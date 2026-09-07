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
let capturedListener: (() => void) | undefined;

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
    mockWatchFn.mockImplementation((_path: string, listener: () => void) => {
      capturedListener = listener;
      return fakeWatcher;
    });
    resetConfigFileLayer();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetConfigFileLayer();
  });

  function fireFileEvent(): void {
    capturedListener?.();
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
    expect(mockWatchFn).toHaveBeenCalledWith('/tmp/drydock.yml', expect.any(Function));
    expect(handle).toBeDefined();
  });

  test('watches the overridden file path instead of the one discovered at boot', async () => {
    const reload = vi.fn().mockResolvedValue({ applied: true, errors: [], diff: emptyDiff() });

    await startConfigFileWatch({ filePath: '/tmp/override.yml', reload });

    expect(mockWatchFn).toHaveBeenCalledWith('/tmp/override.yml', expect.any(Function));
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

  test('ignores a change event that arrives while a reload is already in flight', async () => {
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

    // A second change arrives mid-reload — ignored, not queued.
    fireFileEvent();
    await vi.advanceTimersByTimeAsync(10);
    expect(reload).toHaveBeenCalledTimes(1);

    resolveReload?.({ applied: true, errors: [], diff: emptyDiff() });
    await vi.runOnlyPendingTimersAsync();

    // Once the in-flight reload settles, a later change fires its own event.
    fireFileEvent();
    await vi.advanceTimersByTimeAsync(10);
    expect(reload).toHaveBeenCalledTimes(2);
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
