import {
  acquirePullSlot,
  detectPullThrottle,
  getPullPacingState,
  normalizePullRegistryHost,
  PULL_BACKOFF_BASE_MS,
  PULL_BACKOFF_MAX_MS,
  parseRetryAfterMs,
  reportPullSuccess,
  reportPullThrottle,
  resetPullPacing,
} from './pull-pacing.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-18T00:00:00Z'));
  resetPullPacing();
});

afterEach(() => {
  resetPullPacing();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('normalizePullRegistryHost', () => {
  test.each([
    ['nginx:1', 'docker.io'],
    ['library/nginx:1', 'docker.io'],
    ['docker.io/library/nginx:1', 'docker.io'],
    ['index.docker.io/library/nginx:1', 'docker.io'],
    ['registry-1.docker.io/library/nginx:1', 'docker.io'],
    ['REGISTRY.HUB.DOCKER.COM/x/y:1', 'docker.io'],
    ['ghcr.io/org/app:1', 'ghcr.io'],
    ['GHCR.io/org/app@sha256:abc', 'ghcr.io'],
    ['localhost/app:1', 'localhost'],
    ['myreg:5000/app:1', 'myreg:5000'],
    ['app.example:1', 'docker.io'],
  ])('%s -> %s', (reference, host) => {
    expect(normalizePullRegistryHost(reference)).toBe(host);
  });
});

describe('concurrency bound and fairness', () => {
  test('bounds concurrent pulls per registry and grants FIFO', async () => {
    const order: string[] = [];
    const r1 = await acquirePullSlot('ghcr.io', { limit: 2 });
    const r2 = await acquirePullSlot('ghcr.io', { limit: 2 });
    const p3 = acquirePullSlot('ghcr.io', { limit: 2 }).then((r) => {
      order.push('3');
      return r;
    });
    const p4 = acquirePullSlot('ghcr.io', { limit: 2 }).then((r) => {
      order.push('4');
      return r;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([]);
    expect(getPullPacingState('ghcr.io')).toMatchObject({ active: 2, queued: 2 });

    r1();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['3']);
    r2();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['3', '4']);
    (await p3)();
    (await p4)();
    expect(getPullPacingState('ghcr.io')).toEqual({
      active: 0,
      queued: 0,
      blockedUntil: undefined,
    });
  });

  test('release is idempotent', async () => {
    const r1 = await acquirePullSlot('ghcr.io', { limit: 1 });
    r1();
    r1();
    const r2 = await acquirePullSlot('ghcr.io', { limit: 1 });
    expect(getPullPacingState('ghcr.io').active).toBe(1);
    r2();
  });

  test('defaults the limit', async () => {
    const releases = [await acquirePullSlot('a.io'), await acquirePullSlot('a.io')];
    expect(getPullPacingState('a.io').active).toBe(2);
    releases.forEach((r) => r());
  });

  test('registries are independent', async () => {
    const a = await acquirePullSlot('a.io', { limit: 1 });
    const waitingA = acquirePullSlot('a.io', { limit: 1 });
    const b = await acquirePullSlot('b.io', { limit: 1 });
    expect(getPullPacingState('b.io').active).toBe(1);
    expect(getPullPacingState('a.io').queued).toBe(1);
    a();
    (await waitingA)();
    b();
  });
});

describe('abort while queued', () => {
  test('removes the waiter without leaking a permit', async () => {
    const holder = await acquirePullSlot('a.io', { limit: 1 });
    const controller = new AbortController();
    const queued = acquirePullSlot('a.io', { limit: 1, signal: controller.signal });
    const behind = acquirePullSlot('a.io', { limit: 1 });
    expect(getPullPacingState('a.io').queued).toBe(2);

    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(queued).rejects.toBe(reason);
    expect(getPullPacingState('a.io').queued).toBe(1);

    holder();
    const release = await behind;
    expect(getPullPacingState('a.io').active).toBe(1);
    release();
    expect(getPullPacingState('a.io').active).toBe(0);
  });

  test('rejects immediately when already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('early'));
    await expect(acquirePullSlot('a.io', { signal: controller.signal })).rejects.toThrow('early');
    expect(getPullPacingState('a.io')).toMatchObject({ active: 0, queued: 0 });
  });

  test('a granted waiter ignores a later abort', async () => {
    const controller = new AbortController();
    const release = await acquirePullSlot('a.io', { limit: 1, signal: controller.signal });
    controller.abort(new Error('late'));
    expect(getPullPacingState('a.io').active).toBe(1);
    release();
  });
});

describe('throttle backoff', () => {
  test('honors Retry-After and defers only that registry', async () => {
    const log = { warn: vi.fn() };
    const holder = await acquirePullSlot('a.io', { limit: 1 });
    const queued = vi.fn();
    void acquirePullSlot('a.io', { limit: 1 }).then(queued);

    expect(reportPullThrottle('a.io', 30_000, log)).toBe(30_000);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Retry-After'));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('1 pending'));

    holder();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(queued).not.toHaveBeenCalled();

    // Another registry proceeds during the backoff.
    const other = await acquirePullSlot('b.io', { limit: 1 });
    expect(getPullPacingState('b.io').active).toBe(1);
    other();

    await vi.advanceTimersByTimeAsync(1);
    expect(queued).toHaveBeenCalledTimes(1);
    queued.mock.calls[0][0]();
  });

  test('a new acquire during backoff waits for it', async () => {
    reportPullThrottle('a.io', 10_000);
    const granted = vi.fn();
    void acquirePullSlot('a.io').then(granted);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(granted).not.toHaveBeenCalled();
    expect(getPullPacingState('a.io').blockedUntil).toBeDefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(granted).toHaveBeenCalledTimes(1);
    granted.mock.calls[0][0]();
  });

  test('exponential backoff with jitter, capped, reset on success', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(reportPullThrottle('a.io', undefined)).toBe(PULL_BACKOFF_BASE_MS);
    expect(reportPullThrottle('a.io', undefined)).toBe(PULL_BACKOFF_BASE_MS * 2);
    expect(reportPullThrottle('a.io', undefined)).toBe(PULL_BACKOFF_BASE_MS * 4);
    for (let i = 0; i < 10; i++) {
      reportPullThrottle('a.io', undefined);
    }
    expect(reportPullThrottle('a.io', undefined)).toBe(PULL_BACKOFF_MAX_MS);

    reportPullSuccess('a.io');
    expect(reportPullThrottle('a.io', undefined)).toBe(PULL_BACKOFF_BASE_MS);

    vi.spyOn(Math, 'random').mockReturnValue(1);
    reportPullSuccess('a.io');
    expect(reportPullThrottle('a.io', undefined)).toBe(Math.round(PULL_BACKOFF_BASE_MS * 1.25));
  });

  test('logs the exponential backoff variant', () => {
    const log = { warn: vi.fn() };
    reportPullThrottle('a.io', undefined, log);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('exponential backoff'));
  });

  test('reset clears a pending backoff timer', async () => {
    reportPullThrottle('a.io', 60_000);
    void acquirePullSlot('a.io');
    expect(vi.getTimerCount()).toBe(1);
    resetPullPacing();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('Retry-After is capped at the maximum', () => {
    expect(reportPullThrottle('a.io', 6 * 3600_000)).toBe(PULL_BACKOFF_MAX_MS);
  });

  test('a shorter later throttle never shortens the block', async () => {
    reportPullThrottle('a.io', 60_000);
    reportPullThrottle('a.io', 1_000);
    const granted = vi.fn();
    void acquirePullSlot('a.io').then(granted);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(granted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    granted.mock.calls[0][0]();
  });

  test('reportPullSuccess on an unknown registry is a no-op', () => {
    expect(() => reportPullSuccess('nowhere.io')).not.toThrow();
  });

  test('aborting the head waiter during backoff clears cleanly', async () => {
    reportPullThrottle('a.io', 60_000);
    const controller = new AbortController();
    const queued = acquirePullSlot('a.io', { signal: controller.signal });
    controller.abort(new Error('stop'));
    await expect(queued).rejects.toThrow('stop');
    expect(getPullPacingState('a.io').queued).toBe(0);
  });
});

describe('error classification', () => {
  test('parseRetryAfterMs handles seconds, dates and junk', () => {
    const now = Date.parse('2026-11-18T00:00:00Z');
    expect(parseRetryAfterMs(5)).toBe(5000);
    expect(parseRetryAfterMs(-1)).toBeUndefined();
    expect(parseRetryAfterMs(' 12 ')).toBe(12_000);
    expect(parseRetryAfterMs('Wed, 18 Nov 2026 00:01:00 GMT', now)).toBe(60_000);
    expect(parseRetryAfterMs('Tue, 17 Nov 2026 00:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfterMs('soon')).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
  });

  test('detects 429 without Retry-After', () => {
    expect(detectPullThrottle({ statusCode: 429, message: 'x' })).toEqual({
      retryAfterMs: undefined,
    });
    expect(
      detectPullThrottle(new Error('toomanyrequests: You have reached your pull rate limit')),
    ).toEqual({ retryAfterMs: undefined });
  });

  test('detects 429 with Retry-After from headers or message', () => {
    expect(detectPullThrottle({ statusCode: 429, headers: { 'retry-after': '7' } })).toEqual({
      retryAfterMs: 7000,
    });
    expect(detectPullThrottle({ statusCode: 429, headers: { 'Retry-After': 3 } })).toEqual({
      retryAfterMs: 3000,
    });
    expect(detectPullThrottle({ statusCode: 429, headers: {} })).toEqual({
      retryAfterMs: undefined,
    });
    expect(detectPullThrottle(new Error('429 Too Many Requests, Retry-After: 15'))).toEqual({
      retryAfterMs: 15_000,
    });
  });

  test('ignores unrelated errors', () => {
    expect(detectPullThrottle(new Error('connection refused'))).toBeUndefined();
    expect(detectPullThrottle(undefined)).toBeUndefined();
  });
});
