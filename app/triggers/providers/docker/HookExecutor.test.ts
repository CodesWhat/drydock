import { describe, expect, test, vi } from 'vitest';
import HookExecutor from './HookExecutor.js';

function createLogger() {
  return {
    child: vi.fn().mockReturnValue({}),
  };
}

function createContainer(overrides = {}) {
  return {
    name: 'web',
    id: 'container-id',
    image: {
      name: 'ghcr.io/acme/web',
      tag: {
        value: '1.0.0',
      },
    },
    updateKind: {
      kind: 'tag',
      localValue: '1.0.0',
      remoteValue: '1.0.1',
    },
    labels: {},
    ...overrides,
  };
}

function createExecutor(overrides = {}) {
  return new HookExecutor({
    runHook: vi.fn(),
    getPreferredLabelValue: (labels, ddKey, wudKey) => labels?.[ddKey] ?? labels?.[wudKey],
    getLogger: createLogger,
    recordHookAudit: vi.fn(),
    ...overrides,
  });
}

describe('HookExecutor', () => {
  test('constructor should provide default logger and audit recorder when omitted', () => {
    const runHook = vi.fn();
    const executor = new HookExecutor({
      runHook,
      getPreferredLabelValue: () => undefined,
    });

    const config = executor.buildHookConfig(createContainer());
    expect(config.hookTimeout).toBe(60000);
    expect(() => executor.recordHookAudit('event', {}, 'success', 'ok')).not.toThrow();
  });

  test('buildHookConfig should read labels and apply defaults', () => {
    const executor = createExecutor();

    const defaultConfig = executor.buildHookConfig(createContainer());
    expect(defaultConfig).toEqual({
      hookPre: undefined,
      hookPost: undefined,
      hookPreAbort: true,
      hookTimeout: 60000,
      hookEnv: {
        DD_CONTAINER_NAME: 'web',
        DD_CONTAINER_ID: 'container-id',
        DD_IMAGE_NAME: 'ghcr.io/acme/web',
        DD_IMAGE_TAG: '1.0.0',
        DD_UPDATE_KIND: 'tag',
        DD_UPDATE_FROM: '1.0.0',
        DD_UPDATE_TO: '1.0.1',
      },
    });

    const withLabels = executor.buildHookConfig(
      createContainer({
        updateKind: {
          kind: 'digest',
          localValue: null,
          remoteValue: undefined,
        },
        labels: {
          'dd.hook.pre': 'echo pre',
          'wud.hook.post': 'echo post',
          'dd.hook.pre.abort': 'FALSE',
          'wud.hook.timeout': '120000',
        },
      }),
    );

    expect(withLabels.hookPre).toBe('echo pre');
    expect(withLabels.hookPost).toBe('echo post');
    expect(withLabels.hookPreAbort).toBe(false);
    expect(withLabels.hookTimeout).toBe(120000);
    expect(withLabels.hookEnv.DD_UPDATE_FROM).toBe('');
    expect(withLabels.hookEnv.DD_UPDATE_TO).toBe('');
  });

  test('isHookFailure and getHookFailureDetails should handle exit code and timeout failures', () => {
    const executor = createExecutor();

    expect(executor.isHookFailure({ exitCode: 0, timedOut: false })).toBe(false);
    expect(executor.isHookFailure({ exitCode: 1, timedOut: false })).toBe(true);
    expect(executor.isHookFailure({ exitCode: 0, timedOut: true })).toBe(true);

    expect(
      executor.getHookFailureDetails(
        'Pre-update',
        { timedOut: true, stderr: '', exitCode: 0 },
        5000,
      ),
    ).toBe('Pre-update hook timed out after 5000ms');
    expect(
      executor.getHookFailureDetails(
        'Post-update',
        { timedOut: false, stderr: 'permission denied', exitCode: 127 },
        5000,
      ),
    ).toBe('Post-update hook exited with code 127: permission denied');
  });

  test('runPreUpdateHook should skip execution when no pre hook is configured', async () => {
    const runHook = vi.fn();
    const executor = createExecutor({ runHook });

    await executor.runPreUpdateHook(
      createContainer(),
      {
        hookPre: '',
        hookPreAbort: true,
        hookTimeout: 1000,
        hookEnv: {},
      },
      {
        warn: vi.fn(),
      },
    );

    expect(runHook).not.toHaveBeenCalled();
  });

  test('runPreUpdateHook should execute hook and record success audit', async () => {
    const runHook = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'completed',
      stderr: '',
      timedOut: false,
    });
    const recordHookAudit = vi.fn();
    const executor = createExecutor({ runHook, recordHookAudit });

    const container = createContainer();
    await executor.runPreUpdateHook(
      container,
      {
        hookPre: 'echo pre',
        hookPreAbort: true,
        hookTimeout: 3000,
        hookEnv: { SAMPLE: 'true' },
      },
      {
        warn: vi.fn(),
      },
    );

    expect(runHook).toHaveBeenCalledWith('echo pre', {
      timeout: 3000,
      env: { SAMPLE: 'true' },
      label: 'pre-update',
    });
    expect(recordHookAudit).toHaveBeenCalledWith(
      'hook-pre-success',
      container,
      'success',
      'Pre-update hook completed: completed',
    );
  });

  test('runPreUpdateHook should throw when pre hook fails and abort is enabled', async () => {
    const runHook = vi.fn().mockResolvedValue({
      exitCode: 2,
      stdout: '',
      stderr: 'syntax error',
      timedOut: false,
    });
    const recordHookAudit = vi.fn();
    const warn = vi.fn();
    const executor = createExecutor({ runHook, recordHookAudit });

    const container = createContainer();
    await expect(
      executor.runPreUpdateHook(
        container,
        {
          hookPre: 'exit 2',
          hookPreAbort: true,
          hookTimeout: 1000,
          hookEnv: {},
        },
        { warn },
      ),
    ).rejects.toThrow('Pre-update hook exited with code 2: syntax error');

    expect(recordHookAudit).toHaveBeenCalledWith(
      'hook-pre-failed',
      container,
      'error',
      'Pre-update hook exited with code 2: syntax error',
    );
    expect(warn).toHaveBeenCalledWith('Pre-update hook exited with code 2: syntax error');
  });

  test('runPreUpdateHook should rethrow non-pipeline errors from hook execution', async () => {
    const runHook = vi.fn().mockRejectedValue(new Error('spawn ENOENT'));
    const recordHookAudit = vi.fn();
    const warn = vi.fn();
    const executor = createExecutor({ runHook, recordHookAudit });

    await expect(
      executor.runPreUpdateHook(
        createContainer(),
        {
          hookPre: 'missing-command',
          hookPreAbort: true,
          hookTimeout: 1000,
          hookEnv: {},
        },
        { warn },
      ),
    ).rejects.toThrow('spawn ENOENT');

    expect(recordHookAudit).not.toHaveBeenCalledWith(
      'hook-pre-failed',
      expect.anything(),
      'error',
      expect.any(String),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  test('runPreUpdateHook should expose a stable error code for aborting failures', async () => {
    const runHook = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'failed',
      timedOut: false,
    });
    const executor = createExecutor({ runHook });

    await expect(
      executor.runPreUpdateHook(
        createContainer(),
        {
          hookPre: 'exit 1',
          hookPreAbort: true,
          hookTimeout: 1000,
          hookEnv: {},
        },
        { warn: vi.fn() },
      ),
    ).rejects.toMatchObject({
      code: 'hook-execution-failed',
    });
  });

  test('runPreUpdateHook should continue when pre hook fails but abort is disabled', async () => {
    const runHook = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: true,
    });
    const recordHookAudit = vi.fn();
    const warn = vi.fn();
    const executor = createExecutor({ runHook, recordHookAudit });

    await expect(
      executor.runPreUpdateHook(
        createContainer(),
        {
          hookPre: 'sleep 10',
          hookPreAbort: false,
          hookTimeout: 250,
          hookEnv: {},
        },
        { warn },
      ),
    ).resolves.toBeUndefined();

    expect(recordHookAudit).toHaveBeenCalledWith(
      'hook-pre-failed',
      expect.anything(),
      'error',
      'Pre-update hook timed out after 250ms',
    );
    expect(warn).toHaveBeenCalledWith('Pre-update hook timed out after 250ms');
  });

  test('runPostUpdateHook should skip execution when no post hook is configured', async () => {
    const runHook = vi.fn();
    const executor = createExecutor({ runHook });

    await executor.runPostUpdateHook(
      createContainer(),
      {
        hookPost: undefined,
        hookTimeout: 1000,
        hookEnv: {},
      },
      {
        warn: vi.fn(),
      },
    );

    expect(runHook).not.toHaveBeenCalled();
  });

  test('runPostUpdateHook should record success audit for successful execution', async () => {
    const runHook = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      timedOut: false,
    });
    const recordHookAudit = vi.fn();
    const executor = createExecutor({ runHook, recordHookAudit });

    const container = createContainer();
    await executor.runPostUpdateHook(
      container,
      {
        hookPost: 'echo post',
        hookTimeout: 1000,
        hookEnv: { TEST: '1' },
      },
      {
        warn: vi.fn(),
      },
    );

    expect(runHook).toHaveBeenCalledWith('echo post', {
      timeout: 1000,
      env: { TEST: '1' },
      label: 'post-update',
    });
    expect(recordHookAudit).toHaveBeenCalledWith(
      'hook-post-success',
      container,
      'success',
      'Post-update hook completed: ok',
    );
  });

  test('runPostUpdateHook should record failures without throwing', async () => {
    const runHook = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: true,
    });
    const recordHookAudit = vi.fn();
    const warn = vi.fn();
    const executor = createExecutor({ runHook, recordHookAudit });

    await expect(
      executor.runPostUpdateHook(
        createContainer(),
        {
          hookPost: 'sleep 10',
          hookTimeout: 50,
          hookEnv: {},
        },
        { warn },
      ),
    ).resolves.toBeUndefined();

    expect(recordHookAudit).toHaveBeenCalledWith(
      'hook-post-failed',
      expect.anything(),
      'error',
      'Post-update hook timed out after 50ms',
    );
    expect(warn).toHaveBeenCalledWith('Post-update hook timed out after 50ms');
  });

  test('runPostUpdateHook should rethrow non-pipeline hook errors', async () => {
    const runHook = vi.fn().mockRejectedValue(new Error('ipc disconnected'));
    const recordHookAudit = vi.fn();
    const warn = vi.fn();
    const executor = createExecutor({ runHook, recordHookAudit });

    await expect(
      executor.runPostUpdateHook(
        createContainer(),
        {
          hookPost: 'echo post',
          hookTimeout: 1000,
          hookEnv: {},
        },
        { warn },
      ),
    ).rejects.toThrow('ipc disconnected');

    expect(recordHookAudit).not.toHaveBeenCalledWith(
      'hook-post-failed',
      expect.anything(),
      'error',
      expect.any(String),
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
