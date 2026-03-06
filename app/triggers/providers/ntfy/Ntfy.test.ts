import axios from 'axios';
import joi from 'joi';
import Ntfy from './Ntfy.js';

vi.mock('axios');

const ntfy = new Ntfy();

const configurationValid = {
  url: 'http://xxx.com',
  topic: 'xxx',
  priority: 2,
  mode: 'simple',
  threshold: 'all',
  once: true,
  auto: true,
  order: 100,
  simpletitle: 'New ${container.updateKind.kind} found for container ${container.name}',

  simplebody:
    'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

  batchtitle: '${containers.length} updates available',
  resolvenotifications: false,
};

beforeEach(async () => {
  vi.resetAllMocks();
});

test('validateConfiguration should return validated configuration when valid', async () => {
  const validatedConfiguration = ntfy.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when invalid', async () => {
  const configuration = {
    url: 'git://xxx.com',
  };
  expect(() => {
    ntfy.validateConfiguration(configuration);
  }).toThrowError(joi.ValidationError);
});

test('maskConfiguration should mask sensitive data', async () => {
  ntfy.configuration = {
    auth: {
      user: 'user',
      password: 'password',
      token: 'token',
    },
  };
  expect(ntfy.maskConfiguration()).toEqual({
    auth: {
      user: 'u**r',
      password: 'p******d',
      token: 't***n',
    },
  });
});

test('trigger should call http client', async () => {
  ntfy.configuration = configurationValid;
  const container = {
    name: 'container1',
    updateKind: {
      kind: 'tag',
      localValue: '1.0.0',
      remoteValue: '2.0.0',
    },
  };
  axios.mockResolvedValue({ data: {} });
  await ntfy.trigger(container);
  expect(axios).toHaveBeenCalledWith({
    data: {
      message: 'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
      priority: 2,
      title: 'New tag found for container container1',
      topic: 'xxx',
    },
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',

    timeout: 30000,
    url: 'http://xxx.com',
  });
});

test('trigger should use basic auth when configured like that', async () => {
  ntfy.configuration = {
    ...configurationValid,
    auth: { user: 'user', password: 'pass' },
  };
  const container = {
    name: 'container1',
    updateKind: {
      kind: 'tag',
      localValue: '1.0.0',
      remoteValue: '2.0.0',
    },
  };
  axios.mockResolvedValue({ data: {} });
  await ntfy.trigger(container);
  expect(axios).toHaveBeenCalledWith({
    data: {
      message: 'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
      priority: 2,
      title: 'New tag found for container container1',
      topic: 'xxx',
    },
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',

    timeout: 30000,
    url: 'http://xxx.com',
    auth: { username: 'user', password: 'pass' },
  });
});

test('trigger should use bearer auth when configured like that', async () => {
  ntfy.configuration = {
    ...configurationValid,
    auth: { token: 'token' },
  };
  const container = {
    name: 'container1',
    updateKind: {
      kind: 'tag',
      localValue: '1.0.0',
      remoteValue: '2.0.0',
    },
  };
  axios.mockResolvedValue({ data: {} });
  await ntfy.trigger(container);
  expect(axios).toHaveBeenCalledWith({
    data: {
      message: 'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
      priority: 2,
      title: 'New tag found for container container1',
      topic: 'xxx',
    },
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token',
    },
    method: 'POST',

    timeout: 30000,
    url: 'http://xxx.com',
  });
});

test('triggerBatch should call http client with batch body', async () => {
  ntfy.configuration = configurationValid;
  const containers = [
    {
      name: 'container1',
      updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
    },
    {
      name: 'container2',
      updateKind: { kind: 'tag', localValue: '3.0.0', remoteValue: '4.0.0' },
    },
  ];
  axios.mockResolvedValue({ data: {} });
  await ntfy.triggerBatch(containers);
  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        topic: 'xxx',
        priority: 2,
      }),
      timeout: 30000,
    }),
  );
});
