import { computed, readonly, ref, watch } from 'vue';
import { i18n } from '../boot/i18n';
import { clearLastKnown } from '../utils/last-known';

export type ConnectivityStatus = 'online' | 'offline' | 'server-unreachable';

export const CONNECTIVITY_PROBE_INTERVAL_MS = 15_000;
const PROBE_URL = '/api/v1/auth/status';

// A reverse proxy (Traefik, Caddy, nginx, NPM) answers with these when Drydock
// is down, so they count as unreachable just like a network failure.
const GATEWAY_STATUSES = new Set([502, 503, 504]);

/** Thrown for a 502/503/504 on an API call; a TypeError so it falls back like a network failure. */
export class GatewayUnavailableError extends TypeError {
  constructor(readonly status: number) {
    super(`Server unavailable (${status})`);
    this.name = 'GatewayUnavailableError';
  }
}

// Module-level singleton state shared by every consumer.
const browserOnline = ref(globalThis.navigator?.onLine !== false);
const serverReachable = ref(true);
const lastKnownAt = ref<number | null>(null);

const status = computed<ConnectivityStatus>(() => {
  if (!browserOnline.value) {
    return 'offline';
  }
  return serverReachable.value ? 'online' : 'server-unreachable';
});

const isReadOnly = computed(() => status.value !== 'online');

const readOnlyReason = computed(() => {
  if (status.value === 'offline') {
    return i18n.global.t('appShell.offline.actionsDisabledOffline');
  }
  if (status.value === 'server-unreachable') {
    return i18n.global.t('appShell.offline.actionsDisabledUnreachable');
  }
  return '';
});

function markServerReachable(): void {
  serverReachable.value = true;
}

function markServerUnreachable(): void {
  serverReachable.value = false;
}

/** Record that a view rendered data saved at `savedAt`; keeps the oldest. */
function noteLastKnownServed(savedAt: number): void {
  if (lastKnownAt.value === null || savedAt < lastKnownAt.value) {
    lastKnownAt.value = savedAt;
  }
}

function requestPath(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw, globalThis.location.href).pathname;
  } catch {
    return '';
  }
}

let uninstall: (() => void) | undefined;

/**
 * Tracks browser connectivity and server reachability for the whole app.
 * Wraps fetch so every /api/ call reports its outcome: a network failure marks
 * the server unreachable, any HTTP answer marks it reachable again, and a 401
 * wipes the last-known store so a new session never sees the previous user's
 * data. Coming back online asks every view to refresh.
 */
export function installConnectivityMonitor(): () => void {
  if (uninstall) {
    return uninstall;
  }

  const originalFetch = globalThis.fetch;

  function dispatchResync(): void {
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-resync-required', { detail: { reason: 'reconnect' } }),
    );
  }

  // A single 502/503/504 may be a transient blip from Drydock itself, so it
  // never flips the banner on its own: one confirming request does. Only if
  // that also fails does the server count as unreachable; otherwise the views
  // that were served a fallback are told to refetch.
  let confirming = false;
  async function confirmGatewayFailure(): Promise<void> {
    if (confirming) {
      return;
    }
    confirming = true;
    try {
      const response = await originalFetch(PROBE_URL, { credentials: 'include' });
      if (GATEWAY_STATUSES.has(response.status)) {
        markServerUnreachable();
      } else {
        const wasReachable = serverReachable.value;
        markServerReachable();
        lastKnownAt.value = null;
        if (wasReachable) {
          dispatchResync();
        }
      }
    } catch {
      markServerUnreachable();
    } finally {
      confirming = false;
    }
  }

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!requestPath(input).startsWith('/api/')) {
      return originalFetch(input, init);
    }
    let response: Response;
    try {
      response = await originalFetch(input, init);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        markServerUnreachable();
      }
      throw error;
    }
    if (GATEWAY_STATUSES.has(response.status)) {
      void confirmGatewayFailure();
      throw new GatewayUnavailableError(response.status);
    }
    markServerReachable();
    if (response.status === 401) {
      clearLastKnown();
    }
    return response;
  };

  async function probe(): Promise<void> {
    if (!browserOnline.value) {
      return;
    }
    try {
      await globalThis.fetch(PROBE_URL, { credentials: 'include' });
    } catch {
      // The wrapped fetch already recorded the failure.
    }
  }

  let probeTimer: ReturnType<typeof setInterval> | undefined;
  function startProbing(): void {
    if (!probeTimer) {
      probeTimer = setInterval(() => void probe(), CONNECTIVITY_PROBE_INTERVAL_MS);
    }
  }
  function stopProbing(): void {
    if (probeTimer) {
      clearInterval(probeTimer);
      probeTimer = undefined;
    }
  }

  function handleOnline(): void {
    browserOnline.value = true;
    void probe();
  }
  function handleOffline(): void {
    browserOnline.value = false;
  }
  globalThis.addEventListener('online', handleOnline);
  globalThis.addEventListener('offline', handleOffline);

  const stopWatch = watch(
    status,
    (next) => {
      if (next === 'online') {
        stopProbing();
        lastKnownAt.value = null;
        dispatchResync();
        return;
      }
      startProbing();
    },
    { flush: 'sync' },
  );

  uninstall = () => {
    globalThis.fetch = originalFetch;
    globalThis.removeEventListener('online', handleOnline);
    globalThis.removeEventListener('offline', handleOffline);
    stopWatch();
    stopProbing();
    uninstall = undefined;
  };
  return uninstall;
}

export function useConnectivity() {
  return {
    status,
    isReadOnly,
    readOnlyReason,
    lastKnownAt: readonly(lastKnownAt),
    markServerReachable,
    markServerUnreachable,
    noteLastKnownServed,
  };
}
