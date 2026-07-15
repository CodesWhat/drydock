import { runInNewContext } from 'node:vm';
import { describe, expect, test, vi } from 'vitest';
import { createTrivyDatabaseWarmup } from './trivy-warmup.js';

function enabledLocalConfiguration() {
  return {
    enabled: true,
    scanner: 'trivy',
    trivy: { command: 'trivy', server: '' },
  };
}

describe('createTrivyDatabaseWarmup', () => {
  test('runs the local Trivy database-only command with its separate timeout', async () => {
    const run = vi.fn(async () => undefined);
    const warmup = createTrivyDatabaseWarmup({
      getConfiguration: enabledLocalConfiguration,
      run,
      timeoutMs: 300_000,
    });

    await expect(warmup()).resolves.toBe('ready');

    expect(run).toHaveBeenCalledWith({
      command: 'trivy',
      args: ['image', '--download-db-only', '--timeout', '300s'],
      timeoutMs: 300_000,
    });
  });

  test.each([
    { enabled: false, scanner: '', trivy: { command: 'trivy', server: '' } },
    {
      enabled: true,
      scanner: 'trivy',
      trivy: { command: 'trivy', server: 'http://trivy:4954' },
    },
    { enabled: true, scanner: 'grype', trivy: { command: 'trivy', server: '' } },
  ])('skips warm-up when local Trivy scanning is not active', async (configuration) => {
    const run = vi.fn(async () => undefined);
    const warmup = createTrivyDatabaseWarmup({
      getConfiguration: () => configuration,
      run,
      timeoutMs: 300_000,
    });

    await expect(warmup()).resolves.toBe('skipped');
    expect(run).not.toHaveBeenCalled();
  });

  test('shares one in-flight warm-up between concurrent callers', async () => {
    let finish!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const warmup = createTrivyDatabaseWarmup({
      getConfiguration: enabledLocalConfiguration,
      run,
      timeoutMs: 300_000,
    });

    const first = warmup();
    const second = warmup();
    expect(run).toHaveBeenCalledTimes(1);

    finish();
    await expect(Promise.all([first, second])).resolves.toEqual(['ready', 'ready']);
  });

  test('does not let a stale completion clear a newer in-flight retry', async () => {
    let finishRetry!: () => void;
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('registry unavailable'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishRetry = resolve;
          }),
      );
    const warmup = createTrivyDatabaseWarmup({
      getConfiguration: enabledLocalConfiguration,
      run,
      timeoutMs: 300_000,
    });

    const nativeThen = runInNewContext('Promise.prototype.then') as typeof Promise.prototype.then;
    const originalThen = Promise.prototype.then;
    let replayStaleCleanup: (() => unknown) | undefined;
    Promise.prototype.then = function (
      this: Promise<unknown>,
      onFulfilled?: ((value: unknown) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) {
      return Reflect.apply(nativeThen, this, [
        (value: unknown) => {
          const result = onFulfilled?.(value);
          replayStaleCleanup = () => onFulfilled?.(value);
          return result;
        },
        onRejected,
      ]);
    } as typeof Promise.prototype.then;

    let failedAttempt: Promise<'ready' | 'skipped' | 'failed'>;
    try {
      failedAttempt = warmup();
    } finally {
      Promise.prototype.then = originalThen;
    }
    await expect(failedAttempt).resolves.toBe('failed');
    expect(replayStaleCleanup).toBeTypeOf('function');

    const retry = warmup();
    replayStaleCleanup?.();
    const concurrent = warmup();

    expect(run).toHaveBeenCalledTimes(2);
    finishRetry();
    await expect(Promise.all([retry, concurrent])).resolves.toEqual(['ready', 'ready']);
  });

  test('keeps the successful result ready without downloading again', async () => {
    const run = vi.fn(async () => undefined);
    const warmup = createTrivyDatabaseWarmup({
      getConfiguration: enabledLocalConfiguration,
      run,
      timeoutMs: 300_000,
    });

    await warmup();
    await expect(warmup()).resolves.toBe('ready');

    expect(run).toHaveBeenCalledTimes(1);
  });

  test('reports a failure without rejecting and permits a later retry', async () => {
    const failure = new Error('registry unavailable');
    const onFailure = vi.fn();
    const run = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
    const warmup = createTrivyDatabaseWarmup({
      getConfiguration: enabledLocalConfiguration,
      run,
      onFailure,
      timeoutMs: 300_000,
    });

    await expect(warmup()).resolves.toBe('failed');
    await expect(warmup()).resolves.toBe('ready');

    expect(run).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(failure);
  });

  test('reuses a recent failure until the configured cooldown expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00Z'));
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('registry unavailable'))
      .mockResolvedValueOnce(undefined);
    const warmup = createTrivyDatabaseWarmup({
      getConfiguration: enabledLocalConfiguration,
      run,
      timeoutMs: 300_000,
      failureCooldownMs: 15 * 60 * 1000,
    });

    await expect(warmup()).resolves.toBe('failed');
    await expect(warmup()).resolves.toBe('failed');
    expect(run).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    await expect(warmup()).resolves.toBe('ready');
    expect(run).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  test('permits retry when configuration lookup fails before command execution', async () => {
    const getConfiguration = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('configuration unavailable');
      })
      .mockReturnValueOnce(enabledLocalConfiguration());
    const run = vi.fn(async () => undefined);
    const warmup = createTrivyDatabaseWarmup({
      getConfiguration,
      run,
      timeoutMs: 300_000,
    });

    await expect(warmup()).resolves.toBe('failed');
    await expect(warmup()).resolves.toBe('ready');

    expect(getConfiguration).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledOnce();
  });

  test('executes warm-up through the supplied serializer', async () => {
    const events: string[] = [];
    const execute = vi.fn(async (operation: () => Promise<void>) => {
      events.push('queued');
      await operation();
    });
    const run = vi.fn(async () => {
      events.push('ran');
    });
    const warmup = createTrivyDatabaseWarmup({
      getConfiguration: enabledLocalConfiguration,
      execute,
      run,
      timeoutMs: 300_000,
    });

    await warmup();

    expect(execute).toHaveBeenCalledOnce();
    expect(events).toEqual(['queued', 'ran']);
  });

  test('falls back to the trivy command when the configured command is blank', async () => {
    const run = vi.fn(async () => undefined);
    const warmup = createTrivyDatabaseWarmup({
      getConfiguration: () => ({
        ...enabledLocalConfiguration(),
        trivy: { command: '   ', server: '' },
      }),
      run,
      timeoutMs: 300_000,
    });

    await warmup();

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ command: 'trivy' }));
  });

  test('falls back to the trivy command when the configured command is undefined', async () => {
    const run = vi.fn(async () => undefined);
    const warmup = createTrivyDatabaseWarmup({
      getConfiguration: () => ({
        ...enabledLocalConfiguration(),
        trivy: { command: undefined, server: '' },
      }),
      run,
      timeoutMs: 300_000,
    });

    await warmup();

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ command: 'trivy' }));
  });

  test('uses whole-second ceiling for the Trivy database deadline', async () => {
    const run = vi.fn(async () => undefined);
    const warmup = createTrivyDatabaseWarmup({
      getConfiguration: enabledLocalConfiguration,
      run,
      timeoutMs: 1_001,
    });

    await warmup();

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['image', '--download-db-only', '--timeout', '2s'] }),
    );
  });

  test('uses a minimum one-second Trivy database deadline', async () => {
    const run = vi.fn(async () => undefined);
    const warmup = createTrivyDatabaseWarmup({
      getConfiguration: enabledLocalConfiguration,
      run,
      timeoutMs: 0,
    });

    await warmup();

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['image', '--download-db-only', '--timeout', '1s'] }),
    );
  });

  test('swallows observer failures while reporting a failed warm-up', async () => {
    const warmup = createTrivyDatabaseWarmup({
      getConfiguration: enabledLocalConfiguration,
      run: vi.fn().mockRejectedValue(new Error('registry unavailable')),
      timeoutMs: 300_000,
      onFailure: () => {
        throw new Error('observer failed');
      },
    });

    await expect(warmup()).resolves.toBe('failed');
  });
});
