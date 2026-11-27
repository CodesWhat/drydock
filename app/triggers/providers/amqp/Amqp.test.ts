import amqp from 'amqplib';
import joi from 'joi';
import Amqp from './Amqp.js';

vi.mock('amqplib', () => ({ default: { connect: vi.fn() } }));

const container = {
  name: 'container1',
  updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
};
const url = 'amqp://user:pass@rabbit:5672';

let amqpTrigger: Amqp;
let channel: { assertExchange: any; publish: any; close: any; on: any };
let connection: { on: any; createChannel: any; close: any };
let handlers: Record<string, (...args: any[]) => void>;
let channelHandlers: Record<string, (...args: any[]) => void>;

function configure(overrides = {}) {
  amqpTrigger.configuration = amqpTrigger.validateConfiguration({ url, ...overrides });
}

function publishedPayload(call = 0) {
  return JSON.parse((channel.publish.mock.calls[call][2] as Buffer).toString());
}

beforeEach(() => {
  vi.resetAllMocks();
  amqpTrigger = new Amqp();
  handlers = {};
  channelHandlers = {};
  channel = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      channelHandlers[event] = handler;
    }),
    assertExchange: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockReturnValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  };
  connection = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handler;
    }),
    createChannel: vi.fn().mockResolvedValue(channel),
    close: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(amqp.connect).mockResolvedValue(connection as never);
});

test('validateConfiguration should apply defaults', () => {
  expect(amqpTrigger.validateConfiguration({ url })).toMatchObject({
    url,
    exchange: '',
    routingkey: 'drydock-container',
    exchangetype: 'topic',
    persistent: true,
    disabletitle: false,
  });
});

test.each([{}, { url: 'http://x' }, { url, exchangetype: 'bogus' }])(
  'validateConfiguration should reject %j',
  (configuration) => {
    expect(() => amqpTrigger.validateConfiguration(configuration)).toThrowError(
      joi.ValidationError,
    );
  },
);

test('maskConfiguration should mask the url credentials', () => {
  configure();
  expect(amqpTrigger.maskConfiguration()).toMatchObject({ url: '[REDACTED]' });
});

test('trigger should publish a simple payload to the default exchange', async () => {
  configure();
  await expect(amqpTrigger.trigger(container)).resolves.toBe(true);
  expect(amqp.connect).toHaveBeenCalledWith(url);
  expect(channel.assertExchange).not.toHaveBeenCalled();
  expect(channel.publish).toHaveBeenCalledWith('', 'drydock-container', expect.any(Buffer), {
    persistent: true,
    contentType: 'application/json',
  });
  expect(publishedPayload()).toEqual({
    title: 'New tag found for container container1',
    message: 'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
    mode: 'simple',
    container,
  });
});

test('trigger should drop the title when disabled', async () => {
  configure({ disabletitle: true });
  await amqpTrigger.trigger(container);
  expect(publishedPayload().title).toBe('');
});

test('triggerBatch should publish a batch payload with the event kind', async () => {
  configure();
  await amqpTrigger.triggerBatch([container, container], { eventKind: 'security-alert-digest' });
  expect(publishedPayload()).toMatchObject({
    mode: 'batch',
    eventKind: 'security-alert-digest',
    count: 2,
    containers: [container, container],
  });
});

test('triggerBatch should drop the title when disabled', async () => {
  configure({ disabletitle: true });
  await amqpTrigger.triggerBatch([container]);
  expect(publishedPayload().title).toBe('');
});

test('should assert the configured exchange once and reuse the channel', async () => {
  configure({ exchange: 'drydock', exchangetype: 'fanout', routingkey: 'rk', persistent: false });
  await amqpTrigger.trigger(container);
  await amqpTrigger.trigger(container);
  expect(amqp.connect).toHaveBeenCalledTimes(1);
  expect(channel.assertExchange).toHaveBeenCalledTimes(1);
  expect(channel.assertExchange).toHaveBeenCalledWith('drydock', 'fanout', { durable: true });
  expect(channel.publish).toHaveBeenLastCalledWith('drydock', 'rk', expect.any(Buffer), {
    persistent: false,
    contentType: 'application/json',
  });
});

test('should log connection errors and reconnect after the connection closes', async () => {
  configure();
  const warn = vi.spyOn(amqpTrigger.log, 'warn').mockImplementation(() => undefined);
  await amqpTrigger.trigger(container);
  handlers.error(new Error('reset'));
  expect(warn).toHaveBeenCalledWith('AMQP connection error (reset)');
  handlers.close();
  await amqpTrigger.trigger(container);
  expect(amqp.connect).toHaveBeenCalledTimes(2);
});

test('should listen for channel errors before asserting the exchange, so a broker close cannot crash the process', async () => {
  configure({ exchange: 'drydock' });
  channel.assertExchange.mockImplementation(async () => {
    expect(channelHandlers.error).toBeTypeOf('function');
    expect(channelHandlers.close).toBeTypeOf('function');
  });
  const warn = vi.spyOn(amqpTrigger.log, 'warn').mockImplementation(() => undefined);
  await amqpTrigger.trigger(container);
  channelHandlers.error(new Error('PRECONDITION_FAILED'));
  expect(warn).toHaveBeenCalledWith('AMQP channel error (PRECONDITION_FAILED)');
});

test('should open a fresh channel after the broker closes the current one', async () => {
  configure();
  await amqpTrigger.trigger(container);
  channelHandlers.close();
  await amqpTrigger.trigger(container);
  expect(amqp.connect).toHaveBeenCalledTimes(1);
  expect(connection.createChannel).toHaveBeenCalledTimes(2);
});

test('should ignore a close from a channel that was already replaced', async () => {
  configure();
  await amqpTrigger.trigger(container);
  const staleClose = channelHandlers.close;
  connection.createChannel.mockResolvedValueOnce({ ...channel });
  (amqpTrigger as any).channel = undefined;
  await amqpTrigger.trigger(container);
  staleClose();
  await amqpTrigger.trigger(container);
  expect(connection.createChannel).toHaveBeenCalledTimes(2);
});

test('should share one connection and channel between concurrent first triggers', async () => {
  configure({ exchange: 'drydock' });
  await Promise.all([amqpTrigger.trigger(container), amqpTrigger.trigger(container)]);
  expect(amqp.connect).toHaveBeenCalledTimes(1);
  expect(connection.createChannel).toHaveBeenCalledTimes(1);
  expect(channel.assertExchange).toHaveBeenCalledTimes(1);
  expect(channel.publish).toHaveBeenCalledTimes(2);
});

test('should retry the connection after a failed first attempt', async () => {
  configure();
  vi.mocked(amqp.connect).mockRejectedValueOnce(new Error('refused'));
  await expect(amqpTrigger.trigger(container)).rejects.toThrow('refused');
  await expect(amqpTrigger.trigger(container)).resolves.toBe(true);
  expect(amqp.connect).toHaveBeenCalledTimes(2);
});

test('should reuse an existing connection when only the channel is missing', async () => {
  configure();
  await amqpTrigger.trigger(container);
  (amqpTrigger as any).channel = undefined;
  await amqpTrigger.trigger(container);
  expect(amqp.connect).toHaveBeenCalledTimes(1);
  expect(connection.createChannel).toHaveBeenCalledTimes(2);
});

test('trigger should propagate connection failures', async () => {
  configure();
  vi.mocked(amqp.connect).mockRejectedValue(new Error('refused'));
  await expect(amqpTrigger.trigger(container)).rejects.toThrow('refused');
});

test('deregisterComponent should close the channel and connection', async () => {
  configure();
  await amqpTrigger.trigger(container);
  await amqpTrigger.deregisterComponent();
  expect(channel.close).toHaveBeenCalledTimes(1);
  expect(connection.close).toHaveBeenCalledTimes(1);
});

test('deregisterComponent should do nothing when never connected', async () => {
  configure();
  await expect(amqpTrigger.deregisterComponent()).resolves.toBeUndefined();
  expect(connection.close).not.toHaveBeenCalled();
});

test('deregisterComponent should swallow close errors', async () => {
  configure();
  await amqpTrigger.trigger(container);
  channel.close.mockRejectedValue(new Error('already closed'));
  const debug = vi.spyOn(amqpTrigger.log, 'debug').mockImplementation(() => undefined);
  await expect(amqpTrigger.deregisterComponent()).resolves.toBeUndefined();
  expect(debug).toHaveBeenCalledWith('Error closing AMQP connection (already closed)');
});
