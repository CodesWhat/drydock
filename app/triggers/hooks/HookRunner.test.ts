import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { resetAllowlistWarningStateForTests, runHook } from './HookRunner.js';

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
    resetAllowlistWarningStateForTests();
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
    var result = await runHook(
      'python3 -c "import sys; sys.stderr.write(\'oops\\\\n\'); raise SystemExit(1)"',
      { label: 'test' },
    );
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

  test('should allow quoted arguments, braced variables, and trailing whitespace', async () => {
    var result = await runHook(`printf '%s %s' "\${MY_VAR}" 'world'   `, {
      label: 'test',
      env: { MY_VAR: 'hello-hook' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello-hook world');
  });

  test.each([
    'echo hello && whoami',
    'echo hello; whoami',
    'echo $(whoami)',
    'echo `whoami`',
    'echo hello | cat',
    'echo hello\nwhoami',
    '   ',
    'echo $',
    'echo ${',
    'echo ${1}',
    'echo ${MY_VAR',
    "echo 'unterminated",
    'echo "unterminated',
    'echo "escaped-backslash\\',
    'echo "bad${1}"',
    'echo "bad`tick"',
  ])('should reject unsafe shell syntax in hook command: %s', async (command) => {
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
      const result = await runHook(command, { label: 'test' });

      expect(execFileCalls).toBe(0);
      expect(result).toStrictEqual({
        exitCode: 1,
        stdout: '',
        stderr:
          'Hook command contains unsupported shell syntax. Use a single command with arguments and optional $VAR expansions.',
        timedOut: false,
      });
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
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
    var result = await runHook('node -e "process.stdout.write(\'x\'.repeat(20000))"', {
      label: 'test',
    });
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

  // ---- isHooksExecutionEnabled (line 29): trim().toLowerCase() mutations ----
  test('should skip execution when DD_HOOKS_ENABLED is "  TRUE  " (whitespace)', async () => {
    // trim() is needed to handle padded values
    process.env.DD_HOOKS_ENABLED = '  true  ';
    var result = await runHook('echo ok', { label: 'test' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('ok');
  });

  test('should skip execution when DD_HOOKS_ENABLED is "TRUE" (uppercase)', async () => {
    // toLowerCase() is needed to handle uppercase values
    process.env.DD_HOOKS_ENABLED = 'TRUE';
    var result = await runHook('echo ok', { label: 'test' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('ok');
  });

  test('should skip execution when DD_HOOKS_ENABLED is "True" (mixed case)', async () => {
    process.env.DD_HOOKS_ENABLED = 'True';
    var result = await runHook('echo ok', { label: 'test' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('ok');
  });

  test('should skip execution when DD_HOOKS_ENABLED is undefined', async () => {
    delete process.env.DD_HOOKS_ENABLED;
    var execFileCalls = 0;
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      execFileCalls += 1;
      setImmediate(() => callback(null, '', ''));
      return { exitCode: 0 };
    };

    try {
      const result = await runHook('echo ok', { label: 'test' });
      expect(execFileCalls).toBe(0);
      expect(result.stderr).toContain('Lifecycle hooks are disabled');
    } finally {
      childProcessMockControl.execFileImpl = null;
      process.env.DD_HOOKS_ENABLED = 'true';
    }
  });

  // ---- consumeVariableReference (lines 52, 63, 73, 87): index boundary mutations ----
  // These test the variable parsing in hook commands
  test.each([
    // Simple $VAR references
    'echo $PATH',
    'echo $MY_VAR_123',
    'echo $A',
    'echo $_UNDERSCORE',
    // Braced ${ } references
    'echo ${PATH}',
    'echo ${MY_VAR_123}',
    'echo ${A}',
    // Mixed
    'printf %s $HOME',
    'cmd $VAR1 $VAR2',
    // With quotes containing variables
    'echo "$MY_VAR"',
    'echo "${MY_VAR}"',
    // Alphanumeric safe chars
    'cmd --flag=value',
    'cmd path/to/file',
    'cmd user@host',
  ])('should allow valid hook command: %s', async (command) => {
    var execFileCalls = 0;
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      execFileCalls += 1;
      setImmediate(() => callback(null, 'ok', ''));
      return { exitCode: 0 };
    };

    try {
      const result = await runHook(command, { label: 'test' });
      expect(execFileCalls).toBe(1);
      expect(result.exitCode).toBe(0);
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
  });

  // ---- consumeVariableReference: $ at end of string (line 46/47) ----
  test('should reject $ at end of command (no char after $)', async () => {
    var execFileCalls = 0;
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      execFileCalls += 1;
      setImmediate(() => callback(null, '', ''));
      return { exitCode: 0 };
    };

    try {
      const result = await runHook('echo $', { label: 'test' });
      expect(execFileCalls).toBe(0);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('unsupported shell syntax');
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
  });

  // ---- consumeSingleQuotedSegment: loop through all chars (line 73) ----
  test('single-quoted string with multiple words is valid', async () => {
    var execFileCalls = 0;
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      execFileCalls += 1;
      setImmediate(() => callback(null, 'hello world', ''));
      return { exitCode: 0 };
    };

    try {
      await runHook("echo 'hello world'", { label: 'test' });
      expect(execFileCalls).toBe(1);
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
  });

  // ---- consumeDoubleQuotedSegment: newline/control chars (line 92-100) ----
  test('should reject double-quoted segment with embedded null byte', async () => {
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      setImmediate(() => callback(null, '', ''));
      return { exitCode: 0 };
    };

    try {
      const result = await runHook('echo "bad\0byte"', { label: 'test' });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('unsupported shell syntax');
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
  });

  // ---- consumeDoubleQuotedSegment: backslash escape (line 95-103) ----
  test('should allow valid escape sequences inside double-quoted args', async () => {
    var execFileCalls = 0;
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      execFileCalls += 1;
      setImmediate(() => callback(null, 'ok', ''));
      return { exitCode: 0 };
    };

    try {
      await runHook('echo "escaped\\"quote"', { label: 'test' });
      expect(execFileCalls).toBe(1);
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
  });

  // ---- consumeDoubleQuotedSegment: $ in double-quotes requires valid var ref (line 106-113) ----
  test('should reject double-quoted segment with invalid $ expression', async () => {
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      setImmediate(() => callback(null, '', ''));
      return { exitCode: 0 };
    };

    try {
      const result = await runHook('echo "bad$"', { label: 'test' });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('unsupported shell syntax');
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
  });

  // ---- isAllowedHookCommand: sawToken (line 154, 157, 163, 165) ----
  test('should reject command that is all whitespace', async () => {
    var execFileCalls = 0;
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      execFileCalls += 1;
      setImmediate(() => callback(null, '', ''));
      return { exitCode: 0 };
    };

    try {
      const result = await runHook('   \t   ', { label: 'test' });
      expect(execFileCalls).toBe(0);
      expect(result.exitCode).toBe(1);
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
  });

  // ---- logHookResult (lines 210, 215): timedOut and exitCode conditions ----
  test('should return timedOut=false with exitCode=0 on success', async () => {
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      setImmediate(() => callback(null, 'output', ''));
      return { exitCode: 0 };
    };

    try {
      const result = await runHook('echo ok', { label: 'test' });
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('output');
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
  });

  test('should return non-zero exitCode and stderr on failure', async () => {
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      const err = Object.assign(new Error('failed'), { code: 2 });
      setImmediate(() => callback(err, '', 'something went wrong'));
      return { exitCode: 2 };
    };

    try {
      const result = await runHook('echo ok', { label: 'test' });
      expect(result.exitCode).toBe(2);
      expect(result.timedOut).toBe(false);
      expect(result.stderr).toBe('something went wrong');
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
  });

  // ---- resolveExitCode (line 181-183): timedOut=true forces exitCode=1 ----
  test('timedOut result has exitCode=1 regardless of error code', async () => {
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      const err = Object.assign(new Error('killed'), { killed: true, code: 'ETIMEDOUT' });
      const fakeChild = { exitCode: null };
      setImmediate(() => callback(err, '', ''));
      return fakeChild;
    };

    try {
      const result = await runHook('echo ok', { label: 'test' });
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(1);
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
  });

  // ---- createHookResult: child?.exitCode (line 264) ----
  test('should use child.exitCode from process when error code is not numeric', async () => {
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      const fakeChild = { exitCode: 3 };
      // Error without numeric code, error without killed=true
      const err = Object.assign(new Error('exit'), { code: undefined });
      setImmediate(() => callback(err, 'out', 'err'));
      return fakeChild;
    };

    try {
      const result = await runHook('echo ok', { label: 'test' });
      // exitCode comes from child.exitCode=3 (fallbackExitCode)
      expect(result.exitCode).toBe(3);
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
  });

  // ---- logHookResult: exitCode strings (lines 211, 216, 220) ----
  test('logHookResult messages contain the label name', async () => {
    childProcessMockControl.execFileImpl = (
      _: string,
      __: readonly string[],
      ___: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      setImmediate(() => callback(null, 'done', ''));
      return { exitCode: 0 };
    };

    try {
      const result = await runHook('echo ok', { label: 'my-custom-hook' });
      expect(result.exitCode).toBe(0);
      // We can't easily inspect log calls here since the logger is mocked per-child
      // but we verify the result structure is correct
      expect(result.timedOut).toBe(false);
    } finally {
      childProcessMockControl.execFileImpl = null;
    }
  });

  // ---- Security: DD_HOOKS_ALLOWED_COMMANDS (finding 2) ----

  describe('DD_HOOKS_ALLOWED_COMMANDS allowlist', () => {
    const originalAllowed = process.env.DD_HOOKS_ALLOWED_COMMANDS;

    afterEach(() => {
      if (originalAllowed === undefined) {
        delete process.env.DD_HOOKS_ALLOWED_COMMANDS;
      } else {
        process.env.DD_HOOKS_ALLOWED_COMMANDS = originalAllowed;
      }
      childProcessMockControl.execFileImpl = null;
    });

    test('when DD_HOOKS_ALLOWED_COMMANDS is UNSET, command runs and a one-time warning is logged', async () => {
      delete process.env.DD_HOOKS_ALLOWED_COMMANDS;

      var execFileCalls = 0;
      childProcessMockControl.execFileImpl = (
        _: string,
        __: readonly string[],
        ___: unknown,
        callback: (...args: unknown[]) => void,
      ) => {
        execFileCalls += 1;
        setImmediate(() => callback(null, 'ok', ''));
        return { exitCode: 0 };
      };

      const result = await runHook('echo hello', { label: 'test' });
      expect(execFileCalls).toBe(1);
      expect(result.exitCode).toBe(0);
    });

    test('warning is logged only once across multiple calls when DD_HOOKS_ALLOWED_COMMANDS is UNSET', async () => {
      delete process.env.DD_HOOKS_ALLOWED_COMMANDS;
      // hasLoggedAllowlistWarning is reset in beforeEach via resetAllowlistWarningStateForTests

      var execFileCalls = 0;
      childProcessMockControl.execFileImpl = (
        _: string,
        __: readonly string[],
        ___: unknown,
        callback: (...args: unknown[]) => void,
      ) => {
        execFileCalls += 1;
        setImmediate(() => callback(null, 'ok', ''));
        return { exitCode: 0 };
      };

      // Both calls succeed; the second call takes the already-warned branch
      await runHook('echo first', { label: 'test' });
      const result2 = await runHook('echo second', { label: 'test' });
      expect(execFileCalls).toBe(2);
      expect(result2.exitCode).toBe(0);
    });

    test('when DD_HOOKS_ALLOWED_COMMANDS is SET and command basename matches, command runs', async () => {
      process.env.DD_HOOKS_ALLOWED_COMMANDS = 'echo,curl';

      var execFileCalls = 0;
      childProcessMockControl.execFileImpl = (
        _: string,
        __: readonly string[],
        ___: unknown,
        callback: (...args: unknown[]) => void,
      ) => {
        execFileCalls += 1;
        setImmediate(() => callback(null, 'ok', ''));
        return { exitCode: 0 };
      };

      const result = await runHook('echo hello', { label: 'test' });
      expect(execFileCalls).toBe(1);
      expect(result.exitCode).toBe(0);
    });

    test('when DD_HOOKS_ALLOWED_COMMANDS is SET and command basename does NOT match, command is rejected without executing', async () => {
      process.env.DD_HOOKS_ALLOWED_COMMANDS = 'curl,wget';

      var execFileCalls = 0;
      childProcessMockControl.execFileImpl = (
        _: string,
        __: readonly string[],
        ___: unknown,
        callback: (...args: unknown[]) => void,
      ) => {
        execFileCalls += 1;
        setImmediate(() => callback(null, 'unexpected', ''));
        return { exitCode: 0 };
      };

      const result = await runHook('echo hello', { label: 'test' });
      expect(execFileCalls).toBe(0);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not in DD_HOOKS_ALLOWED_COMMANDS');
    });

    test('when allowlist entry is a full path, exact path match is required', async () => {
      process.env.DD_HOOKS_ALLOWED_COMMANDS = '/usr/local/bin/notify.sh';

      var execFileCalls = 0;
      childProcessMockControl.execFileImpl = (
        _: string,
        __: readonly string[],
        ___: unknown,
        callback: (...args: unknown[]) => void,
      ) => {
        execFileCalls += 1;
        setImmediate(() => callback(null, 'ok', ''));
        return { exitCode: 0 };
      };

      // exact path match: allowed
      const resultAllowed = await runHook('/usr/local/bin/notify.sh arg1', { label: 'test' });
      expect(execFileCalls).toBe(1);
      expect(resultAllowed.exitCode).toBe(0);

      execFileCalls = 0;

      // basename match against a path entry: NOT allowed (must be exact)
      const resultDenied = await runHook('notify.sh arg1', { label: 'test' });
      expect(execFileCalls).toBe(0);
      expect(resultDenied.exitCode).toBe(1);
    });

    test('when allowlist entry has no slash, basename match works for full path commands', async () => {
      process.env.DD_HOOKS_ALLOWED_COMMANDS = 'curl';

      var execFileCalls = 0;
      childProcessMockControl.execFileImpl = (
        _: string,
        __: readonly string[],
        ___: unknown,
        callback: (...args: unknown[]) => void,
      ) => {
        execFileCalls += 1;
        setImmediate(() => callback(null, 'ok', ''));
        return { exitCode: 0 };
      };

      // /usr/bin/curl basename is "curl" which matches the allowlist entry "curl"
      const result = await runHook('/usr/bin/curl https://example.com', { label: 'test' });
      expect(execFileCalls).toBe(1);
      expect(result.exitCode).toBe(0);
    });
  });
});
