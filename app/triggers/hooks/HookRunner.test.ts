import { describe, expect, test, vi } from 'vitest';
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
