import { GotifyClient } from 'gotify-client';
import Gotify from './Gotify.js';

vi.mock('axios');
vi.mock('gotify-client', () => ({
  GotifyClient: vi.fn().mockImplementation(() => ({
    message: {
      createMessage: vi.fn(),
      deleteMessage: vi.fn(),
    },
  })),
}));

const gotify = new Gotify();

const configurationValid = {
  url: 'http://xxx.com',
  token: 'xxx',
  priority: 2,
  mode: 'simple',
  threshold: 'all',
  once: true,
  auto: 'all',
  order: 100,
  simpletitle:
    '${isDigestUpdate ? container.notificationAgentPrefix + "New image available for container " + container.name + container.notificationWatcherSuffix + " (tag " + currentTag + ")" : container.notificationAgentPrefix + "New " + container.updateKind.kind + " found for container " + container.name + container.notificationWatcherSuffix}',
  simplebody:
    '${isDigestUpdate ? container.notificationAgentPrefix + "Container " + container.name + container.notificationWatcherSuffix + " running tag " + currentTag + " has a newer image available" : container.notificationAgentPrefix + "Container " + container.name + container.notificationWatcherSuffix + " running with " + container.updateKind.kind + " " + container.updateKind.localValue + " can be updated to " + container.updateKind.kind + " " + container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

  batchtitle: '${containers.length} updates available',
  resolvenotifications: false,
  digestcron: '0 8 * * *',
};

beforeEach(async () => {
  vi.resetAllMocks();
});

test('validateConfiguration should return validated configuration when valid', async () => {
  const validatedConfiguration = gotify.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should apply default configuration', async () => {
  const validatedConfiguration = gotify.validateConfiguration({
    url: configurationValid.url,
    token: configurationValid.token,
  });
  const { priority, ...expectedWithoutPriority } = configurationValid;
  expect(validatedConfiguration).toStrictEqual(expectedWithoutPriority);
});

test('validateConfiguration should throw error when invalid', async () => {
  const configuration = {
    url: 'git://xxx.com',
  };
  expect(() => {
    gotify.validateConfiguration(configuration);
  }).toThrow();
});

test('validateConfiguration should reject non-http webhook URLs', async () => {
  expect(() => {
    gotify.validateConfiguration({
      url: 'git://xxx.com',
      token: 'xxx',
    });
  }).toThrow();
});

test('maskConfiguration should mask sensitive data', async () => {
  gotify.configuration = configurationValid;
  expect(gotify.maskConfiguration()).toEqual({
    url: configurationValid.url,
    token: '[REDACTED]',
    priority: 2,
    mode: 'simple',
    threshold: 'all',
    once: true,
    auto: 'all',
    order: 100,
    simpletitle: configurationValid.simpletitle,
    simplebody: configurationValid.simplebody,
    batchtitle: configurationValid.batchtitle,
    resolvenotifications: false,
    digestcron: '0 8 * * *',
  });
});

test('trigger should send POST request to Gotify API', async () => {
  gotify.configuration = configurationValid;
  gotify.client = {
    message: {
      createMessage: vi.fn().mockResolvedValue({}),
    },
  };
  const container = {
    name: 'container1',
    updateKind: {
      kind: 'tag',
      localValue: '1.0.0',
      remoteValue: '2.0.0',
    },
  };
  await gotify.trigger(container);
  expect(gotify.client.message.createMessage).toHaveBeenCalledWith({
    title: 'New tag found for container container1',
    message: 'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
    priority: 2,
  });
});

test('should initialize Gotify client on register', async () => {
  const gotifyInstance = new Gotify();
  await gotifyInstance.register('trigger', 'gotify', 'test', {
    url: 'http://gotify.example.com',
    token: 'test-token',
  });

  expect(gotifyInstance.client).toBeDefined();
  expect(GotifyClient).toHaveBeenCalledWith('http://gotify.example.com', {
    app: 'test-token',
  });
});

test('triggerBatch should send batch notification', async () => {
  gotify.configuration = configurationValid;
  gotify.client = {
    message: {
      createMessage: vi.fn().mockResolvedValue({}),
    },
  };

  const containers = [
    {
      name: 'test1',
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    },
    {
      name: 'test2',
      updateKind: { kind: 'tag', localValue: '1.1', remoteValue: '2.1' },
    },
  ];

  await gotify.triggerBatch(containers);

  expect(gotify.client.message.createMessage).toHaveBeenCalledWith({
    title: '2 updates available',
    message: expect.any(String),
    priority: 2,
  });
});

test('dismiss should delete Gotify message by id', async () => {
  gotify.configuration = configurationValid;
  gotify.client = {
    message: {
      deleteMessage: vi.fn().mockResolvedValue({}),
    },
  };
  (gotify as any).log = {
    info: vi.fn(),
  };
  await gotify.dismiss('watcher_container1', { id: 42 });
  expect((gotify as any).log.info).toHaveBeenCalledWith(
    'Deleting Gotify message 42 for container watcher_container1',
  );
  expect(gotify.client.message.deleteMessage).toHaveBeenCalledWith(42);
});

test('dismiss should do nothing when triggerResult has no id', async () => {
  gotify.configuration = configurationValid;
  gotify.client = {
    message: {
      deleteMessage: vi.fn(),
    },
  };
  await gotify.dismiss('watcher_container1', {});
  expect(gotify.client.message.deleteMessage).not.toHaveBeenCalled();
});

test('dismiss should do nothing when triggerResult is undefined', async () => {
  gotify.configuration = configurationValid;
  gotify.client = {
    message: {
      deleteMessage: vi.fn(),
    },
  };
  await gotify.dismiss('watcher_container1', undefined);
  expect(gotify.client.message.deleteMessage).not.toHaveBeenCalled();
});
