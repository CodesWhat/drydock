// @ts-nocheck
import joi from 'joi';

vi.mock('pushover-notifications', () => ({
  default: class Push {
    send(message, cb) {
      cb(undefined, message);
    }
  },
}));

import Pushover from './Pushover.js';

const pushover = new Pushover();

const configurationValid = {
  user: 'user',
  token: 'token', // NOSONAR - test fixture, not a real credential
  priority: 0,
  sound: 'pushover',
  html: 0,
  threshold: 'all',
  mode: 'simple',
  once: true,
  auto: true,
  order: 100,
  simpletitle: 'New ${container.updateKind.kind} found for container ${container.name}',

  simplebody:
    'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

  batchtitle: '${containers.length} updates available',
  resolvenotifications: false,
};

test('validateConfiguration should return validated configuration when valid', async () => {
  const validatedConfiguration = pushover.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should fail when priority is 2 and no retry set', async () => {
  expect(() => {
    pushover.validateConfiguration({
      ...configurationValid,
      priority: 2,
    });
  }).toThrowError(joi.ValidationError);
});

test('validateConfiguration should fail when priority is 2 and retry too small', async () => {
  expect(() => {
    pushover.validateConfiguration({
      ...configurationValid,
      priority: 2,
      retry: 10,
    });
  }).toThrowError(joi.ValidationError);
});

test('validateConfiguration should fail when priority is 2 and no expire', async () => {
  expect(() => {
    pushover.validateConfiguration({
      ...configurationValid,
      priority: 2,
      retry: 100,
    });
  }).toThrowError(joi.ValidationError);
});

test('validateConfiguration should succeed when priority is 2 and expire and retry set', async () => {
  expect(
    pushover.validateConfiguration({
      ...configurationValid,
      priority: 2,
      retry: 100,
      expire: 200,
    }),
  ).toStrictEqual({
    ...configurationValid,
    priority: 2,
    retry: 100,
    expire: 200,
  });
});

test('validateConfiguration should apply_default_configuration', async () => {
  const validatedConfiguration = pushover.validateConfiguration({
    user: configurationValid.user,
    token: configurationValid.token,
  });
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when invalid', async () => {
  const configuration = {};
  expect(() => {
    pushover.validateConfiguration(configuration);
  }).toThrowError(joi.ValidationError);
});

test('maskConfiguration should mask sensitive data', async () => {
  pushover.configuration = configurationValid;
  expect(pushover.maskConfiguration()).toEqual({
    mode: 'simple',
    priority: 0,
    auto: true,
    order: 100,
    simplebody:
      'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

    simpletitle: 'New ${container.updateKind.kind} found for container ${container.name}',

    batchtitle: '${containers.length} updates available',
    resolvenotifications: false,
    sound: 'pushover',
    html: 0,
    threshold: 'all',
    once: true,
    token: 't***n',
    user: 'u**r',
  });
});

test('trigger should send message to pushover', async () => {
  pushover.configuration = {
    ...configurationValid,
  };
  const container = {
    name: 'container1',
    image: {
      name: 'imageName',
      tag: {
        value: '1.0.0',
      },
      digest: {
        value: '123456789',
      },
    },
    result: {
      tag: '2.0.0',
    },
    updateKind: {
      kind: 'tag',
      localValue: '1.0.0',
      remoteValue: '2.0.0',
      semverDiff: 'major',
    },
  };
  const result = await pushover.trigger(container);
  expect(result).toStrictEqual({
    device: undefined,
    message: 'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
    priority: 0,
    sound: 'pushover',
    html: 0,
    title: 'New tag found for container container1',
  });
});

test('triggerBatch should send batch notification', async () => {
  pushover.configuration = configurationValid;
  const containers = [
    {
      name: 'container1',
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
    },
    {
      name: 'container2',
      updateKind: {
        kind: 'tag',
        localValue: '1.1.0',
        remoteValue: '2.1.0',
      },
    },
  ];
  const result = await pushover.triggerBatch(containers);
  expect(result).toStrictEqual({
    device: undefined,
    message:
      '- Container container1 running with tag 1.0.0 can be updated to tag 2.0.0\n- Container container2 running with tag 1.1.0 can be updated to tag 2.1.0',
    priority: 0,
    sound: 'pushover',
    html: 0,
    title: '2 updates available',
  });
});

test('sendMessage should include retry and expire when priority is 2', async () => {
  pushover.configuration = {
    ...configurationValid,
    priority: 2,
    retry: 60,
    expire: 3600,
  };
  const result = await pushover.sendMessage({
    title: 'Emergency',
    message: 'Urgent update',
  });
  expect(result).toStrictEqual({
    title: 'Emergency',
    message: 'Urgent update',
    sound: 'pushover',
    device: undefined,
    priority: 2,
    html: 0,
    retry: 60,
    expire: 3600,
  });
});

test('sendMessage should include ttl when configured', async () => {
  pushover.configuration = {
    ...configurationValid,
    ttl: 300,
  };
  const result = await pushover.sendMessage({
    title: 'TTL Test',
    message: 'Message with TTL',
  });
  expect(result).toStrictEqual({
    title: 'TTL Test',
    message: 'Message with TTL',
    sound: 'pushover',
    device: undefined,
    priority: 0,
    html: 0,
    ttl: 300,
  });
});

test('sendMessage should reject when push.onerror is called', async () => {
  // Override mock to simulate onerror
  vi.resetModules();
  vi.doMock('pushover-notifications', () => ({
    default: class Push {
      set onerror(fn) {
        this._onerror = fn;
      }
      send(_message, _cb) {
        // Simulate an error via onerror
        this._onerror('connection failed');
      }
    },
  }));
  const { default: PushoverFresh } = await import('./Pushover.js');
  const po = new PushoverFresh();
  po.configuration = { ...configurationValid };
  await expect(po.sendMessage({ title: 'Test', message: 'test' })).rejects.toThrow(
    'connection failed',
  );
});

test('sendMessage should reject when send callback has error', async () => {
  vi.resetModules();
  vi.doMock('pushover-notifications', () => ({
    default: class Push {
      set onerror(_fn) {}
      send(_message, cb) {
        cb('send error', null);
      }
    },
  }));
  const { default: PushoverFresh } = await import('./Pushover.js');
  const po = new PushoverFresh();
  po.configuration = { ...configurationValid };
  await expect(po.sendMessage({ title: 'Test', message: 'test' })).rejects.toThrow('send error');
});
