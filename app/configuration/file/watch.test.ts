import log from '../../log/index.js';
import { getConfigFileInfo, resetConfigFileLayer, setConfigFileLayer } from './layer.js';

interface FakeWatcher {
  close: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  emitError(error: unknown): void;
}

function createFakeWatcher(): FakeWatcher {
  let errorHandler: ((error: unknown) => void) | undefined;
  return {
    close: vi.fn(),
    unref: vi.fn(),
    on: vi.fn((event: string, handler: (error: unknown) => void) => {
      if (event === 'error') {
        errorHandler = handler;
      }
    }),
    emitError(error: unknown) {
      errorHandler?.(error);
    },
  };
}

const mockWatchFn = vi.hoisted(() => vi.fn());
let capturedListener: ((eventType: string, filename: string | Buffer | null) => void) | undefined;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    watch: (...args: unknown[]) => mockWatchFn(...args),
  };
});

const { startConfigFileWatch } = await import('./watch.js');

describe('startConfigFileWatch', () => {
  let fakeWatcher: FakeWatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeWatcher = createFakeWatcher();
    capturedListener = undefined;
    mockWatchFn.mockReset();
    mockWatchFn.mockImplementation(
      (_path: string, listener: (eventType: string, filename: string | Buffer | null) => void) => {
        capturedListener = listener;
        return fakeWatcher;
      },
    );
    resetConfigFileLayer();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetConfigFileLayer();
  });

  function fireFileEvent(filename: string | Buffer | null = 'drydock.yml'): void {
    capturedListener?.('change', filename);
  }

  test('returns undefined and never touches fs.watch when no config file was discovered at boot', async () => {
    const handle = await startConfigFileWatch({ reload: vi.fn() });

    expect(handle).toBeUndefined();
    expect(mockWatchFn).not.toHaveBeenCalled();
  });

  test('defaults to the file discovered at boot and the real reload path when neither is overridden', async () => {
    setConfigFileLayer({}, new Set(), {
      path: '/tmp/drydock.yml',
      modifiedAt: new Date().toISOString(),
    });

    const handle = await startConfigFileWatch();

    expect(getConfigFileInfo()?.path).toBe('/tmp/drydock.yml');
    // Watches the file's directory, not the file itself (fix for the watch
    // going dead after write.ts's rename-based atomic save replaces the
    // inode a direct file watch is attached to) — see /tmp above.
    expect(mockWatchFn).toHaveBeenCalledWith('/tmp', expect.any(Function));
    expect(handle).toBeDefined();
  });

  test('watches the overridden file path instead of the one discovered at boot', async () => {
    const reload = vi.fn().mockResolvedValue({ applied: true, errors: [], diff: emptyDiff() });

    await startConfigFileWatch({ filePath: '/tmp/override.yml', reload });

    expect(mockWatchFn).toHaveBeenCalledWith('/tmp', expect.any(Function));
  });

  test('ignores an event for another file in the watched directory', async () => {
    const reload = vi.fn().mockResolvedValue({ applied: true, errors: [], diff: emptyDiff() });

    await startConfigFileWatch({ filePath: '/tmp/drydock.yml', reload, debounceMs: 10 });
    fireFileEvent('some-other-file.yml');
    await vi.advanceTimersByTimeAsync(10);

    expect(reload).not.toHaveBeenCalled();
  });

  test('treats a null filename as a match, rather than filtering it out', async () => {
    const reload = vi.fn().mockResolvedValue({ applied: true, errors: [], diff: emptyDiff() });

    await startConfigFileWatch({ filePath: '/tmp/drydock.yml', reload, debounceMs: 10 });
    fireFileEvent(null);
    await vi.advanceTimersByTimeAsync(10);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('reloads on an event whose filename matches the watched file basename', async () => {
    const reload = vi.fn().mockResolvedValue({ applied: true, errors: [], diff: emptyDiff() });

    await startConfigFileWatch({ filePath: '/tmp/drydock.yml', reload, debounceMs: 10 });
    fireFileEvent('drydock.yml');
    await vi.advanceTimersByTimeAsync(10);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('returns undefined and logs an error when fs.watch throws synchronously', async () => {
    const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => undefined as never);
    mockWatchFn.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    const handle = await startConfigFileWatch({ filePath: '/tmp/drydock.yml', reload: vi.fn() });

    expect(handle).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
    errorSpy.mockRestore();
  });

  test('unrefs the underlying watch handle so it cannot hold the process open', async () => {
    const reload = vi.fn().mockResolvedValue({ applied: true, errors: [], diff: emptyDiff() });

    await startConfigFileWatch({ filePath: '/tmp/drydock.yml', reload });

    expect(fakeWatcher.unref).toHaveBeenCalledTimes(1);
  });

  test('debounces a burst of change events into a single reload', async () => {
    const reload = vi.fn().mockResolvedValue({ applied: true, errors: [], diff: emptyDiff() });

    await startConfigFileWatch({ filePath: '/tmp/drydock.yml', reload, debounceMs: 50 });

    fireFileEvent();
    vi.advanceTimersByTime(10);
    fireFileEvent();
    vi.advanceTimersByTime(10);
    fireFileEvent();
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('queues a change event that arrives while a reload is already in flight, running one more reload once it settles', async () => {
    let resolveReload:
      | ((result: { applied: boolean; errors: unknown[]; diff: unknown }) => void)
      | undefined;
    const reload = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveReload = resolve;
        }),
    );

    await startConfigFileWatch({ filePath: '/tmp/drydock.yml', reload, debounceMs: 10 });

    fireFileEvent();
    await vi.advanceTimersByTimeAsync(10);
    expect(reload).toHaveBeenCalledTimes(1);

    // A second (and third) change arrive mid-reload — queued, not dropped,
    // and not acted on until the in-flight reload settles.
    fireFileEvent();
    await vi.advanceTimersByTimeAsync(10);
    fireFileEvent();
    await vi.advanceTimersByTimeAsync(10);
    expect(reload).toHaveBeenCalledTimes(1);

    resolveReload?.({ applied: true, errors: [], diff: emptyDiff() });
    await vi.runOnlyPendingTimersAsync();
    // The queued signal runs through the same debounce as any other event.
    await vi.advanceTimersByTimeAsync(10);

    // Exactly one follow-up reload runs for the whole queued burst, not one
    // per queued event.
    expect(reload).toHaveBeenCalledTimes(2);
  });

  test('close() during an in-flight reload does not schedule another reload once it settles', async () => {
    let resolveReload:
      | ((result: { applied: boolean; errors: unknown[]; diff: unknown }) => void)
      | undefined;
    const reload = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveReload = resolve;
        }),
    );

    const handle = await startConfigFileWatch({
      filePath: '/tmp/drydock.yml',
      reload,
      debounceMs: 10,
    });

    fireFileEvent();
    await vi.advanceTimersByTimeAsync(10);
    expect(reload).toHaveBeenCalledTimes(1);

    // A second change arrives mid-reload, queuing a follow-up reload.
    fireFileEvent();

    handle?.close();
    resolveReload?.({ applied: true, errors: [], diff: emptyDiff() });
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(10);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('logs a warning and does not throw when a triggered reload is refused', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined as never);
    const reload = vi.fn().mockResolvedValue({
      applied: false,
      errors: [{ path: 'security.scanner', envKey: 'DD_SECURITY_SCANNER', message: 'bad' }],
      diff: emptyDiff(),
    });

    await startConfigFileWatch({ filePath: '/tmp/drydock.yml', reload, debounceMs: 10 });
    fireFileEvent();
    await vi.advanceTimersByTimeAsync(10);
    await vi.runOnlyPendingTimersAsync();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('refused'));
    warnSpy.mockRestore();
  });

  test('logs an error and does not crash when the reload promise rejects', async () => {
    const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => undefined as never);
    const reload = vi.fn().mockRejectedValue(new Error('boom'));

    await startConfigFileWatch({ filePath: '/tmp/drydock.yml', reload, debounceMs: 10 });
    fireFileEvent();
    await vi.advanceTimersByTimeAsync(10);
    await vi.runOnlyPendingTimersAsync();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    errorSpy.mockRestore();
  });

  test('logs an error and does not crash when the underlying watch handle emits an error', async () => {
    const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => undefined as never);
    const reload = vi.fn().mockResolvedValue({ applied: true, errors: [], diff: emptyDiff() });

    await startConfigFileWatch({ filePath: '/tmp/drydock.yml', reload });
    fakeWatcher.emitError(new Error('watch died'));

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('watch died'));
    errorSpy.mockRestore();
  });

  test('close() clears a pending debounce timer and stops the underlying watch', async () => {
    const reload = vi.fn().mockResolvedValue({ applied: true, errors: [], diff: emptyDiff() });

    const handle = await startConfigFileWatch({
      filePath: '/tmp/drydock.yml',
      reload,
      debounceMs: 50,
    });
    fireFileEvent();

    handle?.close();
    await vi.advanceTimersByTimeAsync(100);

    expect(reload).not.toHaveBeenCalled();
    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
  });

  test('close() is safe to call when no debounce timer is pending', async () => {
    const reload = vi.fn().mockResolvedValue({ applied: true, errors: [], diff: emptyDiff() });

    const handle = await startConfigFileWatch({ filePath: '/tmp/drydock.yml', reload });

    expect(() => handle?.close()).not.toThrow();
    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
  });
});

function emptyDiff() {
  return { changed: [], reload: [], restart: [] };
}
