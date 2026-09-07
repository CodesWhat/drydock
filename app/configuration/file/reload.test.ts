import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ComponentReconcileResult } from '../../registry/index.js';
import { getUpdateLockSnapshot, withContainerUpdateLocks } from '../../updates/update-locks.js';
import { configFileSources, ddEnvVars } from '../index.js';
import { getConfigFileInfo, getConfigFileLayer, resetConfigFileLayer } from './layer.js';

const mockReconcile = vi.hoisted(() => vi.fn());
vi.mock('../../registry/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../registry/index.js')>();
  return { ...actual, reconcileComponentsWithConfiguration: mockReconcile };
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockReconcile.mockResolvedValue(defaultReconcileResult());
    ddEnvVarsSnapshot = { ...ddEnvVars };
    configFileSourcesSnapshot = { ...configFileSources };
    originalConfigFileEnv = process.env.DD_CONFIG_FILE;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-reload-test-'));
    configPath = path.join(tempDir, 'drydock.yml');
    process.env.DD_CONFIG_FILE = configPath;
  });

  afterEach(() => {
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

  test('refuses the whole reload when the file itself fails to load', async () => {
    writeConfig('not: [valid, yaml,\n');

    const result = await reloadConfiguration();

    expect(result.applied).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].envKey).toBe('DD_CONFIG_FILE');
    expect(result.reconcile).toBeUndefined();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

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
});
