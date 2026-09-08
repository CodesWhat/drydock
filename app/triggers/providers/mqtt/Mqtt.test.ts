import joi from 'joi';
import mqttClient from 'mqtt';
import {
  clearAllListenersForTests,
  emitContainerAdded,
  emitContainerUpdated,
  emitUpdateOperationChanged,
} from '../../../event/index.js';
import log from '../../../log/index.js';
import { flatten, validate } from '../../../model/container.js';
import * as containerStore from '../../../store/container.js';
import * as updateOperationStore from '../../../store/update-operation.js';

vi.mock('mqtt');
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue(Buffer.from('file-content')),
  },
  readFile: vi.fn().mockResolvedValue(Buffer.from('file-content')),
}));

import fs from 'node:fs/promises';
import Trigger from '../Trigger.js';
import Hass from './Hass.js';
import Mqtt from './Mqtt.js';

const mqtt = new Mqtt();
mqtt.log = log;

const configurationValid = {
  url: 'mqtt://host:1883',
  topic: 'dd/container',
  clientid: 'dd',
  exclude: '',
  hass: {
    discovery: false,
    agenttopicsegment: true,
    commands: false,
    enabled: false,
    prefix: 'homeassistant',
    attributes: 'short',
    filter: {
      include: '',
      exclude: '',
    },
  },
  tls: {
    clientkey: undefined,
    clientcert: undefined,
    cachain: undefined,
    rejectunauthorized: true,
  },
  threshold: 'all',
  mode: 'simple',
  once: true,
  auto: 'all',
  order: 100,
  simpletitle:
    '${isDigestUpdate ? container.notificationAgentPrefix + "New image available for container " + container.name + container.notificationWatcherSuffix + " (tag " + currentTag + ")" : container.notificationAgentPrefix + "New " + container.updateKind.kind + " found for container " + container.name + container.notificationWatcherSuffix}',

  simplebody:
    '${isDigestUpdate ? container.notificationAgentPrefix + "Container " + container.name + container.notificationWatcherSuffix + " running tag " + currentTag + " has a newer image available" : container.notificationAgentPrefix + "Container " + container.name + container.notificationWatcherSuffix + " running with " + container.updateKind.kind + " " + container.updateKind.localValue + " can be updated to " + container.updateKind.kind + " " + container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

  batchtitle: '${containers.length} updates available',
  resolvenotifications: false,
  securitymode: 'simple',
  digestcron: '0 8 * * *',
};

const containerData = [
  {
    containerName: 'homeassistant',
    data: {
      name: 'homeassistant',
      topic: 'dd/container/local/homeassistant',
    },
  },
  {
    containerName: 'home.assistant',
    data: {
      name: 'home.assistant',
      topic: 'dd/container/local/home-assistant',
    },
  },
];

beforeEach(async () => {
  vi.resetAllMocks();
  clearAllListenersForTests();
  mqtt.client = {
    publish: vi.fn(() => {}),
  };
});

test('validateConfiguration should return validated configuration when valid', async () => {
  const validatedConfiguration = mqtt.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should apply_default_configuration', async () => {
  const validatedConfiguration = mqtt.validateConfiguration({
    url: configurationValid.url,
    clientid: 'dd',
  });
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should generate a default client id when not provided', async () => {
  const validatedConfiguration = mqtt.validateConfiguration({
    url: configurationValid.url,
  });
  expect(validatedConfiguration.clientid).toMatch(/^dd_[0-9a-f]{8}$/);
});

test('validateConfiguration should default hass.discovery to true when hass.enabled is true', async () => {
  const validatedConfiguration = mqtt.validateConfiguration({
    url: configurationValid.url,
    clientid: 'dd',
    hass: {
      enabled: true,
      prefix: 'homeassistant',
    },
  });
  expect(validatedConfiguration.hass).toStrictEqual({
    enabled: true,
    prefix: 'homeassistant',
    discovery: true,
    agenttopicsegment: true,
    commands: false,
    attributes: 'short',
    filter: {
      include: '',
      exclude: '',
    },
  });
});

test('validateConfiguration should default hass.agenttopicsegment to true', async () => {
  const validatedConfiguration = mqtt.validateConfiguration({
    url: configurationValid.url,
    clientid: 'dd',
    hass: {
      enabled: true,
      prefix: 'homeassistant',
    },
  });
  expect(validatedConfiguration.hass.agenttopicsegment).toBe(true);
});

test('validateConfiguration should respect an explicit hass.agenttopicsegment=false opt-out', async () => {
  const validatedConfiguration = mqtt.validateConfiguration({
    url: configurationValid.url,
    clientid: 'dd',
    hass: {
      enabled: true,
      prefix: 'homeassistant',
      agenttopicsegment: false,
    },
  });
  expect(validatedConfiguration.hass.agenttopicsegment).toBe(false);
});

test('validateConfiguration should throw error when invalid', async () => {
  const configuration = {
    url: 'http://invalid',
  };
  expect(() => {
    mqtt.validateConfiguration(configuration);
  }).toThrowError(joi.ValidationError);
});

test('maskConfiguration should mask sensitive data', async () => {
  mqtt.configuration = {
    password: 'password',
    url: 'mqtt://host:1883',
    topic: 'dd/container',
    hass: {
      discovery: false,
      enabled: false,
      prefix: 'homeassistant',
    },
  };
  expect(mqtt.maskConfiguration()).toEqual({
    hass: {
      discovery: false,
      enabled: false,
      prefix: 'homeassistant',
    },
    password: '[REDACTED]',
    topic: 'dd/container',
    url: 'mqtt://host:1883',
  });
});

test('initTrigger should init Mqtt client', async () => {
  mqtt.configuration = {
    ...configurationValid,
    user: 'user',
    password: 'password',
    clientid: 'dd',
    hass: {
      enabled: true,
      discovery: true,
      prefix: 'homeassistant',
      attributes: 'short',
      filter: {
        include: '',
        exclude: '',
      },
    },
  };
  const spy = vi.spyOn(mqttClient, 'connectAsync');
  await mqtt.initTrigger();
  expect(spy).toHaveBeenCalledWith('mqtt://host:1883', {
    clientId: 'dd',
    username: 'user',
    password: 'password',
    rejectUnauthorized: true,
  });
});

test.each(containerData)(
  'trigger should format json message payload as expected',
  async ({ containerName, data }) => {
    mqtt.configuration = {
      topic: 'dd/container',
      exclude: '',
      hass: {
        attributes: 'full',
        filter: {
          include: '',
          exclude: '',
        },
      },
    };
    const container = {
      id: '31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816',
      name: containerName,
      watcher: 'local',
      includeTags: '^\\d+\\.\\d+.\\d+$',
      image: {
        id: 'sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6',
        registry: {
          url: '123456789.dkr.ecr.eu-west-1.amazonaws.com',
        },
        name: 'test',
        tag: {
          value: '2021.6.4',
          semver: true,
        },
        digest: {
          watch: false,
          repo: 'sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72',
        },
        architecture: 'amd64',
        os: 'linux',
        created: '2021-06-12T05:33:38.440Z',
      },
      result: {
        tag: '2021.6.5',
      },
    };
    await mqtt.trigger(container);
    expect(mqtt.client.publish).toHaveBeenCalledWith(
      data.topic,
      JSON.stringify(flatten(container)),
      {
        retain: true,
      },
    );
  },
);

// Regression guard for #491: the HA latest_version_template reads result_tag /
// result_digest / image_tag_value from the flattened MQTT state payload. Lock the
// shape the template depends on — an up-to-date container carries image_tag_value
// but NO result_* keys (the case that used to render an empty "Newest version"),
// while tag/digest updates carry the matching result_* field.
test('trigger should publish latest-version source fields for current, tag, and digest states', async () => {
  mqtt.configuration = {
    topic: 'dd/container',
    exclude: '',
    hass: {
      attributes: 'full',
      filter: {
        include: '',
        exclude: '',
      },
    },
  };

  const installedDigest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const remoteDigest = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  const buildContainer = ({ id, name, digestWatch = false, result }) =>
    validate({
      id,
      name,
      watcher: 'local',
      image: {
        id: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        registry: {
          name: 'docker.io',
          url: 'docker.io',
        },
        name: 'library/test',
        tag: {
          value: '1.25.0',
          semver: true,
        },
        digest: {
          watch: digestWatch,
          value: installedDigest,
        },
        architecture: 'amd64',
        os: 'linux',
      },
      ...(result ? { result } : {}),
    });

  const publishContainer = async (container) => {
    mqtt.client.publish.mockClear();
    await mqtt.trigger(container);
    expect(mqtt.client.publish).toHaveBeenCalledTimes(1);
    return JSON.parse(mqtt.client.publish.mock.calls[0][1]);
  };

  const upToDatePayload = await publishContainer(
    buildContainer({ id: 'container-current', name: 'current' }),
  );
  expect(upToDatePayload).toHaveProperty('update_available', false);
  expect(upToDatePayload).toHaveProperty('image_tag_value', '1.25.0');
  expect(upToDatePayload).not.toHaveProperty('result_tag');
  expect(upToDatePayload).not.toHaveProperty('result_digest');

  const tagUpdatePayload = await publishContainer(
    buildContainer({
      id: 'container-tag-update',
      name: 'tag-update',
      result: { tag: '1.26.0' },
    }),
  );
  expect(tagUpdatePayload).toHaveProperty('update_available', true);
  expect(tagUpdatePayload).toHaveProperty('update_kind_kind', 'tag');
  expect(tagUpdatePayload).toHaveProperty('result_tag', '1.26.0');

  const digestUpdatePayload = await publishContainer(
    buildContainer({
      id: 'container-digest-update',
      name: 'digest-update',
      digestWatch: true,
      result: { digest: remoteDigest },
    }),
  );
  expect(digestUpdatePayload).toHaveProperty('update_available', true);
  expect(digestUpdatePayload).toHaveProperty('update_kind_kind', 'digest');
  expect(digestUpdatePayload).toHaveProperty('result_digest', remoteDigest);
});

test('trigger should normalize recreated alias-prefixed container names to their base topic', async () => {
  mqtt.configuration = {
    topic: 'dd/container',
    exclude: '',
    hass: {
      attributes: 'full',
      filter: {
        include: '',
        exclude: '',
      },
    },
  };

  const container = {
    id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
    name: '7ea6b8a42686_termix',
    watcher: 'local',
    includeTags: '^\\d+\\.\\d+.\\d+$',
    image: {
      id: 'sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6',
      registry: {
        url: '123456789.dkr.ecr.eu-west-1.amazonaws.com',
      },
      name: 'test',
      tag: {
        value: '2021.6.4',
        semver: true,
      },
      digest: {
        watch: false,
        repo: 'sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72',
      },
      architecture: 'amd64',
      os: 'linux',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: '2021.6.5',
    },
  };

  await mqtt.trigger(container);

  expect(mqtt.client.publish).toHaveBeenCalledWith(
    'dd/container/local/termix',
    JSON.stringify(flatten(container)),
    {
      retain: true,
    },
  );
});

test('trigger should key the state topic by compose project-service identity when compose labels are present', async () => {
  mqtt.configuration = {
    topic: 'dd/container',
    exclude: '',
    hass: {
      attributes: 'full',
      filter: {
        include: '',
        exclude: '',
      },
    },
  };

  const container = {
    id: 'abc123',
    name: 'myapp_web_1',
    watcher: 'local',
    labels: {
      'com.docker.compose.project': 'myapp',
      'com.docker.compose.service': 'web',
    },
    image: {
      id: 'sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6',
      registry: {
        url: '123456789.dkr.ecr.eu-west-1.amazonaws.com',
      },
      name: 'test',
      tag: {
        value: '2021.6.4',
        semver: true,
      },
      digest: {
        watch: false,
        repo: 'sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72',
      },
      architecture: 'amd64',
      os: 'linux',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: '2021.6.5',
    },
  };

  await mqtt.trigger(container);

  expect(mqtt.client.publish).toHaveBeenCalledWith(
    'dd/container/local/myapp.web',
    JSON.stringify(flatten(container)),
    {
      retain: true,
    },
  );
});

test('trigger should keep the compose-identity state topic stable across a container rename', async () => {
  mqtt.configuration = {
    topic: 'dd/container',
    exclude: '',
    hass: {
      attributes: 'full',
      filter: {
        include: '',
        exclude: '',
      },
    },
  };

  const renamedContainer = {
    id: 'abc123',
    name: 'myapp_web_2_renamed',
    watcher: 'local',
    labels: {
      'com.docker.compose.project': 'myapp',
      'com.docker.compose.service': 'web',
    },
    image: {
      id: 'sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6',
      registry: {
        url: '123456789.dkr.ecr.eu-west-1.amazonaws.com',
      },
      name: 'test',
      tag: {
        value: '2021.6.4',
        semver: true,
      },
      digest: {
        watch: false,
        repo: 'sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72',
      },
      architecture: 'amd64',
      os: 'linux',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: '2021.6.5',
    },
  };

  await mqtt.trigger(renamedContainer);

  expect(mqtt.client.publish).toHaveBeenCalledWith(
    'dd/container/local/myapp.web',
    JSON.stringify(flatten(renamedContainer)),
    {
      retain: true,
    },
  );
});

// #386 / DR-129: two independent publishers build the same container state
// topic. Mqtt.trigger publishes the state payload; Hass publishes the discovery
// config that names `state_topic`/`latest_version_topic`/`json_attributes_topic`
// (and the command topic derived from it). If they disagree for an agent-owned
// container under `hass.agenttopicsegment`, the Home Assistant entity is created
// but never receives state and sits permanently on "Unknown".
describe('agent state topic parity with hass discovery', () => {
  const agentContainer = {
    id: '31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816',
    name: 'nginx',
    watcher: 'local',
    agent: 'ml',
    image: {
      id: 'sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6',
      registry: {
        url: '123456789.dkr.ecr.eu-west-1.amazonaws.com',
      },
      name: 'test',
      tag: {
        value: '2021.6.4',
        semver: true,
      },
      digest: {
        watch: false,
        repo: 'sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72',
      },
      architecture: 'amd64',
      os: 'linux',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: '2021.6.5',
    },
  };

  function buildConfiguration({ enabled, agenttopicsegment }) {
    return {
      url: 'mqtt://host:1883',
      topic: 'dd/container',
      exclude: '',
      hass: {
        enabled,
        discovery: enabled,
        prefix: 'homeassistant',
        agenttopicsegment,
        commands: false,
        attributes: 'full',
        filter: {
          include: '',
          exclude: '',
        },
      },
    };
  }

  async function publishedTopic(configuration, container) {
    mqtt.configuration = configuration;
    await mqtt.trigger(container);
    return mqtt.client.publish.mock.calls[0][0];
  }

  test('publishes an agent container to the topic hass discovery advertises', async () => {
    const configuration = buildConfiguration({ enabled: true, agenttopicsegment: true });
    const hass = new Hass({
      client: mqtt.client,
      configuration,
      log,
      isContainerAllowed: () => true,
    });

    try {
      const topic = await publishedTopic(configuration, agentContainer);

      expect(topic).toBe('dd/container/agent/ml/local/nginx');
      expect(topic).toBe(hass.getContainerStateTopic({ container: agentContainer }));
      expect(mqtt.client.publish).toHaveBeenCalledWith(
        topic,
        JSON.stringify(flatten(agentContainer)),
        {
          retain: true,
        },
      );
    } finally {
      await hass.deregister();
    }
  });

  test('publishes an agent container with a Compose identity slug to the topic hass discovery advertises', async () => {
    const configuration = buildConfiguration({ enabled: true, agenttopicsegment: true });
    const composeAgentContainer = {
      ...agentContainer,
      name: 'myapp_web_1',
      labels: {
        'com.docker.compose.project': 'myapp',
        'com.docker.compose.service': 'web',
      },
    };
    const hass = new Hass({
      client: mqtt.client,
      configuration,
      log,
      isContainerAllowed: () => true,
    });

    try {
      const topic = await publishedTopic(configuration, composeAgentContainer);

      expect(topic).toBe('dd/container/agent/ml/local/myapp.web');
      expect(topic).toBe(hass.getContainerStateTopic({ container: composeAgentContainer }));
    } finally {
      await hass.deregister();
    }
  });

  test('keeps the unscoped topic for an agent container on the agenttopicsegment=false opt-out', async () => {
    const configuration = buildConfiguration({ enabled: true, agenttopicsegment: false });
    const hass = new Hass({
      client: mqtt.client,
      configuration,
      log,
      isContainerAllowed: () => true,
    });

    try {
      const topic = await publishedTopic(configuration, agentContainer);

      expect(topic).toBe('dd/container/local/nginx');
      expect(topic).toBe(hass.getContainerStateTopic({ container: agentContainer }));
    } finally {
      await hass.deregister();
    }
  });

  test('keeps the unscoped topic for an agent container when hass is disabled', async () => {
    const topic = await publishedTopic(
      buildConfiguration({ enabled: false, agenttopicsegment: true }),
      agentContainer,
    );

    expect(topic).toBe('dd/container/local/nginx');
  });

  test('keeps the unscoped topic for a controller-local container', async () => {
    const configuration = buildConfiguration({ enabled: true, agenttopicsegment: true });
    const localContainer = { ...agentContainer, agent: undefined };
    const hass = new Hass({
      client: mqtt.client,
      configuration,
      log,
      isContainerAllowed: () => true,
    });

    try {
      const topic = await publishedTopic(configuration, localContainer);

      expect(topic).toBe('dd/container/local/nginx');
      expect(topic).toBe(hass.getContainerStateTopic({ container: localContainer }));
    } finally {
      await hass.deregister();
    }
  });
});

test('initTrigger should read TLS files when configured', async () => {
  // Re-set mock after vi.resetAllMocks() cleared it
  fs.readFile.mockResolvedValue(Buffer.from('file-content'));
  const spy = vi.spyOn(mqttClient, 'connectAsync');

  mqtt.configuration = {
    ...configurationValid,
    clientid: 'dd',
    tls: {
      clientkey: '/path/to/key.pem',
      clientcert: '/path/to/cert.pem',
      cachain: '/path/to/ca.pem',
      rejectunauthorized: false,
    },
    hass: {
      enabled: false,
      discovery: false,
      prefix: 'homeassistant',
      attributes: 'short',
      filter: {
        include: '',
        exclude: '',
      },
    },
  };
  await mqtt.initTrigger();

  expect(fs.readFile).toHaveBeenCalledWith('/path/to/key.pem');
  expect(fs.readFile).toHaveBeenCalledWith('/path/to/cert.pem');
  expect(fs.readFile).toHaveBeenCalledWith('/path/to/ca.pem');
  expect(spy).toHaveBeenCalledWith(
    'mqtt://host:1883',
    expect.objectContaining({
      key: Buffer.from('file-content'),
      cert: Buffer.from('file-content'),
      ca: [Buffer.from('file-content')],
      rejectUnauthorized: false,
    }),
  );
});

test('triggerBatch should throw error', async () => {
  await expect(mqtt.triggerBatch()).rejects.toThrow('This trigger does not support "batch" mode');
});

test('handleContainerEvent should log when trigger fails', async () => {
  const warnSpy = vi.spyOn(mqtt.log, 'warn');
  const debugSpy = vi.spyOn(mqtt.log, 'debug');
  vi.spyOn(mqtt, 'trigger').mockRejectedValue(new Error('boom'));

  mqtt.handleContainerEvent({ name: 'broken', watcher: 'local' });
  await Promise.resolve();

  expect(warnSpy).toHaveBeenCalledWith('Error (boom)');
  expect(debugSpy).toHaveBeenCalledWith(expect.any(Error));
});

test('handleContainerEvent should skip trigger when mustTrigger is false', async () => {
  const mustTriggerSpy = vi.spyOn(mqtt, 'mustTrigger').mockReturnValue(false);
  const triggerSpy = vi.spyOn(mqtt, 'trigger').mockResolvedValue(undefined);

  mqtt.handleContainerEvent({ name: 'ignored', watcher: 'local' });
  await Promise.resolve();

  expect(mustTriggerSpy).toHaveBeenCalledWith({ name: 'ignored', watcher: 'local' });
  expect(triggerSpy).not.toHaveBeenCalled();
});

test('initTrigger should execute registered container event callbacks', async () => {
  mqtt.configuration = {
    ...configurationValid,
    clientid: 'dd',
    hass: {
      enabled: false,
      discovery: false,
      prefix: 'homeassistant',
      attributes: 'short',
      filter: {
        include: '',
        exclude: '',
      },
    },
  };
  vi.spyOn(mqttClient, 'connectAsync').mockResolvedValue({
    publish: vi.fn().mockResolvedValue(undefined),
  });
  const triggerSpy = vi.spyOn(mqtt, 'trigger').mockResolvedValue(undefined);

  await mqtt.initTrigger();

  emitContainerAdded({ name: 'container-a', watcher: 'local' });
  emitContainerUpdated({ name: 'container-b', watcher: 'local' });
  await Promise.resolve();

  expect(triggerSpy).toHaveBeenCalledTimes(2);
});

test('deregister then initTrigger should not duplicate container event callbacks', async () => {
  mqtt.configuration = {
    ...configurationValid,
    clientid: 'dd',
    hass: {
      enabled: false,
      discovery: false,
      prefix: 'homeassistant',
      attributes: 'short',
      filter: {
        include: '',
        exclude: '',
      },
    },
  };
  vi.spyOn(mqttClient, 'connectAsync').mockResolvedValue({
    publish: vi.fn().mockResolvedValue(undefined),
  });
  const triggerSpy = vi.spyOn(mqtt, 'trigger').mockResolvedValue(undefined);

  await mqtt.initTrigger();
  await mqtt.deregister();
  await mqtt.initTrigger();

  emitContainerAdded({ name: 'container-c', watcher: 'local' });
  await Promise.resolve();

  expect(triggerSpy).toHaveBeenCalledTimes(1);
});

describe('hass.attributes validation', () => {
  test('should accept hass.attributes short', () => {
    const validated = mqtt.validateConfiguration({
      url: configurationValid.url,
      clientid: 'dd',
      hass: { attributes: 'short' },
    });
    expect(validated.hass.attributes).toBe('short');
  });

  test('should default hass.attributes to short', () => {
    const validated = mqtt.validateConfiguration({
      url: configurationValid.url,
      clientid: 'dd',
    });
    expect(validated.hass.attributes).toBe('short');
  });

  test('should reject invalid hass.attributes value', () => {
    expect(() => {
      mqtt.validateConfiguration({
        url: configurationValid.url,
        clientid: 'dd',
        hass: { attributes: 'invalid' },
      });
    }).toThrowError(joi.ValidationError);
  });
});

describe('hass.filter validation', () => {
  test('should default hass.filter include and exclude to empty strings', () => {
    const validated = mqtt.validateConfiguration({
      url: configurationValid.url,
      clientid: 'dd',
    });
    expect(validated.hass.filter).toStrictEqual({
      include: '',
      exclude: '',
    });
  });

  test('should accept hass.filter include and exclude', () => {
    const validated = mqtt.validateConfiguration({
      url: configurationValid.url,
      clientid: 'dd',
      hass: {
        filter: {
          include: 'name,image_name,result_tag',
          exclude: 'security_sbom_documents_0_spdx_version',
        },
      },
    });
    expect(validated.hass.filter).toStrictEqual({
      include: 'name,image_name,result_tag',
      exclude: 'security_sbom_documents_0_spdx_version',
    });
  });
});

describe('exclude validation', () => {
  test('should accept exclude as comma-separated string', () => {
    const validated = mqtt.validateConfiguration({
      url: configurationValid.url,
      clientid: 'dd',
      exclude: 'security.sbom.documents,details,labels',
    });
    expect(validated.exclude).toBe('security.sbom.documents,details,labels');
  });

  test('should default exclude to empty string', () => {
    const validated = mqtt.validateConfiguration({
      url: configurationValid.url,
      clientid: 'dd',
    });
    expect(validated.exclude).toBe('');
  });

  test('should handle empty exclude string', () => {
    const validated = mqtt.validateConfiguration({
      url: configurationValid.url,
      clientid: 'dd',
      exclude: '',
    });
    expect(validated.exclude).toBe('');
  });
});

describe('trigger filtering', () => {
  const containerWithSecurity = {
    id: 'abc123',
    name: 'filtered-test',
    watcher: 'local',
    details: { ports: ['80/tcp'], volumes: [], env: [] },
    labels: { 'com.docker.compose.project': 'app' },
    security: {
      scan: {
        scanner: 'trivy',
        status: 'passed',
        summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
        vulnerabilities: [{ id: 'CVE-2024-0001' }],
      },
      sbom: {
        format: 'spdx',
        documents: [{ spdxVersion: 'SPDX-2.3' }],
      },
    },
    image: {
      id: 'sha256:abc',
      registry: { url: 'docker.io' },
      name: 'nginx',
      tag: { value: '1.25', semver: true },
      digest: { watch: false },
      architecture: 'amd64',
      os: 'linux',
    },
    result: { tag: '1.26' },
  };

  test('should publish filtered container when hass.attributes is short', async () => {
    mqtt.configuration = {
      topic: 'dd/container',
      exclude: '',
      hass: {
        attributes: 'short',
        filter: {
          include: '',
          exclude: '',
        },
      },
    };
    await mqtt.trigger(containerWithSecurity);

    const publishedPayload = JSON.parse(mqtt.client.publish.mock.calls[0][1]);
    expect(publishedPayload).not.toHaveProperty('details_ports_0');
    expect(publishedPayload).not.toHaveProperty('labels_com_docker_compose_project');
    expect(publishedPayload).not.toHaveProperty('security_sbom_documents_0_spdx_version');
    expect(publishedPayload).not.toHaveProperty('security_scan_vulnerabilities_0_id');
    expect(publishedPayload).toHaveProperty('security_scan_status', 'passed');
    expect(publishedPayload).toHaveProperty('security_sbom_format', 'spdx');
  });

  test('should publish full container when hass.attributes is full', async () => {
    mqtt.configuration = {
      topic: 'dd/container',
      exclude: '',
      hass: {
        attributes: 'full',
        filter: {
          include: '',
          exclude: '',
        },
      },
    };
    await mqtt.trigger(containerWithSecurity);

    const publishedPayload = JSON.parse(mqtt.client.publish.mock.calls[0][1]);
    expect(publishedPayload).toHaveProperty('security_scan_vulnerabilities_0_id', 'CVE-2024-0001');
    expect(publishedPayload).toHaveProperty('security_sbom_documents_0_spdx_version', 'SPDX-2.3');
    expect(publishedPayload).toHaveProperty('details_ports_0', '80/tcp');
  });

  test('should use exclude over hass.attributes when both set', async () => {
    mqtt.configuration = {
      topic: 'dd/container',
      exclude: 'details',
      hass: {
        attributes: 'short',
        filter: {
          include: '',
          exclude: '',
        },
      },
    };
    await mqtt.trigger(containerWithSecurity);

    const publishedPayload = JSON.parse(mqtt.client.publish.mock.calls[0][1]);
    // exclude wins: only 'details' stripped, not the full 'short' preset
    expect(publishedPayload).not.toHaveProperty('details_ports_0');
    expect(publishedPayload).toHaveProperty('security_sbom_documents_0_spdx_version', 'SPDX-2.3');
    expect(publishedPayload).toHaveProperty('security_scan_vulnerabilities_0_id', 'CVE-2024-0001');
  });

  test('should use hass.filter.include over all other filters when set', async () => {
    mqtt.configuration = {
      topic: 'dd/container',
      exclude: 'details',
      hass: {
        attributes: 'short',
        filter: {
          include: 'name,image_name,result_tag',
          exclude: 'security_scan_vulnerabilities_0_id',
        },
      },
    };
    await mqtt.trigger(containerWithSecurity);

    const publishedPayload = JSON.parse(mqtt.client.publish.mock.calls[0][1]);
    expect(publishedPayload).toEqual({
      name: 'filtered-test',
      image_name: 'nginx',
      result_tag: '1.26',
    });
  });

  test('should use hass.filter.exclude over legacy exclude and hass.attributes', async () => {
    mqtt.configuration = {
      topic: 'dd/container',
      exclude: 'details',
      hass: {
        attributes: 'short',
        filter: {
          include: '',
          exclude: 'security_sbom_documents_0_spdx_version',
        },
      },
    };
    await mqtt.trigger(containerWithSecurity);

    const publishedPayload = JSON.parse(mqtt.client.publish.mock.calls[0][1]);
    expect(publishedPayload).not.toHaveProperty('security_sbom_documents_0_spdx_version');
    expect(publishedPayload).toHaveProperty('details_ports_0', '80/tcp');
    expect(publishedPayload).toHaveProperty('security_scan_vulnerabilities_0_id', 'CVE-2024-0001');
  });

  test('should publish full container when both are default', async () => {
    mqtt.configuration = {
      topic: 'dd/container',
      exclude: '',
      hass: {
        attributes: 'full',
        filter: {
          include: '',
          exclude: '',
        },
      },
    };
    await mqtt.trigger(containerWithSecurity);

    const publishedPayload = JSON.parse(mqtt.client.publish.mock.calls[0][1]);
    expect(publishedPayload).toHaveProperty('security_scan_vulnerabilities_0_id', 'CVE-2024-0001');
    expect(publishedPayload).toHaveProperty('details_ports_0', '80/tcp');
    expect(publishedPayload).toHaveProperty('labels_com_docker_compose_project', 'app');
  });

  test('should default hass.attributes to short when not provided in runtime config', async () => {
    mqtt.configuration = {
      topic: 'dd/container',
      exclude: '',
      hass: {
        filter: {
          include: '',
          exclude: '',
        },
      },
    };
    await mqtt.trigger(containerWithSecurity);

    const publishedPayload = JSON.parse(mqtt.client.publish.mock.calls[0][1]);
    expect(publishedPayload).not.toHaveProperty('security_scan_vulnerabilities_0_id');
    expect(publishedPayload).not.toHaveProperty('details_ports_0');
    expect(publishedPayload).toHaveProperty('name', 'filtered-test');
  });
});

// ── #210: hass.commands (bidirectional MQTT / HA Install button) ───────────

describe('hass.commands validation', () => {
  test('should default hass.commands to false when omitted', () => {
    const validated = mqtt.validateConfiguration({
      url: configurationValid.url,
      clientid: 'dd',
    });
    expect(validated.hass.commands).toBe(false);
  });

  test('should accept hass.commands=true', () => {
    const validated = mqtt.validateConfiguration({
      url: configurationValid.url,
      clientid: 'dd',
      hass: { commands: true },
    });
    expect(validated.hass.commands).toBe(true);
  });

  test('should coerce an env-style string value for hass.commands', () => {
    const validated = mqtt.validateConfiguration({
      url: configurationValid.url,
      clientid: 'dd',
      hass: { commands: 'true' },
    });
    expect(validated.hass.commands).toBe(true);
  });

  test('maskConfiguration should not mask hass.commands', () => {
    mqtt.configuration = {
      password: 'password',
      url: 'mqtt://host:1883',
      topic: 'dd/container',
      hass: {
        discovery: false,
        enabled: false,
        commands: true,
        prefix: 'homeassistant',
      },
    };
    expect(mqtt.maskConfiguration()).toEqual({
      hass: {
        discovery: false,
        enabled: false,
        commands: true,
        prefix: 'homeassistant',
      },
      password: '[REDACTED]',
      topic: 'dd/container',
      url: 'mqtt://host:1883',
    });
  });

  test('initTrigger should not throw when hass.commands is false or absent', async () => {
    mqtt.configuration = {
      ...configurationValid,
      clientid: 'dd',
      hass: {
        enabled: true,
        discovery: true,
        prefix: 'homeassistant',
        attributes: 'short',
        filter: { include: '', exclude: '' },
        // commands intentionally omitted
      },
    };
    vi.spyOn(mqttClient, 'connectAsync').mockResolvedValue({ publish: vi.fn() });

    await expect(mqtt.initTrigger()).resolves.toBeUndefined();
  });

  test('initTrigger should never construct/init Hass command subscription when hass.enabled is false, even if hass.commands is true', async () => {
    mqtt.configuration = {
      ...configurationValid,
      clientid: 'dd',
      hass: {
        enabled: false,
        discovery: false,
        commands: true,
        prefix: 'homeassistant',
        attributes: 'short',
        filter: { include: '', exclude: '' },
      },
    };
    vi.spyOn(mqttClient, 'connectAsync').mockResolvedValue({ publish: vi.fn() });
    const initCommandSubscriptionSpy = vi.spyOn(Hass.prototype, 'initCommandSubscription');

    await mqtt.initTrigger();

    expect(initCommandSubscriptionSpy).not.toHaveBeenCalled();
    initCommandSubscriptionSpy.mockRestore();
  });
});

describe('hass command lifecycle ordering (#210)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('initTrigger should await command subscription, then discovery resync, before resolving', async () => {
    mqtt.configuration = {
      ...configurationValid,
      clientid: 'dd',
      hass: {
        enabled: true,
        discovery: true,
        commands: true,
        prefix: 'homeassistant',
        attributes: 'short',
        filter: { include: '', exclude: '' },
      },
    };
    vi.spyOn(mqttClient, 'connectAsync').mockResolvedValue({ publish: vi.fn() });

    const order: string[] = [];
    let resolveInitCommandSubscription: () => void;
    let resolveResyncDiscovery: () => void;
    const initCommandSubscriptionSpy = vi
      .spyOn(Hass.prototype, 'initCommandSubscription')
      .mockImplementation(function mockedInitCommandSubscription() {
        order.push('initCommandSubscription-called');
        return new Promise<void>((resolve) => {
          resolveInitCommandSubscription = () => {
            order.push('initCommandSubscription-resolved');
            resolve();
          };
        });
      });
    const resyncDiscoverySpy = vi
      .spyOn(Hass.prototype, 'resyncDiscovery')
      .mockImplementation(function mockedResyncDiscovery() {
        order.push('resyncDiscovery-called');
        return new Promise<void>((resolve) => {
          resolveResyncDiscovery = () => {
            order.push('resyncDiscovery-resolved');
            resolve();
          };
        });
      });

    const initTriggerPromise = mqtt.initTrigger().then(() => {
      order.push('initTrigger-resolved');
    });

    // Let pending microtasks flush; initTrigger must still be pending, blocked
    // on the (not-yet-resolved) initCommandSubscription call.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['initCommandSubscription-called']);

    resolveInitCommandSubscription!();
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual([
      'initCommandSubscription-called',
      'initCommandSubscription-resolved',
      'resyncDiscovery-called',
    ]);

    resolveResyncDiscovery!();
    await initTriggerPromise;

    expect(order).toEqual([
      'initCommandSubscription-called',
      'initCommandSubscription-resolved',
      'resyncDiscovery-called',
      'resyncDiscovery-resolved',
      'initTrigger-resolved',
    ]);
    expect(initCommandSubscriptionSpy).toHaveBeenCalledTimes(1);
    expect(resyncDiscoverySpy).toHaveBeenCalledTimes(1);
  });

  test('re-init should await the previous Hass.deregister() before constructing a new Hass', async () => {
    mqtt.configuration = {
      ...configurationValid,
      clientid: 'dd',
      hass: {
        enabled: true,
        discovery: true,
        prefix: 'homeassistant',
        attributes: 'short',
        filter: { include: '', exclude: '' },
      },
    };
    vi.spyOn(mqttClient, 'connectAsync').mockResolvedValue({ publish: vi.fn() });
    vi.spyOn(Hass.prototype, 'initCommandSubscription').mockResolvedValue(undefined);

    // First init constructs Hass instance #1 with the real deregister.
    await mqtt.initTrigger();

    const order: string[] = [];
    let resolveDeregister: () => void;
    vi.spyOn(Hass.prototype, 'deregister').mockImplementation(function mockedDeregister() {
      order.push('deregister-called');
      return new Promise<void>((resolve) => {
        resolveDeregister = () => {
          order.push('deregister-resolved');
          resolve();
        };
      });
    });

    const secondInitPromise = mqtt.initTrigger().then(() => {
      order.push('initTrigger-resolved');
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['deregister-called']);

    resolveDeregister!();
    await secondInitPromise;

    expect(order).toEqual(['deregister-called', 'deregister-resolved', 'initTrigger-resolved']);
  });

  test('deregisterComponent should await Hass.deregister() before calling super.deregisterComponent()', async () => {
    mqtt.configuration = {
      ...configurationValid,
      clientid: 'dd',
      hass: {
        enabled: true,
        discovery: true,
        prefix: 'homeassistant',
        attributes: 'short',
        filter: { include: '', exclude: '' },
      },
    };
    vi.spyOn(mqttClient, 'connectAsync').mockResolvedValue({ publish: vi.fn() });
    vi.spyOn(Hass.prototype, 'initCommandSubscription').mockResolvedValue(undefined);
    await mqtt.initTrigger();

    const order: string[] = [];
    let resolveDeregister: () => void;
    vi.spyOn(Hass.prototype, 'deregister').mockImplementation(function mockedDeregister() {
      order.push('hass-deregister-called');
      return new Promise<void>((resolve) => {
        resolveDeregister = () => {
          order.push('hass-deregister-resolved');
          resolve();
        };
      });
    });
    vi.spyOn(Trigger.prototype, 'deregisterComponent').mockImplementation(
      async function mockedSuperDeregisterComponent() {
        order.push('super-deregisterComponent-called');
      },
    );

    const deregisterPromise = mqtt.deregisterComponent().then(() => {
      order.push('deregisterComponent-resolved');
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['hass-deregister-called']);

    resolveDeregister!();
    await deregisterPromise;

    expect(order).toEqual([
      'hass-deregister-called',
      'hass-deregister-resolved',
      'super-deregisterComponent-called',
      'deregisterComponent-resolved',
    ]);
  });
});

describe('hass isContainerAllowed wiring (#491)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('initTrigger wires Hass isContainerAllowed to this.mustTrigger', async () => {
    mqtt.configuration = {
      ...configurationValid,
      clientid: 'dd',
      hass: {
        enabled: true,
        discovery: true,
        prefix: 'homeassistant',
        attributes: 'short',
        filter: { include: '', exclude: '' },
      },
    };
    vi.spyOn(mqttClient, 'connectAsync').mockResolvedValue({ publish: vi.fn() });
    vi.spyOn(Hass.prototype, 'initCommandSubscription').mockResolvedValue(undefined);
    const mustTriggerSpy = vi.spyOn(mqtt, 'mustTrigger');

    await mqtt.initTrigger();

    const hassInstance = (
      mqtt as unknown as { hass: { isContainerAllowed: (container: unknown) => boolean } }
    ).hass;
    expect(hassInstance).toBeDefined();

    const container = { name: 'container-name' };

    mustTriggerSpy.mockReturnValueOnce(true);
    expect(hassInstance.isContainerAllowed(container)).toBe(true);
    expect(mustTriggerSpy).toHaveBeenCalledWith(container);

    mustTriggerSpy.mockReturnValueOnce(false);
    expect(hassInstance.isContainerAllowed(container)).toBe(false);
  });
});

describe('hass update progress (#210)', () => {
  const progressContainer = {
    id: 'container-progress',
    name: 'progress-test',
    watcher: 'local',
    image: {
      id: 'sha256:abc',
      registry: { url: 'docker.io' },
      name: 'nginx',
      tag: { value: '1.25', semver: true },
      digest: { watch: false },
      architecture: 'amd64',
      os: 'linux',
    },
  };

  const hassEnabledConfiguration = {
    ...configurationValid,
    clientid: 'dd',
    hass: {
      enabled: true,
      discovery: true,
      agenttopicsegment: true,
      commands: false,
      prefix: 'homeassistant',
      attributes: 'full',
      filter: { include: '', exclude: '' },
    },
  };

  function flush() {
    return new Promise((resolve) => setImmediate(resolve));
  }

  function publishedPayload(callIndex = 0) {
    return JSON.parse(mqtt.client.publish.mock.calls[callIndex][1]);
  }

  async function initWithHassEnabled(configurationOverrides = {}) {
    mqtt.configuration = { ...hassEnabledConfiguration, ...configurationOverrides };
    const publish = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(mqttClient, 'connectAsync').mockResolvedValue({ publish });
    vi.spyOn(Hass.prototype, 'initCommandSubscription').mockResolvedValue(undefined);
    vi.spyOn(Hass.prototype, 'resyncDiscovery').mockResolvedValue(undefined);
    await mqtt.initTrigger();
    return publish;
  }

  afterEach(async () => {
    await mqtt.deregister();
    vi.restoreAllMocks();
  });

  test('trigger publishes an idle update_state when hass is enabled', async () => {
    mqtt.configuration = hassEnabledConfiguration;
    vi.spyOn(updateOperationStore, 'getActiveOperationByContainerId').mockReturnValue(undefined);

    await mqtt.trigger(progressContainer);

    expect(publishedPayload()).toHaveProperty('update_state', {
      installed_version: '1.25',
      in_progress: false,
      update_percentage: null,
    });
  });

  test('trigger publishes the phase percentage while an operation is active', async () => {
    mqtt.configuration = hassEnabledConfiguration;
    const getActiveOperation = vi
      .spyOn(updateOperationStore, 'getActiveOperationByContainerId')
      .mockReturnValue({ phase: 'pulling' } as never);

    await mqtt.trigger(progressContainer);

    expect(getActiveOperation).toHaveBeenCalledWith('container-progress');
    expect(publishedPayload().update_state).toStrictEqual({
      installed_version: '1.25',
      in_progress: true,
      update_percentage: 10,
    });
  });

  test('trigger omits update_state entirely when hass is not enabled', async () => {
    mqtt.configuration = {
      ...hassEnabledConfiguration,
      hass: { ...hassEnabledConfiguration.hass, enabled: false },
    };
    const getActiveOperation = vi.spyOn(updateOperationStore, 'getActiveOperationByContainerId');

    await mqtt.trigger(progressContainer);

    expect(publishedPayload()).not.toHaveProperty('update_state');
    expect(getActiveOperation).not.toHaveBeenCalled();
  });

  test('trigger survives a missing hass configuration block', async () => {
    mqtt.configuration = { topic: 'dd/container', exclude: '' };

    await mqtt.trigger(progressContainer);

    expect(publishedPayload()).not.toHaveProperty('update_state');
  });

  test('trigger omits installed_version when the container carries no tag value', async () => {
    mqtt.configuration = hassEnabledConfiguration;
    vi.spyOn(updateOperationStore, 'getActiveOperationByContainerId').mockReturnValue(undefined);

    await mqtt.trigger({ ...progressContainer, image: { ...progressContainer.image, tag: {} } });

    expect(publishedPayload().update_state).toStrictEqual({
      in_progress: false,
      update_percentage: null,
    });
  });

  test('trigger skips the operation lookup for a container with no id', async () => {
    mqtt.configuration = hassEnabledConfiguration;
    const getActiveOperation = vi.spyOn(updateOperationStore, 'getActiveOperationByContainerId');

    await mqtt.trigger({ ...progressContainer, id: undefined });

    expect(getActiveOperation).not.toHaveBeenCalled();
    expect(publishedPayload().update_state).toStrictEqual({
      installed_version: '1.25',
      in_progress: false,
      update_percentage: null,
    });
  });

  test('trigger still publishes when the operation store read throws', async () => {
    mqtt.configuration = hassEnabledConfiguration;
    vi.spyOn(updateOperationStore, 'getActiveOperationByContainerId').mockImplementation(() => {
      throw new Error('store unavailable');
    });
    const warnSpy = vi.spyOn(mqtt.log, 'warn');

    await mqtt.trigger(progressContainer);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read active update operation'),
    );
    expect(publishedPayload().update_state).toStrictEqual({
      installed_version: '1.25',
      in_progress: false,
      update_percentage: null,
    });
  });

  test('an update-operation phase change republishes progress, and the terminal one clears it', async () => {
    const publish = await initWithHassEnabled();
    vi.spyOn(containerStore, 'getContainer').mockReturnValue(progressContainer as never);
    const getActiveOperation = vi
      .spyOn(updateOperationStore, 'getActiveOperationByContainerId')
      .mockReturnValueOnce({ phase: 'new-started' } as never)
      .mockReturnValueOnce(undefined);

    await emitUpdateOperationChanged({
      operationId: 'op-1',
      containerName: 'progress-test',
      containerId: 'container-progress',
      status: 'in-progress',
      phase: 'new-started',
    });
    await flush();

    expect(JSON.parse(publish.mock.calls[0][1]).update_state).toStrictEqual({
      installed_version: '1.25',
      in_progress: true,
      update_percentage: 80,
    });

    await emitUpdateOperationChanged({
      operationId: 'op-1',
      containerName: 'progress-test',
      containerId: 'container-progress',
      status: 'succeeded',
      phase: 'succeeded',
    });
    await flush();

    expect(JSON.parse(publish.mock.calls[1][1]).update_state).toStrictEqual({
      installed_version: '1.25',
      in_progress: false,
      update_percentage: null,
    });
    expect(getActiveOperation).toHaveBeenCalledTimes(2);
  });

  test('a failed operation clears progress without touching the published versions', async () => {
    const publish = await initWithHassEnabled();
    vi.spyOn(containerStore, 'getContainer').mockReturnValue(progressContainer as never);
    vi.spyOn(updateOperationStore, 'getActiveOperationByContainerId').mockReturnValue(undefined);

    await emitUpdateOperationChanged({
      operationId: 'op-2',
      containerName: 'progress-test',
      containerId: 'container-progress',
      status: 'failed',
      phase: 'failed',
      lastError: 'boom',
    });
    await flush();

    const payload = JSON.parse(publish.mock.calls[0][1]);
    expect(payload.update_state).toStrictEqual({
      installed_version: '1.25',
      in_progress: false,
      update_percentage: null,
    });
    expect(payload).toHaveProperty('image_tag_value', '1.25');
  });

  test('the replacement container id is resolved before the original one', async () => {
    await initWithHassEnabled();
    const getContainer = vi
      .spyOn(containerStore, 'getContainer')
      .mockReturnValue(progressContainer as never);
    vi.spyOn(updateOperationStore, 'getActiveOperationByContainerId').mockReturnValue(undefined);
    const triggerSpy = vi.spyOn(mqtt, 'trigger').mockResolvedValue(undefined);

    await emitUpdateOperationChanged({
      operationId: 'op-3',
      containerName: 'progress-test',
      containerId: 'old-container',
      newContainerId: 'new-container',
      status: 'succeeded',
      phase: 'succeeded',
    });
    await flush();

    expect(getContainer).toHaveBeenCalledTimes(1);
    expect(getContainer).toHaveBeenCalledWith('new-container');
    expect(triggerSpy).toHaveBeenCalledWith(progressContainer);
  });

  test('the original container id is used when the replacement is not stored yet', async () => {
    await initWithHassEnabled();
    const getContainer = vi
      .spyOn(containerStore, 'getContainer')
      .mockImplementation((id) =>
        id === 'old-container' ? (progressContainer as never) : undefined,
      );
    vi.spyOn(updateOperationStore, 'getActiveOperationByContainerId').mockReturnValue(undefined);
    const triggerSpy = vi.spyOn(mqtt, 'trigger').mockResolvedValue(undefined);

    await emitUpdateOperationChanged({
      operationId: 'op-4',
      containerName: 'progress-test',
      containerId: 'old-container',
      newContainerId: 'new-container',
      status: 'in-progress',
      phase: 'renamed',
    });
    await flush();

    expect(getContainer).toHaveBeenNthCalledWith(1, 'new-container');
    expect(getContainer).toHaveBeenNthCalledWith(2, 'old-container');
    expect(triggerSpy).toHaveBeenCalledWith(progressContainer);
  });

  test('an unresolvable operation event publishes nothing', async () => {
    await initWithHassEnabled();
    vi.spyOn(containerStore, 'getContainer').mockReturnValue(undefined);
    const triggerSpy = vi.spyOn(mqtt, 'trigger').mockResolvedValue(undefined);
    const debugSpy = vi.spyOn(mqtt.log, 'debug');

    await emitUpdateOperationChanged({
      operationId: 'op-5',
      containerName: 'gone',
      containerId: '',
      status: 'failed',
      phase: 'failed',
    });
    await flush();

    expect(triggerSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('No stored container'));
  });

  test('a container lookup failure is warned about, not thrown', async () => {
    await initWithHassEnabled();
    vi.spyOn(containerStore, 'getContainer').mockImplementation(() => {
      throw new Error('store unavailable');
    });
    const triggerSpy = vi.spyOn(mqtt, 'trigger').mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(mqtt.log, 'warn');

    await emitUpdateOperationChanged({
      operationId: 'op-6',
      containerName: 'progress-test',
      containerId: 'container-progress',
      status: 'in-progress',
      phase: 'pulling',
    });
    await flush();

    expect(triggerSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to resolve container for update operation op-6'),
    );
  });

  test('update-operation events are ignored when hass is not enabled', async () => {
    mqtt.configuration = {
      ...hassEnabledConfiguration,
      hass: { ...hassEnabledConfiguration.hass, enabled: false, discovery: false },
    };
    vi.spyOn(mqttClient, 'connectAsync').mockResolvedValue({
      publish: vi.fn().mockResolvedValue(undefined),
    });
    await mqtt.initTrigger();
    const getContainer = vi.spyOn(containerStore, 'getContainer');
    const triggerSpy = vi.spyOn(mqtt, 'trigger').mockResolvedValue(undefined);

    await emitUpdateOperationChanged({
      operationId: 'op-7',
      containerName: 'progress-test',
      containerId: 'container-progress',
      status: 'in-progress',
      phase: 'pulling',
    });
    await flush();

    expect(getContainer).not.toHaveBeenCalled();
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  test('deregister unsubscribes from update-operation events', async () => {
    await initWithHassEnabled();
    const getContainer = vi
      .spyOn(containerStore, 'getContainer')
      .mockReturnValue(progressContainer as never);
    const triggerSpy = vi.spyOn(mqtt, 'trigger').mockResolvedValue(undefined);

    await mqtt.deregister();

    await emitUpdateOperationChanged({
      operationId: 'op-8',
      containerName: 'progress-test',
      containerId: 'container-progress',
      status: 'in-progress',
      phase: 'pulling',
    });
    await flush();

    expect(getContainer).not.toHaveBeenCalled();
    expect(triggerSpy).not.toHaveBeenCalled();
  });
});
