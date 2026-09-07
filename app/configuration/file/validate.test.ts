import Component from '../../registry/Component.js';
import * as configurationIndex from '../index.js';
import { validateConfiguration } from './validate.js';

describe('validateConfiguration', () => {
  test('an empty candidate map produces no errors', async () => {
    const result = await validateConfiguration({});
    expect(result.errors).toEqual([]);
  });

  test('accepts the live ddEnvVars object itself as the candidate map (the real validateStartupConfiguration call)', async () => {
    // withCandidateEnv deletes every key off the ddEnvVars singleton before
    // reassigning from the candidate; if candidate is that same object
    // reference (exactly what configuration/index.ts's
    // validateStartupConfiguration passes), deleting the singleton's keys
    // deletes the candidate's keys too, so this must snapshot candidate
    // before touching ddEnvVars. Regression test for that aliasing bug.
    configurationIndex.ddEnvVars.DD_SECURITY_SCANNER = 'bogus';
    try {
      const result = await validateConfiguration(configurationIndex.ddEnvVars);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe('security.scanner');
    } finally {
      delete configurationIndex.ddEnvVars.DD_SECURITY_SCANNER;
    }
  });

  test('restores a pre-existing ddEnvVars key, including one absent from the candidate map', async () => {
    // withCandidateEnv substitutes the whole singleton for the duration of
    // discovery, not just the keys the candidate map happens to name — a
    // real value already in ddEnvVars (e.g. set before the module's own
    // startup validation call) must come back afterward even though this
    // candidate map never mentions it.
    configurationIndex.ddEnvVars.DD_LOG_LEVEL = 'debug';

    await validateConfiguration({ DD_PROMETHEUS_ENABLED: 'true' });

    expect(configurationIndex.ddEnvVars.DD_LOG_LEVEL).toBe('debug');
    delete configurationIndex.ddEnvVars.DD_LOG_LEVEL;
  });

  test('a valid agent entry constructs the static Agent class and produces no errors', async () => {
    const result = await validateConfiguration({
      DD_AGENT_NODE1_HOST: 'http://10.0.0.1:3000',
      DD_AGENT_NODE1_SECRET: 'shared-secret',
    });
    expect(result.errors).toEqual([]);
  });

  test('an invalid agent entry reports the fixed "dd" provider with no provider segment in the path', async () => {
    const result = await validateConfiguration({
      DD_AGENT_NODE1_SECRET: 'shared-secret',
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe('agent.node1.host');
    expect(result.errors[0].envKey).toBe('DD_AGENT_NODE1_HOST');
  });

  test('a provider key with no name segment (a bare string value) is skipped, not treated as an instance', async () => {
    // DD_REGISTRY_GHCR with no further segment leaves configurations.ghcr as
    // the raw string 'sometoken' rather than a nested {name: config} object
    // — collectProviderEntries must skip it rather than iterating its
    // characters as "names".
    const result = await validateConfiguration({ DD_REGISTRY_GHCR: 'sometoken' });
    expect(result.errors).toEqual([]);
  });

  test('a legacy trigger-prefix rejection becomes one error entry instead of aborting validation', async () => {
    const legacyRejection = new Error('legacy trigger prefix rejected (test double)');
    const spy = vi.spyOn(configurationIndex, 'getTriggerConfigurations').mockImplementation(() => {
      throw legacyRejection;
    });

    const result = await validateConfiguration({
      DD_AUTH_BASIC_ADMIN_USER: 'admin',
      DD_AUTH_BASIC_ADMIN_HASH:
        'argon2id$65536$3$4$ZHJ5ZG9jay1yZWdpc3RyeS10ZXN0LXNhbHQ=$YlkF5heeP1TK+kWW7LNnQbI3ws4zeQpVQc3fcw592ObbdIz+n02qdNC5Z1YhzTXJ8FbgaWo61lPGqB8Za5OYwg==',
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual({
      path: 'trigger',
      envKey: 'trigger',
      message: 'legacy trigger prefix rejected (test double)',
    });

    spy.mockRestore();
  });

  test('never calls register() or init() on a discovered component', async () => {
    const initSpy = vi.spyOn(Component.prototype, 'init');
    const registerSpy = vi.spyOn(Component.prototype, 'register');

    await validateConfiguration({
      DD_NOTIFICATION_DISCORD_MYHOOK_URL: 'https://discord.example/hook',
    });

    expect(initSpy).not.toHaveBeenCalled();
    expect(registerSpy).not.toHaveBeenCalled();

    initSpy.mockRestore();
    registerSpy.mockRestore();
  });

  test('runs with no Docker socket available: a watcher entry validates on shape alone', async () => {
    const result = await validateConfiguration({
      DD_WATCHER_LOCAL_SOCKET: '/nonexistent/does-not-exist.sock',
    });
    expect(result.errors).toEqual([]);
  });

  test('a valid discord trigger, ghcr registry (string form) and basic auth produce no errors', async () => {
    const result = await validateConfiguration({
      DD_NOTIFICATION_DISCORD_MYHOOK_URL: 'https://discord.example/hook',
      DD_REGISTRY_GHCR_PRIVATE: 'ghp_sometoken',
      DD_AUTH_BASIC_ADMIN_USER: 'admin',
      DD_AUTH_BASIC_ADMIN_HASH:
        'argon2id$65536$3$4$ZHJ5ZG9jay1yZWdpc3RyeS10ZXN0LXNhbHQ=$YlkF5heeP1TK+kWW7LNnQbI3ws4zeQpVQc3fcw592ObbdIz+n02qdNC5Z1YhzTXJ8FbgaWo61lPGqB8Za5OYwg==',
    });
    expect(result.errors).toEqual([]);
  });

  test('an action-type trigger (docker) uses the "action" top segment, not "notification"', async () => {
    const result = await validateConfiguration({
      DD_ACTION_DOCKER_DEPLOY_PULLTIMEOUT: 'not-a-number',
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe('action.docker.deploy.pulltimeout');
    expect(result.errors[0].envKey).toBe('DD_ACTION_DOCKER_DEPLOY_PULLTIMEOUT');
  });

  test('an unknown trigger provider reports the helpful message with available providers', async () => {
    const result = await validateConfiguration({
      DD_NOTIFICATION_BOGUSPROVIDER_MYHOOK_URL: 'https://example.com/hook',
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      path: 'notification.bogusprovider.myhook',
      envKey: 'DD_NOTIFICATION_BOGUSPROVIDER_MYHOOK',
    });
    expect(result.errors[0].message).toMatch(/Unknown trigger provider: 'bogusprovider'/);
    expect(result.errors[0].message).toMatch(/Available trigger providers:/);
  });

  test('an unknown registry provider names the provider in both the path and the envKey', async () => {
    // Watchers only ever construct the fixed 'docker' provider (see
    // instanceSegments/FIXED_PROVIDER_KINDS), so an "unknown provider" for
    // watcher can only come from constructComponent itself failing, which
    // isn't reachable through the normal env pipeline. Registry is used here
    // instead, which does expose its provider as a path segment.
    const result = await validateConfiguration({
      DD_REGISTRY_NOPE_MYREGISTRY: 'sometoken',
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      path: 'registry.nope.myregistry',
      envKey: 'DD_REGISTRY_NOPE_MYREGISTRY',
    });
    expect(result.errors[0].message).toMatch(/Unknown registry provider: 'nope'/);
  });

  test('a Joi rejection on a component schema carries the Joi message and a field-level YAML path', async () => {
    const result = await validateConfiguration({
      // user is required and declared before hash in Basic's schema, so it
      // is the first (and, under Joi's default abortEarly, only) failure.
      DD_AUTH_BASIC_ADMIN_HASH: 'not-checked-because-user-fails-first',
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe('auth.basic.admin.user');
    expect(result.errors[0].envKey).toBe('DD_AUTH_BASIC_ADMIN_USER');
    expect(result.errors[0].message).toMatch(/"user" is required/);
  });

  test('the auth kind uses the DD_AUTH_ prefix, not DD_AUTHENTICATION_, matching the real env convention', async () => {
    const result = await validateConfiguration({
      DD_AUTH_BASIC_ADMIN_HASH: 'still-missing-user',
    });
    expect(result.errors[0].envKey.startsWith('DD_AUTH_')).toBe(true);
  });

  test('validation runs on the merged map: an env var fixing an invalid file value makes it valid', async () => {
    const invalid = await validateConfiguration({
      DD_AUTH_BASIC_ADMIN_HASH: 'x',
    });
    expect(invalid.errors).toHaveLength(1);

    const fixed = await validateConfiguration({
      DD_AUTH_BASIC_ADMIN_USER: 'admin',
      DD_AUTH_BASIC_ADMIN_HASH:
        'argon2id$65536$3$4$ZHJ5ZG9jay1yZWdpc3RyeS10ZXN0LXNhbHQ=$YlkF5heeP1TK+kWW7LNnQbI3ws4zeQpVQc3fcw592ObbdIz+n02qdNC5Z1YhzTXJ8FbgaWo61lPGqB8Za5OYwg==',
    });
    expect(fixed.errors).toEqual([]);
  });

  describe('section schemas', () => {
    test('server: rejects a bad port', async () => {
      const result = await validateConfiguration({ DD_SERVER_PORT: 'not-a-port' });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe('server.port');
      expect(result.errors[0].envKey).toBe('DD_SERVER_PORT');
    });

    test('prometheus: rejects a non-boolean enabled value', async () => {
      const result = await validateConfiguration({ DD_PROMETHEUS_ENABLED: 'banana' });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe('prometheus.enabled');
      expect(result.errors[0].envKey).toBe('DD_PROMETHEUS_ENABLED');
    });

    test('server.webhook: rejects a non-boolean enabled value (Joi field-level path)', async () => {
      const result = await validateConfiguration({ DD_SERVER_WEBHOOK_ENABLED: 'banana' });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe('server.webhook.enabled');
      expect(result.errors[0].envKey).toBe('DD_SERVER_WEBHOOK_ENABLED');
    });

    test('server.webhook: a cross-field custom Error (not Joi) falls back to the section root path', async () => {
      const result = await validateConfiguration({ DD_SERVER_WEBHOOK_ENABLED: 'true' });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe('server.webhook');
      expect(result.errors[0].envKey).toBe('DD_SERVER_WEBHOOK');
      expect(result.errors[0].message).toMatch(/At least one webhook auth mechanism/);
    });

    test('security: rejects an unknown scanner value', async () => {
      const result = await validateConfiguration({ DD_SECURITY_SCANNER: 'bogus' });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe('security.scanner');
      expect(result.errors[0].envKey).toBe('DD_SECURITY_SCANNER');
    });

    // maturity.sweep's only field (cron) is `joi.string().allow('')` with no
    // further constraint, and every value the env pipeline can hand it is
    // already a string (get() only ever produces strings from DD_* env
    // vars), so no candidate map can make this schema reject. Documented
    // here rather than silently skipped; see the final report's "spec vs
    // reality" note.
    test('maturity.sweep: the schema accepts any string, so it never rejects through the env pipeline', async () => {
      const result = await validateConfiguration({ DD_MATURITY_SWEEP_CRON: 'not-really-a-cron' });
      expect(result.errors).toEqual([]);
    });
  });
});
