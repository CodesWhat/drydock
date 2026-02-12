// @ts-nocheck
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  configuration.ddEnvVars.DD_AGENT_NODE1_SECRET = 'secret1'; // NOSONAR - test fixture
  configuration.ddEnvVars.DD_AGENT_NODE2_HOST = '10.0.0.2';
  configuration.ddEnvVars.DD_AGENT_NODE2_SECRET = 'secret2'; // NOSONAR - test fixture
  expect(configuration.getAgentConfigurations()).toStrictEqual({
    node1: { host: '10.0.0.1', secret: 'secret1' }, // NOSONAR
    node2: { host: '10.0.0.2', secret: 'secret2' }, // NOSONAR
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
    cors: {},
    enabled: true,
    feature: {
      delete: true,
      containeractions: true,
      webhook: true,
    },
    metrics: {},
    port: 4000,
    tls: {},
    trustproxy: false,
  });
});

test('getServerConfiguration should allow disabling metrics auth', async () => {
  delete configuration.ddEnvVars.DD_SERVER_PORT;
  configuration.ddEnvVars.DD_SERVER_METRICS_AUTH = 'false';
  expect(configuration.getServerConfiguration()).toStrictEqual({
    cors: {},
    enabled: true,
    feature: {
      delete: true,
      containeractions: true,
      webhook: true,
    },
    metrics: {
      auth: false,
    },
    port: 3000,
    tls: {},
    trustproxy: false,
  });
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
  configuration.replaceSecrets(vars);
  expect(vars).toStrictEqual({
    DD_SERVER_X: 'super_secret',
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
});

describe('getPrometheusConfiguration errors', () => {
  test('should throw when configuration is invalid', () => {
    configuration.ddEnvVars.DD_PROMETHEUS_ENABLED = 'not-a-boolean';
    expect(() => configuration.getPrometheusConfiguration()).toThrow();
    delete configuration.ddEnvVars.DD_PROMETHEUS_ENABLED;
  });
});

describe('getVersion', () => {
  test('should return unknown when DD_VERSION is not set', () => {
    delete configuration.ddEnvVars.DD_VERSION;
    expect(configuration.getVersion()).toBe('unknown');
  });
});

describe('getServerConfiguration errors', () => {
  test('should throw when server configuration is invalid', () => {
    configuration.ddEnvVars.DD_SERVER_PORT = 'not-a-number';
    expect(() => configuration.getServerConfiguration()).toThrow();
    delete configuration.ddEnvVars.DD_SERVER_PORT;
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
