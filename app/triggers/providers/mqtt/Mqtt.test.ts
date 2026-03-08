import joi from 'joi';
import mqttClient from 'mqtt';
import {
  clearAllListenersForTests,
  emitContainerAdded,
  emitContainerUpdated,
} from '../../../event/index.js';
import log from '../../../log/index.js';
import { flatten } from '../../../model/container.js';

vi.mock('mqtt');
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue(Buffer.from('file-content')),
  },
  readFile: vi.fn().mockResolvedValue(Buffer.from('file-content')),
}));

import fs from 'node:fs/promises';
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
    enabled: false,
    prefix: 'homeassistant',
    attributes: 'full',
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
  auto: true,
  order: 100,
  simpletitle: 'New ${container.updateKind.kind} found for container ${container.name}',

  simplebody:
    'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

  batchtitle: '${containers.length} updates available',
  resolvenotifications: false,
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
    attributes: 'full',
  });
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

test.each(containerData)('trigger should format json message payload as expected', async ({
  containerName,
  data,
}) => {
  mqtt.configuration = {
    topic: 'dd/container',
    exclude: '',
    hass: { attributes: 'full' },
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
  expect(mqtt.client.publish).toHaveBeenCalledWith(data.topic, JSON.stringify(flatten(container)), {
    retain: true,
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
    hass: { enabled: false },
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

test('initTrigger should execute registered container event callbacks', async () => {
  mqtt.configuration = {
    ...configurationValid,
    clientid: 'dd',
    hass: { enabled: false, discovery: false, prefix: 'homeassistant' },
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
    hass: { enabled: false, discovery: false, prefix: 'homeassistant' },
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

  test('should default hass.attributes to full', () => {
    const validated = mqtt.validateConfiguration({
      url: configurationValid.url,
      clientid: 'dd',
    });
    expect(validated.hass.attributes).toBe('full');
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
      hass: { attributes: 'short' },
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
      hass: { attributes: 'full' },
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
      hass: { attributes: 'short' },
    };
    await mqtt.trigger(containerWithSecurity);

    const publishedPayload = JSON.parse(mqtt.client.publish.mock.calls[0][1]);
    // exclude wins: only 'details' stripped, not the full 'short' preset
    expect(publishedPayload).not.toHaveProperty('details_ports_0');
    expect(publishedPayload).toHaveProperty('security_sbom_documents_0_spdx_version', 'SPDX-2.3');
    expect(publishedPayload).toHaveProperty('security_scan_vulnerabilities_0_id', 'CVE-2024-0001');
  });

  test('should publish full container when both are default', async () => {
    mqtt.configuration = {
      topic: 'dd/container',
      exclude: '',
      hass: { attributes: 'full' },
    };
    await mqtt.trigger(containerWithSecurity);

    const publishedPayload = JSON.parse(mqtt.client.publish.mock.calls[0][1]);
    expect(publishedPayload).toHaveProperty('security_scan_vulnerabilities_0_id', 'CVE-2024-0001');
    expect(publishedPayload).toHaveProperty('details_ports_0', '80/tcp');
    expect(publishedPayload).toHaveProperty('labels_com_docker_compose_project', 'app');
  });
});
