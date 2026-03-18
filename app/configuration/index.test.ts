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

test('getVersion should return dd version', async () => {
  configuration.ddEnvVars.DD_VERSION = 'x.y.z';
  expect(configuration.getVersion()).toStrictEqual('x.y.z');
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

test('should include additional legacy env count in warning suffix when more than 10 WUD vars are present', async () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const legacyKeys = Array.from({ length: 12 }, (_, index) => `WUD_LEGACY_${index}`);
  const previousValues = new Map<string, string | undefined>();
  for (const key of legacyKeys) {
    previousValues.set(key, process.env[key]);
    process.env[key] = '1';
  }

  try {
    vi.resetModules();
    await import('./index.js');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('(+2 more)'));
  } finally {
    for (const key of legacyKeys) {
      const previousValue = previousValues.get(key);
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
    warnSpy.mockRestore();
  }
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
    },
    port: 3000,
    session: {},
    tls: {},
    trustproxy: false,
    ui: {},
  });
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
      blockSeverities: ['CRITICAL', 'HIGH'],
      trivy: {
        server: '',
        command: 'trivy',
        timeout: 120000,
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
      },
      scan: {
        cron: '',
        jitter: 60000,
        concurrency: 4,
        batchTimeout: 1800000,
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
      blockSeverities: ['CRITICAL', 'MEDIUM'],
      trivy: {
        server: 'http://trivy:4954',
        command: '/usr/local/bin/trivy',
        timeout: 60000,
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
      },
      scan: {
        cron: '',
        jitter: 60000,
        concurrency: 8,
        batchTimeout: 900000,
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
});

describe('WUD_ legacy dual-prefix support', () => {
  test('WUD_ env vars should be remapped to DD_ keys in ddEnvVars', () => {
    // Simulate WUD_ var being set at module init time by directly inserting
    configuration.ddEnvVars.DD_TEST_DUAL = 'from-wud';
    expect(configuration.ddEnvVars.DD_TEST_DUAL).toBe('from-wud');
    delete configuration.ddEnvVars.DD_TEST_DUAL;
  });

  test('DD_ prefix should take precedence over WUD_ when both present', () => {
    // Set DD_ directly
    configuration.ddEnvVars.DD_LOG_LEVEL = 'warn';
    expect(configuration.getLogLevel()).toBe('warn');
    // Override with a new DD_ value
    configuration.ddEnvVars.DD_LOG_LEVEL = 'error';
    expect(configuration.getLogLevel()).toBe('error');
    delete configuration.ddEnvVars.DD_LOG_LEVEL;
  });

  test('get() should work with remapped WUD_ vars', () => {
    configuration.ddEnvVars.DD_WATCHER_DUALTEST_HOST = 'example.com';
    const result = configuration.getWatcherConfigurations();
    expect(result.dualtest).toStrictEqual({ host: 'example.com' });
    delete configuration.ddEnvVars.DD_WATCHER_DUALTEST_HOST;
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
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKEN;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCHALL;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_WATCH;
    delete configuration.ddEnvVars.DD_SERVER_WEBHOOK_TOKENS_UPDATE;
  });

  test('should return disabled webhook by default', () => {
    expect(configuration.getWebhookConfiguration()).toStrictEqual({
      enabled: false,
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
      token: 'secret-token',
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

  test('should throw when webhook is enabled without shared or endpoint tokens', () => {
    configuration.ddEnvVars.DD_SERVER_WEBHOOK_ENABLED = 'true';
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

  test('should remap WUD_ vars and let DD_ override them at module init', async () => {
    process.env[WUD_KEY] = 'legacy-value';
    process.env[DD_KEY] = 'new-value';

    vi.resetModules();
    const freshConfiguration = await import('./index.js');

    expect(freshConfiguration.ddEnvVars.DD_TEST_BOOTSTRAP_VAR).toBe('new-value');
  });
});
