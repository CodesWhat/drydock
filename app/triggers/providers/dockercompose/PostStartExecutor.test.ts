import { EventEmitter } from 'node:events';
import PostStartExecutor from './PostStartExecutor.js';

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
});
