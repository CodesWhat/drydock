import axios from 'axios';
import joi from 'joi';

vi.mock('axios');

import Apprise from './Apprise.js';

const apprise = new Apprise();

const configurationValid = {
  url: 'http://xxx.com',
  urls: 'maito://user:pass@gmail.com',
  threshold: 'all',
  auto: 'all',
  order: 100,
  once: true,
  mode: 'simple',

  simpletitle:
    '${isDigestUpdate ? "New image available for container " + container.name + " (tag " + currentTag + ")" : "New " + container.updateKind.kind + " found for container " + container.name}',

  simplebody:
    '${isDigestUpdate ? "Container " + container.name + " running tag " + currentTag + " has a newer image available" : "Container " + container.name + " running with " + container.updateKind.kind + " " + container.updateKind.localValue + " can be updated to " + container.updateKind.kind + " " + container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

  batchtitle: '${containers.length} updates available',
  resolvenotifications: false,
  securitymode: 'simple',
  digestcron: '0 8 * * *',
};

beforeEach(async () => {
  vi.resetAllMocks();
});

test('validateConfiguration should return validated configuration when valid', async () => {
  const validatedConfiguration = apprise.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when url scheme is invalid', async () => {
  const configuration = {
    url: 'git://xxx.com',
    urls: 'mailto://test@example.com',
  };
  expect(() => {
    apprise.validateConfiguration(configuration);
  }).toThrowError(joi.ValidationError);
});

test('validateConfiguration should throw error when urls and config are set at the same time', async () => {
  const configuration = {
    ...configurationValid,
    config: 'config',
  };
  expect(() => {
    apprise.validateConfiguration(configuration);
  }).toThrowError(joi.ValidationError);
});

test('trigger should send POST http request to notify endpoint', async () => {
  apprise.configuration = configurationValid;
  const container = {
    name: 'container1',
    image: {
      tag: {
        value: '1.0.0',
      },
    },
    result: {
      tag: '2.0.0',
    },
    updateAvailable: true,
    updateKind: {
      kind: 'tag',
      localValue: '1.0.0',
      remoteValue: '2.0.0',
      semverDiff: 'major',
    },
  };
  axios.mockResolvedValue({ data: {} });
  await apprise.trigger(container);
  expect(axios).toHaveBeenCalledWith({
    data: {
      urls: 'maito://user:pass@gmail.com',
      title: 'New tag found for container container1',
      body: 'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
      format: 'text',
      type: 'info',
    },
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    url: 'http://xxx.com/notify',
    timeout: 30000,
  });
});

test('trigger should use config and tag when configured', async () => {
  apprise.configuration = {
    url: 'http://xxx.com',
    config: 'myconfig',
    tag: 'mytag',
  };

  const container = {
    name: 'test',
    updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
  };
  axios.mockResolvedValue({ data: {} });
  await apprise.trigger(container);

  expect(axios).toHaveBeenCalledWith({
    data: {
      title: expect.any(String),
      body: expect.any(String),
      format: 'text',
      type: 'info',
      tag: 'mytag',
    },
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    url: 'http://xxx.com/notify/myconfig',
    timeout: 30000,
  });
});

test('trigger should use config without tag', async () => {
  apprise.configuration = {
    url: 'http://xxx.com',
    config: 'myconfig',
  };

  const container = {
    name: 'test',
    updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
  };
  axios.mockResolvedValue({ data: {} });
  await apprise.trigger(container);

  expect(axios).toHaveBeenCalledWith({
    data: {
      title: expect.any(String),
      body: expect.any(String),
      format: 'text',
      type: 'info',
    },
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    url: 'http://xxx.com/notify/myconfig',
    timeout: 30000,
  });
  expect(axios.mock.calls[0][0].data).not.toHaveProperty('tag');
});

test('trigger should URL-encode config path segment', async () => {
  apprise.configuration = {
    url: 'http://xxx.com',
    config: 'my/config?foo=bar',
  };

  const container = {
    name: 'test',
    updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
  };
  axios.mockResolvedValue({ data: {} });
  await apprise.trigger(container);

  expect(axios).toHaveBeenCalledWith({
    data: {
      title: expect.any(String),
      body: expect.any(String),
      format: 'text',
      type: 'info',
    },
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    url: 'http://xxx.com/notify/my%2Fconfig%3Ffoo%3Dbar',
    timeout: 30000,
  });
});

test('triggerBatch should send batch notification', async () => {
  apprise.configuration = {
    url: 'http://xxx.com',
    urls: 'mailto://test@example.com',
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

  axios.mockResolvedValue({ data: {} });
  await apprise.triggerBatch(containers);

  expect(axios).toHaveBeenCalledWith({
    data: {
      urls: 'mailto://test@example.com',
      title: expect.any(String),
      body: expect.any(String),
      format: 'text',
      type: 'info',
    },
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    url: 'http://xxx.com/notify',
    timeout: 30000,
  });
});

test('triggerBatch should URL-encode config path segment', async () => {
  apprise.configuration = {
    url: 'http://xxx.com',
    config: 'my/config?foo=bar',
  };

  const containers = [
    {
      name: 'test1',
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    },
  ];

  axios.mockResolvedValue({ data: {} });
  await apprise.triggerBatch(containers);

  expect(axios).toHaveBeenCalledWith({
    data: {
      title: expect.any(String),
      body: expect.any(String),
      format: 'text',
      type: 'info',
    },
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    url: 'http://xxx.com/notify/my%2Fconfig%3Ffoo%3Dbar',
    timeout: 30000,
  });
});

test('triggerBatch should use config and tag when configured', async () => {
  apprise.configuration = {
    url: 'http://xxx.com',
    config: 'myconfig',
    tag: 'mytag',
  };

  const containers = [
    {
      name: 'test1',
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    },
  ];

  axios.mockResolvedValue({ data: {} });
  await apprise.triggerBatch(containers);

  expect(axios).toHaveBeenCalledWith({
    data: {
      title: expect.any(String),
      body: expect.any(String),
      format: 'text',
      type: 'info',
      tag: 'mytag',
    },
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    url: 'http://xxx.com/notify/myconfig',
    timeout: 30000,
  });
});

test('triggerBatch should use config without tag', async () => {
  apprise.configuration = {
    url: 'http://xxx.com',
    config: 'myconfig',
  };

  const containers = [
    {
      name: 'test1',
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    },
  ];

  axios.mockResolvedValue({ data: {} });
  await apprise.triggerBatch(containers);

  expect(axios).toHaveBeenCalledWith({
    data: {
      title: expect.any(String),
      body: expect.any(String),
      format: 'text',
      type: 'info',
    },
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    url: 'http://xxx.com/notify/myconfig',
    timeout: 30000,
  });
  expect(axios.mock.calls[0][0].data).not.toHaveProperty('tag');
});

test('maskConfiguration should mask urls', async () => {
  apprise.configuration = {
    url: 'http://xxx.com',
    urls: 'mailto://secret@example.com',
  };

  const masked = apprise.maskConfiguration();

  expect(masked.url).toBe('http://xxx.com');
  expect(masked.urls).toBe('[REDACTED]');
});
