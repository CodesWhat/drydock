import joi from 'joi';

var childProcessMockControl = vi.hoisted(() => ({
  execCalls: 0,
  execFileCalls: 0,
  execImpl: null as null | ((...args: unknown[]) => unknown),
  execFileImpl: null as null | ((...args: unknown[]) => unknown),
}));

vi.mock('node:child_process', async () => {
  var actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  var exec = (...args: unknown[]) => {
    childProcessMockControl.execCalls += 1;
    if (childProcessMockControl.execImpl !== null) {
      return childProcessMockControl.execImpl(...args);
    }
    return (actual.exec as (...callArgs: unknown[]) => unknown)(...args);
  };
  var execFile = (...args: unknown[]) => {
    childProcessMockControl.execFileCalls += 1;
    if (childProcessMockControl.execFileImpl !== null) {
      return childProcessMockControl.execFileImpl(...args);
    }
    return (actual.execFile as (...callArgs: unknown[]) => unknown)(...args);
  };

  return {
    ...actual,
    exec,
    execFile,
    default: {
      ...(actual as unknown as Record<string, unknown>),
      exec,
      execFile,
    },
  };
});

import Command, { resetShellExecutionWarningStateForTests } from './Command.js';

const command = new Command();

const configurationValid = {
  cmd: 'echo "hello"',
  timeout: 60000,
  shell: '/bin/sh',
  threshold: 'all',
  mode: 'simple',
  once: true,
  auto: 'all',
  order: 100,
  simpletitle: 'New ${container.updateKind.kind} found for container ${container.name}',
  simplebody:
    'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',
  batchtitle: '${containers.length} updates available',
  resolvenotifications: false,
};

beforeEach(async () => {
  vi.resetAllMocks();
  childProcessMockControl.execCalls = 0;
  childProcessMockControl.execFileCalls = 0;
  childProcessMockControl.execImpl = null;
  childProcessMockControl.execFileImpl = null;
  resetShellExecutionWarningStateForTests();
});

test('validateConfiguration should return validated configuration when valid', async () => {
  const validatedConfiguration = command.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should apply_default_configuration', async () => {
  const validatedConfiguration = command.validateConfiguration({
    cmd: configurationValid.cmd,
  });
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when invalid', async () => {
  const configuration = {
    command: 123456789,
  };
  expect(() => {
    command.validateConfiguration(configuration);
  }).toThrowError(joi.ValidationError);
});

test('should log shell execution security warning once on first command trigger execution', async () => {
  const cmd = new Command();
  await cmd.register('trigger', 'command', 'test', {
    cmd: 'echo test',
    shell: '/bin/sh',
  });
  const warnSpy = vi.spyOn(cmd.log, 'warn');

  await cmd.trigger({ name: 'test', id: '1' });
  await cmd.trigger({ name: 'test', id: '2' });

  const securityWarningCalls = warnSpy.mock.calls.filter(([message]) =>
    String(message).includes('Security: Command trigger executes DD_TRIGGER_COMMAND_* cmd'),
  );
  expect(securityWarningCalls).toHaveLength(1);
});

test('should trigger with container', async () => {
  const cmd = new Command();
  await cmd.register('trigger', 'command', 'test', { cmd: 'echo test' });
  const logSpy = vi.spyOn(cmd.log, 'info');

  const container = { name: 'test', id: '123' };
  await cmd.trigger(container);

  expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Command echo test'));
});

test('should trigger batch with containers', async () => {
  const cmd = new Command();
  await cmd.register('trigger', 'command', 'test', { cmd: 'echo batch' });
  const logSpy = vi.spyOn(cmd.log, 'info');

  const containers = [{ name: 'test1' }, { name: 'test2' }];
  await cmd.triggerBatch(containers);

  expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Command echo batch'));
});

test('should handle command execution error', async () => {
  const cmd = new Command();
  await cmd.register('trigger', 'command', 'test', {
    cmd: 'invalid-command',
  });
  const logSpy = vi.spyOn(cmd.log, 'warn');

  const container = { name: 'test' };
  await cmd.trigger(container);

  expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('execution error'));
});

test('should log stderr when present', async () => {
  const cmd = new Command();
  await cmd.register('trigger', 'command', 'test', {
    cmd: 'echo warning >&2',
  });
  const logSpy = vi.spyOn(cmd.log, 'warn');

  const container = { name: 'test' };
  await cmd.trigger(container);

  expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('stderr'));
});

test('runCommand should use execFile with shell and -c arguments', async () => {
  childProcessMockControl.execImpl = (
    _: unknown,
    __: unknown,
    callback: (...args: unknown[]) => void,
  ) => {
    setImmediate(() => callback(null, '', ''));
    return { pid: 1 };
  };
  childProcessMockControl.execFileImpl = (
    file: unknown,
    args: unknown,
    options: unknown,
    callback: (...callbackArgs: unknown[]) => void,
  ) => {
    expect(file).toBe('/bin/sh');
    expect(args).toStrictEqual(['-c', 'echo test']);
    expect((options as { timeout?: number }).timeout).toBe(1234);

    const env = (options as { env?: Record<string, string | undefined> }).env;
    expect(env?.name).toBe('test');
    expect(env?.id).toBe('123');

    setImmediate(() => callback(null, 'ok', ''));
    return { pid: 2 };
  };

  const cmd = new Command();
  await cmd.register('trigger', 'command', 'test', {
    cmd: 'echo test',
    shell: '/bin/sh',
    timeout: 1234,
  });

  await cmd.trigger({ name: 'test', id: '123' });

  expect(childProcessMockControl.execFileCalls).toBe(1);
  expect(childProcessMockControl.execCalls).toBe(0);
});

test('runCommand should coerce non-string stdout/stderr values to empty strings', async () => {
  const cmd = new Command();
  await cmd.register('trigger', 'command', 'test', { cmd: 'echo test' });
  const logInfoSpy = vi.spyOn(cmd.log, 'info');
  const logWarnSpy = vi.spyOn(cmd.log, 'warn');

  childProcessMockControl.execFileImpl = (
    _file: unknown,
    _args: unknown,
    _options: unknown,
    callback: (...callbackArgs: unknown[]) => void,
  ) => {
    setImmediate(() => callback(null, Buffer.from('ok'), Buffer.from('warn')));
    return { pid: 2 };
  };

  await cmd.trigger({ name: 'test', id: '123' });

  expect(logInfoSpy).not.toHaveBeenCalledWith(expect.stringContaining('stdout'));
  expect(logWarnSpy).not.toHaveBeenCalledWith(expect.stringContaining('stderr'));
});
