import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { probeSocketApiVersion } from '../../../watchers/providers/docker/socket-version-probe.js';
import {
  runSelfUpdateController,
  runSelfUpdateControllerEntrypoint,
  testable_getRequiredEnv,
  testable_parsePositiveInt,
} from './self-update-controller.js';

const mockDockerodeCtor = vi.hoisted(() => vi.fn());

vi.mock('dockerode', () => ({
  default: mockDockerodeCtor,
}));
vi.mock('../../../watchers/providers/docker/disable-socket-redirects.js', () => ({
  disableSocketRedirects: vi.fn(),
}));
vi.mock('../../../watchers/providers/docker/socket-version-probe.js', () => ({
  probeSocketApiVersion: vi.fn().mockResolvedValue(undefined),
}));

const DEFAULT_CONTROLLER_ENV = {
  DD_SELF_UPDATE_OP_ID: 'op-123',
  DD_SELF_UPDATE_OLD_CONTAINER_ID: 'old-container-id',
  DD_SELF_UPDATE_OLD_CONTAINER_NAME: 'drydock',
  DD_SELF_UPDATE_NEW_CONTAINER_ID: 'new-container-id',
  DD_SELF_UPDATE_FINALIZE_URL: 'http://127.0.0.1:3000/api/v1/internal/self-update/finalize',
  DD_SELF_UPDATE_FINALIZE_SECRET: 'self-update-finalize-secret',
  DD_SELF_UPDATE_START_TIMEOUT_MS: '1000',
  DD_SELF_UPDATE_HEALTH_TIMEOUT_MS: '1000',
  DD_SELF_UPDATE_POLL_INTERVAL_MS: '1',
} as const;

type ControllerEnvName = keyof typeof DEFAULT_CONTROLLER_ENV;

function setControllerEnv(overrides: Partial<Record<ControllerEnvName, string | undefined>> = {}) {
  const envValues = {
    ...DEFAULT_CONTROLLER_ENV,
    ...overrides,
  };
  for (const [key, value] of Object.entries(envValues)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearControllerEnv() {
  for (const key of Object.keys(DEFAULT_CONTROLLER_ENV)) {
    delete process.env[key];
  }
}

function createExecHarness({ exitCode = 0 } = {}) {
  const startStream = {
    once: vi.fn((event: string, callback: (error?: unknown) => void) => {
      if (event === 'end' || event === 'close') {
        queueMicrotask(() => callback());
      }
    }),
    removeListener: vi.fn(),
    resume: vi.fn(),
  };
  const mockExec = {
    start: vi.fn().mockResolvedValue(startStream),
    inspect: vi.fn().mockResolvedValue({ ExitCode: exitCode }),
  };

  return {
    mockExec,
    exec: vi.fn().mockResolvedValue(mockExec),
  };
}

function createOldContainer(overrides = {}) {
  const { exec, mockExec } = createExecHarness();
  return {
    stop: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({ State: { Running: false }, Name: '/drydock' }),
    start: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    exec,
    _mockExec: mockExec,
    ...overrides,
  };
}

function createNewContainer(overrides = {}) {
  const { exec, mockExec } = createExecHarness();
  return {
    start: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({ State: { Running: true } }),
    remove: vi.fn().mockResolvedValue(undefined),
    exec,
    _mockExec: mockExec,
    ...overrides,
  };
}

function mockDocker(oldContainer: any, newContainer: any) {
  const getContainer = vi.fn((id: string) => {
    if (id === 'old-container-id') {
      return oldContainer;
    }
    if (id === 'new-container-id') {
      return newContainer;
    }
    throw new Error(`unexpected container id ${id}`);
  });

  mockDockerodeCtor.mockImplementation(function DockerodeMock() {
    return { getContainer };
  });
}

function getLoggedStates(): string[] {
  return (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([message]) =>
    String(message),
  );
}

describe('self-update-controller helpers', () => {
  beforeEach(() => {
    clearControllerEnv();
  });

  afterEach(() => {
    clearControllerEnv();
  });

  test('parsePositiveInt returns fallback for undefined, non-positive, and malformed inputs', () => {
    expect(testable_parsePositiveInt(undefined, 99)).toBe(99);
    expect(testable_parsePositiveInt('', 99)).toBe(99);
    expect(testable_parsePositiveInt('0', 99)).toBe(99);
    expect(testable_parsePositiveInt('-5', 99)).toBe(99);
    expect(testable_parsePositiveInt('abc', 99)).toBe(99);
    expect(testable_parsePositiveInt('10ms', 99)).toBe(99);
  });

  test('parsePositiveInt parses valid positive integers', () => {
    expect(testable_parsePositiveInt('42', 99)).toBe(42);
    expect(testable_parsePositiveInt(' 7 ', 99)).toBe(7);
  });

  test('getRequiredEnv throws on missing or whitespace-only env', () => {
    delete process.env.DD_SELF_UPDATE_OLD_CONTAINER_ID;
    process.env.DD_SELF_UPDATE_NEW_CONTAINER_ID = '   ';

    expect(() => testable_getRequiredEnv('DD_SELF_UPDATE_OLD_CONTAINER_ID')).toThrow(
      'Missing required environment variable: DD_SELF_UPDATE_OLD_CONTAINER_ID',
    );
    expect(() => testable_getRequiredEnv('DD_SELF_UPDATE_NEW_CONTAINER_ID')).toThrow(
      'Missing required environment variable: DD_SELF_UPDATE_NEW_CONTAINER_ID',
    );
  });
});

describe('self-update-controller orchestration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setControllerEnv();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    clearControllerEnv();
    vi.restoreAllMocks();
  });

  test('runs success path and commits by removing old container', async () => {
    const oldContainer = createOldContainer();
    const newContainer = createNewContainer();
    mockDocker(oldContainer, newContainer);

    await runSelfUpdateController();

    expect(oldContainer.stop).toHaveBeenCalledTimes(1);
    expect(newContainer.start).toHaveBeenCalledTimes(1);
    expect(oldContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(newContainer.remove).not.toHaveBeenCalled();
    expect(oldContainer.start).not.toHaveBeenCalled();
    expect(oldContainer.rename).not.toHaveBeenCalled();
    expect(newContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['node', 'dist/triggers/providers/docker/self-update-finalize-entrypoint.js'],
        Env: expect.arrayContaining([
          'DD_SELF_UPDATE_FINALIZE_URL=http://127.0.0.1:3000/api/v1/internal/self-update/finalize',
          'DD_SELF_UPDATE_FINALIZE_SECRET=self-update-finalize-secret',
          'DD_SELF_UPDATE_OPERATION_ID=op-123',
          'DD_SELF_UPDATE_STATUS=succeeded',
          'DD_SELF_UPDATE_PHASE=succeeded',
        ]),
      }),
    );
  });

  test('uses default op id and old container name when optional env vars are unset', async () => {
    setControllerEnv({
      DD_SELF_UPDATE_OP_ID: undefined,
      DD_SELF_UPDATE_OLD_CONTAINER_NAME: undefined,
    });
    const oldContainer = createOldContainer();
    const newContainer = createNewContainer();
    mockDocker(oldContainer, newContainer);

    await runSelfUpdateController();

    expect(getLoggedStates()).toContain(
      '[self-update:unknown] PREPARE - old=drydock(old-container-id), new=new-container-id',
    );
  });

  test('pins Dockerode to the probed socket API version when available', async () => {
    vi.mocked(probeSocketApiVersion).mockResolvedValue('1.44');
    const oldContainer = createOldContainer();
    const newContainer = createNewContainer();
    mockDocker(oldContainer, newContainer);

    await runSelfUpdateController();

    expect(mockDockerodeCtor).toHaveBeenCalledWith({
      socketPath: '/var/run/docker.sock',
      version: 'v1.44',
    });
  });

  test('handles healthcheck transition from starting to healthy', async () => {
    const oldContainer = createOldContainer();
    const newContainer = createNewContainer({
      inspect: vi
        .fn()
        .mockResolvedValueOnce({ State: { Running: true } })
        .mockResolvedValueOnce({ State: { Running: true, Health: { Status: 'starting' } } })
        .mockResolvedValueOnce({ State: { Running: true, Health: { Status: 'starting' } } })
        .mockResolvedValueOnce({ State: { Running: true, Health: { Status: 'healthy' } } }),
    });
    mockDocker(oldContainer, newContainer);

    await runSelfUpdateController();

    expect(newContainer.inspect).toHaveBeenCalledTimes(4);
    expect(oldContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(getLoggedStates()).toContain('[self-update:op-123] HEALTH_GATE');
  });

  test('handles healthcheck transition from missing status to healthy', async () => {
    const oldContainer = createOldContainer();
    const newContainer = createNewContainer({
      inspect: vi
        .fn()
        .mockResolvedValueOnce({ State: { Running: true, Health: {} } })
        .mockResolvedValueOnce({ State: { Running: true, Health: {} } })
        .mockResolvedValueOnce({ State: { Running: true, Health: {} } })
        .mockResolvedValueOnce({ State: { Running: true, Health: { Status: 'healthy' } } }),
    });
    mockDocker(oldContainer, newContainer);

    await runSelfUpdateController();

    expect(newContainer.inspect).toHaveBeenCalledTimes(4);
    expect(oldContainer.remove).toHaveBeenCalledWith({ force: true });
  });

  test('rolls back when healthcheck transitions to unhealthy', async () => {
    const oldContainer = createOldContainer({
      inspect: vi.fn().mockResolvedValue({ State: { Running: false }, Name: '/drydock-old-1' }),
    });
    const newContainer = createNewContainer({
      inspect: vi
        .fn()
        .mockResolvedValueOnce({ State: { Running: true } })
        .mockResolvedValueOnce({ State: { Running: true, Health: { Status: 'starting' } } })
        .mockResolvedValueOnce({ State: { Running: true, Health: { Status: 'unhealthy' } } }),
    });
    mockDocker(oldContainer, newContainer);

    await expect(runSelfUpdateController()).rejects.toThrow(
      'New container became unhealthy (new-container-id)',
    );

    expect(newContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(oldContainer.start).toHaveBeenCalledTimes(1);
    expect(oldContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['node', 'dist/triggers/providers/docker/self-update-finalize-entrypoint.js'],
        Env: expect.arrayContaining([
          'DD_SELF_UPDATE_FINALIZE_URL=http://127.0.0.1:3000/api/v1/internal/self-update/finalize',
          'DD_SELF_UPDATE_FINALIZE_SECRET=self-update-finalize-secret',
          'DD_SELF_UPDATE_OPERATION_ID=op-123',
          'DD_SELF_UPDATE_STATUS=rolled-back',
          'DD_SELF_UPDATE_PHASE=rolled-back',
          'DD_SELF_UPDATE_LAST_ERROR=New container became unhealthy (new-container-id)',
        ]),
      }),
    );
  });

  test('does not attempt rollback when success finalization callback fails after commit', async () => {
    const oldContainer = createOldContainer();
    const newContainer = createNewContainer({
      exec: vi.fn().mockRejectedValue(new Error('finalize unavailable')),
    });
    mockDocker(oldContainer, newContainer);

    await expect(runSelfUpdateController()).resolves.toBeUndefined();

    expect(oldContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(oldContainer.start).not.toHaveBeenCalled();
    expect(getLoggedStates()).toContain(
      '[self-update:op-123] FINALIZE_FAILED - finalize unavailable',
    );
  });

  test('times out waiting for old container to stop and rolls back', async () => {
    setControllerEnv({
      DD_SELF_UPDATE_START_TIMEOUT_MS: '3',
      DD_SELF_UPDATE_POLL_INTERVAL_MS: '1',
    });
    const oldContainer = createOldContainer({
      inspect: vi.fn().mockResolvedValue({ State: { Running: true }, Name: '/drydock' }),
    });
    const newContainer = createNewContainer();
    mockDocker(oldContainer, newContainer);

    await expect(runSelfUpdateController()).rejects.toThrow(
      'Timed out waiting for old container old-container-id to stop',
    );

    expect(newContainer.start).not.toHaveBeenCalled();
    expect(newContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(oldContainer.start).toHaveBeenCalledTimes(1);
  });

  test('times out waiting for new container to enter running state and rolls back', async () => {
    setControllerEnv({
      DD_SELF_UPDATE_START_TIMEOUT_MS: '3',
      DD_SELF_UPDATE_POLL_INTERVAL_MS: '1',
    });
    const oldContainer = createOldContainer();
    const newContainer = createNewContainer({
      inspect: vi.fn().mockResolvedValue({ State: { Running: false } }),
    });
    mockDocker(oldContainer, newContainer);

    await expect(runSelfUpdateController()).rejects.toThrow(
      'Timed out waiting for new container new-container-id to enter running state',
    );

    expect(newContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(oldContainer.start).toHaveBeenCalledTimes(1);
  });

  test('times out waiting for new container health and rolls back', async () => {
    setControllerEnv({
      DD_SELF_UPDATE_HEALTH_TIMEOUT_MS: '3',
      DD_SELF_UPDATE_POLL_INTERVAL_MS: '1',
    });
    const oldContainer = createOldContainer();
    let inspectCallCount = 0;
    const newContainer = createNewContainer({
      inspect: vi.fn().mockImplementation(() => {
        inspectCallCount += 1;
        if (inspectCallCount === 1) {
          return Promise.resolve({ State: { Running: true } });
        }
        return Promise.resolve({ State: { Running: true, Health: { Status: 'starting' } } });
      }),
    });
    mockDocker(oldContainer, newContainer);

    await expect(runSelfUpdateController()).rejects.toThrow(
      'Timed out waiting for new container new-container-id to become healthy',
    );

    expect(newContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(oldContainer.start).toHaveBeenCalledTimes(1);
  });

  test('handles rollback partial failures without masking original error', async () => {
    const oldContainer = createOldContainer({
      inspect: vi.fn().mockResolvedValue({ State: { Running: false }, Name: '/drydock-old-123' }),
      rename: vi.fn().mockRejectedValue(new Error('rename failed')),
      start: vi.fn().mockRejectedValue(new Error('restart failed')),
    });
    const newContainer = createNewContainer({
      start: vi.fn().mockRejectedValue(new Error('start failed')),
      remove: vi.fn().mockRejectedValue(new Error('candidate remove failed')),
    });
    mockDocker(oldContainer, newContainer);

    await expect(runSelfUpdateController()).rejects.toThrow('start failed');

    const logs = getLoggedStates();
    expect(logs).toContain('[self-update:op-123] CLEANUP_CANDIDATE');
    expect(logs).toContain(
      '[self-update:op-123] CLEANUP_CANDIDATE_FAILED - candidate remove failed',
    );
    expect(logs).toContain('[self-update:op-123] ROLLBACK_RESTORE_NAME_FAILED - rename failed');
    expect(logs).toContain('[self-update:op-123] ROLLBACK_START_OLD_FAILED - restart failed');
    expect(logs).toContain('[self-update:op-123] FAILED_WITH_ROLLBACK - start failed');
  });

  test('treats Docker 304 responses as already-stopped/already-started in forward path', async () => {
    const oldContainer = createOldContainer({
      stop: vi.fn().mockRejectedValue({ statusCode: 304, message: 'already stopped' }),
    });
    const newContainer = createNewContainer({
      start: vi.fn().mockRejectedValue({ status: 304, message: 'already started' }),
    });
    mockDocker(oldContainer, newContainer);

    await runSelfUpdateController();

    expect(oldContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(newContainer.remove).not.toHaveBeenCalled();
    expect(oldContainer.start).not.toHaveBeenCalled();
  });

  test('treats message-only already-stopped and already-started errors as benign', async () => {
    const oldContainer = createOldContainer({
      stop: vi.fn().mockRejectedValue(new Error('Container is not running')),
    });
    const newContainer = createNewContainer({
      start: vi.fn().mockRejectedValue(new Error('already started by another process')),
    });
    mockDocker(oldContainer, newContainer);

    await runSelfUpdateController();

    expect(oldContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(newContainer.remove).not.toHaveBeenCalled();
  });

  test('throws when old container stop fails with non-benign error', async () => {
    const oldContainer = createOldContainer({
      stop: vi.fn().mockRejectedValue(new Error('stop failed hard')),
    });
    const newContainer = createNewContainer();
    mockDocker(oldContainer, newContainer);

    await expect(runSelfUpdateController()).rejects.toThrow('stop failed hard');

    expect(newContainer.start).not.toHaveBeenCalled();
    expect(newContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(oldContainer.start).toHaveBeenCalledTimes(1);
  });

  test('keeps old container name unchanged when inspect name is missing during rollback', async () => {
    const oldContainer = createOldContainer({
      inspect: vi.fn().mockResolvedValue({ State: { Running: false } }),
    });
    const newContainer = createNewContainer({
      start: vi.fn().mockRejectedValue(new Error('start failed')),
    });
    mockDocker(oldContainer, newContainer);

    await expect(runSelfUpdateController()).rejects.toThrow('start failed');

    expect(oldContainer.rename).not.toHaveBeenCalled();
  });

  test('restores old container name when inspect name is present without leading slash', async () => {
    const oldContainer = createOldContainer({
      inspect: vi.fn().mockResolvedValue({ State: { Running: false }, Name: 'drydock-old-123' }),
    });
    const newContainer = createNewContainer({
      start: vi.fn().mockRejectedValue(new Error('start failed')),
    });
    mockDocker(oldContainer, newContainer);

    await expect(runSelfUpdateController()).rejects.toThrow('start failed');

    expect(oldContainer.rename).toHaveBeenCalledWith({ name: 'drydock' });
  });

  test('does not log rollback-start failure when old container start returns 304', async () => {
    const oldContainer = createOldContainer({
      inspect: vi.fn().mockResolvedValue({ State: { Running: false }, Name: '/drydock' }),
      start: vi.fn().mockRejectedValue({ statusCode: 304, message: 'already started' }),
    });
    const newContainer = createNewContainer({
      start: vi.fn().mockRejectedValue(new Error('start failed')),
    });
    mockDocker(oldContainer, newContainer);

    await expect(runSelfUpdateController()).rejects.toThrow('start failed');

    expect(getLoggedStates().some((line) => line.includes('ROLLBACK_START_OLD_FAILED'))).toBe(
      false,
    );
  });

  test('does not log rollback-start failure when old container start rejects with already-started string', async () => {
    const oldContainer = createOldContainer({
      inspect: vi.fn().mockResolvedValue({ State: { Running: false }, Name: '/drydock' }),
      start: vi.fn().mockRejectedValue('already started by another process'),
    });
    const newContainer = createNewContainer({
      start: vi.fn().mockRejectedValue(new Error('start failed')),
    });
    mockDocker(oldContainer, newContainer);

    await expect(runSelfUpdateController()).rejects.toThrow('start failed');

    expect(getLoggedStates().some((line) => line.includes('ROLLBACK_START_OLD_FAILED'))).toBe(
      false,
    );
  });

  test('fails early when required env is missing', async () => {
    clearControllerEnv();
    process.env.DD_SELF_UPDATE_NEW_CONTAINER_ID = 'new-container-id';

    await expect(runSelfUpdateController()).rejects.toThrow(
      'Missing required environment variable: DD_SELF_UPDATE_OLD_CONTAINER_ID',
    );
  });

  test('entrypoint should log failures and set process exitCode', async () => {
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    await runSelfUpdateControllerEntrypoint(async () => {
      throw new Error('entrypoint boom');
    });

    expect(console.error).toHaveBeenCalledWith('[self-update] controller failed: entrypoint boom');
    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
  });
});
