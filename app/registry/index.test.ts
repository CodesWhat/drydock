// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import * as configuration from '../configuration/index.js';
import * as prometheusWatcher from '../prometheus/watcher.js';
import * as store from '../store/index.js';
import Component from './Component.js';

vi.mock('../configuration', () => ({
  getLogLevel: vi.fn(() => 'info'),
  getLogFormat: vi.fn(() => 'json'),
  getRegistryConfigurations: vi.fn(),
  getTriggerConfigurations: vi.fn(),
  getWatcherConfigurations: vi.fn(),
  getAuthenticationConfigurations: vi.fn(),
  getAgentConfigurations: vi.fn(),
}));

vi.mock('../store/index.js', () => ({
  save: vi.fn(),
}));

let registries = {};
let triggers = {};
let watchers = {};
let authentications = {};
let agents = {};

// Override the mocked functions
// We need to cast to jest.Mock or assume they are mocks because of the factory above
const mockGetRegistryConfigurations = configuration.getRegistryConfigurations;
const mockGetTriggerConfigurations = configuration.getTriggerConfigurations;
const mockGetWatcherConfigurations = configuration.getWatcherConfigurations;
const mockGetAuthenticationConfigurations = configuration.getAuthenticationConfigurations;
const mockGetAgentConfigurations = configuration.getAgentConfigurations;

mockGetRegistryConfigurations.mockImplementation(() => registries);
mockGetTriggerConfigurations.mockImplementation(() => triggers);
mockGetWatcherConfigurations.mockImplementation(() => watchers);
mockGetAuthenticationConfigurations.mockImplementation(() => authentications);
mockGetAgentConfigurations.mockImplementation(() => agents);

import * as registry from './index.js';

beforeEach(async () => {
  vi.clearAllMocks();
  prometheusWatcher.init();
  registries = {};
  triggers = {};
  watchers = {};
  authentications = {};
  agents = {};

  // Ensure default implementations return the variables
  mockGetRegistryConfigurations.mockImplementation(() => registries);
  mockGetTriggerConfigurations.mockImplementation(() => triggers);
  mockGetWatcherConfigurations.mockImplementation(() => watchers);
  mockGetAuthenticationConfigurations.mockImplementation(() => authentications);
  mockGetAgentConfigurations.mockImplementation(() => agents);
});

afterEach(async () => {
  try {
    await registry.testable_deregisterRegistries();
    await registry.testable_deregisterTriggers();
    await registry.testable_deregisterWatchers();
    await registry.testable_deregisterAuthentications();
  } catch (e) {
    // ignore error
  }
});

test('registerComponent should warn when component does not exist', async () => {
  const registerComponent = registry.testable_registerComponent;
  await expect(
    registerComponent({
      kind: 'kind' as any,
      provider: 'provider',
      name: 'name',
      configuration: {},
      componentPath: 'path',
    }),
  ).rejects.toThrow(/Unknown kind provider/);
});

test('registerComponents should return empty array if not components', async () => {
  const registerComponents = registry.testable_registerComponents;
  await expect(registerComponents('kind', undefined, 'path')).resolves.toEqual([]);
});

test('deregisterComponent should throw when component fails to deregister', async () => {
  const deregisterComponent = registry.testable_deregisterComponent;
  const component = new Component();
  component.deregister = () => {
    throw new Error('Error x');
  };
  await expect(deregisterComponent(component)).rejects.toThrowError(
    'Error when deregistering component .',
  );
});

test('registerComponent should resolve agent component path when agent option is set', async () => {
  await expect(
    registry.testable_registerComponent({
      kind: 'watcher',
      provider: 'docker',
      name: 'agent-local',
      configuration: {},
      componentPath: 'watchers/providers',
      agent: 'node-1',
    }),
  ).rejects.toThrow(/Unknown watcher provider|Error when registering component/);
});

test('registerComponent should execute module fallback branch when module has no default export', async () => {
  const tempProviderPath = path.join(process.cwd(), 'tmp-test-providers');
  const providerDir = path.join(tempProviderPath, 'nodefault');
  const providerModule = path.join(providerDir, 'nodefault.ts');

  fs.mkdirSync(providerDir, { recursive: true });
  fs.writeFileSync(providerModule, 'export const value = 1;');

  try {
    await expect(
      registry.testable_registerComponent({
        kind: 'trigger',
        provider: 'nodefault',
        name: 'sample',
        configuration: {},
        componentPath: 'tmp-test-providers',
      }),
    ).rejects.toThrow(/Error when registering component|Unknown trigger provider/);
  } finally {
    fs.rmSync(tempProviderPath, { recursive: true, force: true });
  }
});

test('registerRegistries should register all registries', async () => {
  registries = {
    hub: {
      private: {
        login: 'login',
        token: 'token',
      },
    },
    ecr: {
      private: {
        accesskeyid: 'key',
        secretaccesskey: 'secret',
        region: 'region',
      },
    },
  };
  await registry.testable_registerRegistries();
  expect(Object.keys(registry.getState().registry).sort()).toEqual([
    'alicr.public',
    'codeberg.public',
    'dhi.public',
    'docr.public',
    'ecr.private',
    'gar.public',
    'gcr.public',
    'ghcr.public',
    'hub.private',
    'ibmcr.public',
    'lscr.public',
    'ocir.public',
    'quay.public',
  ]);
});

test('registerRegistries should register all anonymous registries by default', async () => {
  await registry.testable_registerRegistries();
  expect(Object.keys(registry.getState().registry).sort()).toEqual([
    'alicr.public',
    'codeberg.public',
    'dhi.public',
    'docr.public',
    'ecr.public',
    'gar.public',
    'gcr.public',
    'ghcr.public',
    'hub.public',
    'ibmcr.public',
    'lscr.public',
    'ocir.public',
    'quay.public',
  ]);
});

test('registerRegistries should warn when registration errors occur', async () => {
  const spyLog = vi.spyOn(registry.testable_log, 'warn');
  registries = {
    hub: {
      private: {
        login: false,
      },
    },
  };
  await registry.testable_registerRegistries();
  expect(spyLog).toHaveBeenCalledWith(
    'Some registries failed to register (Error when registering component hub ("value" does not match any of the allowed types))',
  );
});

test('registerTriggers should register all triggers', async () => {
  triggers = {
    mock: {
      mock1: {},
      mock2: {},
    },
  };
  await registry.testable_registerTriggers();
  expect(Object.keys(registry.getState().trigger)).toEqual(['mock.mock1', 'mock.mock2']);
});

test('registerTriggers should share threshold across trigger types with the same name', async () => {
  triggers = {
    mock: {
      update: {
        threshold: 'minor',
      },
    },
    discord: {
      update: {
        url: 'https://example.com',
      },
    },
  };
  await registry.testable_registerTriggers();
  expect(registry.getState().trigger['mock.update'].configuration.threshold).toEqual('minor');
  expect(registry.getState().trigger['discord.update'].configuration.threshold).toEqual('minor');
});

test('registerTriggers should not share threshold when same-name triggers define different values', async () => {
  triggers = {
    mock: {
      update: {
        threshold: 'minor',
      },
    },
    discord: {
      update: {
        url: 'https://example.com',
        threshold: 'patch',
      },
    },
    http: {
      update: {
        url: 'https://example.net',
      },
    },
  };
  await registry.testable_registerTriggers();
  expect(registry.getState().trigger['mock.update'].configuration.threshold).toEqual('minor');
  expect(registry.getState().trigger['discord.update'].configuration.threshold).toEqual('patch');
  expect(registry.getState().trigger['http.update'].configuration.threshold).toEqual('all');
});

test('registerTriggers should apply provider-level threshold to ntfy triggers', async () => {
  triggers = {
    ntfy: {
      threshold: 'minor',
      sh: {
        topic: 'xxxxyyyyzzzz',
      },
    },
  };
  await registry.testable_registerTriggers();
  expect(registry.getState().trigger['ntfy.sh'].configuration.threshold).toEqual('minor');
});

test('registerTriggers should let trigger-level threshold override provider-level one', async () => {
  triggers = {
    ntfy: {
      threshold: 'minor',
      sh: {
        topic: 'xxxxyyyyzzzz',
        threshold: 'patch',
      },
    },
  };
  await registry.testable_registerTriggers();
  expect(registry.getState().trigger['ntfy.sh'].configuration.threshold).toEqual('patch');
});

test('registerTriggers should warn when registration errors occur', async () => {
  const spyLog = vi.spyOn(registry.testable_log, 'warn');
  triggers = {
    trigger1: {
      fail: true,
    },
  };
  await registry.testable_registerTriggers();
  expect(spyLog).toHaveBeenCalledWith(
    expect.stringContaining(
      "Some triggers failed to register (Unknown trigger provider: 'trigger1'",
    ),
  );
});

test('registerWatchers should register all watchers', async () => {
  watchers = {
    watcher1: {
      host: 'host1',
    },
    watcher2: {
      host: 'host2',
    },
  };
  await registry.testable_registerWatchers();
  expect(Object.keys(registry.getState().watcher)).toEqual(['docker.watcher1', 'docker.watcher2']);
});

test('registerWatchers should register local docker watcher by default', async () => {
  await registry.testable_registerWatchers();
  expect(Object.keys(registry.getState().watcher)).toEqual(['docker.local']);
});

test('registerWatchers should warn when registration errors occur', async () => {
  const spyLog = vi.spyOn(registry.testable_log, 'warn');
  watchers = {
    watcher1: {
      fail: true,
    },
  };
  await registry.testable_registerWatchers();
  expect(spyLog).toHaveBeenCalledWith(
    'Some watchers failed to register (Error when registering component docker ("fail" is not allowed))',
  );
});

test('registerAuthentications should register all auth strategies', async () => {
  authentications = {
    basic: {
      john: {
        user: 'john',
        hash: 'hash',
      },
      jane: {
        user: 'jane',
        hash: 'hash',
      },
    },
  };
  await registry.testable_registerAuthentications();
  expect(Object.keys(registry.getState().authentication)).toEqual(['basic.john', 'basic.jane']);
});

test('registerAuthentications should warn when registration errors occur', async () => {
  const spyLog = vi.spyOn(registry.testable_log, 'warn');
  authentications = {
    basic: {
      john: {
        fail: true,
      },
    },
  };
  await registry.testable_registerAuthentications();
  expect(spyLog).toHaveBeenCalledWith(
    'Some authentications failed to register (Error when registering component basic ("user" is required))',
  );
});

test('registerAuthentications should register anonymous auth by default', async () => {
  await registry.testable_registerAuthentications();
  expect(Object.keys(registry.getState().authentication)).toEqual(['anonymous.anonymous']);
});

test('init should register all components', async () => {
  registries = {
    hub: {
      private: {
        login: 'login',
        token: 'token',
      },
    },
    ecr: {
      private: {
        accesskeyid: 'key',
        secretaccesskey: 'secret',
        region: 'region',
      },
    },
  };
  triggers = {
    mock: {
      mock1: {},
      mock2: {},
    },
  };
  watchers = {
    watcher1: {
      host: 'host1',
    },
    watcher2: {
      host: 'host2',
    },
  };
  authentications = {
    basic: {
      john: {
        user: 'john',
        hash: 'hash',
      },
      jane: {
        user: 'jane',
        hash: 'hash',
      },
    },
  };
  await registry.init();
  expect(Object.keys(registry.getState().registry).sort()).toEqual([
    'alicr.public',
    'codeberg.public',
    'dhi.public',
    'docr.public',
    'ecr.private',
    'gar.public',
    'gcr.public',
    'ghcr.public',
    'hub.private',
    'ibmcr.public',
    'lscr.public',
    'ocir.public',
    'quay.public',
  ]);
  expect(Object.keys(registry.getState().trigger)).toEqual(['mock.mock1', 'mock.mock2']);
  expect(Object.keys(registry.getState().watcher)).toEqual(['docker.watcher1', 'docker.watcher2']);
  expect(Object.keys(registry.getState().authentication)).toEqual(['basic.john', 'basic.jane']);
});

test('deregisterAll should deregister all components', async () => {
  registries = {
    hub: {
      login: 'login',
      token: 'token',
    },
    ecr: {
      accesskeyid: 'key',
      secretaccesskey: 'secret',
      region: 'region',
    },
  };
  triggers = {
    mock: {
      mock1: {},
      mock2: {},
    },
  };
  watchers = {
    watcher1: {
      host: 'host1',
    },
    watcher2: {
      host: 'host2',
    },
  };
  authentications = {
    basic: {
      john: {
        user: 'john',
        hash: 'hash',
      },
      jane: {
        user: 'jane',
        hash: 'hash',
      },
    },
  };
  await registry.init();
  await registry.testable_deregisterAll();
  expect(Object.keys(registry.getState().registry).length).toEqual(0);
  expect(Object.keys(registry.getState().trigger).length).toEqual(0);
  expect(Object.keys(registry.getState().watcher).length).toEqual(0);
  expect(Object.keys(registry.getState().authentication).length).toEqual(0);
});

test('shutdown should deregister all and exit 0', async () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  registry.getState().trigger = {};
  registry.getState().registry = {};
  registry.getState().watcher = {};
  registry.getState().authentication = {};
  await registry.testable_shutdown();
  expect(store.save).toHaveBeenCalledTimes(1);
  expect(exitSpy).toHaveBeenCalledWith(0);
  exitSpy.mockRestore();
});

test('shutdown should exit 1 when deregisterAll throws', async () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  const component = new Component();
  component.deregister = () => {
    throw new Error('Fail!!!');
  };
  registry.getState().trigger = { trigger1: component };
  await registry.testable_shutdown();
  expect(store.save).not.toHaveBeenCalled();
  expect(exitSpy).toHaveBeenCalledWith(1);
  exitSpy.mockRestore();
});

test('shutdown should exit 1 when store save throws', async () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  store.save.mockRejectedValueOnce(new Error('Save failed'));
  registry.getState().trigger = {};
  registry.getState().registry = {};
  registry.getState().watcher = {};
  registry.getState().authentication = {};
  await registry.testable_shutdown();
  expect(store.save).toHaveBeenCalledTimes(1);
  expect(exitSpy).toHaveBeenCalledWith(1);
  exitSpy.mockRestore();
});

test('deregisterAll should throw an error when any component fails to deregister', async () => {
  const component = new Component();
  component.deregister = () => {
    throw new Error('Fail!!!');
  };
  registry.getState().trigger = {
    trigger1: component,
  };
  await expect(registry.testable_deregisterAll()).rejects.toThrowError(
    'Error when deregistering component .',
  );
});

test('deregisterRegistries should throw when errors occurred', async () => {
  const component = new Component();
  component.deregister = () => {
    throw new Error('Fail!!!');
  };
  registry.getState().registry = {
    registry1: component,
  };
  await expect(registry.testable_deregisterRegistries()).rejects.toThrowError(
    'Error when deregistering component .',
  );
});

test('deregisterTriggers should throw when errors occurred', async () => {
  const component = new Component();
  component.deregister = () => {
    throw new Error('Fail!!!');
  };
  registry.getState().trigger = {
    trigger1: component,
  };
  await expect(registry.testable_deregisterTriggers()).rejects.toThrowError(
    'Error when deregistering component .',
  );
});

test('deregisterWatchers should throw when errors occurred', async () => {
  const component = new Component();
  component.deregister = () => {
    throw new Error('Fail!!!');
  };
  registry.getState().watcher = {
    watcher1: component,
  };
  await expect(registry.testable_deregisterWatchers()).rejects.toThrowError(
    'Error when deregistering component .',
  );
});

// --- Hybrid Triggers / Trigger Group Defaults ---

test('applyTriggerGroupDefaults should return input unchanged when no group entries exist', () => {
  const configurations = {
    mock: {
      update: { mock: 'custom' },
    },
  };
  const result = registry.testable_applyTriggerGroupDefaults(configurations, 'triggers/providers');
  expect(result).toEqual(configurations);
});

test('applyTriggerGroupDefaults should extract trigger group and apply to matching triggers', () => {
  const configurations = {
    mock: {
      update: { mock: 'custom' },
    },
    discord: {
      update: { url: 'https://example.com' },
    },
    update: { threshold: 'minor' },
  };
  const result = registry.testable_applyTriggerGroupDefaults(configurations, 'triggers/providers');
  expect(result.mock.update).toEqual({ threshold: 'minor', mock: 'custom' });
  expect(result.discord.update).toEqual({
    threshold: 'minor',
    url: 'https://example.com',
  });
  // The "update" group entry should NOT be in the result as a provider
  expect(result.update).toBeUndefined();
});

test('applyTriggerGroupDefaults should not override explicit trigger-level config', () => {
  const configurations = {
    mock: {
      update: { mock: 'custom', threshold: 'patch' },
    },
    discord: {
      update: { url: 'https://example.com' },
    },
    update: { threshold: 'minor' },
  };
  const result = registry.testable_applyTriggerGroupDefaults(configurations, 'triggers/providers');
  // mock.update has explicit threshold=patch, should NOT be overridden
  expect(result.mock.update.threshold).toEqual('patch');
  // discord.update has no explicit threshold, should get the group default
  expect(result.discord.update.threshold).toEqual('minor');
});

test('applyTriggerGroupDefaults should handle empty configurations', () => {
  expect(registry.testable_applyTriggerGroupDefaults({}, 'triggers/providers')).toEqual({});
  expect(registry.testable_applyTriggerGroupDefaults(null, 'triggers/providers')).toEqual(null);
});

test('applyTriggerGroupDefaults should support multiple shared keys', () => {
  const configurations = {
    mock: {
      notify: {},
    },
    notify: { threshold: 'major', once: 'false' },
  };
  const result = registry.testable_applyTriggerGroupDefaults(configurations, 'triggers/providers');
  expect(result.mock.notify).toEqual({ threshold: 'major', once: 'false' });
  expect(result.notify).toBeUndefined();
});

test('applyTriggerGroupDefaults should treat known providers case-insensitively from provider directory list', () => {
  const tempProviderPath = path.join(process.cwd(), 'tmp-test-trigger-providers');
  fs.mkdirSync(path.join(tempProviderPath, 'MockProvider'), { recursive: true });

  try {
    const result = registry.testable_applyTriggerGroupDefaults(
      {
        MockProvider: {
          update: {
            threshold: 'patch',
          },
        },
        update: {
          threshold: 'minor',
        },
      },
      'tmp-test-trigger-providers',
    );

    expect(result.MockProvider.update.threshold).toBe('patch');
    expect(result.update).toBeUndefined();
  } finally {
    fs.rmSync(tempProviderPath, { recursive: true, force: true });
  }
});

test('getKnownProviderSet should normalize provider names to lowercase', () => {
  const tempProviderPath = path.join(process.cwd(), 'tmp-test-provider-set');
  fs.mkdirSync(path.join(tempProviderPath, 'UpperOne'), { recursive: true });
  fs.mkdirSync(path.join(tempProviderPath, 'lowerTwo'), { recursive: true });

  try {
    const providerSet = registry.testable_getKnownProviderSet('tmp-test-provider-set');
    expect(providerSet.has('upperone')).toBe(true);
    expect(providerSet.has('lowertwo')).toBe(true);
  } finally {
    fs.rmSync(tempProviderPath, { recursive: true, force: true });
  }
});

test('getKnownProviderSet should invoke debug callback when provider path cannot be read', () => {
  const debugSpy = vi.spyOn(registry.testable_log, 'debug');

  const providers = registry.testable_getKnownProviderSet('tmp-provider-path-that-does-not-exist');

  expect(providers.size).toBe(0);
  expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('Unable to load providers under'));
});

test('applyTriggerGroupDefaults should handle non-record provider configs', () => {
  const configurations = {
    mock: 'not-a-record',
    update: { threshold: 'minor' },
  };
  const result = registry.testable_applyTriggerGroupDefaults(configurations, 'triggers/providers');
  // Non-record provider config should be passed through unchanged
  expect(result.mock).toBe('not-a-record');
});

test('applyTriggerGroupDefaults should handle non-record trigger within provider', () => {
  const configurations = {
    mock: {
      update: 'not-a-record',
      notify: { threshold: 'major' },
    },
    notify: { threshold: 'minor' },
  };
  const result = registry.testable_applyTriggerGroupDefaults(configurations, 'triggers/providers');
  // Non-record trigger config should be passed through
  expect(result.mock.update).toBe('not-a-record');
  expect(result.mock.notify.threshold).toBe('major');
});

test('applyTriggerGroupDefaults should handle trigger with no matching group', () => {
  const configurations = {
    mock: {
      update: { mock: 'custom' },
      unmatched: { foo: 'bar' },
    },
    update: { threshold: 'minor' },
  };
  const result = registry.testable_applyTriggerGroupDefaults(configurations, 'triggers/providers');
  expect(result.mock.update.threshold).toBe('minor');
  // unmatched should pass through unchanged since there's no group for it
  expect(result.mock.unmatched).toEqual({ foo: 'bar' });
});

test('applyTriggerGroupDefaults should not treat non-shared-key entries as groups', () => {
  // An entry with non-shared keys (e.g. url) should NOT be extracted as a group
  const configurations = {
    mock: {
      update: {},
    },
    unknownprovider: {
      update: { url: 'https://example.com', threshold: 'minor' },
    },
  };
  const result = registry.testable_applyTriggerGroupDefaults(configurations, 'triggers/providers');
  // unknownprovider has a key "update" that is a record with non-shared keys,
  // so it should remain as a normal provider entry (not extracted as a group)
  expect(result.unknownprovider).toBeDefined();
  expect(result.unknownprovider.update).toEqual({
    url: 'https://example.com',
    threshold: 'minor',
  });
});

test('registerTriggers should apply trigger group defaults across providers', async () => {
  triggers = {
    mock: {
      update: {},
    },
    discord: {
      update: {
        url: 'https://example.com',
      },
    },
    update: { threshold: 'minor' },
  };
  await registry.testable_registerTriggers();
  expect(registry.getState().trigger['mock.update'].configuration.threshold).toEqual('minor');
  expect(registry.getState().trigger['discord.update'].configuration.threshold).toEqual('minor');
});

test('registerTriggers should let explicit config override trigger group defaults', async () => {
  triggers = {
    mock: {
      update: { threshold: 'patch' },
    },
    discord: {
      update: {
        url: 'https://example.com',
      },
    },
    update: { threshold: 'minor' },
  };
  await registry.testable_registerTriggers();
  expect(registry.getState().trigger['mock.update'].configuration.threshold).toEqual('patch');
  expect(registry.getState().trigger['discord.update'].configuration.threshold).toEqual('minor');
});

test('init should register agents and their watchers/triggers', async () => {
  agents = {
    node1: {
      host: 'http://10.0.0.1:3000',
      secret: 'mysecret',
    },
  };
  triggers = {};
  watchers = {};
  registries = {};
  authentications = {};
  await registry.init();
  expect(Object.keys(registry.getState().agent)).toContain('dd.node1');
});

test('init in agent mode should skip authentications and agents registration', async () => {
  registry.getState().authentication = {};
  registry.getState().agent = {};
  triggers = {};
  watchers = {};
  registries = {};
  authentications = {
    basic: {
      john: {
        user: 'john',
        hash: 'hash',
      },
    },
  };
  agents = {
    node1: {
      host: 'http://10.0.0.1:3000',
      secret: 'mysecret',
    },
  };

  await registry.init({ agent: true });
  expect(Object.keys(registry.getState().authentication)).toEqual([]);
  expect(Object.keys(registry.getState().agent)).toEqual([]);
});

test('deregisterAgentComponents should remove agent-specific watchers and triggers', async () => {
  // Register a mock component as watcher and trigger with agent
  const watcherComponent = new Component();
  await watcherComponent.register('watcher', 'docker', 'agentw', {});
  watcherComponent.agent = 'myagent';
  registry.getState().watcher[watcherComponent.getId()] = watcherComponent;

  const triggerComponent = new Component();
  await triggerComponent.register('trigger', 'mock', 'agentt', {});
  triggerComponent.agent = 'myagent';
  registry.getState().trigger[triggerComponent.getId()] = triggerComponent;

  await registry.deregisterAgentComponents('myagent');

  expect(registry.getState().watcher[watcherComponent.getId()]).toBeUndefined();
  expect(registry.getState().trigger[triggerComponent.getId()]).toBeUndefined();
});

test('registerTriggers in agent mode should filter out unsupported trigger types', async () => {
  // Clean all existing triggers first
  const state = registry.getState();
  Object.keys(state.trigger).forEach((key) => delete state.trigger[key]);

  triggers = {
    mock: {
      update: {},
    },
    docker: {
      update: {},
    },
  };
  await registry.testable_registerTriggers({ agent: true });
  // mock is not in the allowed list for agent mode
  expect(registry.getState().trigger['mock.update']).toBeUndefined();
  expect(registry.getState().trigger['docker.update']).toBeDefined();
});

test('registerTriggers in agent mode should warn when registration fails', async () => {
  const spyLog = vi.spyOn(registry.testable_log, 'warn');
  const state = registry.getState();
  Object.keys(state.trigger).forEach((key) => delete state.trigger[key]);

  triggers = {
    docker: {
      fail: {
        invalid: true, // This should cause registration failure
      },
    },
  };
  await registry.testable_registerTriggers({ agent: true });
  expect(spyLog).toHaveBeenCalledWith(expect.stringContaining('Some triggers failed to register'));
});

test('init should handle agent registration failures gracefully', async () => {
  agents = {
    badagent: {
      // Missing required fields should cause failure
    },
  };
  triggers = {};
  watchers = {};
  registries = {};
  authentications = {};
  // Should not throw
  await registry.init();
  // The agent should not be registered
  expect(registry.getState().agent['dd.badagent']).toBeUndefined();
});

test('registerWatchers in agent mode should exit when no watchers configured', async () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  watchers = {};
  await registry.testable_registerWatchers({ agent: true });
  expect(exitSpy).toHaveBeenCalledWith(1);
  exitSpy.mockRestore();
});
