import {
  configurationValid,
  createMockLog,
  docker,
  registerCommonDockerBeforeEach,
} from './Docker.test.helpers.js';
import { getPullPacingState, resetPullPacing } from './pull-pacing.js';

registerCommonDockerBeforeEach();

function deferredPull() {
  let finish: (error?: Error) => void = () => undefined;
  const dockerApi = {
    pull: vi.fn().mockResolvedValue({}),
    modem: {
      followProgress: vi.fn((_stream, done) => {
        finish = (error) => done(error ?? null, []);
      }),
    },
  };
  return { dockerApi, finish: (error?: Error) => finish(error) };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetPullPacing();
  (docker.pullImage as unknown as { mockRestore?: () => void }).mockRestore?.();
});

afterEach(() => {
  resetPullPacing();
  vi.useRealTimers();
  docker.configuration = { ...configurationValid };
});

test('pulls from one registry share the configured bound and other registries proceed', async () => {
  docker.configuration = { ...configurationValid, pullconcurrency: 1 };
  const first = deferredPull();
  const second = deferredPull();
  const other = deferredPull();
  const logContainer = createMockLog('info', 'warn', 'debug');

  const p1 = docker.pullImage(
    first.dockerApi,
    undefined,
    'registry-1.docker.io/a/b:1',
    logContainer,
  );
  await vi.advanceTimersByTimeAsync(0);
  const p2 = docker.pullImage(second.dockerApi, undefined, 'a/c:1', logContainer);
  const p3 = docker.pullImage(other.dockerApi, undefined, 'ghcr.io/a/b:1', logContainer);
  await vi.advanceTimersByTimeAsync(0);

  expect(first.dockerApi.pull).toHaveBeenCalledTimes(1);
  expect(second.dockerApi.pull).not.toHaveBeenCalled();
  expect(other.dockerApi.pull).toHaveBeenCalledTimes(1);
  expect(logContainer.info).toHaveBeenCalledWith(
    'Pull image a/c:1 is waiting for a docker.io pull slot',
  );

  first.finish();
  await p1;
  await vi.advanceTimersByTimeAsync(0);
  expect(second.dockerApi.pull).toHaveBeenCalledWith(
    'a/c:1',
    expect.objectContaining({ authconfig: undefined }),
  );
  second.finish();
  other.finish();
  await Promise.all([p2, p3]);
  expect(getPullPacingState('docker.io').active).toBe(0);
  expect(getPullPacingState('ghcr.io').active).toBe(0);
});

test('a 429 pull error defers the next pull on that registry', async () => {
  const logContainer = createMockLog('info', 'warn', 'debug');
  const failing = {
    pull: vi.fn().mockRejectedValue(
      Object.assign(new Error('toomanyrequests'), {
        statusCode: 429,
        headers: { 'retry-after': '20' },
      }),
    ),
    modem: { followProgress: vi.fn() },
  };
  await expect(docker.pullImage(failing, undefined, 'a/b:1', logContainer)).rejects.toThrow(
    'toomanyrequests',
  );
  expect(logContainer.warn).toHaveBeenCalledWith(expect.stringContaining('throttled image pulls'));

  const next = deferredPull();
  const pending = docker.pullImage(next.dockerApi, undefined, 'a/c:1', logContainer);
  await vi.advanceTimersByTimeAsync(19_999);
  expect(next.dockerApi.pull).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(next.dockerApi.pull).toHaveBeenCalledTimes(1);
  next.finish();
  await pending;
});

test('a pull timeout releases the slot', async () => {
  docker.configuration = { ...configurationValid, pulltimeout: 1000, pullconcurrency: 1 };
  const hung = deferredPull();
  const logContainer = createMockLog('info', 'warn', 'debug');
  const timedOut = docker.pullImage(hung.dockerApi, undefined, 'a/b:1', logContainer);
  const timedOutAssertion = expect(timedOut).rejects.toThrow('timed out after 1000ms');
  await vi.advanceTimersByTimeAsync(1000);
  await timedOutAssertion;
  expect(getPullPacingState('docker.io').active).toBe(0);

  const next = deferredPull();
  const pending = docker.pullImage(next.dockerApi, undefined, 'a/c:1', logContainer);
  await vi.advanceTimersByTimeAsync(0);
  expect(next.dockerApi.pull).toHaveBeenCalledTimes(1);
  next.finish();
  await pending;
});

test('a non-throttle failure does not back off the registry', async () => {
  const logContainer = createMockLog('info', 'warn', 'debug');
  const failing = {
    pull: vi.fn().mockRejectedValue(new Error('manifest unknown')),
    modem: { followProgress: vi.fn() },
  };
  await expect(docker.pullImage(failing, undefined, 'a/b:1', logContainer)).rejects.toThrow(
    'manifest unknown',
  );
  expect(getPullPacingState('docker.io').blockedUntil).toBeUndefined();
});
