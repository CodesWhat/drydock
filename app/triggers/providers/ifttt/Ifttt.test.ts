import axios from 'axios';
import joi from 'joi';

vi.mock('axios');

import Ifttt from './Ifttt.js';

const ifttt = new Ifttt();

const configurationValid = {
  key: 'secret',
  event: 'dd-image',
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

beforeEach(async () => {
  vi.resetAllMocks();
});

test('validateConfiguration should return validated configuration when valid', async () => {
  const validatedConfiguration = ifttt.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should apply_default_configuration', async () => {
  const validatedConfiguration = ifttt.validateConfiguration({
    key: configurationValid.key,
  });
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when invalid', async () => {
  const configuration = {};
  expect(() => {
    ifttt.validateConfiguration(configuration);
  }).toThrowError(joi.ValidationError);
});

test('maskConfiguration should mask sensitive data', async () => {
  ifttt.configuration = {
    key: 'key',
    event: 'event',
  };
  expect(ifttt.maskConfiguration()).toEqual({
    key: '[REDACTED]',
    event: 'event',
  });
});

test('trigger should send http request to IFTTT', async () => {
  ifttt.configuration = {
    key: 'key',
    event: 'event',
  };
  const container = {
    name: 'container1',
    result: {
      tag: '2.0.0',
    },
  };
  axios.mockResolvedValue({ data: {} });
  await ifttt.trigger(container);
  expect(axios).toHaveBeenCalledWith({
    data: {
      value1: 'container1',
      value2: '2.0.0',
      value3: '{"name":"container1","result":{"tag":"2.0.0"}}',
    },
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',

    url: 'https://maker.ifttt.com/trigger/event/with/key/key',
  });
});

test('trigger should not throw when container result is missing', async () => {
  ifttt.configuration = {
    key: 'key',
    event: 'event',
  };
  const container = {
    name: 'container-without-result',
  };
  axios.mockResolvedValue({ data: {} });

  await ifttt.trigger(container);

  expect(axios).toHaveBeenCalledWith({
    data: {
      value1: 'container-without-result',
      value2: undefined,
      value3: '{"name":"container-without-result"}',
    },
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    url: 'https://maker.ifttt.com/trigger/event/with/key/key',
  });
});

test('triggerBatch should send http request with containers json', async () => {
  ifttt.configuration = {
    key: 'key',
    event: 'event',
  };
  const containers = [{ name: 'c1' }, { name: 'c2' }];
  axios.mockResolvedValue({ data: {} });
  await ifttt.triggerBatch(containers);
  expect(axios).toHaveBeenCalledWith({
    data: {
      value1: JSON.stringify(containers),
    },
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    url: 'https://maker.ifttt.com/trigger/event/with/key/key',
  });
});

test('triggerBatch should use runtimeContext.title as value1 and empty value2 when only title is set', async () => {
  ifttt.configuration = {
    key: 'key',
    event: 'event',
  };
  const containers = [{ name: 'app1' }];
  axios.mockResolvedValue({ data: {} });
  await ifttt.triggerBatch(containers, {
    title: 'Security scan: 1 finding',
    eventKind: 'security-alert-digest',
  });
  expect(axios).toHaveBeenCalledWith({
    data: {
      value1: 'Security scan: 1 finding',
      value2: '',
      value3: JSON.stringify(containers),
    },
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    url: 'https://maker.ifttt.com/trigger/event/with/key/key',
  });
});

test('triggerBatch should use runtimeContext.body as value2 and empty value1 when only body is set', async () => {
  ifttt.configuration = {
    key: 'key',
    event: 'event',
  };
  const containers = [{ name: 'app1' }];
  axios.mockResolvedValue({ data: {} });
  await ifttt.triggerBatch(containers, { body: '- app1: 1 critical' });
  expect(axios).toHaveBeenCalledWith({
    data: {
      value1: '',
      value2: '- app1: 1 critical',
      value3: JSON.stringify(containers),
    },
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    url: 'https://maker.ifttt.com/trigger/event/with/key/key',
  });
});

test('triggerBatch should use both runtimeContext title and body when both are set', async () => {
  ifttt.configuration = {
    key: 'key',
    event: 'event',
  };
  const containers = [{ name: 'app1' }];
  axios.mockResolvedValue({ data: {} });
  await ifttt.triggerBatch(containers, {
    title: 'Security scan: 1 finding',
    body: '- app1: 1 critical',
    eventKind: 'security-alert-digest',
  });
  expect(axios).toHaveBeenCalledWith({
    data: {
      value1: 'Security scan: 1 finding',
      value2: '- app1: 1 critical',
      value3: JSON.stringify(containers),
    },
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    url: 'https://maker.ifttt.com/trigger/event/with/key/key',
  });
});
