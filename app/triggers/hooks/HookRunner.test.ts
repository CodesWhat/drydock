import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { runHook } from './HookRunner.js';

var childProcessMockControl = vi.hoisted(() => ({
  execFileImpl: null as null | ((...args: unknown[]) => unknown),
}));

vi.mock('node:child_process', async () => {
  var actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');

  return {
    ...actual,
    execFile: (...args: unknown[]) => {
      if (childProcessMockControl.execFileImpl !== null) {
        return childProcessMockControl.execFileImpl(...args);
      }

      return (actual.execFile as (...callArgs: unknown[]) => unknown)(...args);
    },
  };
});

vi.mock('../../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

describe('HookRunner', () => {
  const originalHooksEnabled = process.env.DD_HOOKS_ENABLED;

  beforeEach(() => {
    process.env.DD_HOOKS_ENABLED = 'true';
  });

  afterAll(() => {
    if (originalHooksEnabled === undefined) {
      delete process.env.DD_HOOKS_ENABLED;
      return;
    }
    process.env.DD_HOOKS_ENABLED = originalHooksEnabled;
  });

  test('should skip command execution when hooks are disabled', async () => {
    process.env.DD_HOOKS_ENABLED = 'false';
    var execFileCalls = 0;

    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      execFileCalls += 1;
      setImmediate(() => callback(null, 'unexpected execution', ''));
      return { exitCode: 0 };
    };

    try {
      const result = await runHook('echo hello', { label: 'test' });
      expect(execFileCalls).toBe(0);
      expect(result).toStrictEqual({
        exitCode: 0,
        stdout: '',
        stderr: 'Lifecycle hooks are disabled. Set DD_HOOKS_ENABLED=true to enable execution.',
        timedOut: false,
      });
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
  });

  test('should execute a command successfully', async () => {
    var result = await runHook('echo hello', { label: 'test' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.stderr).toBe('');
    expect(result.timedOut).toBe(false);
  });

  test('should capture non-zero exit code', async () => {
    var result = await runHook('exit 42', { label: 'test' });
    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  test('should capture stderr output', async () => {
    var result = await runHook('echo oops >&2; exit 1', { label: 'test' });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.trim()).toBe('oops');
    expect(result.timedOut).toBe(false);
  });

  test('should handle timeout', async () => {
    var result = await runHook('sleep 10', { label: 'test', timeout: 200 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(1);
  }, 10_000);

  test('should pass environment variables', async () => {
    var result = await runHook('echo $MY_VAR', {
      label: 'test',
      env: { MY_VAR: 'hello-hook' },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello-hook');
  });

  test('should not forward non-allowlisted parent environment variables', async () => {
    const secretKey = 'DRYDOCK_TEST_HOOK_SECRET';
    const originalSecret = process.env[secretKey];
    const originalPath = process.env.PATH;
    process.env[secretKey] = 'top-secret';
    process.env.PATH = '/tmp/drydock-hook-path';

    let capturedEnv: Record<string, string | undefined> | undefined;
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      options: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      capturedEnv = (options as { env?: Record<string, string | undefined> }).env;
      setImmediate(() => callback(null, '', ''));
      return { exitCode: 0 };
    };

    try {
      const result = await runHook('echo ignored', {
        label: 'test',
        env: { MY_VAR: 'hello-hook' },
      });

      expect(result.exitCode).toBe(0);
      expect(capturedEnv?.MY_VAR).toBe('hello-hook');
      expect(capturedEnv?.PATH).toBe('/tmp/drydock-hook-path');
      expect(capturedEnv?.[secretKey]).toBeUndefined();
    } finally {
      childProcessMockControl.execFileImpl = null;
      if (originalSecret === undefined) {
        delete process.env[secretKey];
      } else {
        process.env[secretKey] = originalSecret;
      }
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });

  test('should truncate stdout to 10KB', async () => {
    // Generate output larger than 10KB
    var result = await runHook(
      'python3 -c "print(\'x\' * 20000)" 2>/dev/null || printf "%0.sx" $(seq 1 20000)',
      {
        label: 'test',
      },
    );
    expect(result.stdout.length).toBeLessThanOrEqual(10 * 1024);
  });

  test('should use default timeout of 60000ms', async () => {
    // Just confirm it runs without specifying timeout
    var result = await runHook('echo ok', { label: 'test' });
    expect(result.exitCode).toBe(0);
  });

  test('should fall back to exit code 0 and empty outputs for non-string callback data', async () => {
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      var fakeChild = { exitCode: null };
      setImmediate(() =>
        callback(null, Buffer.from('binary-stdout'), Buffer.from('binary-stderr')),
      );
      return fakeChild;
    };

    try {
      const result = await runHook('echo ignored', { label: 'test' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(result.timedOut).toBe(false);
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
  });
});
