import type { PreferencesSchema } from '@/preferences/schema';

const mocks = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
  migrate: vi.fn((value: unknown) => value),
  applyFontSize: vi.fn(),
  applyRadius: vi.fn(),
  setI18nLocale: vi.fn(),
  nextTick: vi.fn<() => Promise<void>>(),
  watchCallbacks: [] as Array<() => void>,
  listeners: new Map<string, EventListener>(),
}));

vi.mock('@/services/preferences', () => ({
  getPreferences: mocks.getPreferences,
  updatePreferences: mocks.updatePreferences,
}));
vi.mock('@/preferences/migrate', () => ({ migrate: mocks.migrate }));
vi.mock('@/preferences/font-size', () => ({ applyFontSize: mocks.applyFontSize }));
vi.mock('@/preferences/radius', () => ({ applyRadius: mocks.applyRadius }));
vi.mock('@/boot/i18n', () => ({ setI18nLocale: mocks.setI18nLocale }));
vi.mock('vue', () => ({
  nextTick: mocks.nextTick,
  watch: vi.fn((source: () => unknown, callback: () => void) => {
    source();
    mocks.watchCallbacks.push(callback);
  }),
}));

async function load(registerListeners = true) {
  vi.resetModules();
  mocks.watchCallbacks.length = 0;
  mocks.listeners.clear();
  if (registerListeners) {
    vi.spyOn(globalThis, 'addEventListener').mockImplementation((name, listener) => {
      mocks.listeners.set(name, listener as EventListener);
    });
  } else {
    vi.stubGlobal('addEventListener', undefined);
  }
  const schema = await import('@/preferences/schema');
  const preferences = structuredClone(schema.DEFAULTS);
  vi.doMock('@/preferences/store', () => ({
    preferences,
    DEEP_WATCH_SECTIONS: ['appearance', 'locale', 'sync'],
  }));
  const sync = await import('@/preferences/sync');
  return { sync, preferences, schema };
}

function response(
  preferences: PreferencesSchema | Record<string, unknown> | null,
  schemaVersion = 11,
) {
  return { apiVersion: 1, username: 'alice', schemaVersion, preferences, updatedAt: 'now' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('preference sync engine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.getPreferences.mockReset();
    mocks.updatePreferences.mockReset();
    mocks.migrate.mockReset();
    mocks.nextTick.mockReset();
    mocks.migrate.mockImplementation((value) => value);
    mocks.nextTick.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does nothing for a missing server blob', async () => {
    const { sync, preferences } = await load();
    mocks.getPreferences.mockResolvedValue(response(null));
    const before = structuredClone(preferences);
    await sync.hydrateFromServer('alice');
    expect(preferences).toEqual(before);
    expect(mocks.applyFontSize).not.toHaveBeenCalled();
  });

  it('loads without registering SSE handlers when event listeners are unavailable', async () => {
    await expect(load(false)).resolves.toBeDefined();
    expect(mocks.listeners.size).toBe(0);
  });

  it('does not apply a server blob whose own sync flag is disabled', async () => {
    const { sync, preferences } = await load();
    const server = structuredClone(preferences);
    server.sync.enabled = false;
    server.appearance.fontSize = 1.2;
    mocks.getPreferences.mockResolvedValue(response(server));
    await sync.hydrateFromServer('alice');
    expect(preferences.appearance.fontSize).not.toBe(1.2);
    expect(mocks.applyFontSize).not.toHaveBeenCalled();
  });

  it('migrates and applies enabled server values and only updates changed CSS', async () => {
    const { sync, preferences } = await load();
    const raw = { schemaVersion: 10 };
    const migrated = structuredClone(preferences);
    migrated.sync.enabled = true;
    migrated.appearance.fontSize = 1.2;
    migrated.appearance.radius = 'modern';
    migrated.locale.language = 'es';
    mocks.getPreferences.mockResolvedValue(response(raw, 10));
    mocks.migrate.mockReturnValue(migrated);
    await sync.hydrateFromServer('alice');
    expect(mocks.migrate).toHaveBeenCalledWith(raw);
    expect(preferences).toEqual(migrated);
    expect(mocks.applyFontSize).toHaveBeenCalledWith(1.2);
    expect(mocks.applyRadius).toHaveBeenCalledWith('modern');
    expect(mocks.setI18nLocale).toHaveBeenCalledWith('es');
    expect(mocks.updatePreferences).not.toHaveBeenCalled();
  });

  it('merges other changes without reapplying unchanged CSS-critical values', async () => {
    const { sync, preferences } = await load();
    const server = structuredClone(preferences);
    server.sync.enabled = true;
    server.layout.sidebarCollapsed = true;
    mocks.getPreferences.mockResolvedValue(response(server));
    await sync.hydrateFromServer('alice');
    expect(preferences.layout.sidebarCollapsed).toBe(true);
    expect(mocks.applyFontSize).not.toHaveBeenCalled();
    expect(mocks.applyRadius).not.toHaveBeenCalled();
    expect(mocks.setI18nLocale).not.toHaveBeenCalled();
  });

  it('swallows network failures and only hydrates once', async () => {
    const { sync, preferences } = await load();
    const before = structuredClone(preferences);
    mocks.getPreferences.mockRejectedValue(new Error('offline'));
    await expect(sync.hydrateFromServer('alice')).resolves.toBeUndefined();
    await sync.hydrateFromServer('alice');
    expect(mocks.getPreferences).toHaveBeenCalledTimes(1);
    expect(preferences).toEqual(before);
  });

  it('suppresses deep-watch callbacks during a server merge but schedules them afterward', async () => {
    const { sync, preferences } = await load();
    const server = structuredClone(preferences);
    server.sync.enabled = true;
    server.layout.sidebarCollapsed = true;
    mocks.getPreferences.mockResolvedValue(response(server));
    mocks.nextTick.mockImplementation(async () => {
      for (const callback of mocks.watchCallbacks) callback();
    });

    await sync.hydrateFromServer('alice');

    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.updatePreferences).not.toHaveBeenCalled();

    mocks.watchCallbacks[0]();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);
  });

  it('skips anonymous hydration and pushes', async () => {
    const { sync } = await load();
    await sync.hydrateFromServer('anonymous');
    await sync.pushInitialSync('anonymous');
    expect(mocks.getPreferences).not.toHaveBeenCalled();
    expect(mocks.updatePreferences).not.toHaveBeenCalled();
  });

  it('pushes the full current blob immediately for either toggle state', async () => {
    const { sync, preferences } = await load();
    for (const enabled of [true, false]) {
      preferences.sync.enabled = enabled;
      await sync.pushInitialSync('alice');
      expect(mocks.updatePreferences).toHaveBeenLastCalledWith(
        preferences.schemaVersion,
        preferences,
      );
    }
    expect(mocks.updatePreferences).toHaveBeenCalledTimes(2);
  });

  it('debounces enabled local mutations and drops failed writes', async () => {
    const { preferences } = await load();
    preferences.sync.enabled = true;
    mocks.watchCallbacks[0]();
    mocks.watchCallbacks[0]();
    await vi.advanceTimersByTimeAsync(2999);
    expect(mocks.updatePreferences).not.toHaveBeenCalled();
    mocks.updatePreferences.mockRejectedValue(new Error('offline'));
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);
  });

  it('does not schedule writes while disabled', async () => {
    const { preferences } = await load();
    preferences.sync.enabled = false;
    mocks.watchCallbacks[0]();
    await vi.runAllTimersAsync();
    expect(mocks.updatePreferences).not.toHaveBeenCalled();
  });

  it('drops a dirty write if sync is disabled before the timer fires', async () => {
    const { preferences } = await load();
    preferences.sync.enabled = true;
    mocks.watchCallbacks[0]();
    preferences.sync.enabled = false;
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.updatePreferences).not.toHaveBeenCalled();
  });

  it('makes a stale timer callback harmless after the dirty write is flushed', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { preferences } = await load();
    preferences.sync.enabled = true;
    mocks.watchCallbacks[0]();
    const timerCallback = setTimeoutSpy.mock.calls.at(-1)?.[0] as () => void;

    timerCallback();
    await Promise.resolve();
    expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);

    timerCallback();
    await Promise.resolve();
    expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);
  });

  it('refetches on an empty preference invalidation and gates a disabled blob', async () => {
    const { sync, preferences } = await load();
    mocks.getPreferences.mockResolvedValue(response(null));
    await sync.hydrateFromServer('alice');
    mocks.getPreferences.mockClear();
    const localFontSize = preferences.appearance.fontSize;
    const disabled = structuredClone(preferences);
    disabled.sync.enabled = false;
    disabled.appearance.fontSize = 1.3;
    mocks.getPreferences.mockResolvedValue(response(disabled));
    mocks.listeners.get('dd:sse-preferences-updated')!(new CustomEvent('x', { detail: {} }));
    await vi.waitFor(() => expect(mocks.getPreferences).toHaveBeenCalledTimes(1));
    expect(preferences.sync.enabled).toBe(false);
    expect(preferences.appearance.fontSize).toBe(localFontSize);
  });

  it('ignores preference invalidations before any user hydrates', async () => {
    await load();
    mocks.listeners.get('dd:sse-preferences-updated')!(new CustomEvent('x', { detail: {} }));
    expect(mocks.getPreferences).not.toHaveBeenCalled();
  });

  it('protects a pending local edit from SSE and allows refetch after its flush', async () => {
    const { sync, preferences } = await load();
    mocks.getPreferences.mockResolvedValue(response(null));
    await sync.hydrateFromServer('alice');
    mocks.getPreferences.mockClear();

    preferences.sync.enabled = true;
    preferences.layout.sidebarCollapsed = true;
    mocks.watchCallbacks[0]();
    mocks.listeners.get('dd:sse-preferences-updated')!(
      new CustomEvent('x', { detail: { username: 'alice' } }),
    );
    expect(mocks.getPreferences).not.toHaveBeenCalled();
    expect(preferences.layout.sidebarCollapsed).toBe(true);

    await vi.advanceTimersByTimeAsync(3000);
    const server = structuredClone(preferences);
    server.layout.sidebarCollapsed = false;
    mocks.getPreferences.mockResolvedValue(response(server));
    mocks.listeners.get('dd:sse-preferences-updated')!(
      new CustomEvent('x', { detail: { username: 'alice' } }),
    );
    await vi.waitFor(() => expect(mocks.getPreferences).toHaveBeenCalledTimes(1));
    expect(preferences.layout.sidebarCollapsed).toBe(false);
  });

  it('refetches on reconnect only when enabled and a current user exists', async () => {
    const { sync, preferences } = await load();
    mocks.listeners.get('dd:sse-connected')!(new Event('x'));
    expect(mocks.getPreferences).not.toHaveBeenCalled();
    mocks.getPreferences.mockResolvedValue(response(null));
    await sync.hydrateFromServer('alice');
    mocks.getPreferences.mockClear();
    preferences.sync.enabled = true;
    mocks.listeners.get('dd:sse-connected')!(new Event('x'));
    await vi.waitFor(() => expect(mocks.getPreferences).toHaveBeenCalled());
  });

  it.each([
    'resolve',
    'reject',
  ] as const)('blocks SSE refetch during an in-flight debounced write, then resumes after %s', async (outcome) => {
    const { sync, preferences } = await load();
    mocks.getPreferences.mockResolvedValue(response(null));
    await sync.hydrateFromServer('alice');
    mocks.getPreferences.mockClear();
    const write = deferred<ReturnType<typeof response>>();
    mocks.updatePreferences.mockReturnValue(write.promise);
    preferences.sync.enabled = true;
    mocks.watchCallbacks[0]();
    await vi.advanceTimersByTimeAsync(3000);

    mocks.listeners.get('dd:sse-preferences-updated')!(new CustomEvent('x', { detail: {} }));
    expect(mocks.getPreferences).not.toHaveBeenCalled();

    if (outcome === 'resolve') write.resolve(response(preferences));
    else write.reject(new Error('write failed'));
    await Promise.resolve();
    await Promise.resolve();
    mocks.listeners.get('dd:sse-preferences-updated')!(new CustomEvent('x', { detail: {} }));
    await vi.waitFor(() => expect(mocks.getPreferences).toHaveBeenCalledTimes(1));
  });

  it.each([
    'resolve',
    'reject',
  ] as const)('blocks SSE refetch during an explicit push, then resumes after %s', async (outcome) => {
    const { sync, preferences } = await load();
    mocks.getPreferences.mockResolvedValue(response(null));
    await sync.hydrateFromServer('alice');
    mocks.getPreferences.mockClear();
    const write = deferred<ReturnType<typeof response>>();
    mocks.updatePreferences.mockReturnValue(write.promise);
    const push = sync.pushInitialSync('alice');

    mocks.listeners.get('dd:sse-preferences-updated')!(new CustomEvent('x', { detail: {} }));
    expect(mocks.getPreferences).not.toHaveBeenCalled();

    if (outcome === 'resolve') {
      write.resolve(response(preferences));
      await push;
    } else {
      write.reject(new Error('push failed'));
      await expect(push).rejects.toThrow('push failed');
    }
    mocks.listeners.get('dd:sse-preferences-updated')!(new CustomEvent('x', { detail: {} }));
    await vi.waitFor(() => expect(mocks.getPreferences).toHaveBeenCalledTimes(1));
  });

  it('cancels the previous user debounce and hydrates a switched user', async () => {
    const { sync, preferences } = await load();
    mocks.getPreferences.mockResolvedValue(response(null));
    await sync.hydrateFromServer('alice');
    preferences.sync.enabled = true;
    mocks.watchCallbacks[0]();
    expect(vi.getTimerCount()).toBe(1);
    mocks.getPreferences.mockClear();

    await sync.hydrateFromServer('bob');

    expect(mocks.getPreferences).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.updatePreferences).not.toHaveBeenCalled();
  });

  it('discards a stale hydration completion after switching users', async () => {
    const { sync, preferences } = await load();
    const aliceFetch = deferred<ReturnType<typeof response>>();
    mocks.getPreferences
      .mockReturnValueOnce(aliceFetch.promise)
      .mockResolvedValueOnce(response(null));
    const aliceHydration = sync.hydrateFromServer('alice');
    await sync.hydrateFromServer('bob');
    const aliceServer = structuredClone(preferences);
    aliceServer.sync.enabled = true;
    aliceServer.appearance.fontSize = 1.3;

    aliceFetch.resolve(response(aliceServer));
    await aliceHydration;

    expect(preferences.appearance.fontSize).not.toBe(1.3);
    expect(mocks.applyFontSize).not.toHaveBeenCalled();
  });

  it('consumes the ambient debounce after a successful explicit push', async () => {
    const { sync, preferences } = await load();
    preferences.sync.enabled = true;
    mocks.watchCallbacks[0]();
    await sync.pushInitialSync('alice');
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);
  });

  it('preserves the ambient debounce when an explicit push rejects', async () => {
    const { sync, preferences } = await load();
    preferences.sync.enabled = true;
    mocks.watchCallbacks[0]();
    mocks.updatePreferences.mockRejectedValueOnce(new Error('push failed')).mockResolvedValue({});

    await expect(sync.pushInitialSync('alice')).rejects.toThrow('push failed');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.updatePreferences).toHaveBeenCalledTimes(2);
  });
});
