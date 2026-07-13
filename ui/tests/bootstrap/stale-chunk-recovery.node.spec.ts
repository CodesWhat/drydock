// @vitest-environment node

import {
  clearStaleChunkReloadGuard,
  handleVitePreloadError,
  installVitePreloadErrorHandler,
  requestStaleChunkReload,
} from '@/bootstrap/stale-chunk-recovery';

const guardKey = 'dd-stale-chunk-reload-pending';
const storedValues = new Map<string, string>();
const storage = {
  getItem: (key: string) => storedValues.get(key) ?? null,
  setItem: (key: string, value: string) => storedValues.set(key, value),
  removeItem: (key: string) => storedValues.delete(key),
};

describe('stale chunk browser defaults', () => {
  let reload: ReturnType<typeof vi.fn>;
  let browserEvents: EventTarget;
  let addEventListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storedValues.clear();
    reload = vi.fn();
    browserEvents = new EventTarget();
    addEventListener = vi.fn(browserEvents.addEventListener.bind(browserEvents));
    vi.stubGlobal('sessionStorage', storage);
    vi.stubGlobal('location', { reload });
    vi.stubGlobal('addEventListener', addEventListener);
    clearStaleChunkReloadGuard();
  });

  afterEach(() => {
    clearStaleChunkReloadGuard();
    vi.unstubAllGlobals();
  });

  it('calls the browser reload default for direct and Vite recovery paths', () => {
    expect(requestStaleChunkReload(new Error('Loading chunk 9 failed'))).toBe(true);
    expect(sessionStorage.getItem(guardKey)).toBe('1');
    expect(reload).toHaveBeenCalledTimes(1);

    clearStaleChunkReloadGuard();
    const event = new Event('vite:preloadError', { cancelable: true });

    expect(handleVitePreloadError(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(sessionStorage.getItem(guardKey)).toBe('1');
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('installs the Vite preload listener on the default event target', () => {
    installVitePreloadErrorHandler();

    expect(addEventListener).toHaveBeenCalledWith('vite:preloadError', expect.any(Function));

    const event = new Event('vite:preloadError', { cancelable: true });
    browserEvents.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(sessionStorage.getItem(guardKey)).toBe('1');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
