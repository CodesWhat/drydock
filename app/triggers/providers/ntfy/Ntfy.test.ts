import axios from 'axios';
import joi from 'joi';
import { rejectOnceWithHttpStatus } from '../../../test/notification-provider-mocks.js';
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
  auto: 'all',
  order: 100,
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
      user: '[REDACTED]',
      password: '[REDACTED]',
      token: '[REDACTED]',
    },
  });
});

test('maskConfiguration should leave auth undefined when it is not configured', async () => {
  ntfy.configuration = { ...configurationValid };
  expect(ntfy.maskConfiguration()).toEqual({ ...configurationValid, auth: undefined });
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

test('sendHttpRequest should reject when Ntfy returns 429', async () => {
  ntfy.configuration = configurationValid;
  rejectOnceWithHttpStatus(axios, 'Ntfy rate limited', 429);

  await expect(ntfy.sendHttpRequest({ message: 'hello' })).rejects.toThrow('Ntfy rate limited');
});

test('validateConfiguration should accept topics, priorities and actions', async () => {
  const configuration = {
    ...configurationValid,
    topics: { updatefailed: 'failures', securityalert: 'alerts' },
    priorities: { updatefailed: 5, securityalert: 4 },
    actions: [
      {
        action: 'view',
        label: 'Open ${container.name}',
        url: 'https://example.test/${container.name}',
      },
    ],
  };
  expect(ntfy.validateConfiguration(configuration)).toStrictEqual(configuration);
});

test('validateConfiguration should reject a fourth action', async () => {
  const configuration = {
    ...configurationValid,
    actions: [
      { action: 'view', label: 'a', url: 'https://example.test/a' },
      { action: 'view', label: 'b', url: 'https://example.test/b' },
      { action: 'view', label: 'c', url: 'https://example.test/c' },
      { action: 'view', label: 'd', url: 'https://example.test/d' },
    ],
  };
  expect(() => {
    ntfy.validateConfiguration(configuration);
  }).toThrowError(joi.ValidationError);
});

test('validateConfiguration should reject an unknown action type', async () => {
  const configuration = {
    ...configurationValid,
    actions: [{ action: 'broadcast', label: 'a', url: 'https://example.test/a' }],
  };
  expect(() => {
    ntfy.validateConfiguration(configuration);
  }).toThrowError(joi.ValidationError);
});

test('trigger should route to the per-event topic and priority when configured', async () => {
  ntfy.configuration = {
    ...configurationValid,
    topics: { updatefailed: 'failures' },
    priorities: { updatefailed: 5 },
  };
  const container = {
    name: 'container1',
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
    notificationEvent: { kind: 'update-failed', error: 'boom' },
  };
  axios.mockResolvedValue({ data: {} });
  await ntfy.trigger(container);
  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ topic: 'failures', priority: 5 }),
    }),
  );
});

test('trigger should fall back to the static topic and priority for an event kind with no override', async () => {
  ntfy.configuration = {
    ...configurationValid,
    topics: { updatefailed: 'failures' },
    priorities: { updatefailed: 5 },
  };
  const container = {
    name: 'container1',
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
  };
  axios.mockResolvedValue({ data: {} });
  await ntfy.trigger(container);
  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ topic: 'xxx', priority: 2 }),
    }),
  );
});

test('trigger should render action templates with container variables and include them in the body', async () => {
  ntfy.configuration = {
    ...configurationValid,
    actions: [
      {
        action: 'view',
        label: 'Open ${container.name}',
        url: 'https://example.test/${container.name}',
      },
      {
        action: 'http',
        label: 'Rollback',
        url: 'https://example.test/rollback',
        method: 'POST',
        body: '${container.name}',
        clear: true,
      },
    ],
  };
  const container = {
    name: 'container1',
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
  };
  axios.mockResolvedValue({ data: {} });
  await ntfy.trigger(container);
  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        actions: [
          { action: 'view', label: 'Open container1', url: 'https://example.test/container1' },
          {
            action: 'http',
            label: 'Rollback',
            url: 'https://example.test/rollback',
            method: 'POST',
            body: 'container1',
            clear: true,
          },
        ],
      }),
    }),
  );
});

test('trigger should omit actions when none are configured or the array is empty', async () => {
  ntfy.configuration = { ...configurationValid, actions: [] };
  const container = {
    name: 'container1',
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
  };
  axios.mockResolvedValue({ data: {} });
  await ntfy.trigger(container);
  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ actions: undefined }),
    }),
  );
});

test('triggerBatch should route topic/priority using the first container in the batch and render its actions', async () => {
  ntfy.configuration = {
    ...configurationValid,
    topics: { updatefailed: 'failures' },
    priorities: { updatefailed: 5 },
    actions: [
      {
        action: 'view',
        label: 'Open ${container.name}',
        url: 'https://example.test/${container.name}',
      },
    ],
  };
  const containers = [
    {
      name: 'container1',
      updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
      notificationEvent: { kind: 'update-failed', error: 'boom' },
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
        topic: 'failures',
        priority: 5,
        actions: [
          { action: 'view', label: 'Open container1', url: 'https://example.test/container1' },
        ],
      }),
    }),
  );
});

test('triggerBatch should default to update-available routing and omit actions for an empty batch', async () => {
  ntfy.configuration = configurationValid;
  axios.mockResolvedValue({ data: {} });
  await ntfy.triggerBatch([]);
  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ topic: 'xxx', priority: 2, actions: undefined }),
    }),
  );
});

test('triggerBatch should route a security-alert digest batch by the runtime context event kind, not the row', async () => {
  ntfy.configuration = {
    ...configurationValid,
    topics: { securityalert: 'sec-alerts' },
    priorities: { securityalert: 5 },
  };
  const rows = [{ name: 'row1' }];
  axios.mockResolvedValue({ data: {} });
  await ntfy.triggerBatch(rows, {
    eventKind: 'security-alert-digest',
    title: 'Security digest: 3 findings',
    body: '- row1 has a critical finding',
  });
  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        topic: 'sec-alerts',
        priority: 5,
        title: 'Security digest: 3 findings',
        message: '- row1 has a critical finding',
      }),
    }),
  );
});

test('trigger should render action templates against the enriched template container, not the raw container', async () => {
  ntfy.configuration = {
    ...configurationValid,
    actions: [
      {
        action: 'view',
        label: 'Open on ${container.notificationServerName}',
        url: 'https://${container.notificationServerName}/containers/${container.name}',
      },
    ],
  };
  const container = {
    name: 'web',
    agent: 'edge-1',
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
  };
  axios.mockResolvedValue({ data: {} });
  await ntfy.trigger(container);
  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        actions: [
          {
            action: 'view',
            label: 'Open on edge-1',
            url: 'https://edge-1/containers/web',
          },
        ],
      }),
    }),
  );
});
