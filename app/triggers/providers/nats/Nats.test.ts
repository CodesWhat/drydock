import joi from 'joi';
import { connect, nkeyAuthenticator } from 'nats';
import Nats from './Nats.js';

vi.mock('nats', () => ({
  connect: vi.fn(),
  nkeyAuthenticator: vi.fn(() => 'nkey-authenticator'),
}));

const container = {
  name: 'container1',
  updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
};

let natsTrigger: Nats;
let connection: {
  publish: any;
  flush: any;
  drain: any;
  isClosed: any;
};

function configure(overrides = {}) {
  natsTrigger.configuration = natsTrigger.validateConfiguration({
    servers: 'nats://a:4222, nats://b:4222,',
    ...overrides,
  });
}

function publishedPayload(call = 0) {
  return JSON.parse(new TextDecoder().decode(connection.publish.mock.calls[call][1]));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(nkeyAuthenticator).mockReturnValue('nkey-authenticator' as never);
  natsTrigger = new Nats();
  connection = {
    publish: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    drain: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
  };
  vi.mocked(connect).mockResolvedValue(connection as never);
});

test('validateConfiguration should apply defaults', () => {
  expect(natsTrigger.validateConfiguration({ servers: 'nats://a:4222' })).toMatchObject({
    servers: 'nats://a:4222',
    subject: 'drydock.container',
    disabletitle: false,
  });
});

test.each([{}, { servers: 'a', subject: 5 }])(
  'validateConfiguration should reject %j',
  (configuration) => {
    expect(() => natsTrigger.validateConfiguration(configuration)).toThrowError(
      joi.ValidationError,
    );
  },
);

test('maskConfiguration should mask the password, token and nkey', () => {
  configure({ user: 'u', password: 'p', token: 't', nkey: 'SUABC' });
  expect(natsTrigger.maskConfiguration()).toMatchObject({
    user: 'u',
    password: '[REDACTED]',
    token: '[REDACTED]',
    nkey: '[REDACTED]',
  });
});

test('trigger should connect without credentials and publish a simple payload', async () => {
  configure();
  await natsTrigger.trigger(container);
  expect(connect).toHaveBeenCalledWith({ servers: ['nats://a:4222', 'nats://b:4222'] });
  expect(connection.publish).toHaveBeenCalledWith('drydock.container', expect.any(Uint8Array));
  expect(connection.flush).toHaveBeenCalledTimes(1);
  expect(publishedPayload()).toEqual({
    title: 'New tag found for container container1',
    message: 'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
    mode: 'simple',
    container,
  });
});

test('trigger should drop the title when disabled', async () => {
  configure({ disabletitle: true, subject: 'custom.subject' });
  await natsTrigger.trigger(container);
  expect(connection.publish.mock.calls[0][0]).toBe('custom.subject');
  expect(publishedPayload().title).toBe('');
});

test('triggerBatch should publish a batch payload with the event kind', async () => {
  configure();
  await natsTrigger.triggerBatch([container, container], { eventKind: 'security-alert-digest' });
  expect(publishedPayload()).toMatchObject({
    mode: 'batch',
    eventKind: 'security-alert-digest',
    count: 2,
    containers: [container, container],
  });
});

test('triggerBatch should drop the title when disabled', async () => {
  configure({ disabletitle: true });
  await natsTrigger.triggerBatch([container]);
  expect(publishedPayload().title).toBe('');
});

test('connection should use user and password when both are set', async () => {
  configure({ user: 'u', password: 'p', token: 't' });
  await natsTrigger.trigger(container);
  expect(connect).toHaveBeenCalledWith(expect.objectContaining({ user: 'u', pass: 'p' }));
  expect(vi.mocked(connect).mock.calls[0][0]).not.toHaveProperty('token');
});

test('connection should use the auth token when no user and password pair is set', async () => {
  configure({ user: 'u', token: 't' });
  await natsTrigger.trigger(container);
  expect(connect).toHaveBeenCalledWith(expect.objectContaining({ token: 't' }));
});

test('connection should use an nkey authenticator built from the seed', async () => {
  configure({ nkey: 'SUABC' });
  await natsTrigger.trigger(container);
  expect(nkeyAuthenticator).toHaveBeenCalledWith(new TextEncoder().encode('SUABC'));
  expect(connect).toHaveBeenCalledWith(
    expect.objectContaining({ authenticator: 'nkey-authenticator' }),
  );
});

test('should reuse an open connection and reconnect after it closes', async () => {
  configure();
  await natsTrigger.trigger(container);
  await natsTrigger.trigger(container);
  expect(connect).toHaveBeenCalledTimes(1);
  connection.isClosed.mockReturnValue(true);
  await natsTrigger.trigger(container);
  expect(connect).toHaveBeenCalledTimes(2);
});

test('trigger should propagate connection failures', async () => {
  configure();
  vi.mocked(connect).mockRejectedValue(new Error('refused'));
  await expect(natsTrigger.trigger(container)).rejects.toThrow('refused');
});

test('deregisterComponent should drain an open connection', async () => {
  configure();
  await natsTrigger.trigger(container);
  await natsTrigger.deregisterComponent();
  expect(connection.drain).toHaveBeenCalledTimes(1);
});

test('deregisterComponent should skip a closed connection', async () => {
  configure();
  await natsTrigger.trigger(container);
  connection.isClosed.mockReturnValue(true);
  await natsTrigger.deregisterComponent();
  expect(connection.drain).not.toHaveBeenCalled();
});

test('deregisterComponent should do nothing when never connected', async () => {
  configure();
  await expect(natsTrigger.deregisterComponent()).resolves.toBeUndefined();
});

test('deregisterComponent should swallow drain errors', async () => {
  configure();
  await natsTrigger.trigger(container);
  connection.drain.mockRejectedValue(new Error('draining'));
  const debug = vi.spyOn(natsTrigger.log, 'debug').mockImplementation(() => undefined);
  await expect(natsTrigger.deregisterComponent()).resolves.toBeUndefined();
  expect(debug).toHaveBeenCalledWith('Error draining NATS connection (draining)');
});
