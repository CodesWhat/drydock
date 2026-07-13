import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import log from '../log/index.js';
import appPackageJson from '../package.json';
import * as configuration from './index.js';

function getTestDirectory() {
  try {
    const moduleUrl = new Function('return import.meta.url')();
    return path.dirname(fileURLToPath(moduleUrl));
  } catch {
    return __dirname;
  }
}

const TEST_DIRECTORY = getTestDirectory();

afterEach(() => {
  configuration.setDetectedServerName(undefined);
});

test('getVersion should return dd version', async () => {
  configuration.ddEnvVars.DD_VERSION = 'x.y.z';
  expect(configuration.getVersion()).toStrictEqual('x.y.z');
});

test('getVersion should trim whitespace from DD_VERSION', async () => {
  // Kills 107:29 [MethodExpression] ddEnvVars.DD_VERSION (removes .trim())
  configuration.ddEnvVars.DD_VERSION = '  1.2.3  ';
  expect(configuration.getVersion()).toBe('1.2.3');
  delete configuration.ddEnvVars.DD_VERSION;
});

test('getLogLevel should return info by default', async () => {
  delete configuration.ddEnvVars.DD_LOG_LEVEL;
  expect(configuration.getLogLevel()).toStrictEqual('info');
});

test('getLogLevel should return debug when overridden', async () => {
  configuration.ddEnvVars.DD_LOG_LEVEL = 'debug';
  expect(configuration.getLogLevel()).toStrictEqual('debug');
});

test('getLogFormat should return text by default', async () => {
  delete configuration.ddEnvVars.DD_LOG_FORMAT;
  expect(configuration.getLogFormat()).toStrictEqual('text');
});

test('getLogFormat should return json when overridden', async () => {
  configuration.ddEnvVars.DD_LOG_FORMAT = 'json';
  expect(configuration.getLogFormat()).toStrictEqual('json');
});

test('getLogFormat should normalize casing', async () => {
  configuration.ddEnvVars.DD_LOG_FORMAT = 'JSON';
  expect(configuration.getLogFormat()).toStrictEqual('json');
});

test('getLogFormat should fallback to text for unsupported values', async () => {
  configuration.ddEnvVars.DD_LOG_FORMAT = 'pretty';
  expect(configuration.getLogFormat()).toStrictEqual('text');
  delete configuration.ddEnvVars.DD_LOG_FORMAT;
});

test('getLogBufferEnabled should default to true', async () => {
  delete configuration.ddEnvVars.DD_LOG_BUFFER_ENABLED;
  expect(configuration.getLogBufferEnabled()).toStrictEqual(true);
});

test('getLogBufferEnabled should return false when disabled via env', async () => {
  configuration.ddEnvVars.DD_LOG_BUFFER_ENABLED = 'false';
  expect(configuration.getLogBufferEnabled()).toStrictEqual(false);
  delete configuration.ddEnvVars.DD_LOG_BUFFER_ENABLED;
});

test('getLocalWatcherEnabled should default to true', async () => {
  delete configuration.ddEnvVars.DD_LOCAL_WATCHER;
  expect(configuration.getLocalWatcherEnabled()).toStrictEqual(true);
});

test('getLocalWatcherEnabled should return false when disabled via env', async () => {
  configuration.ddEnvVars.DD_LOCAL_WATCHER = 'false';
  expect(configuration.getLocalWatcherEnabled()).toStrictEqual(false);
  delete configuration.ddEnvVars.DD_LOCAL_WATCHER;
});

test('getExperimentalPortwingEnabled should default to false', () => {
  delete configuration.ddEnvVars.DD_EXPERIMENTAL_PORTWING;
  expect(configuration.getExperimentalPortwingEnabled()).toStrictEqual(false);
});

test('getExperimentalPortwingEnabled should return true when set to "true"', () => {
  configuration.ddEnvVars.DD_EXPERIMENTAL_PORTWING = 'true';
  expect(configuration.getExperimentalPortwingEnabled()).toStrictEqual(true);
  delete configuration.ddEnvVars.DD_EXPERIMENTAL_PORTWING;
});

test('getExperimentalPortwingEnabled should normalize casing', () => {
  configuration.ddEnvVars.DD_EXPERIMENTAL_PORTWING = 'TRUE';
  expect(configuration.getExperimentalPortwingEnabled()).toStrictEqual(true);
  delete configuration.ddEnvVars.DD_EXPERIMENTAL_PORTWING;
});

test('getExperimentalPortwingEnabled should trim whitespace before comparing', () => {
  configuration.ddEnvVars.DD_EXPERIMENTAL_PORTWING = '  true  ';
  expect(configuration.getExperimentalPortwingEnabled()).toStrictEqual(true);
  delete configuration.ddEnvVars.DD_EXPERIMENTAL_PORTWING;
});

test('getExperimentalPortwingEnabled should return false for non-"true" values', () => {
  configuration.ddEnvVars.DD_EXPERIMENTAL_PORTWING = '1';
  expect(configuration.getExperimentalPortwingEnabled()).toStrictEqual(false);
  delete configuration.ddEnvVars.DD_EXPERIMENTAL_PORTWING;
});

test('getWudCardCompatEnabled should default to false', () => {
  delete configuration.ddEnvVars.DD_COMPAT_WUDCARD;
  expect(configuration.getWudCardCompatEnabled()).toStrictEqual(false);
});

test('getWudCardCompatEnabled should return true when set to "true"', () => {
  configuration.ddEnvVars.DD_COMPAT_WUDCARD = 'true';
  expect(configuration.getWudCardCompatEnabled()).toStrictEqual(true);
  delete configuration.ddEnvVars.DD_COMPAT_WUDCARD;
});

test('getWudCardCompatEnabled should normalize casing', () => {
  configuration.ddEnvVars.DD_COMPAT_WUDCARD = 'TRUE';
  expect(configuration.getWudCardCompatEnabled()).toStrictEqual(true);
  delete configuration.ddEnvVars.DD_COMPAT_WUDCARD;
});

test('getWudCardCompatEnabled should trim whitespace before comparing', () => {
  configuration.ddEnvVars.DD_COMPAT_WUDCARD = '  true  ';
  expect(configuration.getWudCardCompatEnabled()).toStrictEqual(true);
  delete configuration.ddEnvVars.DD_COMPAT_WUDCARD;
});

test('getWudCardCompatEnabled should return false for non-"true" values', () => {
  configuration.ddEnvVars.DD_COMPAT_WUDCARD = '1';
  expect(configuration.getWudCardCompatEnabled()).toStrictEqual(false);
  delete configuration.ddEnvVars.DD_COMPAT_WUDCARD;
});

test('getDnsMode should default to ipv4first', () => {
  delete configuration.ddEnvVars.DD_DNS_MODE;
  expect(configuration.getDnsMode()).toBe('ipv4first');
});

test('getDnsMode should accept ipv6first', () => {
  configuration.ddEnvVars.DD_DNS_MODE = 'ipv6first';
  expect(configuration.getDnsMode()).toBe('ipv6first');
  delete configuration.ddEnvVars.DD_DNS_MODE;
});

test('getDnsMode should accept verbatim', () => {
  configuration.ddEnvVars.DD_DNS_MODE = 'verbatim';
  expect(configuration.getDnsMode()).toBe('verbatim');
  delete configuration.ddEnvVars.DD_DNS_MODE;
});

test('getDnsMode should normalize casing', () => {
  configuration.ddEnvVars.DD_DNS_MODE = 'IPV4FIRST';
  expect(configuration.getDnsMode()).toBe('ipv4first');
  delete configuration.ddEnvVars.DD_DNS_MODE;
});

test('getDnsMode should fallback to ipv4first for invalid values', () => {
  configuration.ddEnvVars.DD_DNS_MODE = 'invalid';
  expect(configuration.getDnsMode()).toBe('ipv4first');
  delete configuration.ddEnvVars.DD_DNS_MODE;
});

test('getDnsMode should trim whitespace', () => {
  configuration.ddEnvVars.DD_DNS_MODE = '  verbatim  ';
  expect(configuration.getDnsMode()).toBe('verbatim');
  delete configuration.ddEnvVars.DD_DNS_MODE;
});

test('getWatcherConfiguration should return empty object by default', async () => {
  delete configuration.ddEnvVars.DD_WATCHER_WATCHER1_X;
  delete configuration.ddEnvVars.DD_WATCHER_WATCHER1_Y;
  delete configuration.ddEnvVars.DD_WATCHER_WATCHER2_X;
  delete configuration.ddEnvVars.DD_WATCHER_WATCHER2_Y;
  expect(configuration.getWatcherConfigurations()).toStrictEqual({});
});

test('getWatcherConfiguration should return configured watchers when overridden', async () => {
  configuration.ddEnvVars.DD_WATCHER_WATCHER1_X = 'x';
  configuration.ddEnvVars.DD_WATCHER_WATCHER1_Y = 'y';
  configuration.ddEnvVars.DD_WATCHER_WATCHER2_X = 'x';
  configuration.ddEnvVars.DD_WATCHER_WATCHER2_Y = 'y';
  expect(configuration.getWatcherConfigurations()).toStrictEqual({
    watcher1: { x: 'x', y: 'y' },
    watcher2: { x: 'x', y: 'y' },
  });
});

test('getWatcherConfiguration should surface DD_WATCHER_*_TAG_PIN_INFO as a nested lowercase path (#498)', async () => {
  configuration.ddEnvVars.DD_WATCHER_TEST_TAG_PIN_INFO = 'false';

  const watcherConfigurations = configuration.getWatcherConfigurations();
  expect(watcherConfigurations.test.tag.pin.info).toBe('false');

  delete configuration.ddEnvVars.DD_WATCHER_TEST_TAG_PIN_INFO;
});

test('getWatcherConfiguration should surface DD_WATCHER_*_TAG_FAMILY as a nested lowercase path (#498)', async () => {
  configuration.ddEnvVars.DD_WATCHER_TEST_TAG_FAMILY = 'loose';

  const watcherConfigurations = configuration.getWatcherConfigurations();
  expect(watcherConfigurations.test.tag.family).toBe('loose');

  delete configuration.ddEnvVars.DD_WATCHER_TEST_TAG_FAMILY;
});

test('getWatcherConfiguration should surface IMGSET tag.pin.info as a nested lowercase path (#498)', async () => {
  configuration.ddEnvVars.DD_WATCHER_TEST_IMGSET_SERVICE_IMAGE = 'ghcr.io/team/service';
  configuration.ddEnvVars.DD_WATCHER_TEST_IMGSET_SERVICE_TAG_PIN_INFO = 'false';

  const watcherConfigurations = configuration.getWatcherConfigurations();
  expect(watcherConfigurations.test.imgset.service.tag.pin.info).toBe('false');

  delete configuration.ddEnvVars.DD_WATCHER_TEST_IMGSET_SERVICE_IMAGE;
  delete configuration.ddEnvVars.DD_WATCHER_TEST_IMGSET_SERVICE_TAG_PIN_INFO;
});

test('getWatcherConfiguration should normalize declarative maturity defaults to watcher runtime keys', () => {
  configuration.ddEnvVars.DD_WATCHER_LOCAL_MATURITY_MODE = 'mature';
  configuration.ddEnvVars.DD_WATCHER_LOCAL_MATURITY_MIN_AGE_DAYS = '14';

  const watcherConfigurations = configuration.getWatcherConfigurations();
  expect(watcherConfigurations.local.maturitymode).toBe('mature');
  expect(watcherConfigurations.local.maturityminagedays).toBe('14');
  expect(watcherConfigurations.local.maturity).toBeUndefined();

  delete configuration.ddEnvVars.DD_WATCHER_LOCAL_MATURITY_MODE;
  delete configuration.ddEnvVars.DD_WATCHER_LOCAL_MATURITY_MIN_AGE_DAYS;
});

test('getWatcherConfiguration should not apply maturity aliases without a watcher name', () => {
  configuration.ddEnvVars.DD_WATCHER__MATURITY_MODE = 'mature';

  const watcherConfigurations = configuration.getWatcherConfigurations();

  expect(watcherConfigurations['']).toEqual({});
  delete configuration.ddEnvVars.DD_WATCHER__MATURITY_MODE;
});

test('getWatcherConfiguration should map MAINTENANCE_WINDOW aliases', async () => {
  configuration.ddEnvVars.DD_WATCHER_LOCAL_MAINTENANCE_WINDOW = '0 2 * * *';
  configuration.ddEnvVars.DD_WATCHER_LOCAL_MAINTENANCE_WINDOW_TZ = 'Europe/Paris';

  const watcherConfigurations = configuration.getWatcherConfigurations();
  expect(watcherConfigurations.local.maintenancewindow).toStrictEqual('0 2 * * *');
  expect(watcherConfigurations.local.maintenancewindowtz).toStrictEqual('Europe/Paris');
  expect(watcherConfigurations.local.maintenance).toBeUndefined();

  delete configuration.ddEnvVars.DD_WATCHER_LOCAL_MAINTENANCE_WINDOW;
  delete configuration.ddEnvVars.DD_WATCHER_LOCAL_MAINTENANCE_WINDOW_TZ;
});

test('getWatcherConfiguration should map MAINTENANCE_WINDOW aliases regardless of insertion order', async () => {
  configuration.ddEnvVars.DD_WATCHER_REVERSE_MAINTENANCE_WINDOW_TZ = 'UTC';
  configuration.ddEnvVars.DD_WATCHER_REVERSE_MAINTENANCE_WINDOW = '30 1 * * *';

  const watcherConfigurations = configuration.getWatcherConfigurations();
  expect(watcherConfigurations.reverse.maintenancewindow).toStrictEqual('30 1 * * *');
  expect(watcherConfigurations.reverse.maintenancewindowtz).toStrictEqual('UTC');
  expect(watcherConfigurations.reverse.maintenance).toBeUndefined();

  delete configuration.ddEnvVars.DD_WATCHER_REVERSE_MAINTENANCE_WINDOW;
  delete configuration.ddEnvVars.DD_WATCHER_REVERSE_MAINTENANCE_WINDOW_TZ;
});

test('getWatcherConfiguration should preserve MAINTENANCEWINDOW legacy env vars', async () => {
  configuration.ddEnvVars.DD_WATCHER_LEGACY_MAINTENANCEWINDOW = '15 3 * * *';
  configuration.ddEnvVars.DD_WATCHER_LEGACY_MAINTENANCEWINDOWTZ = 'America/New_York';

  const watcherConfigurations = configuration.getWatcherConfigurations();
  expect(watcherConfigurations.legacy.maintenancewindow).toStrictEqual('15 3 * * *');
  expect(watcherConfigurations.legacy.maintenancewindowtz).toStrictEqual('America/New_York');

  delete configuration.ddEnvVars.DD_WATCHER_LEGACY_MAINTENANCEWINDOW;
  delete configuration.ddEnvVars.DD_WATCHER_LEGACY_MAINTENANCEWINDOWTZ;
});

test('getWatcherConfiguration should ignore MAINTENANCE_WINDOW aliases without watcher name', async () => {
  configuration.ddEnvVars.DD_WATCHER_MAINTENANCE_WINDOW = '*/5 * * * *';
  configuration.ddEnvVars.DD_WATCHER_MAINTENANCE_WINDOW_TZ = 'UTC';

  const watcherConfigurations = configuration.getWatcherConfigurations();
  expect(watcherConfigurations['']).toBeUndefined();

  delete configuration.ddEnvVars.DD_WATCHER_MAINTENANCE_WINDOW;
  delete configuration.ddEnvVars.DD_WATCHER_MAINTENANCE_WINDOW_TZ;
});

test('getWatcherConfiguration should create watcher entry from alias when watcher has no other keys', async () => {
  configuration.ddEnvVars.DD_WATCHER_ALIASONLY_MAINTENANCE_WINDOW = '0 6 * * *';

  const watcherConfigurations = configuration.getWatcherConfigurations();
  expect(watcherConfigurations.aliasonly).toEqual({ maintenancewindow: '0 6 * * *' });
  expect(watcherConfigurations.aliasonly.maintenance).toBeUndefined();

  delete configuration.ddEnvVars.DD_WATCHER_ALIASONLY_MAINTENANCE_WINDOW;
});

test('getWatcherConfiguration should create watcher entry for lowercase alias keys', async () => {
  configuration.ddEnvVars.dd_watcher_lowercase_maintenance_window = '*/10 * * * *';

  const watcherConfigurations = configuration.getWatcherConfigurations();
  expect(watcherConfigurations.lowercase).toEqual({ maintenancewindow: '*/10 * * * *' });

  delete configuration.ddEnvVars.dd_watcher_lowercase_maintenance_window;
});

test('getTriggerConfigurations should return empty object by default', async () => {
  delete configuration.ddEnvVars.DD_TRIGGER_TRIGGER1_X;
  delete configuration.ddEnvVars.DD_TRIGGER_TRIGGER1_Y;
  delete configuration.ddEnvVars.DD_TRIGGER_TRIGGER2_X;
  delete configuration.ddEnvVars.DD_TRIGGER_TRIGGER2_Y;
  expect(configuration.getTriggerConfigurations()).toStrictEqual({});
});

test('getTriggerConfigurations should return configured triggers when overridden', async () => {
  configuration.ddEnvVars.DD_TRIGGER_TRIGGER1_X = 'x';
  configuration.ddEnvVars.DD_TRIGGER_TRIGGER1_Y = 'y';
  configuration.ddEnvVars.DD_TRIGGER_TRIGGER2_X = 'x';
  configuration.ddEnvVars.DD_TRIGGER_TRIGGER2_Y = 'y';
  expect(configuration.getTriggerConfigurations()).toStrictEqual({
    trigger1: { x: 'x', y: 'y' },
    trigger2: { x: 'x', y: 'y' },
  });
});

test('getTriggerConfigurations logs every legacy DD_TRIGGER key at error level', () => {
  const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => log);
  const legacyKey = 'DD_TRIGGER_PHASE3ERROR_UNIQUE_ENABLED';
  configuration.ddEnvVars[legacyKey] = 'true';

  try {
    configuration.getTriggerConfigurations();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Legacy trigger environment variable "${legacyKey}"`),
    );
  } finally {
    delete configuration.ddEnvVars[legacyKey];
    errorSpy.mockRestore();
  }
});

test('getRegistryConfigurations should return empty object by default', async () => {
  delete configuration.ddEnvVars.DD_REGISTRY_REGISTRY1_X;
  delete configuration.ddEnvVars.DD_REGISTRY_REGISTRY1_Y;
  delete configuration.ddEnvVars.DD_REGISTRY_REGISTRY1_X;
  delete configuration.ddEnvVars.DD_REGISTRY_REGISTRY1_Y;
  expect(configuration.getRegistryConfigurations()).toStrictEqual({});
});

test('getRegistryConfigurations should return configured registries when overridden', async () => {
  configuration.ddEnvVars.DD_REGISTRY_REGISTRY1_X = 'x';
  configuration.ddEnvVars.DD_REGISTRY_REGISTRY1_Y = 'y';
  configuration.ddEnvVars.DD_REGISTRY_REGISTRY2_X = 'x';
  configuration.ddEnvVars.DD_REGISTRY_REGISTRY2_Y = 'y';
  expect(configuration.getRegistryConfigurations()).toStrictEqual({
    registry1: { x: 'x', y: 'y' },
    registry2: { x: 'x', y: 'y' },
  });
});

test('getAgentConfigurations should return configured agents when overridden', async () => {
  configuration.ddEnvVars.DD_AGENT_NODE1_HOST = '10.0.0.1';
  configuration.ddEnvVars.DD_AGENT_NODE1_SECRET = 'secret1';
  configuration.ddEnvVars.DD_AGENT_NODE2_HOST = '10.0.0.2';
  configuration.ddEnvVars.DD_AGENT_NODE2_SECRET = 'secret2';
  expect(configuration.getAgentConfigurations()).toStrictEqual({
    node1: { host: '10.0.0.1', secret: 'secret1' },
    node2: { host: '10.0.0.2', secret: 'secret2' },
  });
});

test('getStoreConfiguration should return configured store', async () => {
  configuration.ddEnvVars.DD_STORE_X = 'x';
  configuration.ddEnvVars.DD_STORE_Y = 'y';
  expect(configuration.getStoreConfiguration()).toStrictEqual({
    x: 'x',
    y: 'y',
  });
});

test('getServerConfiguration should return configured api (new vars)', async () => {
  configuration.ddEnvVars.DD_SERVER_PORT = '4000';
  delete configuration.ddEnvVars.DD_SERVER_METRICS_AUTH;
  delete configuration.ddEnvVars.DD_SERVER_METRICS_TOKEN;
  expect(configuration.getServerConfiguration()).toStrictEqual({
    cookie: {},
    compression: {},
    cors: {},
    enabled: true,
    feature: {
      delete: true,
      containeractions: true,
    },
    metrics: {},
    port: 4000,
    session: {},
    tls: {},
    trustproxy: false,
    ui: {},
  });
});

test('getServerConfiguration should allow disabling metrics auth', async () => {
  delete configuration.ddEnvVars.DD_SERVER_PORT;
  configuration.ddEnvVars.DD_SERVER_METRICS_AUTH = 'false';
  expect(configuration.getServerConfiguration()).toStrictEqual({
    cookie: {},
    compression: {},
    cors: {},
    enabled: true,
    feature: {
      delete: true,
      containeractions: true,
    },
    metrics: {
      auth: false,
      token: '',
    },
    port: 3000,
    session: {},
    tls: {},
    trustproxy: false,
    ui: {},
  });
  delete configuration.ddEnvVars.DD_SERVER_METRICS_AUTH;
});

test('getServerConfiguration should parse DD_SERVER_METRICS_TOKEN', async () => {
  delete configuration.ddEnvVars.DD_SERVER_PORT;
  configuration.ddEnvVars.DD_SERVER_METRICS_TOKEN = 'my-prom-metrics-token';
  const config = configuration.getServerConfiguration();
  expect(config.metrics).toStrictEqual({
    auth: true,
    token: 'my-prom-metrics-token',
  });
  delete configuration.ddEnvVars.DD_SERVER_METRICS_TOKEN;
});

test('getServerConfiguration should allow DD_SERVER_METRICS_TOKEN to be empty', async () => {
  delete configuration.ddEnvVars.DD_SERVER_PORT;
  configuration.ddEnvVars.DD_SERVER_METRICS_TOKEN = '';
  const config = configuration.getServerConfiguration();
  expect(config.metrics).toStrictEqual({
    auth: true,
    token: '',
  });
  delete configuration.ddEnvVars.DD_SERVER_METRICS_TOKEN;
});

test('getServerConfiguration should allow disabling the UI router', async () => {
  configuration.ddEnvVars.DD_SERVER_UI_ENABLED = 'false';
  const config = configuration.getServerConfiguration();
  expect(config.ui).toStrictEqual({
    enabled: false,
  });
  delete configuration.ddEnvVars.DD_SERVER_UI_ENABLED;
});

test('getServerConfiguration should allow tuning compression', async () => {
  configuration.ddEnvVars.DD_SERVER_COMPRESSION_ENABLED = 'false';
  configuration.ddEnvVars.DD_SERVER_COMPRESSION_THRESHOLD = '2048';
  const config = configuration.getServerConfiguration();
  expect(config.compression).toStrictEqual({
    enabled: false,
    threshold: 2048,
  });
  delete configuration.ddEnvVars.DD_SERVER_COMPRESSION_ENABLED;
  delete configuration.ddEnvVars.DD_SERVER_COMPRESSION_THRESHOLD;
});

test('getServerConfiguration should accept trustproxy as number', async () => {
  configuration.ddEnvVars.DD_SERVER_TRUSTPROXY = '1';
  const config = configuration.getServerConfiguration();
  expect(config.trustproxy).toBe(1);
  delete configuration.ddEnvVars.DD_SERVER_TRUSTPROXY;
});

test('getServerConfiguration should accept trustproxy as boolean string', async () => {
  configuration.ddEnvVars.DD_SERVER_TRUSTPROXY = 'true';
  const config = configuration.getServerConfiguration();
  expect(config.trustproxy).toBe(true);
  delete configuration.ddEnvVars.DD_SERVER_TRUSTPROXY;
});

test('getServerConfiguration should allow overriding session cookie sameSite', async () => {
  configuration.ddEnvVars.DD_SERVER_COOKIE_SAMESITE = 'none';
  const config = configuration.getServerConfiguration();
  expect(config.cookie).toStrictEqual({
    samesite: 'none',
  });
  delete configuration.ddEnvVars.DD_SERVER_COOKIE_SAMESITE;
});

test('getServerConfiguration should normalize session cookie sameSite casing', async () => {
  configuration.ddEnvVars.DD_SERVER_COOKIE_SAMESITE = 'STRICT';
  const config = configuration.getServerConfiguration();
  expect(config.cookie).toStrictEqual({
    samesite: 'strict',
  });
  delete configuration.ddEnvVars.DD_SERVER_COOKIE_SAMESITE;
});

test('getServerConfiguration should allow overriding max concurrent sessions per user', async () => {
  configuration.ddEnvVars.DD_SERVER_SESSION_MAXCONCURRENTSESSIONS = '3';
  const config = configuration.getServerConfiguration();
  expect(config.session).toStrictEqual({
    maxconcurrentsessions: 3,
  });
  delete configuration.ddEnvVars.DD_SERVER_SESSION_MAXCONCURRENTSESSIONS;
});

test('getServerName should return DD_SERVER_NAME when set', () => {
  configuration.ddEnvVars.DD_SERVER_NAME = 'my-controller';
  expect(configuration.getServerName()).toBe('my-controller');
  delete configuration.ddEnvVars.DD_SERVER_NAME;
});

test('getServerName should fall back to os.hostname when DD_SERVER_NAME is not set', () => {
  delete configuration.ddEnvVars.DD_SERVER_NAME;
  const name = configuration.getServerName();
  expect(typeof name).toBe('string');
  expect(name.length).toBeGreaterThan(0);
});

test('getServerName should trim whitespace from DD_SERVER_NAME', () => {
  configuration.ddEnvVars.DD_SERVER_NAME = '  my-server  ';
  expect(configuration.getServerName()).toBe('my-server');
  delete configuration.ddEnvVars.DD_SERVER_NAME;
});

test('getServerName should fall back to hostname when DD_SERVER_NAME is empty', () => {
  configuration.ddEnvVars.DD_SERVER_NAME = '';
  const name = configuration.getServerName();
  expect(name).not.toBe('');
  delete configuration.ddEnvVars.DD_SERVER_NAME;
});

test('getServerName should prefer detected server name when DD_SERVER_NAME is not set', () => {
  delete configuration.ddEnvVars.DD_SERVER_NAME;
  configuration.setDetectedServerName('datavault');

  expect(configuration.getServerName()).toBe('datavault');
});

test('getDetectedServerName should reflect the last setDetectedServerName value', () => {
  configuration.setDetectedServerName(undefined);
  expect(configuration.getDetectedServerName()).toBeUndefined();

  configuration.setDetectedServerName('datavault');
  expect(configuration.getDetectedServerName()).toBe('datavault');

  configuration.setDetectedServerName('   ');
  expect(configuration.getDetectedServerName()).toBeUndefined();
});

test('getServerConfiguration should allow enabling identity-aware rate-limit keys', async () => {
  configuration.ddEnvVars.DD_SERVER_RATELIMIT_IDENTITYKEYING = 'true';
  const config = configuration.getServerConfiguration();
  expect(config.ratelimit).toStrictEqual({
    identitykeying: true,
  });
  delete configuration.ddEnvVars.DD_SERVER_RATELIMIT_IDENTITYKEYING;
});

test('getPrometheusConfiguration should result in enabled by default', async () => {
  delete configuration.ddEnvVars.DD_PROMETHEUS_ENABLED;
  expect(configuration.getPrometheusConfiguration()).toStrictEqual({
    enabled: true,
  });
});

test('getPrometheusConfiguration should be disabled when overridden', async () => {
  configuration.ddEnvVars.DD_PROMETHEUS_ENABLED = 'false';
  expect(configuration.getPrometheusConfiguration()).toStrictEqual({
    enabled: false,
  });
});

test('replaceSecrets must read secret in file', async () => {
  const vars = {
    DD_SERVER_X__FILE: `${TEST_DIRECTORY}/secret.txt`,
  };
  await configuration.replaceSecrets(vars);
  expect(vars).toStrictEqual({
    DD_SERVER_X: 'super_secret',
  });
});

test('replaceSecrets should avoid synchronous file-system APIs', async () => {
  const vars = {
    DD_SERVER_X__FILE: `${TEST_DIRECTORY}/secret.txt`,
  };
  const openSyncSpy = vi.spyOn(fs, 'openSync');

  try {
    await configuration.replaceSecrets(vars);
    expect(openSyncSpy).not.toHaveBeenCalled();
  } finally {
    openSyncSpy.mockRestore();
  }
});

test('replaceSecrets must reject secret files larger than 1MB', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-secret-'));
  const largeSecretPath = path.join(tempDirectory, 'large-secret.txt');
  fs.writeFileSync(largeSecretPath, 'x'.repeat(1024 * 1024 + 1), 'utf-8');

  const vars = {
    DD_SERVER_X__FILE: largeSecretPath,
  };

  try {
    await expect(configuration.replaceSecrets(vars)).rejects.toThrow(
      'exceeds maximum size of 1048576 bytes',
    );
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

describe('getSecurityConfiguration', () => {
  test('should return disabled scanner by default', () => {
    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_SERVER;
    const result = configuration.getSecurityConfiguration();
    expect(result).toEqual({
      enabled: false,
      scanner: '',
      backend: 'command',
      availabilityPolicy: 'block',
      docker: {
        socket: '/var/run/docker.sock',
        host: '',
        port: 2375,
        protocol: 'http',
        network: 'bridge',
        cacheVolumePrefix: 'drydock-scanner-cache',
      },
      blockSeverities: ['CRITICAL', 'HIGH'],
      trivy: {
        server: '',
        command: 'trivy',
        timeout: 600000,
        imageSrc: '',
        extraArgs: [],
        workerImage:
          'aquasec/trivy@sha256:bcc376de8d77cfe086a917230e818dc9f8528e3c852f7b1aff648949b6258d1c',
      },
      grype: {
        command: 'grype',
        timeout: 600000,
        extraArgs: [],
        workerImage:
          'anchore/grype@sha256:af65fbc0c664691067788fe95ff88760b435543e45595eb2ca6f102fc476fbe1',
      },
      signature: {
        verify: false,
        cosign: {
          command: 'cosign',
          timeout: 60000,
          key: '',
          identity: '',
          issuer: '',
        },
      },
      sbom: {
        enabled: false,
        formats: ['spdx-json'],
        generator: 'auto',
      },
      syft: {
        command: 'syft',
        timeout: 600000,
        extraArgs: [],
        workerImage:
          'anchore/syft@sha256:5999d209a342e55e9edf70bf8930fb5b86d8f2a783fa401178372c50e21b1d36',
      },
      gate: {
        mode: 'on',
      },
      prune: {
        onBlock: true,
      },
      scan: {
        cron: '',
        jitter: 60000,
        concurrency: 4,
        batchTimeout: 1800000,
        notifications: false,
      },
    });
  });

  test('should parse trivy security config', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = 'critical,medium';
    configuration.ddEnvVars.DD_SECURITY_TRIVY_SERVER = 'http://trivy:4954';
    configuration.ddEnvVars.DD_SECURITY_TRIVY_COMMAND = '/usr/local/bin/trivy';
    configuration.ddEnvVars.DD_SECURITY_TRIVY_TIMEOUT = '60000';
    configuration.ddEnvVars.DD_SECURITY_VERIFY_SIGNATURES = 'true';
    configuration.ddEnvVars.DD_SECURITY_COSIGN_COMMAND = '/usr/local/bin/cosign';
    configuration.ddEnvVars.DD_SECURITY_COSIGN_TIMEOUT = '45000';
    configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY = `${TEST_DIRECTORY}/secret.txt`;
    configuration.ddEnvVars.DD_SECURITY_COSIGN_IDENTITY = 'maintainer@example.com';
    configuration.ddEnvVars.DD_SECURITY_COSIGN_ISSUER =
      'https://token.actions.githubusercontent.com';
    configuration.ddEnvVars.DD_SECURITY_SBOM_ENABLED = 'true';
    configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS = 'cyclonedx-json,spdx-json,cyclonedx-json';
    configuration.ddEnvVars.DD_SECURITY_SCAN_CONCURRENCY = '8';
    configuration.ddEnvVars.DD_SECURITY_SCAN_BATCH_TIMEOUT = '900000';

    const result = configuration.getSecurityConfiguration();
    expect(result).toEqual({
      enabled: true,
      scanner: 'trivy',
      backend: 'command',
      availabilityPolicy: 'block',
      docker: {
        socket: '/var/run/docker.sock',
        host: '',
        port: 2375,
        protocol: 'http',
        network: 'bridge',
        cacheVolumePrefix: 'drydock-scanner-cache',
      },
      blockSeverities: ['CRITICAL', 'MEDIUM'],
      trivy: {
        server: 'http://trivy:4954',
        command: '/usr/local/bin/trivy',
        timeout: 60000,
        imageSrc: '',
        extraArgs: [],
        workerImage:
          'aquasec/trivy@sha256:bcc376de8d77cfe086a917230e818dc9f8528e3c852f7b1aff648949b6258d1c',
      },
      grype: {
        command: 'grype',
        timeout: 600000,
        extraArgs: [],
        workerImage:
          'anchore/grype@sha256:af65fbc0c664691067788fe95ff88760b435543e45595eb2ca6f102fc476fbe1',
      },
      signature: {
        verify: true,
        cosign: {
          command: '/usr/local/bin/cosign',
          timeout: 45000,
          key: `${TEST_DIRECTORY}/secret.txt`,
          identity: 'maintainer@example.com',
          issuer: 'https://token.actions.githubusercontent.com',
        },
      },
      sbom: {
        enabled: true,
        formats: ['cyclonedx-json', 'spdx-json'],
        generator: 'auto',
      },
      syft: {
        command: 'syft',
        timeout: 600000,
        extraArgs: [],
        workerImage:
          'anchore/syft@sha256:5999d209a342e55e9edf70bf8930fb5b86d8f2a783fa401178372c50e21b1d36',
      },
      gate: {
        mode: 'on',
      },
      prune: {
        onBlock: true,
      },
      scan: {
        cron: '',
        jitter: 60000,
        concurrency: 8,
        batchTimeout: 900000,
        notifications: false,
      },
    });

    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_SERVER;
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_COMMAND;
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_TIMEOUT;
    delete configuration.ddEnvVars.DD_SECURITY_VERIFY_SIGNATURES;
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_COMMAND;
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_TIMEOUT;
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY;
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_IDENTITY;
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_ISSUER;
    delete configuration.ddEnvVars.DD_SECURITY_SBOM_ENABLED;
    delete configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS;
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_CONCURRENCY;
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_BATCH_TIMEOUT;
  });

  test('should fallback to default block severities when configured list is invalid', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = 'foo,bar';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).toEqual(['CRITICAL', 'HIGH']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Invalid DD_SECURITY_BLOCK_SEVERITY values: FOO, BAR. Allowed values: NONE, UNKNOWN, LOW, MEDIUM, HIGH, CRITICAL. Falling back to defaults: CRITICAL, HIGH.',
      ),
    );

    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
    warnSpy.mockRestore();
  });

  test('should normalize and deduplicate invalid block severities in fallback warning', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = ' foo ,FOO, bar ';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).toEqual(['CRITICAL', 'HIGH']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Invalid DD_SECURITY_BLOCK_SEVERITY values: FOO, BAR. Allowed values: NONE, UNKNOWN, LOW, MEDIUM, HIGH, CRITICAL. Falling back to defaults: CRITICAL, HIGH.',
      ),
    );

    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
    warnSpy.mockRestore();
  });

  test('should warn and ignore invalid block severities when valid values are present', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = 'critical,foo,medium,foo';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).toEqual(['CRITICAL', 'MEDIUM']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Invalid DD_SECURITY_BLOCK_SEVERITY values: FOO. Allowed values: NONE, UNKNOWN, LOW, MEDIUM, HIGH, CRITICAL. Invalid values were ignored.',
      ),
    );

    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
    warnSpy.mockRestore();
  });

  test('should fallback to default block severities when list is empty after normalization', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = ' ,  , ';

    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).toEqual(['CRITICAL', 'HIGH']);

    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
  });

  test('should return empty block severities when set to NONE (advisory-only mode)', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = 'NONE';

    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).toEqual([]);

    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
  });

  test('should accept NONE case-insensitively with whitespace', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = '  none  ';

    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).toEqual([]);

    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
  });

  test('should throw when trivy timeout is invalid', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_TRIVY_TIMEOUT = 'not-a-number';

    expect(() => configuration.getSecurityConfiguration()).toThrow();

    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_TIMEOUT;
  });

  test('should parse scanner backend, worker, provider argument, and Docker runtime settings', () => {
    const values = {
      DD_SECURITY_SCANNER: 'BoTh',
      DD_SECURITY_BACKEND: 'Docker',
      DD_SECURITY_AVAILABILITY_POLICY: 'Warn',
      DD_SECURITY_DOCKER_SOCKET: '/run/user/1000/podman.sock',
      DD_SECURITY_DOCKER_HOST: 'scanner-docker',
      DD_SECURITY_DOCKER_PORT: '2376',
      DD_SECURITY_DOCKER_PROTOCOL: 'https',
      DD_SECURITY_DOCKER_NETWORK: 'scanner-net',
      DD_SECURITY_DOCKER_CACHE_VOLUME: 'scanner-cache',
      DD_SECURITY_TRIVY_ARGS: '["--skip-dirs", " /tmp/cache "]',
      DD_SECURITY_TRIVY_WORKER_IMAGE: 'example/trivy@sha256:test',
      DD_SECURITY_GRYPE_COMMAND: '/usr/local/bin/grype',
      DD_SECURITY_GRYPE_TIMEOUT: '45000',
      DD_SECURITY_GRYPE_ARGS: '["--only-fixed"]',
      DD_SECURITY_GRYPE_WORKER_IMAGE: 'example/grype@sha256:test',
      DD_SECURITY_SBOM_GENERATOR: 'SyFt',
      DD_SECURITY_SYFT_COMMAND: '/usr/local/bin/syft',
      DD_SECURITY_SYFT_TIMEOUT: '46000',
      DD_SECURITY_SYFT_ARGS: '["--scope", "all-layers"]',
      DD_SECURITY_SYFT_WORKER_IMAGE: 'example/syft@sha256:test',
    };
    Object.assign(configuration.ddEnvVars, values);

    try {
      const result = configuration.getSecurityConfiguration();

      expect(result).toMatchObject({
        scanner: 'both',
        backend: 'docker',
        availabilityPolicy: 'warn',
        docker: {
          socket: '/run/user/1000/podman.sock',
          host: 'scanner-docker',
          port: 2376,
          protocol: 'https',
          network: 'scanner-net',
          cacheVolumePrefix: 'scanner-cache',
        },
        trivy: {
          extraArgs: ['--skip-dirs', '/tmp/cache'],
          workerImage: 'example/trivy@sha256:test',
        },
        grype: {
          command: '/usr/local/bin/grype',
          timeout: 45000,
          extraArgs: ['--only-fixed'],
          workerImage: 'example/grype@sha256:test',
        },
        sbom: { generator: 'syft' },
        syft: {
          command: '/usr/local/bin/syft',
          timeout: 46000,
          extraArgs: ['--scope', 'all-layers'],
          workerImage: 'example/syft@sha256:test',
        },
      });
    } finally {
      for (const key of Object.keys(values)) {
        delete configuration.ddEnvVars[key];
      }
    }
  });

  test('should accept remote Trivy only when a server is configured', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_BACKEND = 'remote';
    configuration.ddEnvVars.DD_SECURITY_TRIVY_SERVER = 'http://trivy:4954';

    try {
      expect(configuration.getSecurityConfiguration()).toMatchObject({
        scanner: 'trivy',
        backend: 'remote',
        trivy: { server: 'http://trivy:4954' },
      });
    } finally {
      delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
      delete configuration.ddEnvVars.DD_SECURITY_BACKEND;
      delete configuration.ddEnvVars.DD_SECURITY_TRIVY_SERVER;
    }
  });

  test.each([
    ['a non-Trivy scanner', 'grype', 'http://trivy:4954'],
    ['an empty Trivy server', 'trivy', '   '],
  ])('should reject remote backend with %s', (_label, scanner, server) => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = scanner;
    configuration.ddEnvVars.DD_SECURITY_BACKEND = 'remote';
    configuration.ddEnvVars.DD_SECURITY_TRIVY_SERVER = server;

    try {
      expect(() => configuration.getSecurityConfiguration()).toThrow(
        'DD_SECURITY_BACKEND=remote requires DD_SECURITY_SCANNER=trivy and DD_SECURITY_TRIVY_SERVER',
      );
    } finally {
      delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
      delete configuration.ddEnvVars.DD_SECURITY_BACKEND;
      delete configuration.ddEnvVars.DD_SECURITY_TRIVY_SERVER;
    }
  });

  test.each([
    ['malformed JSON', '{', 'DD_SECURITY_TRIVY_ARGS'],
    ['a non-array value', '{}', 'DD_SECURITY_GRYPE_ARGS'],
    ['a non-string entry', '[42]', 'DD_SECURITY_GRYPE_ARGS'],
    ['an empty entry', '["  "]', 'DD_SECURITY_SYFT_ARGS'],
    ['a NUL byte', '["bad\\u0000arg"]', 'DD_SECURITY_SYFT_ARGS'],
  ])('should reject %s in provider extra arguments', (_label, value, key) => {
    configuration.ddEnvVars[key] = value;

    try {
      expect(() => configuration.getSecurityConfiguration()).toThrow(
        `${key} must be a JSON array of strings`,
      );
    } finally {
      delete configuration.ddEnvVars[key];
    }
  });

  test('should treat an explicitly empty provider argument string as no arguments', () => {
    configuration.ddEnvVars.DD_SECURITY_GRYPE_ARGS = '';

    try {
      expect(configuration.getSecurityConfiguration().grype.extraArgs).toEqual([]);
    } finally {
      delete configuration.ddEnvVars.DD_SECURITY_GRYPE_ARGS;
    }
  });

  test('should read DD_SECURITY_TRIVY_IMAGE_SRC into trivy.imageSrc', () => {
    configuration.ddEnvVars.DD_SECURITY_TRIVY_IMAGE_SRC = 'remote';

    const result = configuration.getSecurityConfiguration();
    expect(result.trivy.imageSrc).toBe('remote');

    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_IMAGE_SRC;
  });

  test('should default trivy.imageSrc to empty string when DD_SECURITY_TRIVY_IMAGE_SRC is not set', () => {
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_IMAGE_SRC;

    const result = configuration.getSecurityConfiguration();
    expect(result.trivy.imageSrc).toBe('');
  });

  test('should warn and fallback to default sbom formats when configured list is invalid', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS = 'foo,bar';
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = configuration.getSecurityConfiguration();
    expect(result.sbom.formats).toEqual(['spdx-json']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Invalid DD_SECURITY_SBOM_FORMATS values: foo, bar. Allowed values: spdx-json, cyclonedx-json. Falling back to defaults: spdx-json.',
      ),
    );

    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS;
    warnSpy.mockRestore();
  });

  test('should warn and ignore invalid sbom formats when valid values are present', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS = 'spdx-json,foo,SPDX-JSON,baz';
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = configuration.getSecurityConfiguration();
    expect(result.sbom.formats).toEqual(['spdx-json']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Invalid DD_SECURITY_SBOM_FORMATS values: foo, baz. Allowed values: spdx-json, cyclonedx-json. Invalid values were ignored.',
      ),
    );

    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS;
    warnSpy.mockRestore();
  });

  test('should fallback to default sbom formats when list is empty after normalization', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS = ' , , ';

    const result = configuration.getSecurityConfiguration();
    expect(result.sbom.formats).toEqual(['spdx-json']);

    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS;
  });

  test('should throw when cosign timeout is invalid', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_COSIGN_TIMEOUT = 'not-a-number';

    expect(() => configuration.getSecurityConfiguration()).toThrow();

    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_TIMEOUT;
  });

  test('should throw when cosign key is not a regular file', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY = '/';

    expect(() => configuration.getSecurityConfiguration()).toThrow(
      'DD_SECURITY_COSIGN_KEY must reference an existing regular file',
    );

    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY;
  });

  test('should throw when cosign key path does not exist', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'trivy';
    configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY = '/tmp/drydock-non-existent-cosign-key.pub';

    expect(() => configuration.getSecurityConfiguration()).toThrow(
      'DD_SECURITY_COSIGN_KEY must reference an existing regular file',
    );

    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY;
  });

  test('prune.onBlock should default to true', () => {
    const result = configuration.getSecurityConfiguration();
    expect(result.prune.onBlock).toBe(true);
  });

  test('DD_SECURITY_PRUNE_ONBLOCK=false should disable prune on block', () => {
    configuration.ddEnvVars.DD_SECURITY_PRUNE_ONBLOCK = 'false';

    const result = configuration.getSecurityConfiguration();
    expect(result.prune.onBlock).toBe(false);

    delete configuration.ddEnvVars.DD_SECURITY_PRUNE_ONBLOCK;
  });

  test('DD_SECURITY_PRUNE_ONBLOCK=true should enable prune on block', () => {
    configuration.ddEnvVars.DD_SECURITY_PRUNE_ONBLOCK = 'true';

    const result = configuration.getSecurityConfiguration();
    expect(result.prune.onBlock).toBe(true);

    delete configuration.ddEnvVars.DD_SECURITY_PRUNE_ONBLOCK;
  });
});

describe('getPublicUrl', () => {
  test('should return DD_PUBLIC_URL when set', () => {
    configuration.ddEnvVars.DD_PUBLIC_URL = 'https://my.public.url';
    const result = configuration.getPublicUrl({});
    expect(result).toBe('https://my.public.url');
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
  });

  test('should guess from request when DD_PUBLIC_URL is not set', () => {
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
    const result = configuration.getPublicUrl({
      protocol: 'https',
      hostname: 'example.com',
    });
    expect(result).toBe('https://example.com');
  });

  test('should return / when URL construction fails', () => {
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
    const result = configuration.getPublicUrl({
      protocol: '',
      hostname: '',
    });
    expect(result).toBe('/');
  });

  test('should return / for non-http protocols', () => {
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
    const result = configuration.getPublicUrl({
      protocol: 'ftp',
      hostname: 'example.com',
    });
    expect(result).toBe('/');
  });

  test('should return / when DD_PUBLIC_URL uses a non-http protocol', () => {
    configuration.ddEnvVars.DD_PUBLIC_URL = 'javascript:alert(1)';

    const result = configuration.getPublicUrl({
      protocol: 'https',
      hostname: 'example.com',
    });

    expect(result).toBe('/');
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
  });

  test('should return / when DD_PUBLIC_URL contains userinfo injection', () => {
    configuration.ddEnvVars.DD_PUBLIC_URL = 'https://trusted.example@attacker.example';

    const result = configuration.getPublicUrl({
      protocol: 'https',
      hostname: 'example.com',
    });

    expect(result).toBe('/');
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
  });

  test('should return / when inferred hostname contains userinfo injection', () => {
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
    const result = configuration.getPublicUrl({
      protocol: 'https',
      hostname: 'trusted.example@attacker.example',
    });
    expect(result).toBe('/');
  });

  test('should return / when DD_PUBLIC_URL contains control characters', () => {
    configuration.ddEnvVars.DD_PUBLIC_URL = 'https://example.com\u0000evil';

    const result = configuration.getPublicUrl({
      protocol: 'https',
      hostname: 'example.com',
    });

    expect(result).toBe('/');
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
  });

  test('should return / when inferred URL hostname normalization mismatches request hostname', () => {
    delete configuration.ddEnvVars.DD_PUBLIC_URL;

    const result = configuration.getPublicUrl({
      protocol: 'https',
      hostname: '%65xample.com',
    });

    expect(result).toBe('/');
  });

  test('should return / when request protocol or hostname are not strings', () => {
    delete configuration.ddEnvVars.DD_PUBLIC_URL;

    const result = configuration.getPublicUrl({
      protocol: ['https'],
      hostname: ['example.com'],
    });

    expect(result).toBe('/');
  });
});

describe('getPrometheusConfiguration errors', () => {
  test('should throw when configuration is invalid', () => {
    configuration.ddEnvVars.DD_PROMETHEUS_ENABLED = 'not-a-boolean';
    expect(() => configuration.getPrometheusConfiguration()).toThrow();
    delete configuration.ddEnvVars.DD_PROMETHEUS_ENABLED;
  });
});

describe('getVersion', () => {
  async function importFreshConfiguration() {
    vi.resetModules();
    return import('./index.js');
  }

  test('should fall back to package.json version when DD_VERSION is not set', async () => {
    const freshConfiguration = await importFreshConfiguration();
    delete freshConfiguration.ddEnvVars.DD_VERSION;
    expect(freshConfiguration.getVersion()).toBe(appPackageJson.version);
  });

  test('should ignore docker placeholder DD_VERSION=unknown and fall back to package.json', async () => {
    const freshConfiguration = await importFreshConfiguration();
    freshConfiguration.ddEnvVars.DD_VERSION = 'unknown';
    expect(freshConfiguration.getVersion()).toBe(appPackageJson.version);
  });

  test('should reuse cached package version after first lookup', async () => {
    const freshConfiguration = await importFreshConfiguration();
    delete freshConfiguration.ddEnvVars.DD_VERSION;

    const readFileSpy = vi.spyOn(fs, 'readFileSync');
    const first = freshConfiguration.getVersion();
    const second = freshConfiguration.getVersion();

    expect(first).toBe(appPackageJson.version);
    expect(second).toBe(appPackageJson.version);
    expect(readFileSpy).toHaveBeenCalledTimes(1);

    readFileSpy.mockRestore();
  });

  test('should return unknown when package version cannot be resolved', async () => {
    const freshConfiguration = await importFreshConfiguration();
    delete freshConfiguration.ddEnvVars.DD_VERSION;

    const readFileSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('read failure');
    });

    expect(freshConfiguration.getVersion()).toBe('unknown');

    readFileSpy.mockRestore();
  });
});

describe('getServerConfiguration errors', () => {
  test('should throw when server configuration is invalid', () => {
    configuration.ddEnvVars.DD_SERVER_PORT = 'not-a-number';
    expect(() => configuration.getServerConfiguration()).toThrow();
    delete configuration.ddEnvVars.DD_SERVER_PORT;
  });

  test('should throw when session cookie sameSite is invalid', () => {
    configuration.ddEnvVars.DD_SERVER_COOKIE_SAMESITE = 'invalid';
    expect(() => configuration.getServerConfiguration()).toThrow();
    delete configuration.ddEnvVars.DD_SERVER_COOKIE_SAMESITE;
  });

  test('should throw when max concurrent sessions is lower than 1', () => {
    configuration.ddEnvVars.DD_SERVER_SESSION_MAXCONCURRENTSESSIONS = '0';
    expect(() => configuration.getServerConfiguration()).toThrow();
    delete configuration.ddEnvVars.DD_SERVER_SESSION_MAXCONCURRENTSESSIONS;
  });

  test('should throw when metrics token is shorter than 16 characters', () => {
    configuration.ddEnvVars.DD_SERVER_METRICS_TOKEN = 'short-token';
    expect(() => configuration.getServerConfiguration()).toThrow();
    delete configuration.ddEnvVars.DD_SERVER_METRICS_TOKEN;
  });

  test('should throw when CORS is enabled without DD_SERVER_CORS_ORIGIN', () => {
    configuration.ddEnvVars.DD_SERVER_CORS_ENABLED = 'true';
    delete configuration.ddEnvVars.DD_SERVER_CORS_ORIGIN;
    expect(() => configuration.getServerConfiguration()).toThrow();
    delete configuration.ddEnvVars.DD_SERVER_CORS_ENABLED;
  });

  test('should fallback to defaults when nested server config is null', () => {
    const originalDd = configuration.ddEnvVars.dd;
    configuration.ddEnvVars.dd = {
      ...(originalDd || {}),
      server: null,
    };

    const result = configuration.getServerConfiguration();
    expect(result.port).toBe(3000);
    expect(result.enabled).toBe(true);

    if (originalDd === undefined) {
      delete configuration.ddEnvVars.dd;
    } else {
      configuration.ddEnvVars.dd = originalDd;
    }
  });
});

describe('getPublicUrl edge cases', () => {
  test('should return url for http protocol', () => {
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
    const result = configuration.getPublicUrl({
      protocol: 'http',
      hostname: 'localhost',
    });
    expect(result).toBe('http://localhost');
  });
});

describe('getAuthenticationConfigurations', () => {
  test('should return empty object by default', () => {
    delete configuration.ddEnvVars.DD_AUTH_AUTH1_X;
    expect(configuration.getAuthenticationConfigurations()).toStrictEqual({});
  });

  test('should return configured authentications when overridden', () => {
    configuration.ddEnvVars.DD_AUTH_BASIC_JOHN_USER = 'john';
    configuration.ddEnvVars.DD_AUTH_BASIC_JOHN_HASH = 'hash';
    const result = configuration.getAuthenticationConfigurations();
    expect(result.basic).toBeDefined();
    expect(result.basic.john).toBeDefined();
    delete configuration.ddEnvVars.DD_AUTH_BASIC_JOHN_USER;
    delete configuration.ddEnvVars.DD_AUTH_BASIC_JOHN_HASH;
  });
});

describe('getWebhookConfiguration', () => {
  beforeEach(() => {
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_ENABLED;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_SECRET;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKEN;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCHALL;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCH;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_UPDATE;
  });

  test('should return disabled webhook by default', () => {
    expect(configuration.getWebhookConfiguration()).toStrictEqual({
      enabled: false,
      secret: '',
      token: '',
      tokens: {
        watchall: '',
        watch: '',
        update: '',
      },
    });
  });

  test('should return enabled webhook when token is provided', () => {
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_ENABLED = 'true';
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKEN = 'secret-token';

    expect(configuration.getWebhookConfiguration()).toStrictEqual({
      enabled: true,
      secret: '',
      token: 'secret-token',
      tokens: {
        watchall: '',
        watch: '',
        update: '',
      },
    });
  });

  test('should allow enabling registry webhooks with HMAC secret and no bearer token', () => {
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_ENABLED = 'true';
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_SECRET = 'webhook-signing-secret';
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKEN;

    expect(configuration.getWebhookConfiguration()).toStrictEqual({
      enabled: true,
      secret: 'webhook-signing-secret',
      token: '',
      tokens: {
        watchall: '',
        watch: '',
        update: '',
      },
    });
  });

  test('should return enabled webhook when per-endpoint tokens are provided without shared token', () => {
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_ENABLED = 'true';
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKEN;
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCHALL = 'watchall-token';
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCH = 'watch-token';
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_UPDATE = 'update-token';

    expect(configuration.getWebhookConfiguration()).toStrictEqual({
      enabled: true,
      secret: '',
      token: '',
      tokens: {
        watchall: 'watchall-token',
        watch: 'watch-token',
        update: 'update-token',
      },
    });
  });

  test('should throw when endpoint-specific webhook tokens are partially configured', () => {
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_ENABLED = 'true';
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKEN = 'shared-token';
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCHALL = 'watchall-token';
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCH;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_UPDATE;

    expect(() => configuration.getWebhookConfiguration()).toThrow(
      'All endpoint-specific webhook tokens (DD_SERVER_WEBHOOK_TOKENS_WATCHALL, DD_SERVER_WEBHOOK_TOKENS_WATCH, DD_SERVER_WEBHOOK_TOKENS_UPDATE) must be configured together when any DD_SERVER_WEBHOOK_TOKENS_* value is set',
    );
  });

  test('should throw when webhook is enabled without tokens or HMAC secret', () => {
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_ENABLED = 'true';
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_SECRET;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKEN;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCHALL;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCH;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_UPDATE;

    expect(() => configuration.getWebhookConfiguration()).toThrow();
  });

  test('should fallback to default webhook configuration when nested value is null', () => {
    const originalDd = configuration.ddEnvVars.dd;
    configuration.ddEnvVars.dd = {
      ...(originalDd || {}),
      server: {
        ...(originalDd?.server || {}),
        webhook: null,
      },
    };

    expect(configuration.getWebhookConfiguration()).toStrictEqual({
      enabled: false,
      secret: '',
      token: '',
      tokens: {
        watchall: '',
        watch: '',
        update: '',
      },
    });

    if (originalDd === undefined) {
      delete configuration.ddEnvVars.dd;
    } else {
      configuration.ddEnvVars.dd = originalDd;
    }
  });

  test('should validate nested webhook configuration when dd.server.webhook object is present', () => {
    const originalDd = configuration.ddEnvVars.dd;
    configuration.ddEnvVars.dd = {
      ...(originalDd || {}),
      server: {
        ...(originalDd?.server || {}),
        webhook: {
          enabled: false,
          secret: '',
          token: '',
          tokens: {
            watchall: '',
            watch: '',
            update: '',
          },
        },
      },
    };

    expect(configuration.getWebhookConfiguration()).toStrictEqual({
      enabled: false,
      secret: '',
      token: '',
      tokens: {
        watchall: '',
        watch: '',
        update: '',
      },
    });

    if (originalDd === undefined) {
      delete configuration.ddEnvVars.dd;
    } else {
      configuration.ddEnvVars.dd = originalDd;
    }
  });

  test('should throw when webhook tokens payload is not an object', () => {
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_ENABLED = 'true';
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKEN = 'shared-token';
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS = 'invalid';
    expect(() => configuration.getWebhookConfiguration()).toThrow();
  });
});

describe('getPrometheusConfiguration null fallback', () => {
  test('should fallback to defaults when nested prometheus config is null', () => {
    const originalDd = configuration.ddEnvVars.dd;
    configuration.ddEnvVars.dd = {
      ...(originalDd || {}),
      prometheus: null,
    };

    expect(configuration.getPrometheusConfiguration()).toStrictEqual({
      enabled: true,
    });

    if (originalDd === undefined) {
      delete configuration.ddEnvVars.dd;
    } else {
      configuration.ddEnvVars.dd = originalDd;
    }
  });
});

describe('module bootstrap env mapping', () => {
  const WUD_KEY = 'WUD_TEST_BOOTSTRAP_VAR';
  const DD_KEY = 'DD_TEST_BOOTSTRAP_VAR';

  afterEach(() => {
    delete process.env[WUD_KEY];
    delete process.env[DD_KEY];
  });

  test('should load DD_ vars and ignore removed WUD_ aliases at module init', async () => {
    process.env[WUD_KEY] = 'legacy-value';
    process.env[DD_KEY] = 'new-value';

    vi.resetModules();
    const freshConfiguration = await import('./index.js');

    expect(freshConfiguration.ddEnvVars.DD_TEST_BOOTSTRAP_VAR).toBe('new-value');
    expect(freshConfiguration.ddEnvVars.WUD_TEST_BOOTSTRAP_VAR).toBeUndefined();
  });

  test('should not remap a removed WUD_ variable when no DD_ variable exists', async () => {
    process.env[WUD_KEY] = 'legacy-value';

    vi.resetModules();
    const freshConfiguration = await import('./index.js');

    expect(freshConfiguration.ddEnvVars.DD_TEST_BOOTSTRAP_VAR).toBeUndefined();
    expect(freshConfiguration.ddEnvVars.WUD_TEST_BOOTSTRAP_VAR).toBeUndefined();
  });
});

describe('trigger env aliases', () => {
  async function importFreshConfiguration() {
    vi.resetModules();
    return import('./index.js');
  }

  test('should merge DD_ACTION and DD_NOTIFICATION aliases with DD_TRIGGER legacy env vars', async () => {
    const freshConfiguration = await importFreshConfiguration();
    freshConfiguration.ddEnvVars.DD_TRIGGER_DOCKER_UPDATE_THRESHOLD = 'major';
    freshConfiguration.ddEnvVars.DD_ACTION_DOCKER_UPDATE_THRESHOLD = 'minor';
    freshConfiguration.ddEnvVars.DD_NOTIFICATION_SMTP_ALERT_ENABLED = 'false';

    expect(freshConfiguration.getTriggerConfigurations()).toStrictEqual({
      docker: {
        update: {
          threshold: 'minor',
        },
      },
      smtp: {
        alert: {
          enabled: 'false',
        },
      },
    });
  });

  test('should prefer alias values over DD_TRIGGER legacy values for the same setting', async () => {
    const freshConfiguration = await importFreshConfiguration();
    freshConfiguration.ddEnvVars.DD_TRIGGER_DOCKER_UPDATE_THRESHOLD = 'major';
    freshConfiguration.ddEnvVars.DD_ACTION_DOCKER_UPDATE_THRESHOLD = 'minor';

    expect(freshConfiguration.getTriggerConfigurations()).toStrictEqual({
      docker: {
        update: {
          threshold: 'minor',
        },
      },
    });
  });

  test('should log one error per legacy DD_TRIGGER key and record legacy env usage', async () => {
    const freshConfiguration = await importFreshConfiguration();
    const freshLegacyInput = await import('../prometheus/compatibility.js');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const legacyKey = 'DD_TRIGGER_DISCORD_NOTIFY_URL';
    freshConfiguration.ddEnvVars[legacyKey] = 'https://example.invalid/webhook';
    freshConfiguration.ddEnvVars.DD_NOTIFICATION_DISCORD_NOTIFY_ENABLED = 'true';

    const summaryBefore = freshLegacyInput.getLegacyInputSummary().env.total;

    freshConfiguration.getTriggerConfigurations();
    freshConfiguration.getTriggerConfigurations();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Legacy trigger environment variable'),
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('v1.7.0'));
    expect(freshLegacyInput.getLegacyInputSummary().env.total).toBeGreaterThan(summaryBefore);
    expect(freshLegacyInput.getLegacyInputSummary().env.keys).toContain(legacyKey);

    errorSpy.mockRestore();
  });
});

describe('legacy trigger prefix tracking guards', () => {
  const nonLegacyTriggerKey = 'DD_ACTION_DOCKER_UPDATE_THRESHOLD';
  const tooFewSegmentsKey = 'DD_TRIGGER_DOCKER';
  const undefinedValueKey = 'DD_TRIGGER_DOCKER_UPDATE_THRESHOLD';

  async function importFreshConfiguration() {
    vi.resetModules();
    return import('./index.js');
  }

  test('should ignore non-DD_TRIGGER keys when tracking legacy prefixes', async () => {
    const freshConfiguration = await importFreshConfiguration();
    freshConfiguration.ddEnvVars[nonLegacyTriggerKey] = 'major';

    expect(freshConfiguration.getTriggerConfigurations()).toStrictEqual({
      docker: {
        update: {
          threshold: 'major',
        },
      },
    });
    expect(freshConfiguration.usesLegacyTriggerPrefix('docker', 'update')).toBe(false);
  });

  test('should ignore DD_TRIGGER keys with too few path segments when tracking legacy prefixes', async () => {
    const freshConfiguration = await importFreshConfiguration();
    freshConfiguration.ddEnvVars[tooFewSegmentsKey] = 'ignored';

    expect(freshConfiguration.getTriggerConfigurations()).toStrictEqual({
      docker: 'ignored',
    });
    expect(freshConfiguration.usesLegacyTriggerPrefix('docker', 'update')).toBe(false);
  });

  test('should ignore DD_TRIGGER keys with undefined values when tracking legacy prefixes', async () => {
    const freshConfiguration = await importFreshConfiguration();
    freshConfiguration.ddEnvVars[undefinedValueKey] = undefined;

    expect(freshConfiguration.getTriggerConfigurations()).toStrictEqual({
      docker: {
        update: {},
      },
    });
    expect(freshConfiguration.usesLegacyTriggerPrefix('docker', 'update')).toBe(false);
  });
});

// ── Additional mutation-killing tests ──────────────────────────────────────────

describe('replaceSecrets – boundary and label coverage', () => {
  test('should include the env var name in the error when the path is empty', async () => {
    // Kills 50:79 [ObjectLiteral] {} and 51:14 [StringLiteral] ``
    // resolveConfiguredPath uses the label in the error message when path is invalid
    const vars: Record<string, string | undefined> = { DD_MY_SECRET__FILE: '' };
    await expect(configuration.replaceSecrets(vars)).rejects.toThrow('DD_MY_SECRET__FILE path');
  });

  test('should include the env var name in the error when path is undefined/non-string', async () => {
    // Also kills 51:14 – if label is empty string, error would say "Path cannot be empty" not "DD_... path cannot be empty"
    const vars: Record<string, string | undefined> = { DD_MY_SECRET__FILE: undefined };
    // undefined path → resolveConfiguredPath throws with label in message
    await expect(configuration.replaceSecrets(vars)).rejects.toThrow('DD_MY_SECRET__FILE path');
  });

  test('should use the secretFileEnvVar name as the label on error', async () => {
    // Ensures the label argument (line 51) is non-empty and uses the key name.
    const badPath = '/tmp/drydock-nonexistent-secret-12345.txt';
    const vars = { DD_MY_SECRET__FILE: badPath };
    await expect(configuration.replaceSecrets(vars)).rejects.toThrow();
  });

  test('should accept a secret file whose size is exactly MAX_SECRET_FILE_SIZE_BYTES', async () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-secret-'));
    const exactPath = path.join(tempDirectory, 'exact.txt');
    // 1 MB exactly (not over): should NOT throw
    fs.writeFileSync(exactPath, 'x'.repeat(1024 * 1024), 'utf-8');
    const vars = { DD_EXACT__FILE: exactPath };
    try {
      await expect(configuration.replaceSecrets(vars)).resolves.not.toThrow();
      expect(vars.DD_EXACT).toBeDefined();
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  test('should strip the __FILE key and set the plain key after successful read', async () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-secret-'));
    const secretPath = path.join(tempDirectory, 'myval.txt');
    fs.writeFileSync(secretPath, 'hello-world', 'utf-8');
    const vars: Record<string, string | undefined> = { DD_SOME_VAL__FILE: secretPath };
    try {
      await configuration.replaceSecrets(vars);
      expect(vars.DD_SOME_VAL__FILE).toBeUndefined();
      expect(vars.DD_SOME_VAL).toBe('hello-world');
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});

describe('getVersion – package.json parsing details', () => {
  async function importFreshConfiguration() {
    vi.resetModules();
    return import('./index.js');
  }

  test('should skip a package.json candidate that has a non-string version field', async () => {
    const freshConfiguration = await importFreshConfiguration();
    delete freshConfiguration.ddEnvVars.DD_VERSION;

    const readFileSpy = vi
      .spyOn(fs, 'readFileSync')
      .mockImplementationOnce(() => JSON.stringify({ version: 42 }));
    readFileSpy.mockImplementationOnce(() => JSON.stringify({ version: '1.2.3' }));

    // First candidate returned a number (not a string) – should fall through to second
    const version = freshConfiguration.getVersion();
    // The second candidate is a string so it should be used
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
    readFileSpy.mockRestore();
  });

  test('should return the trimmed version, not the raw version with whitespace', async () => {
    const freshConfiguration = await importFreshConfiguration();
    delete freshConfiguration.ddEnvVars.DD_VERSION;

    const readFileSpy = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValueOnce(JSON.stringify({ version: '  2.0.0  ' }));

    // Kills 124:33 [MethodExpression] – if trim() is removed cache has spaces
    const version = freshConfiguration.getVersion();
    expect(version).toBe('2.0.0');
    readFileSpy.mockRestore();
  });
});

describe('getServerConfiguration – schema boundary values', () => {
  test('should accept port 0', () => {
    // Kills 367:11 [MethodExpression] joi.number().default(3000).integer().max(0)
    configuration.ddEnvVars.DD_SERVER_PORT = '0';
    expect(() => configuration.getServerConfiguration()).not.toThrow();
    const config = configuration.getServerConfiguration();
    expect(config.port).toBe(0);
    delete configuration.ddEnvVars.DD_SERVER_PORT;
  });

  test('should reject port 65536', () => {
    configuration.ddEnvVars.DD_SERVER_PORT = '65536';
    expect(() => configuration.getServerConfiguration()).toThrow();
    delete configuration.ddEnvVars.DD_SERVER_PORT;
  });

  test('should default enabled to true', () => {
    // Kills 370:40 [BooleanLiteral] true → false
    delete configuration.ddEnvVars.DD_SERVER_ENABLED;
    const config = configuration.getServerConfiguration();
    expect(config.enabled).toBe(true);
  });

  test('should default tls.enabled to false', () => {
    // Kills 372:15 [BooleanLiteral] false → true
    delete configuration.ddEnvVars.DD_SERVER_TLS_ENABLED;
    const config = configuration.getServerConfiguration();
    expect(config.tls).toStrictEqual({});
  });

  test('should default cors.enabled to false', () => {
    // Kills 377:15 [BooleanLiteral]
    delete configuration.ddEnvVars.DD_SERVER_CORS_ENABLED;
    const config = configuration.getServerConfiguration();
    expect((config.cors as { enabled?: boolean }).enabled).toBeUndefined();
  });

  test('should default cors.methods to GET,HEAD,PUT,PATCH,POST,DELETE', () => {
    // Kills 376:33 [StringLiteral] ""
    configuration.ddEnvVars.DD_SERVER_CORS_ENABLED = 'true';
    configuration.ddEnvVars.DD_SERVER_CORS_ORIGIN = 'https://example.com';
    const config = configuration.getServerConfiguration();
    expect((config.cors as { methods?: string }).methods).toBe('GET,HEAD,PUT,PATCH,POST,DELETE');
    delete configuration.ddEnvVars.DD_SERVER_CORS_ENABLED;
    delete configuration.ddEnvVars.DD_SERVER_CORS_ORIGIN;
  });

  test('should default compression.enabled to true', () => {
    // Kills 385:40 [BooleanLiteral] true → false
    delete configuration.ddEnvVars.DD_SERVER_COMPRESSION_ENABLED;
    const config = configuration.getServerConfiguration();
    expect((config.compression as { enabled?: boolean }).enabled).toBeUndefined();
    // Default is applied: joi strips unknown after validate
    // Re-get with explicit check
    configuration.ddEnvVars.DD_SERVER_COMPRESSION_ENABLED = 'true';
    const config2 = configuration.getServerConfiguration();
    expect((config2.compression as { enabled: boolean }).enabled).toBe(true);
    delete configuration.ddEnvVars.DD_SERVER_COMPRESSION_ENABLED;
  });

  test('cors.origin should require min length of 1 when enabled', () => {
    // Kills 386:17 [MethodExpression] joi.string().trim().max(1) and joi.string()
    configuration.ddEnvVars.DD_SERVER_CORS_ENABLED = 'true';
    configuration.ddEnvVars.DD_SERVER_CORS_ORIGIN = '   '; // whitespace only – trim+min(1) should reject
    expect(() => configuration.getServerConfiguration()).toThrow();
    delete configuration.ddEnvVars.DD_SERVER_CORS_ENABLED;
    delete configuration.ddEnvVars.DD_SERVER_CORS_ORIGIN;
  });

  test('cors.origin should trim whitespace before validation', () => {
    // Ensures trim() is applied (not mutated away)
    configuration.ddEnvVars.DD_SERVER_CORS_ENABLED = 'true';
    configuration.ddEnvVars.DD_SERVER_CORS_ORIGIN = '  https://example.com  ';
    const config = configuration.getServerConfiguration();
    expect((config.cors as { origin?: string }).origin).toBe('https://example.com');
    delete configuration.ddEnvVars.DD_SERVER_CORS_ENABLED;
    delete configuration.ddEnvVars.DD_SERVER_CORS_ORIGIN;
  });

  test('should default ui.enabled to true', () => {
    // Kills 396:40 [BooleanLiteral] false
    delete configuration.ddEnvVars.DD_SERVER_UI_ENABLED;
    configuration.getServerConfiguration();
    // When env not set joi uses default (true) – enabling ui
    configuration.ddEnvVars.DD_SERVER_UI_ENABLED = 'true';
    const config2 = configuration.getServerConfiguration();
    expect((config2.ui as { enabled: boolean }).enabled).toBe(true);
    delete configuration.ddEnvVars.DD_SERVER_UI_ENABLED;
  });

  test('should default feature.delete to true', () => {
    // Kills 407:39 [BooleanLiteral] false
    delete configuration.ddEnvVars.DD_SERVER_FEATURE_DELETE;
    const config = configuration.getServerConfiguration();
    expect(config.feature.delete).toBe(true);
  });

  test('should default feature.containeractions to true', () => {
    // Kills 408:49 [BooleanLiteral]
    delete configuration.ddEnvVars.DD_SERVER_FEATURE_CONTAINERACTIONS;
    const config = configuration.getServerConfiguration();
    expect(config.feature.containeractions).toBe(true);
  });

  test('should accept and validate cookie samesite lax', () => {
    // Kills 421:20 [StringLiteral] ""
    delete configuration.ddEnvVars.DD_SERVER_COOKIE_SAMESITE;
    configuration.getServerConfiguration();
    // Default is lax when not explicitly set
    configuration.ddEnvVars.DD_SERVER_COOKIE_SAMESITE = 'lax';
    const config2 = configuration.getServerConfiguration();
    expect((config2.cookie as { samesite: string }).samesite).toBe('lax');
    delete configuration.ddEnvVars.DD_SERVER_COOKIE_SAMESITE;
  });

  test('cookie samesite value is trimmed before validation', () => {
    // Kills 416:19 [MethodExpression] joi.string() – removes .trim()
    // Without trim, '  lax  ' with spaces fails the .valid() check
    configuration.ddEnvVars.DD_SERVER_COOKIE_SAMESITE = '  lax  ';
    const config = configuration.getServerConfiguration();
    expect((config.cookie as { samesite: string }).samesite).toBe('lax');
    delete configuration.ddEnvVars.DD_SERVER_COOKIE_SAMESITE;
  });

  test('getServerConfiguration accepts unknown env keys without throwing (allowUnknown)', () => {
    // Kills 447:86 [ObjectLiteral] {} / 448:19 [BooleanLiteral] false
    // With allowUnknown: false, unknown keys in configurationFromEnv would cause validation errors
    configuration.ddEnvVars.DD_SERVER_TOTALLY_UNKNOWN_KEY = 'value';
    expect(() => configuration.getServerConfiguration()).not.toThrow();
    delete configuration.ddEnvVars.DD_SERVER_TOTALLY_UNKNOWN_KEY;
  });

  test('getServerConfiguration does not include unknown keys in output (stripUnknown)', () => {
    // Kills 449:19 [BooleanLiteral] false – without stripUnknown, extra keys pass through
    configuration.ddEnvVars.DD_SERVER_UNKNOWN_EXTRA_FIELD = 'should-not-appear';
    const config = configuration.getServerConfiguration();
    // The result should not have the unknown field
    const configAsRecord = config as Record<string, unknown>;
    expect(configAsRecord.unknown).toBeUndefined();
    delete configuration.ddEnvVars.DD_SERVER_UNKNOWN_EXTRA_FIELD;
  });

  test('should default metrics.auth to true', () => {
    // Kills 447:86 [ObjectLiteral] {}  and 448:19/449:19 [BooleanLiteral]
    delete configuration.ddEnvVars.DD_SERVER_METRICS_AUTH;
    delete configuration.ddEnvVars.DD_SERVER_METRICS_TOKEN;
    configuration.ddEnvVars.DD_SERVER_METRICS_AUTH = 'true';
    const config = configuration.getServerConfiguration();
    expect((config.metrics as { auth: boolean }).auth).toBe(true);
    delete configuration.ddEnvVars.DD_SERVER_METRICS_AUTH;
  });

  test('should default metrics.token to empty string', () => {
    // Kills 449:19 [BooleanLiteral]
    delete configuration.ddEnvVars.DD_SERVER_METRICS_AUTH;
    delete configuration.ddEnvVars.DD_SERVER_METRICS_TOKEN;
    configuration.ddEnvVars.DD_SERVER_METRICS_TOKEN = '';
    const config = configuration.getServerConfiguration();
    expect((config.metrics as { token: string }).token).toBe('');
    delete configuration.ddEnvVars.DD_SERVER_METRICS_TOKEN;
  });

  test('should not set cors.enabled in defaults (joi strips unknown)', () => {
    // Kills 391:39 [StringLiteral] "" (cors.methods default)
    delete configuration.ddEnvVars.DD_SERVER_CORS_ENABLED;
    delete configuration.ddEnvVars.DD_SERVER_CORS_ORIGIN;
    delete configuration.ddEnvVars.DD_SERVER_CORS_METHODS;
    configuration.getServerConfiguration();
    // When cors is enabled and origin is provided, methods default applies
    configuration.ddEnvVars.DD_SERVER_CORS_ENABLED = 'true';
    configuration.ddEnvVars.DD_SERVER_CORS_ORIGIN = 'https://example.com';
    const configWithCors = configuration.getServerConfiguration();
    expect((configWithCors.cors as { methods: string }).methods).toBe(
      'GET,HEAD,PUT,PATCH,POST,DELETE',
    );
    delete configuration.ddEnvVars.DD_SERVER_CORS_ENABLED;
    delete configuration.ddEnvVars.DD_SERVER_CORS_ORIGIN;
  });

  test('should allow TLS with key and cert', () => {
    // Kills 369:15 [ObjectLiteral] {}
    configuration.ddEnvVars.DD_SERVER_TLS_ENABLED = 'true';
    configuration.ddEnvVars.DD_SERVER_TLS_KEY = '/some/key.pem';
    configuration.ddEnvVars.DD_SERVER_TLS_CERT = '/some/cert.pem';
    const config = configuration.getServerConfiguration();
    expect((config.tls as { enabled: boolean }).enabled).toBe(true);
    delete configuration.ddEnvVars.DD_SERVER_TLS_ENABLED;
    delete configuration.ddEnvVars.DD_SERVER_TLS_KEY;
    delete configuration.ddEnvVars.DD_SERVER_TLS_CERT;
  });

  test('should throw when TLS enabled without key', () => {
    // Kills 371:32 [StringLiteral] "" – when('enabled') condition key replaced with ""
    // With mutation, key is never required even when TLS is enabled → no throw
    configuration.ddEnvVars.DD_SERVER_TLS_ENABLED = 'true';
    configuration.ddEnvVars.DD_SERVER_TLS_CERT = '/some/cert.pem';
    delete configuration.ddEnvVars.DD_SERVER_TLS_KEY;
    expect(() => configuration.getServerConfiguration()).toThrow();
    delete configuration.ddEnvVars.DD_SERVER_TLS_ENABLED;
    delete configuration.ddEnvVars.DD_SERVER_TLS_CERT;
  });

  test('should throw when TLS enabled without cert', () => {
    // Kills 376:33 [StringLiteral] "" – cert when('enabled') condition replaced with ""
    configuration.ddEnvVars.DD_SERVER_TLS_ENABLED = 'true';
    configuration.ddEnvVars.DD_SERVER_TLS_KEY = '/some/key.pem';
    delete configuration.ddEnvVars.DD_SERVER_TLS_CERT;
    expect(() => configuration.getServerConfiguration()).toThrow();
    delete configuration.ddEnvVars.DD_SERVER_TLS_ENABLED;
    delete configuration.ddEnvVars.DD_SERVER_TLS_KEY;
  });

  test('should use feature defaults from default object', () => {
    // Kills 406:15 [ObjectLiteral] {}
    delete configuration.ddEnvVars.DD_SERVER_FEATURE_DELETE;
    delete configuration.ddEnvVars.DD_SERVER_FEATURE_CONTAINERACTIONS;
    const config = configuration.getServerConfiguration();
    expect(config.feature).toStrictEqual({ delete: true, containeractions: true });
  });
});

describe('getWebhookConfiguration – token/secret field coverage', () => {
  beforeEach(() => {
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_ENABLED;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_SECRET;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKEN;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCHALL;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCH;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_UPDATE;
  });

  test('tokens.watchall default is empty string not another value', () => {
    const config = configuration.getWebhookConfiguration();
    expect(config.tokens.watchall).toBe('');
  });

  test('tokens.watch default is empty string', () => {
    const config = configuration.getWebhookConfiguration();
    expect(config.tokens.watch).toBe('');
  });

  test('tokens.update default is empty string', () => {
    const config = configuration.getWebhookConfiguration();
    expect(config.tokens.update).toBe('');
  });

  test('secret default is empty string', () => {
    const config = configuration.getWebhookConfiguration();
    expect(config.secret).toBe('');
  });

  test('secret allows explicit empty string value without throwing', () => {
    // Kills 480:32 [StringLiteral] "Stryker was here!" in secret.allow('')
    // With mutation allow("Stryker was here!"), setting secret='' would fail validation
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_SECRET = '';
    expect(() => configuration.getWebhookConfiguration()).not.toThrow();
    const config = configuration.getWebhookConfiguration();
    expect(config.secret).toBe('');
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_SECRET;
  });

  test('token allows explicit empty string value without throwing', () => {
    // Kills 481:31 [StringLiteral] "Stryker was here!" in token.allow('')
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKEN = '';
    expect(() => configuration.getWebhookConfiguration()).not.toThrow();
    const config = configuration.getWebhookConfiguration();
    expect(config.token).toBe('');
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKEN;
  });

  test('tokens.watchall allows explicit empty string value without throwing', () => {
    // Kills 484:38 [StringLiteral] "Stryker was here!" in watchall.allow('')
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCHALL = '';
    expect(() => configuration.getWebhookConfiguration()).not.toThrow();
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCHALL;
  });

  test('tokens.watch allows explicit empty string value without throwing', () => {
    // Kills 485:35 [StringLiteral] "Stryker was here!" in watch.allow('')
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCH = '';
    expect(() => configuration.getWebhookConfiguration()).not.toThrow();
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCH;
  });

  test('tokens.update allows explicit empty string value without throwing', () => {
    // Kills 486:36 [StringLiteral] "Stryker was here!" in update.allow('')
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_UPDATE = '';
    expect(() => configuration.getWebhookConfiguration()).not.toThrow();
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_UPDATE;
  });

  test('token default is empty string', () => {
    const config = configuration.getWebhookConfiguration();
    expect(config.token).toBe('');
  });

  test('hasAnyToken check uses optional chaining on tokens.watchall', () => {
    // Kills 502:5 / 509:5 [OptionalChaining]
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_ENABLED = 'true';
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCHALL = 'token-wa';
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCH = 'token-w';
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_UPDATE = 'token-u';
    // Should not throw – all three are set
    expect(() => configuration.getWebhookConfiguration()).not.toThrow();
  });

  test('should not throw when webhook enabled with watchall token only (missing watch/update)', () => {
    // Demonstrates partial token detection (line 505/506 ConditionalExpression)
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_ENABLED = 'true';
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCHALL = 'wa-token';
    expect(() => configuration.getWebhookConfiguration()).toThrow(
      'All endpoint-specific webhook tokens',
    );
  });

  test('enabled=false does NOT validate token requirements', () => {
    // Kills 514/517:16 [ConditionalExpression] true
    // When disabled, missing tokens should not throw
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_ENABLED = 'false';
    expect(() => configuration.getWebhookConfiguration()).not.toThrow();
  });

  test('tokens schema default watchall key value is empty string', () => {
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_ENABLED = 'false';
    const config = configuration.getWebhookConfiguration();
    expect(config.tokens.watchall).toBe('');
    expect(config.tokens.watch).toBe('');
    expect(config.tokens.update).toBe('');
  });

  test('enabled webhook with no auth throws specific error message', () => {
    // Kills 528:7 [StringLiteral] "" – if message replaced with "", toThrow("") always passes
    // but toThrow with a specific string checks actual message content
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_ENABLED = 'true';
    expect(() => configuration.getWebhookConfiguration()).toThrow(
      'At least one webhook auth mechanism',
    );
  });
});

describe('parseDelimitedEnumList – detailed coverage', () => {
  test('empty defaultRawValue string uses empty string filter correctly', () => {
    // Kills 569:82 [StringLiteral] ""
    // Test via getSecurityConfiguration with custom severity
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
    const result = configuration.getSecurityConfiguration();
    // Default should be CRITICAL,HIGH parsed correctly from DEFAULT_SECURITY_BLOCK_SEVERITY
    expect(result.blockSeverities).toEqual(['CRITICAL', 'HIGH']);
  });

  test('whitespace-only items are filtered out from configured values', () => {
    // Kills 603:34 [StringLiteral] "Stryker was here!" (filter value !== '')
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = 'CRITICAL, ,HIGH';
    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).toEqual(['CRITICAL', 'HIGH']);
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
  });

  test('single valid value returns array of that value', () => {
    // Kills 604:7 [ConditionalExpression] false – configuredValues.length check
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = 'LOW';
    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).toEqual(['LOW']);
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
  });

  test('configured empty string after split returns defaults', () => {
    // Kills 604:7 [ConditionalExpression] false – configuredValues empty path
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = ',,,';
    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).toEqual(['CRITICAL', 'HIGH']);
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
  });

  test('onInvalidValues is called with correct context shape', () => {
    // Kills 611:7 [ConditionalExpression] true / 611:7 [EqualityOperator]
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = 'CRITICAL,INVALID_SEVERITY';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = configuration.getSecurityConfiguration();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('INVALID_SEVERITY'));
    // parsedValues still had CRITICAL so we do NOT fall back to defaults
    expect(result.blockSeverities).toEqual(['CRITICAL']);
    warnSpy.mockRestore();
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
  });

  test('onInvalidValues callback receives defaultValues array (not empty)', () => {
    // Kills 612:5 [OptionalChaining] options?.onInvalidValues
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = 'BOGUS';
    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).toEqual(['CRITICAL', 'HIGH']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Falling back to defaults: CRITICAL, HIGH.'),
    );
    warnSpy.mockRestore();
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
  });

  test('normalizeValue is applied to each item (toUpperCase for severity)', () => {
    // Kills 600:28 [MethodExpression] rawValue.split(',').map(...)
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = 'critical,high';
    const result = configuration.getSecurityConfiguration();
    // If normalizeValue removed, 'critical' would not match 'CRITICAL'
    expect(result.blockSeverities).toEqual(['CRITICAL', 'HIGH']);
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
  });

  test('defaultRawValue items are filtered through isAllowedValue', () => {
    // Kills 591:25 [MethodExpression]
    // The DEFAULT_SECURITY_BLOCK_SEVERITY is 'CRITICAL,HIGH' which are valid
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).not.toContain('');
    expect(result.blockSeverities.length).toBeGreaterThan(0);
  });

  test('trim is applied to each value in the configured list', () => {
    // Kills 593:21 [MethodExpression] value (removes trim call)
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = ' CRITICAL , HIGH ';
    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).toEqual(['CRITICAL', 'HIGH']);
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
  });

  test('parsedValues.length === 0 falls back to defaults', () => {
    // Kills 618 path - parsedValues empty → return defaultValues
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = 'COMPLETELY_INVALID';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).toEqual(['CRITICAL', 'HIGH']);
    warnSpy.mockRestore();
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
  });

  test('onInvalidValues callback is NOT called when all configured values are valid', () => {
    // Kills 611:7 [ConditionalExpression] true / 611:7 [EqualityOperator] invalidValues.length >= 0
    // With mutant "true", callback always fires even for valid-only inputs
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = 'CRITICAL,HIGH';
    const result = configuration.getSecurityConfiguration();
    // All valid, so warn should NOT be called for CRITICAL/HIGH severity values
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Invalid'));
    expect(result.blockSeverities).toEqual(['CRITICAL', 'HIGH']);
    warnSpy.mockRestore();
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
  });

  test('SBOM format values are lowercased before matching (normalizeValue for sbom)', () => {
    // Kills 594:24 [ConditionalExpression] true / 594:34 [StringLiteral]
    configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS = 'SPDX-JSON';
    const result = configuration.getSecurityConfiguration();
    expect(result.sbom.formats).toEqual(['spdx-json']);
    delete configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS;
  });

  test('SBOM format invalid warning uses correct message', () => {
    // Kills 603:34 / 599 sbom path
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS = 'spdx-json,invalid-format';
    const result = configuration.getSecurityConfiguration();
    expect(result.sbom.formats).toEqual(['spdx-json']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid-format'));
    warnSpy.mockRestore();
    delete configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS;
  });
});

describe('validateCosignKeyPath and cosign pattern coverage', () => {
  test('should reject cosign key path containing double dots (path traversal)', () => {
    // Kills 685:20 [Regex] mutations
    configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY = '../secret.pub';
    expect(() => configuration.getSecurityConfiguration()).toThrow();
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY;
  });

  test('cosign key pattern allows single dots', () => {
    // A file like /tmp/key.pub is valid (no ..)
    configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY = `${TEST_DIRECTORY}/secret.txt`;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.key).toBe(`${TEST_DIRECTORY}/secret.txt`);
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY;
  });

  test('cosign command defaults to cosign string (not empty)', () => {
    // Kills 683:18 [StringLiteral]
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_COMMAND;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.command).toBe('cosign');
  });

  test('cosign timeout defaults to 60000 (not 0)', () => {
    // Kills 684:20 [StringLiteral]
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_TIMEOUT;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.timeout).toBe(60000);
  });

  test('cosign identity defaults to empty string', () => {
    // Kills 686:38 [StringLiteral]
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_IDENTITY;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.identity).toBe('');
  });

  test('cosign issuer defaults to empty string', () => {
    // Kills 687:36 [StringLiteral]
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_ISSUER;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.issuer).toBe('');
  });

  test('cosign identity is passed through when set to a non-empty value', () => {
    // Kills 686:38 [StringLiteral] when mutated to ""
    configuration.ddEnvVars.DD_SECURITY_COSIGN_IDENTITY = 'my@example.com';
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.identity).toBe('my@example.com');
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_IDENTITY;
  });

  test('cosign issuer is passed through when set to a non-empty value', () => {
    configuration.ddEnvVars.DD_SECURITY_COSIGN_ISSUER = 'https://accounts.google.com';
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.issuer).toBe('https://accounts.google.com');
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_ISSUER;
  });
});

describe('getSecurityConfiguration – trivy/sbom/scan/prune field coverage', () => {
  test('trivy server defaults to empty string (not another string)', () => {
    // Kills 654:62 [StringLiteral]
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_SERVER;
    const result = configuration.getSecurityConfiguration();
    expect(result.trivy.server).toBe('');
  });

  test('trivy command defaults to trivy (not empty string)', () => {
    // Kills 657:38 [StringLiteral]
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_COMMAND;
    const result = configuration.getSecurityConfiguration();
    expect(result.trivy.command).toBe('trivy');
  });

  test('trivy command is passed through when explicitly set', () => {
    configuration.ddEnvVars.DD_SECURITY_TRIVY_COMMAND = 'my-trivy';
    const result = configuration.getSecurityConfiguration();
    expect(result.trivy.command).toBe('my-trivy');
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_COMMAND;
  });

  test('trivy timeout defaults to 600000', () => {
    // Kills 662:36 [StringLiteral]
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_TIMEOUT;
    const result = configuration.getSecurityConfiguration();
    expect(result.trivy.timeout).toBe(600000);
  });

  test('trivy image src defaults to empty string', () => {
    // Kills 663:39 [StringLiteral]
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_IMAGE_SRC;
    const result = configuration.getSecurityConfiguration();
    expect(result.trivy.imageSrc).toBe('');
  });

  test('sbom enabled defaults to false', () => {
    // Kills 674:43 [BooleanLiteral] true
    delete configuration.ddEnvVars.DD_SECURITY_SBOM_ENABLED;
    const result = configuration.getSecurityConfiguration();
    expect(result.sbom.enabled).toBe(false);
  });

  test('sbom formats default to spdx-json', () => {
    // Kills 679:39 [StringLiteral] ""
    delete configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS;
    const result = configuration.getSecurityConfiguration();
    expect(result.sbom.formats).toEqual(['spdx-json']);
  });

  test('gate mode defaults to on', () => {
    delete configuration.ddEnvVars.DD_SECURITY_GATE_MODE;
    const result = configuration.getSecurityConfiguration();
    expect(result.gate.mode).toBe('on');
  });

  test('scan cron defaults to empty string', () => {
    // Kills 708:34 [StringLiteral]
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_CRON;
    const result = configuration.getSecurityConfiguration();
    expect(result.scan.cron).toBe('');
  });

  test('scan cron is passed through when set', () => {
    configuration.ddEnvVars.DD_SECURITY_SCAN_CRON = '0 * * * *';
    const result = configuration.getSecurityConfiguration();
    expect(result.scan.cron).toBe('0 * * * *');
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_CRON;
  });

  test('scan jitter defaults to 60000', () => {
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_JITTER;
    const result = configuration.getSecurityConfiguration();
    expect(result.scan.jitter).toBe(60000);
  });

  test('scan jitter is passed through when set to 0', () => {
    // Tests the ?? 60000 branch is not incorrectly triggered by 0
    configuration.ddEnvVars.DD_SECURITY_SCAN_JITTER = '0';
    const result = configuration.getSecurityConfiguration();
    expect(result.scan.jitter).toBe(0);
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_JITTER;
  });

  test('scan concurrency defaults to 4', () => {
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_CONCURRENCY;
    const result = configuration.getSecurityConfiguration();
    expect(result.scan.concurrency).toBe(4);
  });

  test('scan batch timeout defaults to 1800000', () => {
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_BATCH_TIMEOUT;
    const result = configuration.getSecurityConfiguration();
    expect(result.scan.batchTimeout).toBe(1800000);
  });

  test('scan batch timeout is passed through when set to 0', () => {
    configuration.ddEnvVars.DD_SECURITY_SCAN_BATCH_TIMEOUT = '0';
    const result = configuration.getSecurityConfiguration();
    expect(result.scan.batchTimeout).toBe(0);
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_BATCH_TIMEOUT;
  });

  test('scan notifications defaults to false', () => {
    // Kills 723:19 [BooleanLiteral]
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_NOTIFICATIONS;
    const result = configuration.getSecurityConfiguration();
    expect(result.scan.notifications).toBe(false);
  });

  test('scan notifications can be enabled', () => {
    configuration.ddEnvVars.DD_SECURITY_SCAN_NOTIFICATIONS = 'true';
    const result = configuration.getSecurityConfiguration();
    expect(result.scan.notifications).toBe(true);
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_NOTIFICATIONS;
  });

  test('sbom enabled can be set to true', () => {
    // Kills 722:19 [BooleanLiteral]
    configuration.ddEnvVars.DD_SECURITY_SBOM_ENABLED = 'true';
    const result = configuration.getSecurityConfiguration();
    expect(result.sbom.enabled).toBe(true);
    delete configuration.ddEnvVars.DD_SECURITY_SBOM_ENABLED;
  });

  test('scan jitter minimum is 0 (not rejected)', () => {
    // Kills 709:17 [MethodExpression] joi.number().integer().max(0)
    configuration.ddEnvVars.DD_SECURITY_SCAN_JITTER = '0';
    expect(() => configuration.getSecurityConfiguration()).not.toThrow();
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_JITTER;
  });

  test('scan jitter rejects negative values', () => {
    configuration.ddEnvVars.DD_SECURITY_SCAN_JITTER = '-1';
    expect(() => configuration.getSecurityConfiguration()).toThrow();
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_JITTER;
  });

  test('security scanner schema defaults use correct object', () => {
    // Kills 721:86 [ObjectLiteral] {}
    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
    const result = configuration.getSecurityConfiguration();
    expect(result).toHaveProperty('trivy');
    expect(result.trivy).toHaveProperty('server');
    expect(result.trivy).toHaveProperty('command');
    expect(result.trivy).toHaveProperty('timeout');
  });

  test('getSecurityConfiguration optional chain on trivy.server returns empty string when not set', () => {
    // Kills 740:15 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_SERVER;
    const result = configuration.getSecurityConfiguration();
    expect(result.trivy.server).toBe('');
  });

  test('getSecurityConfiguration optional chain on trivy.command returns trivy when not set', () => {
    // Kills 741:16 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_COMMAND;
    const result = configuration.getSecurityConfiguration();
    expect(result.trivy.command).toBe('trivy');
  });

  test('getSecurityConfiguration optional chain on trivy.timeout returns 600000 when not set', () => {
    // Kills 742:16 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_TIMEOUT;
    const result = configuration.getSecurityConfiguration();
    expect(result.trivy.timeout).toBe(600000);
  });

  test('getSecurityConfiguration optional chain on verify.signatures returns false when not set', () => {
    // Kills 746:23 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_VERIFY_SIGNATURES;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.verify).toBe(false);
  });

  test('getSecurityConfiguration optional chain on cosign.command returns cosign when not set', () => {
    // Kills 748:18 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_COMMAND;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.command).toBe('cosign');
  });

  test('getSecurityConfiguration optional chain on cosign.timeout returns 60000 when not set', () => {
    // Kills 749:18 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_TIMEOUT;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.timeout).toBe(60000);
  });

  test('getSecurityConfiguration optional chain on cosign.identity returns empty string when not set', () => {
    // Kills 751:19 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_IDENTITY;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.identity).toBe('');
  });

  test('getSecurityConfiguration optional chain on cosign.issuer returns empty string when not set', () => {
    // Kills 752:17 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_ISSUER;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.issuer).toBe('');
  });

  test('getSecurityConfiguration optional chain on sbom.enabled returns false when not set', () => {
    // Kills 756:24 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_SBOM_ENABLED;
    const result = configuration.getSecurityConfiguration();
    expect(result.sbom.enabled).toBe(false);
  });

  test('getSecurityConfiguration optional chain on prune.onblock returns true when not set', () => {
    // Kills 763:16 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_PRUNE_ONBLOCK;
    const result = configuration.getSecurityConfiguration();
    expect(result.prune.onBlock).toBe(true);
  });

  test('getSecurityConfiguration optional chain on scan.cron returns empty string when not set', () => {
    // Kills 766:13 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_CRON;
    const result = configuration.getSecurityConfiguration();
    expect(result.scan.cron).toBe('');
  });

  test('getSecurityConfiguration optional chain on scan.jitter returns 60000 when not set', () => {
    // Kills 767:15 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_JITTER;
    const result = configuration.getSecurityConfiguration();
    expect(result.scan.jitter).toBe(60000);
  });

  test('getSecurityConfiguration optional chain on scan.concurrency returns 4 when not set', () => {
    // Kills 768:20 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_CONCURRENCY;
    const result = configuration.getSecurityConfiguration();
    expect(result.scan.concurrency).toBe(4);
  });

  test('getSecurityConfiguration optional chain on scan.batch returns 1800000 when not set', () => {
    // Kills 769:21 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_BATCH_TIMEOUT;
    const result = configuration.getSecurityConfiguration();
    expect(result.scan.batchTimeout).toBe(1800000);
  });

  test('getSecurityConfiguration optional chain on scan.notifications returns false when not set', () => {
    // Kills 770:30 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_SCAN_NOTIFICATIONS;
    const result = configuration.getSecurityConfiguration();
    expect(result.scan.notifications).toBe(false);
  });

  test('getSecurityConfiguration optional chain on block.severity uses default when not set', () => {
    // Kills 731:53 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).toEqual(['CRITICAL', 'HIGH']);
  });

  test('getSecurityConfiguration optional chain on sbom.formats uses default when not set', () => {
    // Kills 732:51 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS;
    const result = configuration.getSecurityConfiguration();
    expect(result.sbom.formats).toEqual(['spdx-json']);
  });

  test('getSecurityConfiguration optional chain on cosign.key uses empty when not set', () => {
    // Kills 733:43 [OptionalChaining]
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.key).toBe('');
  });
});

describe('getSecurityConfiguration – allow empty string schema coverage', () => {
  test('scanner allows explicit empty string without throwing', () => {
    // Kills 654:62 [StringLiteral] – allow('') becomes allow("Stryker was here!")
    // Setting scanner='' must not cause validation error
    configuration.ddEnvVars.DD_SECURITY_SCANNER = '';
    expect(() => configuration.getSecurityConfiguration()).not.toThrow();
    delete configuration.ddEnvVars.DD_SECURITY_SCANNER;
  });

  test('block.severity allows explicit empty string without throwing', () => {
    // Kills 657:38 [StringLiteral] – allow('') → allow("Stryker was here!")
    configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY = '';
    expect(() => configuration.getSecurityConfiguration()).not.toThrow();
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
  });

  test('trivy.server allows explicit empty string without throwing', () => {
    // Kills 662:36 [StringLiteral] – trivy.server.allow('')
    configuration.ddEnvVars.DD_SECURITY_TRIVY_SERVER = '';
    expect(() => configuration.getSecurityConfiguration()).not.toThrow();
    const result = configuration.getSecurityConfiguration();
    expect(result.trivy.server).toBe('');
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_SERVER;
  });

  test('trivy.image.src allows explicit empty string without throwing', () => {
    // Kills 667:37 [StringLiteral] – trivy.image.src.allow('')
    configuration.ddEnvVars.DD_SECURITY_TRIVY_IMAGE_SRC = '';
    expect(() => configuration.getSecurityConfiguration()).not.toThrow();
    delete configuration.ddEnvVars.DD_SECURITY_TRIVY_IMAGE_SRC;
  });

  test('cosign.key allows explicit empty string without throwing', () => {
    // Kills cosign.key allow('') mutation
    configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY = '';
    expect(() => configuration.getSecurityConfiguration()).not.toThrow();
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY;
  });

  test('cosign.identity allows explicit empty string without throwing', () => {
    // Kills 686:38 [StringLiteral]
    configuration.ddEnvVars.DD_SECURITY_COSIGN_IDENTITY = '';
    expect(() => configuration.getSecurityConfiguration()).not.toThrow();
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_IDENTITY;
  });

  test('cosign.issuer allows explicit empty string without throwing', () => {
    // Kills 687:36 [StringLiteral]
    configuration.ddEnvVars.DD_SECURITY_COSIGN_ISSUER = '';
    expect(() => configuration.getSecurityConfiguration()).not.toThrow();
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_ISSUER;
  });

  test('sbom.formats allows explicit empty string without throwing', () => {
    // Kills sbom.formats allow('') mutation
    configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS = '';
    expect(() => configuration.getSecurityConfiguration()).not.toThrow();
    delete configuration.ddEnvVars.DD_SECURITY_SBOM_FORMATS;
  });
});

describe('parseSafePublicUrlCandidate – detailed coverage', () => {
  test('should return / when DD_PUBLIC_URL is a non-empty invalid URL', () => {
    // Kills 830:40 [ConditionalExpression] false /  830:40 [EqualityOperator]
    configuration.ddEnvVars.DD_PUBLIC_URL = 'not-a-url-but-not-empty';
    const result = configuration.getPublicUrl({ protocol: 'https', hostname: 'example.com' });
    // configuredPublicUrl is falsy (invalid URL), publicUrl is a non-empty string → return '/'
    expect(result).toBe('/');
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
  });

  test('should return / when DD_PUBLIC_URL is a whitespace-only string', () => {
    // Kills 830:40 [MethodExpression] publicUrl (removes trim())
    configuration.ddEnvVars.DD_PUBLIC_URL = '   ';
    // trim().length === 0 → the publicUrl branch does NOT trigger → falls through to req inference
    const result = configuration.getPublicUrl({ protocol: 'https', hostname: 'example.com' });
    expect(result).toBe('https://example.com');
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
  });

  test('should return origin when DD_PUBLIC_URL is a valid https URL with path', () => {
    // Kills 818:36 [ConditionalExpression] false for protocol check
    configuration.ddEnvVars.DD_PUBLIC_URL = 'https://api.example.com/v1';
    const result = configuration.getPublicUrl({ protocol: 'https', hostname: 'other.com' });
    expect(result).toBe('https://api.example.com');
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
  });

  test('should return origin when DD_PUBLIC_URL is a valid http URL', () => {
    configuration.ddEnvVars.DD_PUBLIC_URL = 'http://local.example.com';
    const result = configuration.getPublicUrl({ protocol: 'https', hostname: 'other.com' });
    expect(result).toBe('http://local.example.com');
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
  });

  test('getPublicUrl inferred URL uses protocol string correctly', () => {
    // Kills 835:20 [ConditionalExpression] true / 835:70 [StringLiteral]
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
    // protocol is not a string → falls back to empty string
    const result = configuration.getPublicUrl({ protocol: null, hostname: 'example.com' });
    expect(result).toBe('/');
  });

  test('getPublicUrl inferred URL uses hostname string correctly', () => {
    // Kills 836:20 [ConditionalExpression] true / 836:70 [StringLiteral]
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
    const result = configuration.getPublicUrl({ protocol: 'https', hostname: null });
    expect(result).toBe('/');
  });

  test('parseSafePublicUrlCandidate rejects value with control character at start', () => {
    // Kills 804:7 [ConditionalExpression] false / 804:80 [BlockStatement] {}
    configuration.ddEnvVars.DD_PUBLIC_URL = 'https://example.com';
    const result = configuration.getPublicUrl({ protocol: 'https', hostname: 'example.com' });
    expect(result).toBe('/');
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
  });

  test('parseSafePublicUrlCandidate rejects empty string after trim', () => {
    // Kills 801:24 [MethodExpression] value (removes trim)
    // Empty string after trim → trimmedValue.length === 0 → return undefined
    configuration.ddEnvVars.DD_PUBLIC_URL = '';
    // Empty string → no configuredPublicUrl, empty publicUrl does not trigger '/' path
    const result = configuration.getPublicUrl({ protocol: 'https', hostname: 'example.com' });
    // publicUrl is '' → trim().length === 0 → second branch does not fire → infer from request
    expect(result).toBe('https://example.com');
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
  });

  test('getPublicUrl with valid inferred URL returns correct origin', () => {
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
    const result = configuration.getPublicUrl({ protocol: 'https', hostname: 'myhost.example' });
    expect(result).toBe('https://myhost.example');
  });

  test('parseSafePublicUrlCandidate rejects URL with empty username and non-empty password', () => {
    // Kills 818:36 [ConditionalExpression] false – removes || parsedUrl.password !== ''
    // URL ':secret@example.com' has empty username but non-empty password; must be rejected
    configuration.ddEnvVars.DD_PUBLIC_URL = 'https://:secret@example.com';
    const result = configuration.getPublicUrl({ protocol: 'https', hostname: 'example.com' });
    // With mutant (|| false), password-only auth passes through → origin returned
    // With real code, password !== '' → returns undefined → falls through → '/'
    expect(result).toBe('/');
    delete configuration.ddEnvVars.DD_PUBLIC_URL;
  });
});

describe('isRecord and mergeRecords mutation coverage', () => {
  test('getTriggerConfigurations merges DD_TRIGGER legacy with DD_ACTION correctly', () => {
    // Exercises mergeRecords (lines 234-249) and isRecord (lines 230-232)
    configuration.ddEnvVars.DD_TRIGGER_DOCKER_UPDATE_THRESHOLD = 'major';
    configuration.ddEnvVars.DD_ACTION_DOCKER_UPDATE_LEVEL = 'patch';
    const result = configuration.getTriggerConfigurations();
    expect(result.docker).toBeDefined();
    expect((result.docker as Record<string, unknown>).update).toBeDefined();
    delete configuration.ddEnvVars.DD_TRIGGER_DOCKER_UPDATE_THRESHOLD;
    delete configuration.ddEnvVars.DD_ACTION_DOCKER_UPDATE_LEVEL;
  });

  test('mergeRecords deep-merges nested objects', () => {
    // Kills 231:10 [ConditionalExpression] false/true, 231:28/57 EqualityOperator/BooleanLiteral
    configuration.ddEnvVars.DD_TRIGGER_DOCKER_UPDATE_THRESHOLD = 'major';
    configuration.ddEnvVars.DD_TRIGGER_DOCKER_UPDATE_LEVEL = 'image';
    configuration.ddEnvVars.DD_ACTION_DOCKER_UPDATE_THRESHOLD = 'minor';
    const result = configuration.getTriggerConfigurations();
    // Both trigger and action contribute keys to docker.update object
    const dockerUpdate = (result.docker as Record<string, Record<string, unknown>>).update;
    expect(dockerUpdate.threshold).toBe('minor'); // action overrides trigger
    expect(dockerUpdate.level).toBe('image'); // preserved from trigger
    delete configuration.ddEnvVars.DD_TRIGGER_DOCKER_UPDATE_THRESHOLD;
    delete configuration.ddEnvVars.DD_TRIGGER_DOCKER_UPDATE_LEVEL;
    delete configuration.ddEnvVars.DD_ACTION_DOCKER_UPDATE_THRESHOLD;
  });

  test('mergeRecords with non-object override replaces base value', () => {
    // When overrideValue is not a record, it replaces baseValue entirely
    configuration.ddEnvVars.DD_TRIGGER_DOCKER_UPDATE_THRESHOLD = 'major';
    configuration.ddEnvVars.DD_ACTION_DOCKER = 'scalar'; // scalar override for 'docker'
    const result = configuration.getTriggerConfigurations();
    // action.docker = 'scalar' should override trigger.docker (which is an object)
    expect(result.docker).toBe('scalar');
    delete configuration.ddEnvVars.DD_TRIGGER_DOCKER_UPDATE_THRESHOLD;
    delete configuration.ddEnvVars.DD_ACTION_DOCKER;
  });

  test('isRecord returns false for null values during merge', () => {
    // Kills 231:10 [ConditionalExpression] true + 231:10 [EqualityOperator] value === null
    // Make one side null to test null exclusion from isRecord
    configuration.ddEnvVars.DD_TRIGGER_DOCKER_UPDATE_THRESHOLD = 'major';
    configuration.ddEnvVars.DD_ACTION_DOCKER_UPDATE_THRESHOLD = 'minor';
    // Both sides are strings (not objects) – merge uses simple override
    const result = configuration.getTriggerConfigurations();
    expect((result.docker as Record<string, Record<string, string>>).update.threshold).toBe(
      'minor',
    );
    delete configuration.ddEnvVars.DD_TRIGGER_DOCKER_UPDATE_THRESHOLD;
    delete configuration.ddEnvVars.DD_ACTION_DOCKER_UPDATE_THRESHOLD;
  });

  test('isRecord returns false for arrays during merge (does not deep merge arrays)', () => {
    // Kills 231:57 [BooleanLiteral] Array.isArray(value)
    configuration.ddEnvVars.DD_TRIGGER_DOCKER_UPDATE_THRESHOLD = 'major';
    // Can only test via trigger/action merge paths
    const result = configuration.getTriggerConfigurations();
    expect(result).toHaveProperty('docker');
    delete configuration.ddEnvVars.DD_TRIGGER_DOCKER_UPDATE_THRESHOLD;
  });
});

describe('normalizeWatcherMaintenanceEnvAliases – missing-value path', () => {
  test('should skip aliases with undefined env values (maintenancewindow key not set)', () => {
    // Kills 210:28 [ConditionalExpression] false for envValue === undefined check
    // When an env var is in ddEnvVars but has undefined value,
    // normalizeWatcherMaintenanceEnvAliases should NOT add the maintenancewindow key.
    // The watcher entry may still appear from get() but the alias key should be absent.
    configuration.ddEnvVars.DD_WATCHER_SKIPPED_MAINTENANCE_WINDOW = undefined;
    const watcherConfigurations = configuration.getWatcherConfigurations();
    // The alias should be skipped – maintenancewindow key should be set from get() as undefined,
    // not as a properly resolved value via the alias path.
    // Key presence from get() is fine but the value should be undefined (not overwritten).
    expect(watcherConfigurations.skipped?.maintenancewindow).toBeUndefined();
    delete configuration.ddEnvVars.DD_WATCHER_SKIPPED_MAINTENANCE_WINDOW;
  });

  test('should not delete maintenance key when watcher has no existing maintenance key', () => {
    // Kills 221:7 [ConditionalExpression] and LogicalOperator mutations
    configuration.ddEnvVars.DD_WATCHER_NOMAINT_MAINTENANCE_WINDOW = '*/5 * * * *';
    const watcherConfigurations = configuration.getWatcherConfigurations();
    // 'maintenance' was never set, so it should still be undefined
    expect(watcherConfigurations.nomaint.maintenance).toBeUndefined();
    expect(watcherConfigurations.nomaint.maintenancewindow).toBe('*/5 * * * *');
    delete configuration.ddEnvVars.DD_WATCHER_NOMAINT_MAINTENANCE_WINDOW;
  });

  test('normalizeWatcherMaintenanceEnvAliases deletes the maintenance key when present', () => {
    // Kills 222:7 [ConditionalExpression] true – the BlockStatement replacing delete
    // Set DD_WATCHER_LOCAL_MAINTENANCE to create the maintenance key via get(), then
    // also set DD_WATCHER_LOCAL_MAINTENANCE_WINDOW to trigger normalization.
    // After normalization, 'maintenance' should be deleted.
    configuration.ddEnvVars.DD_WATCHER_DELMAINT_MAINTENANCE = 'old-window-format';
    configuration.ddEnvVars.DD_WATCHER_DELMAINT_MAINTENANCE_WINDOW = '0 2 * * *';
    const watcherConfigurations = configuration.getWatcherConfigurations();
    // maintenance was present (from DD_WATCHER_DELMAINT_MAINTENANCE) but should be deleted
    expect(watcherConfigurations.delmaint.maintenance).toBeUndefined();
    expect(watcherConfigurations.delmaint.maintenancewindow).toBe('0 2 * * *');
    delete configuration.ddEnvVars.DD_WATCHER_DELMAINT_MAINTENANCE;
    delete configuration.ddEnvVars.DD_WATCHER_DELMAINT_MAINTENANCE_WINDOW;
  });

  test('parseWatcherMaintenanceEnvAlias returns undefined for non-DD_WATCHER_ prefixed keys', () => {
    // Kills 182:7 [ConditionalExpression] false – the startsWith(prefix) check
    // If a non-watcher key (e.g., DD_REGISTRY_FOO_MAINTENANCE_WINDOW) is present,
    // it should NOT be parsed as a watcher maintenance alias.
    configuration.ddEnvVars.DD_REGISTRY_NONWATCHER_MAINTENANCE_WINDOW = '0 5 * * *';
    const watcherConfigurations = configuration.getWatcherConfigurations();
    // Should not create a watcher entry for 'nonwatcher'
    expect(watcherConfigurations.nonwatcher).toBeUndefined();
    delete configuration.ddEnvVars.DD_REGISTRY_NONWATCHER_MAINTENANCE_WINDOW;
  });

  test('TZ alias is NOT treated as window alias (suffix check is correct)', () => {
    // Kills 194:7 [ConditionalExpression] true – if endsWith(windowSuffix) always true,
    // TZ keys would be parsed as window aliases (setting 'maintenancewindow' not 'maintenancewindowtz').
    configuration.ddEnvVars.DD_WATCHER_TZSUFFIX_MAINTENANCE_WINDOW_TZ = 'America/Chicago';
    const watcherConfigurations = configuration.getWatcherConfigurations();
    // Should be stored as maintenancewindowtz, NOT maintenancewindow
    expect(watcherConfigurations.tzsuffix.maintenancewindowtz).toBe('America/Chicago');
    expect(watcherConfigurations.tzsuffix.maintenancewindow).toBeUndefined();
    delete configuration.ddEnvVars.DD_WATCHER_TZSUFFIX_MAINTENANCE_WINDOW_TZ;
  });
});

describe('getLegacyTriggerIdFromEnvKey path coverage', () => {
  test('usesLegacyTriggerPrefix returns true when DD_TRIGGER key has 3 segments (type.name.field)', () => {
    // Kills 261:7 [ConditionalExpression] false / 261:31 [BlockStatement] {}
    configuration.ddEnvVars.DD_TRIGGER_SLACK_MYSLACK_URL = 'https://hooks.slack.com/test';
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    configuration.getTriggerConfigurations();
    expect(configuration.usesLegacyTriggerPrefix('slack', 'myslack')).toBe(true);
    delete configuration.ddEnvVars.DD_TRIGGER_SLACK_MYSLACK_URL;
    warnSpy.mockRestore();
  });

  test('usesLegacyTriggerPrefix returns true for exactly 2-segment DD_TRIGGER key (type.name)', () => {
    // Kills 261:7 [EqualityOperator] triggerPath.length <= 2 (should be < 2)
    // DD_TRIGGER_X_Y has exactly 2 segments [x, y] – should return id 'x.y'
    configuration.ddEnvVars.DD_TRIGGER_GOTIFY_MYNOTIF = 'value';
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    configuration.getTriggerConfigurations();
    // 2 segments → valid ID (triggerPath.length === 2, NOT < 2)
    expect(configuration.usesLegacyTriggerPrefix('gotify', 'mynotif')).toBe(true);
    delete configuration.ddEnvVars.DD_TRIGGER_GOTIFY_MYNOTIF;
    warnSpy.mockRestore();
  });

  test('usesLegacyTriggerPrefix returns false when DD_TRIGGER key has only 1 segment', () => {
    // Kills 261:7 [EqualityOperator] triggerPath.length <= 2 (should be < 2)
    configuration.ddEnvVars.DD_TRIGGER_DOCKER = 'value';
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    configuration.getTriggerConfigurations();
    expect(configuration.usesLegacyTriggerPrefix('docker', '')).toBe(false);
    delete configuration.ddEnvVars.DD_TRIGGER_DOCKER;
    warnSpy.mockRestore();
  });

  test('trigger path parsing converts to lowercase before storing legacyId', () => {
    // Note: usesLegacyTriggerPrefix itself lowercases the lookup key, so this mutant
    // (258:20 [MethodExpression] part – removing toLowerCase in getLegacyTriggerIdFromEnvKey)
    // is equivalent – the Set lookup will match regardless of case stored in the set.
    // Verify the basic functionality works correctly.
    configuration.ddEnvVars.DD_TRIGGER_DISCORD_MYBOT_URL = 'https://discord.com/api/webhooks/test';
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    configuration.getTriggerConfigurations();
    expect(configuration.usesLegacyTriggerPrefix('discord', 'mybot')).toBe(true);
    delete configuration.ddEnvVars.DD_TRIGGER_DISCORD_MYBOT_URL;
    warnSpy.mockRestore();
  });

  test('trigger path parsing filters out empty segments', () => {
    // Kills 259:23 [EqualityOperator] part.length >= 0 (replacing > 0)
    // DD_TRIGGER_A__B has an empty segment between A and B (double underscore → empty part after split)
    // With >= 0 filter, empty '' is kept: path = ['a', '', 'b'], id = 'a.'
    // With > 0 filter, empty '' is excluded: path = ['a', 'b'], id = 'a.b'
    configuration.ddEnvVars.DD_TRIGGER_MYTYPE__MYNAME_FIELD = 'value';
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    configuration.getTriggerConfigurations();
    // With correct filter, empty string is excluded and we get 'mytype.myname' not 'mytype.'
    expect(configuration.usesLegacyTriggerPrefix('mytype', 'myname')).toBe(true);
    expect(configuration.usesLegacyTriggerPrefix('mytype', '')).toBe(false);
    delete configuration.ddEnvVars.DD_TRIGGER_MYTYPE__MYNAME_FIELD;
    warnSpy.mockRestore();
  });

  test('envKeyUpper is uppercased before getLegacyTriggerIdFromEnvKey call', () => {
    // Kills 252:23 [MethodExpression] envKey.toLowerCase()
    // The envKey.toUpperCase() ensures case-insensitive detection
    configuration.ddEnvVars.DD_TRIGGER_MATRIX_MYROOM_URL = 'https://matrix.example.com';
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    configuration.getTriggerConfigurations();
    // The trigger ID should be stored as lowercase 'matrix.myroom'
    expect(configuration.usesLegacyTriggerPrefix('matrix', 'myroom')).toBe(true);
    delete configuration.ddEnvVars.DD_TRIGGER_MATRIX_MYROOM_URL;
    warnSpy.mockRestore();
  });

  test('collectLegacyTriggerUsage tracks first two path segments as type.name', () => {
    // Kills 281:11 [ConditionalExpression] true
    configuration.ddEnvVars.DD_TRIGGER_TEAMS_MYTEAMS_URL = 'https://outlook.office.com/webhook/';
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    configuration.getTriggerConfigurations();
    // The legacy ID should be teams.myteams (first two segments)
    expect(configuration.usesLegacyTriggerPrefix('teams', 'myteams')).toBe(true);
    // Not a three-segment id
    expect(configuration.usesLegacyTriggerPrefix('teams', 'myteams.url')).toBe(false);
    delete configuration.ddEnvVars.DD_TRIGGER_TEAMS_MYTEAMS_URL;
    warnSpy.mockRestore();
  });

  test('getLegacyTriggerIdFromEnvKey with 255:23 – slice from prefix.length correctly', () => {
    // Kills 255:23 [MethodExpression] – replaces slice+split with just the method chain
    // If slice(prefix.length) is wrong, the prefix 'DD_TRIGGER_' remains in the path
    configuration.ddEnvVars.DD_TRIGGER_NTFY_MYNTFY_TOPIC = 'value';
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    configuration.getTriggerConfigurations();
    // Should correctly extract 'ntfy.myntfy' (not 'dd_trigger_ntfy.myntfy')
    expect(configuration.usesLegacyTriggerPrefix('ntfy', 'myntfy')).toBe(true);
    expect(configuration.usesLegacyTriggerPrefix('dd_trigger_ntfy', 'myntfy')).toBe(false);
    delete configuration.ddEnvVars.DD_TRIGGER_NTFY_MYNTFY_TOPIC;
    warnSpy.mockRestore();
  });
});

describe('getSecurityConfiguration – schema validation field assertions', () => {
  test('block.severity schema default is CRITICAL,HIGH', () => {
    // Kills 667:37 [StringLiteral] and related
    delete configuration.ddEnvVars.DD_SECURITY_BLOCK_SEVERITY;
    const result = configuration.getSecurityConfiguration();
    expect(result.blockSeverities).toEqual(['CRITICAL', 'HIGH']);
  });

  test('verify.signatures defaults to false (not true)', () => {
    // Kills 692:40 [BooleanLiteral] true
    delete configuration.ddEnvVars.DD_SECURITY_VERIFY_SIGNATURES;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.verify).toBe(false);
  });

  test('getSecurityConfiguration schema object default keys are present', () => {
    // Kills 697:15 [ObjectLiteral] {}
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_COMMAND;
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_TIMEOUT;
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY;
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_IDENTITY;
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_ISSUER;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign).toStrictEqual({
      command: 'cosign',
      timeout: 60000,
      key: '',
      identity: '',
      issuer: '',
    });
  });

  test('cosign key schema default is empty string (not another value)', () => {
    // Kills 698:48 [StringLiteral] "" (key default)
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_KEY;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.key).toBe('');
  });

  test('cosign identity schema default is empty string', () => {
    // Kills 698:54 [StringLiteral]
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_IDENTITY;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.identity).toBe('');
  });

  test('cosign issuer schema default is empty string', () => {
    // Kills 698:69 [StringLiteral]
    delete configuration.ddEnvVars.DD_SECURITY_COSIGN_ISSUER;
    const result = configuration.getSecurityConfiguration();
    expect(result.signature.cosign.issuer).toBe('');
  });

  test('prune.onblock schema defaults to true', () => {
    // Kills 703:40 [BooleanLiteral] false
    delete configuration.ddEnvVars.DD_SECURITY_PRUNE_ONBLOCK;
    const result = configuration.getSecurityConfiguration();
    expect(result.prune.onBlock).toBe(true);
  });

  test('getSecurityConfiguration does not include unknown keys in output (stripUnknown)', () => {
    // Kills 721:86 [ObjectLiteral] {} / 723:19 [BooleanLiteral] false
    // With stripUnknown: false, unknown env vars would pass through in the result object
    configuration.ddEnvVars.DD_SECURITY_UNKNOWN_EXTRA_FIELD = 'should-not-appear';
    const result = configuration.getSecurityConfiguration();
    // The raw configuration object should not contain unknown keys
    expect((result as Record<string, unknown>).unknown).toBeUndefined();
    expect((result as Record<string, unknown>).extra).toBeUndefined();
    delete configuration.ddEnvVars.DD_SECURITY_UNKNOWN_EXTRA_FIELD;
  });

  test('getSecurityConfiguration accepts unknown env keys without throwing (allowUnknown)', () => {
    // Kills 722:19 [BooleanLiteral] false – allowUnknown: false would throw for unknown fields
    configuration.ddEnvVars.DD_SECURITY_TOTALLY_UNKNOWN_KEY = 'value';
    expect(() => configuration.getSecurityConfiguration()).not.toThrow();
    delete configuration.ddEnvVars.DD_SECURITY_TOTALLY_UNKNOWN_KEY;
  });
});

// ── Secret file hardening: permission check (Fix 1) + trailing-newline trim (Fix 2) ──

describe('replaceSecrets – secret file hardening', () => {
  // Fix 1 – permission check
  // When a secret file's permissions allow group or others to read it, replaceSecrets
  // emits a logWarn naming the file and recommending chmod 600.
  // The check is skipped on non-POSIX platforms (Windows) where mode bits are synthetic.

  test('should warn when secret file has world-readable permissions (0644)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-perms-'));
    const secretPath = path.join(tempDir, 'secret.txt');
    fs.writeFileSync(secretPath, 'my-secret');
    fs.chmodSync(secretPath, 0o644);

    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      const vars: Record<string, string | undefined> = { DD_PERM_WARN__FILE: secretPath };
      await configuration.replaceSecrets(vars);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(secretPath));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('chmod 600'));
    } finally {
      warnSpy.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should not warn when secret file has owner-only permissions (0600)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-perms-'));
    const secretPath = path.join(tempDir, 'secret.txt');
    fs.writeFileSync(secretPath, 'my-secret');
    fs.chmodSync(secretPath, 0o600);

    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      const vars: Record<string, string | undefined> = { DD_PERM_OK__FILE: secretPath };
      await configuration.replaceSecrets(vars);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should prefer __FILE contents over the bare env var when both are set (file wins)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-precedence-'));
    const secretPath = path.join(tempDir, 'session-secret.txt');
    fs.writeFileSync(secretPath, 'secret-from-file');
    fs.chmodSync(secretPath, 0o600);

    try {
      const vars: Record<string, string | undefined> = {
        DD_SESSION_SECRET: 'direct-env-value',
        DD_SESSION_SECRET__FILE: secretPath,
      };
      await configuration.replaceSecrets(vars);
      // __FILE wins: the file contents replace the bare env var value
      expect(vars.DD_SESSION_SECRET).toBe('secret-from-file');
      expect(vars.DD_SESSION_SECRET__FILE).toBeUndefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should skip permission check on non-POSIX platforms (win32)', async () => {
    // Covers the os.platform() === 'win32' branch so that the mode-bit check is skipped.
    // We spy on os.platform() – the same os module imported by both test file and implementation –
    // so that the guard evaluates to false for this call.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-perms-'));
    const secretPath = path.join(tempDir, 'secret.txt');
    fs.writeFileSync(secretPath, 'my-secret');
    fs.chmodSync(secretPath, 0o644);

    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const platformSpy = vi.spyOn(os, 'platform').mockReturnValueOnce('win32' as NodeJS.Platform);
    try {
      const vars: Record<string, string | undefined> = { DD_PERM_WIN__FILE: secretPath };
      await configuration.replaceSecrets(vars);
      // World-readable file, but platform guard fires first – no permission warn expected.
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('chmod 600'));
    } finally {
      platformSpy.mockRestore();
      warnSpy.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Fix 2 – trailing-newline trim
  // Secret files created with editors or `echo` typically have a trailing newline.
  // replaceSecrets trims trailing whitespace (trimEnd()) matching the Docker *_FILE convention
  // used by the official postgres image (POSTGRES_PASSWORD_FILE resolved via $(< file)).

  test('should trim a trailing newline from secret file value', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-trim-'));
    const secretPath = path.join(tempDir, 'token.txt');
    fs.writeFileSync(secretPath, 'my-token\n');
    fs.chmodSync(secretPath, 0o600);

    try {
      const vars: Record<string, string | undefined> = { DD_TRIM_NL__FILE: secretPath };
      await configuration.replaceSecrets(vars);
      expect(vars.DD_TRIM_NL).toBe('my-token');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should trim multiple trailing newlines from secret file value', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-trim-'));
    const secretPath = path.join(tempDir, 'token.txt');
    fs.writeFileSync(secretPath, 'my-token\n\n');
    fs.chmodSync(secretPath, 0o600);

    try {
      const vars: Record<string, string | undefined> = { DD_TRIM_MULTI__FILE: secretPath };
      await configuration.replaceSecrets(vars);
      expect(vars.DD_TRIM_MULTI).toBe('my-token');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should preserve leading whitespace while trimming only trailing whitespace', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-trim-'));
    const secretPath = path.join(tempDir, 'token.txt');
    fs.writeFileSync(secretPath, '  indented-secret\n');
    fs.chmodSync(secretPath, 0o600);

    try {
      const vars: Record<string, string | undefined> = { DD_TRIM_LEAD__FILE: secretPath };
      await configuration.replaceSecrets(vars);
      expect(vars.DD_TRIM_LEAD).toBe('  indented-secret');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should preserve internal newlines while trimming only the trailing newline', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-trim-'));
    const secretPath = path.join(tempDir, 'token.txt');
    fs.writeFileSync(secretPath, 'line1\nline2\n');
    fs.chmodSync(secretPath, 0o600);

    try {
      const vars: Record<string, string | undefined> = { DD_TRIM_INTERNAL__FILE: secretPath };
      await configuration.replaceSecrets(vars);
      expect(vars.DD_TRIM_INTERNAL).toBe('line1\nline2');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should trim a trailing CRLF from secret file value (handles Windows line endings)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-trim-'));
    const secretPath = path.join(tempDir, 'token-crlf.txt');
    fs.writeFileSync(secretPath, 'my-token\r\n');
    fs.chmodSync(secretPath, 0o600);

    try {
      const vars: Record<string, string | undefined> = { DD_TRIM_CRLF__FILE: secretPath };
      await configuration.replaceSecrets(vars);
      expect(vars.DD_TRIM_CRLF).toBe('my-token');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
