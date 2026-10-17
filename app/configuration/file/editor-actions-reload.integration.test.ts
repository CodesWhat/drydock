import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Component from '../../registry/Component.js';
import { getState, testable_deregisterComponent } from '../../registry/index.js';
import Command from '../../triggers/providers/command/Command.js';
import { withContainerUpdateLocks } from '../../updates/update-locks.js';
import { configFileInterpolatedKeys, configFileSources, ddEnvVars } from '../index.js';
import { getActionEditSnapshot, writeActionEdits } from './editor.js';
import { resetConfigFileLayer } from './layer.js';
import { reloadConfiguration } from './reload.js';

const { execFile } = vi.hoisted(() => ({
  execFile: vi.fn(() => {
    throw new Error('Action execution is forbidden');
  }),
}));
vi.mock('node:child_process', () => ({ execFile }));
vi.mock('../../store/notification.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/notification.js')>()),
  getNotificationRules: () => [],
}));
vi.mock('../../registry/component-resolution.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../registry/component-resolution.js')>();
  return {
    ...actual,
    constructComponent: async (...args: Parameters<typeof actual.constructComponent>) => {
      const component = await actual.constructComponent(...args);
      // Keep real provider schemas; only prevent unrelated registry network startup.
      if (args[0] === 'registry' && component instanceof Component)
        vi.spyOn(component, 'init').mockResolvedValue(undefined);
      return component;
    },
  };
});

test('action save waits for the update lifecycle and replaces the real instance without dispatch', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-action-reload-'));
  const configPath = path.join(directory, 'drydock.yml');
  const previous = { ...ddEnvVars };
  const sources = { ...configFileSources };
  const interpolated = new Set(configFileInterpolatedKeys);
  let releaseUpdate = () => {};
  let activeUpdate: Promise<unknown> | undefined;
  let saving: ReturnType<typeof writeActionEdits> | undefined;
  try {
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    ddEnvVars.DD_LOCAL_WATCHER = 'false';
    vi.stubEnv('DD_CONFIG_FILE', configPath);
    vi.stubEnv('DD_LOCAL_WATCHER', 'false');
    fs.writeFileSync(
      configPath,
      'action:\n  command:\n    private:\n      cmd: never-execute-this\n      auto: none\n      order: 100\n      concurrency: 1\n',
      { mode: 0o600 },
    );
    const initial = await reloadConfiguration();
    expect(initial).toMatchObject({ applied: true, errors: [], reconcile: { errors: [] } });
    const original = getState().trigger['command.private'];
    expect(original).toBeInstanceOf(Command);
    const teardown = vi.spyOn(original, 'deregisterComponent');
    const snapshot = await getActionEditSnapshot();
    const held = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    let entered = () => {};
    const entry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    activeUpdate = withContainerUpdateLocks(['action-editor-fixture'], async () => {
      entered();
      await held;
    });
    await entry;
    saving = writeActionEdits({
      revision: snapshot.revision,
      changes: [
        { path: ['action', 'command', 'private', 'auto'], operation: 'set', value: true },
        { path: ['action', 'command', 'private', 'order'], operation: 'set', value: -2.5 },
        { path: ['action', 'command', 'private', 'concurrency'], operation: 'set', value: 3 },
      ],
    });
    await vi.waitFor(() => expect(fs.readFileSync(configPath, 'utf8')).toContain('concurrency: 3'));
    expect(getState().trigger['command.private']).toBe(original);
    expect(teardown).not.toHaveBeenCalled();
    releaseUpdate();
    await activeUpdate;
    const result = await saving;
    expect(result).toMatchObject({
      saved: true,
      applied: true,
      errors: [],
      reload: { reconcile: { changed: 1, errors: 0 } },
    });
    const replacement = getState().trigger['command.private'];
    expect(replacement).toBeInstanceOf(Command);
    expect(replacement).not.toBe(original);
    expect(replacement.configuration).toMatchObject({
      auto: 'all',
      order: -2.5,
      concurrency: 3,
      cmd: 'never-execute-this',
    });
    expect(teardown).toHaveBeenCalledExactlyOnceWith();
    expect(execFile).not.toHaveBeenCalled();
  } finally {
    releaseUpdate();
    await activeUpdate;
    await saving;
    const kinds = ['registry', 'trigger', 'watcher', 'authentication', 'agent'] as const;
    await Promise.allSettled(
      kinds.flatMap((kind) =>
        Object.values(getState()[kind]).map((component) =>
          testable_deregisterComponent(component, kind),
        ),
      ),
    );
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    Object.assign(ddEnvVars, previous);
    for (const key of Object.keys(configFileSources)) delete configFileSources[key];
    Object.assign(configFileSources, sources);
    configFileInterpolatedKeys.clear();
    for (const key of interpolated) configFileInterpolatedKeys.add(key);
    resetConfigFileLayer();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
