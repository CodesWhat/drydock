import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setWarnLogger } from '../../log/warn.js';
import type { ComponentReconcileResult } from '../../registry/index.js';
import { getUpdateLockSnapshot, withContainerUpdateLocks } from '../../updates/update-locks.js';
import { configFileInterpolatedKeys, configFileSources, ddEnvVars } from '../index.js';
import { getConfigFileInfo, getConfigFileLayer, resetConfigFileLayer } from './layer.js';

const mockReconcile = vi.hoisted(() => vi.fn());
const mockGetState = vi.hoisted(() => vi.fn(() => ({ trigger: {} }) as never));
vi.mock('../../registry/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../registry/index.js')>();
  return { ...actual, reconcileComponentsWithConfiguration: mockReconcile, getState: mockGetState };
});

const mockGetNotificationRules = vi.hoisted(() => vi.fn(() => [] as never[]));
vi.mock('../../store/notification.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/notification.js')>();
  return { ...actual, getNotificationRules: mockGetNotificationRules };
});

const mockWithContainerUpdateLocks = vi.hoisted(() =>
  vi.fn(
    async (
      keys: readonly string[],
      fn: () => Promise<unknown>,
      options?: Record<string, unknown>,
    ) => {
      const real = await vi.importActual<typeof import('../../updates/update-locks.js')>(
        '../../updates/update-locks.js',
      );
      return real.withContainerUpdateLocks(keys, fn, options as never);
    },
  ),
);
vi.mock('../../updates/update-locks.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../updates/update-locks.js')>();
  return { ...actual, withContainerUpdateLocks: mockWithContainerUpdateLocks };
});

const { reloadConfiguration } = await import('./reload.js');

function defaultReconcileResult(): ComponentReconcileResult {
  return { added: [], changed: [], removed: [], unchanged: [], errors: [] };
}

describe('reloadConfiguration', () => {
  let ddEnvVarsSnapshot: Record<string, string | undefined>;
  let configFileSourcesSnapshot: Record<string, string>;
  let originalConfigFileEnv: string | undefined;
  let tempDir: string;
  let configPath: string;
  let interpolatedSnapshot: Set<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReconcile.mockResolvedValue(defaultReconcileResult());
    ddEnvVarsSnapshot = { ...ddEnvVars };
    configFileSourcesSnapshot = { ...configFileSources };
    interpolatedSnapshot = new Set(configFileInterpolatedKeys);
    originalConfigFileEnv = process.env.DD_CONFIG_FILE;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-reload-test-'));
    configPath = path.join(tempDir, 'drydock.yml');
    process.env.DD_CONFIG_FILE = configPath;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    configFileInterpolatedKeys.clear();
    for (const key of interpolatedSnapshot) configFileInterpolatedKeys.add(key);
    for (const key of Object.keys(ddEnvVars)) {
      delete ddEnvVars[key];
    }
    Object.assign(ddEnvVars, ddEnvVarsSnapshot);
    for (const key of Object.keys(configFileSources)) {
      delete configFileSources[key];
    }
    Object.assign(configFileSources, configFileSourcesSnapshot);
    if (originalConfigFileEnv === undefined) {
      delete process.env.DD_CONFIG_FILE;
    } else {
      process.env.DD_CONFIG_FILE = originalConfigFileEnv;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigFileLayer();
  });

  function writeConfig(yamlContents: string): void {
    fs.writeFileSync(configPath, yamlContents, 'utf-8');
    fs.chmodSync(configPath, 0o600);
  }

  test('refuses the whole reload and touches nothing when the new file fails validation', async () => {
    writeConfig('security:\n  scanner: bogus\n');

    const result = await reloadConfiguration();

    expect(result.applied).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].envKey).toBe('DD_SECURITY_SCANNER');
    expect(result.reconcile).toBeUndefined();
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(ddEnvVars.DD_SECURITY_SCANNER).toBeUndefined();
    expect(getConfigFileLayer()).toStrictEqual({});
  });

  test('resolves secret-file values before Joi and applies the resolved key rather than the file marker', async () => {
    const credentialPath = path.join(tempDir, 'webhook');
    fs.writeFileSync(credentialPath, 'https://discord.example/private\n', { mode: 0o600 });
    writeConfig(
      `notification:\n  discord:\n    private:\n      url:\n        _file: ${credentialPath}\n`,
    );
    const result = await reloadConfiguration();
    expect(result.applied).toBe(true);
    expect(result.errors).toEqual([]);
    expect(ddEnvVars.DD_NOTIFICATION_DISCORD_PRIVATE_URL).toBe('https://discord.example/private');
    expect(ddEnvVars.DD_NOTIFICATION_DISCORD_PRIVATE_URL__FILE).toBeUndefined();
    expect(result.diff.changed).toContain('DD_NOTIFICATION_DISCORD_PRIVATE_URL');
    expect(configFileSources.DD_NOTIFICATION_DISCORD_PRIVATE_URL).toBe('file');
  });

  test('refuses the whole reload when the file itself fails to load', async () => {
    writeConfig('not: [valid, yaml,\n');

    const result = await reloadConfiguration();

    expect(result.applied).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].envKey).toBe('DD_CONFIG_FILE');
    expect(result.reconcile).toBeUndefined();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  test('updates secret reference ownership even when bytes stay identical, then removes it', async () => {
    const key = 'DD_NOTIFICATION_DISCORD_PRIVATE_URL';
    const marker = `${key}__FILE`;
    const credentialPath = path.join(tempDir, 'webhook');
    const value = 'https://discord.example/private';
    fs.writeFileSync(credentialPath, value, { mode: 0o600 });
    ddEnvVars[key] = value;
    configFileSources[marker] = 'file';
    writeConfig(
      `notification:\n  discord:\n    private:\n      url:\n        _file: ${credentialPath}\n`,
    );
    expect((await reloadConfiguration()).diff.changed).not.toContain(key);
    expect(configFileSources[key]).toBe('file');
    expect(configFileSources[marker]).toBeUndefined();
    writeConfig(
      `notification:\n  discord:\n    private:\n      url:\n        _file: \${PRIVATE_WEBHOOK_PATH:-${credentialPath}}\n`,
    );
    expect((await reloadConfiguration()).diff.changed).not.toContain(key);
    expect(configFileSources[key]).toBe('env');
    expect(configFileInterpolatedKeys.has(key)).toBe(true);
    writeConfig(
      `notification:\n  discord:\n    private:\n      url:\n        _file: ${credentialPath}\n`,
    );
    expect((await reloadConfiguration()).applied).toBe(true);
    expect(configFileSources[key]).toBe('file');
    expect(configFileInterpolatedKeys.has(key)).toBe(false);
    writeConfig('{}\n');
    expect((await reloadConfiguration()).diff.changed).toContain(key);
    expect(ddEnvVars[key]).toBeUndefined();
    expect(configFileSources[key]).toBeUndefined();
  });

  test.each(['missing', 'unreadable'])(
    'returns a sanitized refusal for a %s secret without changing state',
    async (failure) => {
      const credentialPath = path.join(tempDir, 'private-secret-path');
      if (failure === 'unreadable') {
        fs.writeFileSync(credentialPath, 'private-sentinel', { mode: 0o600 });
        vi.spyOn(fs.promises, 'open').mockRejectedValueOnce(new Error(`EACCES ${credentialPath}`));
      }
      writeConfig(
        `notification:\n  discord:\n    private:\n      url:\n        _file: ${credentialPath}\n`,
      );
      const before = { ...ddEnvVars };
      const result = await reloadConfiguration();
      expect(result).toEqual({
        applied: false,
        errors: [
          {
            path: 'document',
            envKey: 'DD_CONFIG_FILE',
            message: 'Unable to resolve configuration secret files',
          },
        ],
        diff: { changed: [], reload: [], restart: [] },
      });
      expect(ddEnvVars).toEqual(before);
      expect(mockReconcile).not.toHaveBeenCalled();
      expect(getConfigFileLayer()).toEqual({});
    },
  );

  test('applies a changed reloadable key and leaves a simultaneously changed restart-only key unapplied', async () => {
    writeConfig(
      'notification:\n  discord:\n    myhook:\n      url: https://discord.example/hook\n' +
        'server:\n  port: 4000\n',
    );

    const result = await reloadConfiguration();

    expect(result.applied).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.diff.reload).toContain('notification');
    expect(result.diff.restart).toContain('server');
    expect(ddEnvVars.DD_NOTIFICATION_DISCORD_MYHOOK_URL).toBe('https://discord.example/hook');
    expect(ddEnvVars.DD_SERVER_PORT).toBeUndefined();
    expect(configFileSources.DD_SERVER_PORT).toBeUndefined();
  });

  test('reconciles registered components after a successful reload and surfaces the result', async () => {
    writeConfig('watcher:\n  remote:\n    host: example.invalid\n    port: 2375\n');
    const reconcileResult: ComponentReconcileResult = {
      added: ['watcher:docker.remote'],
      changed: [],
      removed: [],
      unchanged: [],
      errors: [],
    };
    mockReconcile.mockResolvedValueOnce(reconcileResult);

    const result = await reloadConfiguration();

    expect(result.applied).toBe(true);
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(result.reconcile).toBe(reconcileResult);
  });

  test('publishes the file layer and file info only after a successful reload', async () => {
    writeConfig(
      'notification:\n  discord:\n    myhook:\n      url: https://discord.example/hook\n',
    );

    expect(getConfigFileInfo()).toBeUndefined();

    await reloadConfiguration();

    expect(getConfigFileLayer().DD_NOTIFICATION_DISCORD_MYHOOK_URL).toBe(
      'https://discord.example/hook',
    );
    expect(getConfigFileInfo()?.path).toBe(configPath);
  });

  test('runs the whole sequence inside an exclusive, no-per-container-lock update-lock pass', async () => {
    writeConfig(
      'notification:\n  discord:\n    myhook:\n      url: https://discord.example/hook\n',
    );

    await reloadConfiguration();

    expect(mockWithContainerUpdateLocks).toHaveBeenCalledWith(
      [],
      expect.any(Function),
      expect.objectContaining({ exclusive: true, skipUpdateLocks: true }),
    );
  });

  test('serializes behind a concurrent exclusive update-lock holder rather than interleaving', async () => {
    writeConfig(
      'notification:\n  discord:\n    myhook:\n      url: https://discord.example/hook\n',
    );
    const callOrder: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstHolderStarted = new Promise<void>((resolveStarted) => {
      // Take the real gate exclusively first, exactly like a self-update
      // would, and hold it open until the test releases it.
      void withContainerUpdateLocks(
        [],
        () =>
          new Promise<void>((resolveHeld) => {
            callOrder.push('first-start');
            resolveStarted();
            releaseFirst = () => {
              callOrder.push('first-end');
              resolveHeld();
            };
          }),
        { exclusive: true },
      );
    });
    await firstHolderStarted;

    expect(getUpdateLockSnapshot().lifecycle?.exclusiveActive).toBe(true);

    const reloadPromise = reloadConfiguration().then((result) => {
      callOrder.push('reload-end');
      return result;
    });

    // The reload has to be queued, not running, while the first holder is
    // still active — give the microtask queue a turn and confirm it hasn't
    // jumped ahead.
    await Promise.resolve();
    await Promise.resolve();
    expect(callOrder).toEqual(['first-start']);

    releaseFirst?.();
    const result = await reloadPromise;

    expect(callOrder).toEqual(['first-start', 'first-end', 'reload-end']);
    expect(result.applied).toBe(true);
  });

  describe('interpolated file keys (decision D1, regression for a reload never seeing them change or get removed)', () => {
    const ENV_KEY_A = 'DD_TEST_RELOAD_INTERPOLATE_A';
    const ENV_KEY_B = 'DD_TEST_RELOAD_INTERPOLATE_B';

    afterEach(() => {
      delete process.env[ENV_KEY_A];
      delete process.env[ENV_KEY_B];
      configFileInterpolatedKeys.delete('DD_NOTIFICATION_DISCORD_MYHOOK_URL');
    });

    test('an interpolated reloadable key whose file reference changes to a different env var produces a reload delta with the new resolved value', async () => {
      process.env[ENV_KEY_A] = 'https://a.example/hook';
      process.env[ENV_KEY_B] = 'https://b.example/hook';
      writeConfig(`notification:\n  discord:\n    myhook:\n      url: \${${ENV_KEY_A}}\n`);

      const first = await reloadConfiguration();
      expect(first.applied).toBe(true);
      expect(ddEnvVars.DD_NOTIFICATION_DISCORD_MYHOOK_URL).toBe('https://a.example/hook');
      expect(configFileSources.DD_NOTIFICATION_DISCORD_MYHOOK_URL).toBe('env');
      expect(configFileInterpolatedKeys.has('DD_NOTIFICATION_DISCORD_MYHOOK_URL')).toBe(true);

      writeConfig(`notification:\n  discord:\n    myhook:\n      url: \${${ENV_KEY_B}}\n`);
      const second = await reloadConfiguration();

      expect(second.applied).toBe(true);
      expect(second.diff.changed).toContain('DD_NOTIFICATION_DISCORD_MYHOOK_URL');
      expect(second.diff.reload).toContain('notification');
      expect(ddEnvVars.DD_NOTIFICATION_DISCORD_MYHOOK_URL).toBe('https://b.example/hook');
      expect(configFileInterpolatedKeys.has('DD_NOTIFICATION_DISCORD_MYHOOK_URL')).toBe(true);
    });

    test('an interpolated reloadable key removed from the file is removed from the applied delta', async () => {
      process.env[ENV_KEY_A] = 'https://a.example/hook';
      writeConfig(`notification:\n  discord:\n    myhook:\n      url: \${${ENV_KEY_A}}\n`);

      const first = await reloadConfiguration();
      expect(first.applied).toBe(true);
      expect(ddEnvVars.DD_NOTIFICATION_DISCORD_MYHOOK_URL).toBe('https://a.example/hook');
      expect(configFileInterpolatedKeys.has('DD_NOTIFICATION_DISCORD_MYHOOK_URL')).toBe(true);

      writeConfig('notification:\n  discord: {}\n');
      const second = await reloadConfiguration();

      expect(second.applied).toBe(true);
      expect(second.diff.changed).toContain('DD_NOTIFICATION_DISCORD_MYHOOK_URL');
      expect(second.diff.reload).toContain('notification');
      expect(ddEnvVars.DD_NOTIFICATION_DISCORD_MYHOOK_URL).toBeUndefined();
      expect(configFileSources.DD_NOTIFICATION_DISCORD_MYHOOK_URL).toBeUndefined();
      expect(configFileInterpolatedKeys.has('DD_NOTIFICATION_DISCORD_MYHOOK_URL')).toBe(false);
    });
  });

  describe('orphaned notification rule reporting', () => {
    let warnMessages: string[];

    beforeEach(() => {
      warnMessages = [];
      setWarnLogger({ warn: (message) => warnMessages.push(message) });
    });

    afterEach(() => {
      setWarnLogger({ warn: () => {}, error: () => {} });
    });

    test('reports and logs a rule pointing at a trigger this reload removed', async () => {
      mockGetState.mockReturnValue({ trigger: {} });
      mockGetNotificationRules.mockReturnValue([
        { id: 'update-available', triggers: ['slack.ops'] },
      ]);
      writeConfig(
        'notification:\n  discord:\n    myhook:\n      url: https://discord.example/hook\n',
      );

      const result = await reloadConfiguration();

      expect(result.applied).toBe(true);
      expect(result.orphanedRules).toEqual([
        { ruleId: 'update-available', triggerId: 'slack.ops' },
      ]);
      expect(warnMessages).toHaveLength(1);
      expect(warnMessages[0]).toContain('update-available');
      expect(warnMessages[0]).toContain('slack.ops');
    });

    test('reports a rule pointing at a trigger this reload renamed', async () => {
      mockGetState.mockReturnValue({ trigger: { 'slack.new-ops': { type: 'slack' } } });
      mockGetNotificationRules.mockReturnValue([
        { id: 'update-available', triggers: ['slack.old-ops'] },
      ]);
      writeConfig(
        'notification:\n  discord:\n    myhook:\n      url: https://discord.example/hook\n',
      );

      const result = await reloadConfiguration();

      expect(result.orphanedRules).toEqual([
        { ruleId: 'update-available', triggerId: 'slack.old-ops' },
      ]);
    });

    test('reports no orphans when every rule reference still resolves', async () => {
      mockGetState.mockReturnValue({ trigger: { 'slack.ops': { type: 'slack' } } });
      mockGetNotificationRules.mockReturnValue([
        { id: 'update-available', triggers: ['slack.ops'] },
      ]);
      writeConfig(
        'notification:\n  discord:\n    myhook:\n      url: https://discord.example/hook\n',
      );

      const result = await reloadConfiguration();

      expect(result.orphanedRules).toEqual([]);
      expect(warnMessages).toEqual([]);
    });

    test('omits orphanedRules when the reload is refused', async () => {
      writeConfig('security:\n  scanner: bogus\n');

      const result = await reloadConfiguration();

      expect(result.applied).toBe(false);
      expect(result.orphanedRules).toBeUndefined();
    });
  });
});
