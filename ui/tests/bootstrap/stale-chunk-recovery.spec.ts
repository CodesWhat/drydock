import {
  clearStaleChunkReloadGuard,
  handleVitePreloadError,
  installVitePreloadErrorHandler,
  requestStaleChunkReload,
} from '@/bootstrap/stale-chunk-recovery';

describe('stale chunk recovery', () => {
  beforeEach(() => {
    clearStaleChunkReloadGuard();
    sessionStorage.clear();
  });

  it('reloads once for a lazy dynamic-import failure', () => {
    const reload = vi.fn();
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/view.js');

    expect(requestStaleChunkReload(error, reload)).toBe(true);
    expect(requestStaleChunkReload(error, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores router errors unrelated to chunk loading', () => {
    const reload = vi.fn();

    expect(requestStaleChunkReload(new Error('navigation cancelled'), reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('honors the session guard left by a previous page load', () => {
    const reload = vi.fn();
    sessionStorage.setItem('dd-stale-chunk-reload-pending', '1');

    expect(requestStaleChunkReload(new Error('Loading chunk 7 failed'), reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('prevents the Vite preload error and requests recovery', () => {
    const reload = vi.fn();
    const event = new Event('vite:preloadError', { cancelable: true });

    expect(handleVitePreloadError(event, reload)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('allows a later recovery after a successful navigation clears the guard', () => {
    const reload = vi.fn();
    const error = new Error('Loading chunk 42 failed');

    expect(requestStaleChunkReload(error, reload)).toBe(true);
    clearStaleChunkReloadGuard();
    expect(requestStaleChunkReload(error, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('installs the Vite listener only once per event target', () => {
    const target = new EventTarget();
    const addEventListenerSpy = vi.spyOn(target, 'addEventListener');
    const reload = vi.fn();

    installVitePreloadErrorHandler(target, reload);
    installVitePreloadErrorHandler(target, reload);
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));

    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still reloads when session storage is unavailable', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    const reload = vi.fn();

    try {
      expect(requestStaleChunkReload(new Error('Loading chunk 8 failed'), reload)).toBe(true);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    }

    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    try {
      expect(() => clearStaleChunkReloadGuard()).not.toThrow();
    } finally {
      removeItemSpy.mockRestore();
    }
  });
});
