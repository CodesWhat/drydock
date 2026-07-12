const STALE_CHUNK_RELOAD_GUARD_KEY = 'dd-stale-chunk-reload-pending';
const CHUNK_LOAD_ERROR_PATTERN =
  /(?:failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading (?:css )?chunk \S+ failed|chunkloaderror|unable to preload css|vite:preloaderror)/i;

let reloadRequested = false;
const installedTargets = new WeakSet<EventTarget>();

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

function hasPersistedReloadGuard(): boolean {
  try {
    return sessionStorage.getItem(STALE_CHUNK_RELOAD_GUARD_KEY) === '1';
  } catch {
    return false;
  }
}

function persistReloadGuard(): void {
  try {
    sessionStorage.setItem(STALE_CHUNK_RELOAD_GUARD_KEY, '1');
  } catch {
    // Storage can be unavailable in locked-down/private browser contexts.
  }
}

export function requestStaleChunkReload(
  error: unknown,
  reload: () => void = () => globalThis.location.reload(),
): boolean {
  if (!CHUNK_LOAD_ERROR_PATTERN.test(errorText(error))) {
    return false;
  }
  if (reloadRequested || hasPersistedReloadGuard()) {
    return false;
  }

  reloadRequested = true;
  persistReloadGuard();
  reload();
  return true;
}

export function clearStaleChunkReloadGuard(): void {
  reloadRequested = false;
  try {
    sessionStorage.removeItem(STALE_CHUNK_RELOAD_GUARD_KEY);
  } catch {
    // Best-effort cleanup only; the in-memory guard has still been cleared.
  }
}

export function handleVitePreloadError(
  event: Event,
  reload: () => void = () => globalThis.location.reload(),
): boolean {
  event.preventDefault();
  return requestStaleChunkReload('vite:preloadError', reload);
}

export function installVitePreloadErrorHandler(
  target: EventTarget = globalThis,
  reload: () => void = () => globalThis.location.reload(),
): void {
  if (installedTargets.has(target)) {
    return;
  }
  installedTargets.add(target);
  target.addEventListener('vite:preloadError', (event) => {
    handleVitePreloadError(event, reload);
  });
}
