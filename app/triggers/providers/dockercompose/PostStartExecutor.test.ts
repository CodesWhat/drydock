import { EventEmitter } from 'node:events';
import PostStartExecutor, {
  normalizePostStartEnvironmentValue,
  normalizePostStartHooks,
} from './PostStartExecutor.js';

function makeExecMocks({
  exitCode = 0,
  streamEvent = 'close',
  streamError = undefined as Error | undefined,
  hasResume = true,
  hasOnce = true,
} = {}) {
  let startStream: any;
  if (hasOnce) {
    startStream = new EventEmitter();
    if (hasResume) {
      startStream.resume = vi.fn();
    }
  } else {
    startStream = {};
  }

  const mockExec = {
    start: vi.fn().mockImplementation(async () => {
      if (hasOnce) {
        setImmediate(() => {
          if (streamError) {
            startStream.emit('error', streamError);
          } else {
            startStream.emit(streamEvent);
          }
        });
      }
      return startStream;
    }),
    inspect: vi.fn().mockResolvedValue({ ExitCode: exitCode }),
  };

  const recreatedContainer = {
    inspect: vi.fn().mockResolvedValue({
      State: { Running: true },
    }),
    exec: vi.fn().mockResolvedValue(mockExec),
  };

  return { startStream, mockExec, recreatedContainer };
}

describe('PostStartExecutor', () => {
  test('runServicePostStartHooks should execute hooks with normalized command and env', async () => {
    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const { recreatedContainer, mockExec } = makeExecMocks();
    const mockDockerApi = {
      getContainer: vi.fn().mockReturnValue(recreatedContainer),
    };

    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      isDryRun: () => false,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'netbox' }, 'netbox', {
      post_start: [
        {
          command: 'echo hello',
          user: 'root',
          working_dir: '/tmp',
          privileged: true,
          environment: { TEST: '1' },
        },
      ],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['sh', '-c', 'echo hello'],
        User: 'root',
        WorkingDir: '/tmp',
        Privileged: true,
        Env: ['TEST=1'],
      }),
    );
    expect(mockExec.inspect).toHaveBeenCalledTimes(1);
  });

  test('runServicePostStartHooks should skip when dryrun is enabled', async () => {
    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const mockDockerApi = {
      getContainer: vi.fn(),
    };

    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      isDryRun: () => true,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'netbox' }, 'netbox', {
      post_start: ['echo hello'],
    });

    expect(mockDockerApi.getContainer).not.toHaveBeenCalled();
  });

  test('constructor should throw when getWatcher is not provided', () => {
    expect(() => new PostStartExecutor({ getWatcher: undefined as any })).toThrow(
      'PostStartExecutor requires dependency "getWatcher"',
    );
  });

  test('constructor should use fallback getLog when not provided', async () => {
    const { recreatedContainer } = makeExecMocks();
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
      post_start: [{ command: 'echo ok' }],
    });

    expect(mockDockerApi.getContainer).toHaveBeenCalled();
  });

  describe('defaultGetDockerApiFromWatcher', () => {
    test('should warn and skip when watcher is null', async () => {
      const mockLog = { info: vi.fn(), warn: vi.fn() };
      const executor = new PostStartExecutor({
        getLog: () => mockLog,
        getWatcher: () => null,
      });

      await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
        post_start: ['echo hi'],
      });

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('watcher Docker API is unavailable'),
      );
    });

    test('should warn and skip when watcher has no dockerApi', async () => {
      const mockLog = { info: vi.fn(), warn: vi.fn() };
      const executor = new PostStartExecutor({
        getLog: () => mockLog,
        getWatcher: () => ({}),
      });

      await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
        post_start: ['echo hi'],
      });

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('watcher Docker API is unavailable'),
      );
    });

    test('should warn and skip when dockerApi.getContainer is not a function', async () => {
      const mockLog = { info: vi.fn(), warn: vi.fn() };
      const executor = new PostStartExecutor({
        getLog: () => mockLog,
        getWatcher: () => ({ dockerApi: { getContainer: 'not-a-fn' } }),
      });

      await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
        post_start: ['echo hi'],
      });

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('watcher Docker API is unavailable'),
      );
    });
  });

  test('should skip when container is not running', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const stoppedContainer = {
      inspect: vi.fn().mockResolvedValue({ State: { Running: false } }),
      exec: vi.fn(),
    };
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(stoppedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
      post_start: ['echo hi'],
    });

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('container is not running'));
    expect(stoppedContainer.exec).not.toHaveBeenCalled();
  });

  test('should skip hook when command is missing from object hook', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const { recreatedContainer } = makeExecMocks();
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
      post_start: [{ user: 'root' }],
    });

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('command is missing'));
  });

  test('should normalize string hook into command object', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const { recreatedContainer } = makeExecMocks();
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
      post_start: 'echo hello',
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({ Cmd: ['sh', '-c', 'echo hello'] }),
    );
  });

  test('should normalize array command', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const { recreatedContainer } = makeExecMocks();
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
      post_start: [{ command: ['/bin/bash', '-c', 'echo hi'] }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({ Cmd: ['/bin/bash', '-c', 'echo hi'] }),
    );
  });

  test('should handle stream without resume', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const { recreatedContainer } = makeExecMocks({ hasResume: false });
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
      post_start: [{ command: 'echo hi' }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalled();
  });

  test('should handle stream without once (no event emitter)', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const { recreatedContainer } = makeExecMocks({ hasOnce: false });
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
      post_start: [{ command: 'echo hi' }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalled();
  });

  test('should throw on non-zero exit code', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const { recreatedContainer } = makeExecMocks({ exitCode: 1 });
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await expect(
      executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
        post_start: [{ command: 'exit 1' }],
      }),
    ).rejects.toThrow('exit code 1');
  });

  test('should reject on stream error', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const { recreatedContainer } = makeExecMocks({ streamError: new Error('stream fail') });
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await expect(
      executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
        post_start: [{ command: 'echo hi' }],
      }),
    ).rejects.toThrow('stream fail');
  });

  test('should handle end event for stream', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const { recreatedContainer } = makeExecMocks({ streamEvent: 'end' });
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
      post_start: [{ command: 'echo hi' }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalled();
  });

  test('should normalize array environment variables', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const { recreatedContainer } = makeExecMocks();
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
      post_start: [{ command: 'echo hi', environment: ['FOO=bar', 'BAZ=qux'] }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({ Env: ['FOO=bar', 'BAZ=qux'] }),
    );
  });

  test('should handle array environment variable without equals sign', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const { recreatedContainer } = makeExecMocks();
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
      post_start: [{ command: 'echo hi', environment: ['FOO'] }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(expect.objectContaining({ Env: ['FOO'] }));
  });

  test('should throw on invalid environment key', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const { recreatedContainer } = makeExecMocks();
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await expect(
      executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
        post_start: [{ command: 'echo hi', environment: { 'invalid-key!': 'val' } }],
      }),
    ).rejects.toThrow('Invalid compose post_start environment variable key');
  });

  test('should skip when no post_start hooks defined', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const mockDockerApi = { getContainer: vi.fn() };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {});

    expect(mockDockerApi.getContainer).not.toHaveBeenCalled();
  });

  test('should handle object environment value that is null', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const { recreatedContainer } = makeExecMocks();
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
      post_start: [{ command: 'echo hi', environment: { KEY: null } }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({ Env: ['KEY='] }),
    );
  });

  test('should handle object environment value that is an object', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const { recreatedContainer } = makeExecMocks();
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
      post_start: [{ command: 'echo hi', environment: { KEY: { nested: true } } }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({ Env: ['KEY={"nested":true}'] }),
    );
  });

  test('normalizePostStartHooks should return empty array for falsy input', () => {
    expect(normalizePostStartHooks(null)).toEqual([]);
    expect(normalizePostStartHooks(undefined)).toEqual([]);
  });

  test('should skip when post_start is an empty array', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const mockDockerApi = { getContainer: vi.fn() };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
      post_start: [],
    });

    expect(mockDockerApi.getContainer).not.toHaveBeenCalled();
  });

  test('normalizePostStartEnvironmentValue should return empty string for circular objects', () => {
    const circular: any = {};
    circular.self = circular;
    expect(normalizePostStartEnvironmentValue(circular)).toBe('');
  });

  test('should handle no environment', async () => {
    const mockLog = { info: vi.fn(), warn: vi.fn() };
    const { recreatedContainer } = makeExecMocks();
    const mockDockerApi = { getContainer: vi.fn().mockReturnValue(recreatedContainer) };
    const executor = new PostStartExecutor({
      getLog: () => mockLog,
      getWatcher: () => ({ dockerApi: mockDockerApi }),
    });

    await executor.runServicePostStartHooks({ name: 'c1' }, 'svc', {
      post_start: [{ command: 'echo hi' }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({ Env: undefined }),
    );
  });
});
