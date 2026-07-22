const MUTABLE_NOTIFICATION_FIELDS = [
  'enabled',
  'triggers',
  'bellEnabled',
  'bellThreshold',
  'templates',
];
const MUTABLE_SETTINGS_FIELDS = ['internetlessMode', 'updateMode'];

function getCollection(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.data)) return payload.data;
  return null;
}

function pickOwnFields(value, fields) {
  return Object.fromEntries(
    fields.flatMap((field) =>
      value && Object.hasOwn(value, field) ? [[field, structuredClone(value[field])]] : [],
    ),
  );
}

function createApiRequest(config, fetchImpl = fetch, requestTimeoutMs = 50_000) {
  const baseUrl = `${config.protocol}://${config.host}:${config.port}`;
  const credentials = `${config.username}:${config.password}`;
  const authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;

  return async function request(method, path, body) {
    const headers = { Authorization: authorization };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const responseBody = await response.text();

      if (!response.ok) {
        throw new Error(
          `State restoration request ${method} ${path} failed with ${response.status}: ${responseBody}`,
        );
      }
      if (responseBody === '') return undefined;

      try {
        return JSON.parse(responseBody);
      } catch (error) {
        throw new Error(
          `State restoration request ${method} ${path} returned invalid JSON: ${error.message}`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function captureContainerState(request, containerName) {
  const containers = getCollection(await request('GET', '/api/v1/containers'));
  if (!containers) throw new Error('Container state snapshot did not return a container array');

  const container = containers.find((candidate) => candidate?.name === containerName);
  if (!container) throw new Error(`Cannot snapshot missing container ${containerName}`);
  if (!container.id || !container.status) {
    throw new Error(`Container ${containerName} snapshot is missing id or status`);
  }

  return { id: container.id, name: containerName, status: container.status };
}

async function restoreContainerState(request, snapshot) {
  const path = `/api/v1/containers/${snapshot.id}`;
  const current = await request('GET', path);
  if (current?.status === snapshot.status) return;

  if (snapshot.status === 'running') {
    await request('POST', `${path}/start`);
    return;
  }
  if (snapshot.status === 'stopped' || snapshot.status === 'exited') {
    await request('POST', `${path}/stop`);
    return;
  }

  throw new Error(
    `Cannot restore container ${snapshot.name} to unsupported status ${snapshot.status}`,
  );
}

async function captureSettingsState(request) {
  const settings = await request('GET', '/api/v1/settings');
  return pickOwnFields(settings, MUTABLE_SETTINGS_FIELDS);
}

async function restoreSettingsState(request, snapshot) {
  await request('PATCH', '/api/v1/settings', snapshot);
}

async function captureNotificationRuleState(request, ruleId) {
  const rules = getCollection(await request('GET', '/api/v1/notifications'));
  if (!rules) throw new Error('Notification state snapshot did not return a rule array');

  const rule = rules.find((candidate) => candidate?.id === ruleId);
  if (!rule) throw new Error(`Cannot snapshot missing notification rule ${ruleId}`);

  return { id: ruleId, values: pickOwnFields(rule, MUTABLE_NOTIFICATION_FIELDS) };
}

async function restoreNotificationRuleState(request, snapshot) {
  await request('PATCH', `/api/v1/notifications/${snapshot.id}`, snapshot.values);
}

module.exports = {
  captureContainerState,
  captureNotificationRuleState,
  captureSettingsState,
  createApiRequest,
  restoreContainerState,
  restoreNotificationRuleState,
  restoreSettingsState,
};
