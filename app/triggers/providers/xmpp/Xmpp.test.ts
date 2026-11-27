import { EventEmitter } from 'node:events';
import { client } from '@xmpp/client';
import joi from 'joi';
import Xmpp from './Xmpp.js';

vi.mock('@xmpp/client', () => ({
  client: vi.fn(),
  xml: vi.fn((name: string, attrs: object, ...children: unknown[]) => ({ name, attrs, children })),
}));

const container = {
  name: 'container1',
  updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
};
const required = {
  service: 'xmpp://xmpp.example:5222',
  user: 'drydock',
  password: 'secret',
  to: 'ops@example.com',
};

let xmppTrigger: Xmpp;
let session: EventEmitter & { start: any; stop: any; send: any };

function configure(overrides = {}) {
  xmppTrigger.configuration = xmppTrigger.validateConfiguration({ ...required, ...overrides });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  xmppTrigger = new Xmpp();
  session = Object.assign(new EventEmitter(), {
    start: vi.fn().mockImplementation(async () => {
      setImmediate(() => session.emit('online'));
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  });
  vi.mocked(client).mockReturnValue(session as never);
  vi.spyOn(xmppTrigger.log, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

test('validateConfiguration should apply defaults', () => {
  expect(xmppTrigger.validateConfiguration(required)).toMatchObject({
    ...required,
    timeout: 10000,
  });
});

test.each([{}, { ...required, service: 'http://x' }, { ...required, timeout: 0 }])(
  'validateConfiguration should reject %j',
  (configuration) => {
    expect(() => xmppTrigger.validateConfiguration(configuration)).toThrowError(
      joi.ValidationError,
    );
  },
);

test('maskConfiguration should mask the password', () => {
  configure();
  expect(xmppTrigger.maskConfiguration()).toMatchObject({
    user: 'drydock',
    password: '[REDACTED]',
    to: 'ops@example.com',
  });
});

test('trigger should send a chat message and close the session', async () => {
  configure({ domain: 'example.com' });
  await xmppTrigger.trigger(container);
  expect(client).toHaveBeenCalledWith({
    service: required.service,
    domain: 'example.com',
    username: 'drydock',
    password: 'secret',
  });
  expect(session.send).toHaveBeenCalledWith({
    name: 'message',
    attrs: { type: 'chat', to: 'ops@example.com' },
    children: [
      {
        name: 'body',
        attrs: {},
        children: [
          'New tag found for container container1\n\nContainer container1 running with tag 1.0.0 can be updated to tag 2.0.0',
        ],
      },
    ],
  });
  expect(session.stop).toHaveBeenCalledTimes(1);
});

test('triggerBatch should send the batch title and body', async () => {
  configure();
  await xmppTrigger.triggerBatch([container, container]);
  const message = session.send.mock.calls[0][0];
  expect(message.children[0].children[0].startsWith('2 updates available\n\n')).toBe(true);
});

test('sendMessage should reject when sending fails and still close the session', async () => {
  configure();
  session.send.mockRejectedValue(new Error('send failed'));
  await expect(xmppTrigger.trigger(container)).rejects.toThrow('send failed');
  expect(session.stop).toHaveBeenCalledTimes(1);
});

test('sendMessage should ignore a failing stop', async () => {
  configure();
  session.stop.mockRejectedValue(new Error('already stopped'));
  await expect(xmppTrigger.trigger(container)).resolves.toBeUndefined();
});

test('sendMessage should reject on a session error event', async () => {
  configure();
  session.start.mockImplementation(async () => {
    setImmediate(() => session.emit('error', new Error('auth failed')));
  });
  await expect(xmppTrigger.trigger(container)).rejects.toThrow('auth failed');
});

test('sendMessage should reject when the session fails to start', async () => {
  configure();
  session.start.mockRejectedValue(new Error('connect refused'));
  await expect(xmppTrigger.trigger(container)).rejects.toThrow('connect refused');
});

test('sendMessage should ignore events after it settled', async () => {
  configure();
  session.start.mockImplementation(async () => {
    setImmediate(() => {
      session.emit('error', new Error('first'));
      session.emit('error', new Error('second'));
    });
  });
  await expect(xmppTrigger.trigger(container)).rejects.toThrow('first');
});

test('sendMessage should time out and stop the session', async () => {
  vi.useFakeTimers();
  configure({ timeout: 50 });
  session.start.mockReturnValue(new Promise(() => undefined));
  const result = xmppTrigger.trigger(container);
  const assertion = expect(result).rejects.toThrow('XMPP session timed out after 50ms');
  await vi.advanceTimersByTimeAsync(50);
  await assertion;
  expect(session.stop).toHaveBeenCalledTimes(1);
});
