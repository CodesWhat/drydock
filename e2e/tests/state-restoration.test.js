const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

let stateRestoration;
try {
  stateRestoration = require('../features/support/state-restoration');
} catch (error) {
  assert.fail(`Cucumber state restoration support must be loadable: ${error.message}`);
}

let registerStateRestorationHooks;
try {
  ({ registerStateRestorationHooks } = require('../features/support/state-restoration-hooks'));
} catch (error) {
  assert.fail(`Cucumber state restoration hooks must be loadable: ${error.message}`);
}

function createStatefulRequest(initialState) {
  const state = structuredClone(initialState);
  const calls = [];

  async function request(method, path, body) {
    calls.push({ method, path, body });

    if (method === 'GET' && path === '/api/v1/containers') {
      return { data: [structuredClone(state.container)] };
    }
    if (method === 'GET' && path === `/api/v1/containers/${state.container.id}`) {
      return structuredClone(state.container);
    }
    if (method === 'POST' && path.endsWith('/start')) {
      state.container.status = 'running';
      return { message: 'Container started successfully' };
    }
    if (method === 'POST' && path.endsWith('/stop')) {
      state.container.status = 'stopped';
      return { message: 'Container stopped successfully' };
    }
    if (method === 'GET' && path === '/api/v1/settings') {
      return structuredClone(state.settings);
    }
    if (method === 'PATCH' && path === '/api/v1/settings') {
      Object.assign(state.settings, body);
      return structuredClone(state.settings);
    }
    if (method === 'GET' && path === '/api/v1/notifications') {
      return { data: [structuredClone(state.notification)] };
    }
    if (method === 'PATCH' && path === `/api/v1/notifications/${state.notification.id}`) {
      Object.assign(state.notification, body);
      return structuredClone(state.notification);
    }

    throw new Error(`Unexpected request: ${method} ${path}`);
  }

  return { calls, request, state };
}

const stateRestorationConfig = {
  protocol: 'http',
  host: 'localhost',
  port: 3000,
  username: 'john',
  password: 'doe',
};

test('aborts a stalled state-restoration request before the Cucumber hook timeout', async () => {
  let requestSignal;
  const fetchImpl = (_url, options) =>
    new Promise((_resolve, reject) => {
      requestSignal = options.signal;
      requestSignal.addEventListener('abort', () => reject(new Error('request aborted')));
    });
  const request = stateRestoration.createApiRequest(stateRestorationConfig, fetchImpl, 5);

  await assert.rejects(request('GET', '/api/v1/settings'), /request aborted/);
  assert.equal(requestSignal.aborted, true);
});

test('clears the state-restoration request timeout after a completed request', async () => {
  let requestSignal;
  const fetchImpl = async (_url, options) => {
    requestSignal = options.signal;
    return { ok: true, text: async () => '{}' };
  };
  const request = stateRestoration.createApiRequest(stateRestorationConfig, fetchImpl, 5);

  await request('GET', '/api/v1/settings');
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(requestSignal.aborted, false);
});

test('restores the original container lifecycle state after an interrupted scenario', async () => {
  const harness = createStatefulRequest({
    container: { id: 'container-1', name: 'hub_nginx_120', status: 'running' },
    settings: {},
    notification: {},
  });
  const snapshot = await stateRestoration.captureContainerState(harness.request, 'hub_nginx_120');
  harness.state.container.status = 'stopped';

  await stateRestoration.restoreContainerState(harness.request, snapshot);

  assert.equal(harness.state.container.status, 'running');
  assert.deepEqual(harness.calls.at(-1), {
    method: 'POST',
    path: '/api/v1/containers/container-1/start',
    body: undefined,
  });
});

test('restores the complete original settings after an interrupted scenario', async () => {
  const harness = createStatefulRequest({
    container: {},
    settings: { internetlessMode: false, updateMode: 'manual' },
    notification: {},
  });
  const snapshot = await stateRestoration.captureSettingsState(harness.request);
  Object.assign(harness.state.settings, { internetlessMode: true, updateMode: 'auto' });

  await stateRestoration.restoreSettingsState(harness.request, snapshot);

  assert.deepEqual(harness.state.settings, {
    internetlessMode: false,
    updateMode: 'manual',
  });
  assert.deepEqual(harness.calls.at(-1), {
    method: 'PATCH',
    path: '/api/v1/settings',
    body: { internetlessMode: false, updateMode: 'manual' },
  });
});

test('restores every mutable field on the original notification rule', async () => {
  const originalRule = {
    id: 'update-available',
    enabled: true,
    triggers: [],
    bellEnabled: false,
    bellThreshold: 'warning',
    templates: { 'mock.example': { simpleTitle: 'Original' } },
  };
  const harness = createStatefulRequest({
    container: {},
    settings: {},
    notification: originalRule,
  });
  const snapshot = await stateRestoration.captureNotificationRuleState(
    harness.request,
    'update-available',
  );
  Object.assign(harness.state.notification, {
    enabled: false,
    triggers: ['mock.example'],
    bellEnabled: true,
    bellThreshold: 'critical',
    templates: {},
  });

  await stateRestoration.restoreNotificationRuleState(harness.request, snapshot);

  assert.deepEqual(harness.state.notification, originalRule);
  assert.deepEqual(harness.calls.at(-1), {
    method: 'PATCH',
    path: '/api/v1/notifications/update-available',
    body: {
      enabled: true,
      triggers: [],
      bellEnabled: false,
      bellThreshold: 'warning',
      templates: { 'mock.example': { simpleTitle: 'Original' } },
    },
  });
});

test('registers tagged before/after hooks that restore state even after scenario interruption', async () => {
  const beforeHooks = new Map();
  const afterHooks = new Map();
  const cucumber = {
    Before(options, hook) {
      beforeHooks.set(options.tags, hook);
    },
    After(options, hook) {
      afterHooks.set(options.tags, hook);
    },
  };
  const harness = createStatefulRequest({
    container: { id: 'container-1', name: 'hub_nginx_120', status: 'running' },
    settings: { internetlessMode: false, updateMode: 'manual' },
    notification: {
      id: 'update-available',
      enabled: true,
      triggers: [],
      bellEnabled: false,
      bellThreshold: 'warning',
      templates: {},
    },
  });
  registerStateRestorationHooks(cucumber, harness.request);

  const scenarios = [
    {
      tag: '@restores_container_state',
      mutate() {
        harness.state.container.status = 'stopped';
      },
      restored() {
        assert.equal(harness.state.container.status, 'running');
      },
    },
    {
      tag: '@restores_settings_state',
      mutate() {
        harness.state.settings.internetlessMode = true;
      },
      restored() {
        assert.deepEqual(harness.state.settings, {
          internetlessMode: false,
          updateMode: 'manual',
        });
      },
    },
    {
      tag: '@restores_notification_state',
      mutate() {
        harness.state.notification.enabled = false;
        harness.state.notification.triggers = ['mock.example'];
      },
      restored() {
        assert.equal(harness.state.notification.enabled, true);
        assert.deepEqual(harness.state.notification.triggers, []);
      },
    },
  ];

  for (const scenario of scenarios) {
    const world = {};
    await beforeHooks.get(scenario.tag).call(world);
    scenario.mutate();
    // Cucumber invokes After hooks for failed scenarios; invoke the registered
    // cleanup directly to model a failure before the scenario's manual reset.
    await afterHooks.get(scenario.tag).call(world, { result: { status: 'FAILED' } });
    scenario.restored();
  }
});

test('tags every state-mutating v1.4 scenario with its restoration hook', () => {
  const feature = readFileSync(join(__dirname, '../features/api-v14.feature'), 'utf8');
  const expectedTags = [
    ['@restores_container_state', 'Drydock must allow container lifecycle actions'],
    ['@restores_settings_state', 'Drydock must persist settings through API'],
    ['@restores_notification_state', 'Drydock must allow notification rule updates'],
  ];

  for (const [tag, scenario] of expectedTags) {
    assert.match(
      feature,
      new RegExp(`${tag}\\n\\s+Scenario: ${scenario}`),
      `${scenario} must activate ${tag}`,
    );
  }
});
