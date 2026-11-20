import { getErrorMessage } from '../../../util/error.js';

/**
 * Process-wide coordination of Docker daemon image pulls, keyed by registry
 * host. Registry HTTP retries do not wrap daemon downloads, so a throttled
 * registry (HTTP 429, `toomanyrequests`) is handled here: a bounded number of
 * concurrent pulls per host, FIFO fairness, and a shared backoff that defers
 * that host's queued pulls while other registries keep going.
 */

export const DEFAULT_PULL_CONCURRENCY = 2;
export const PULL_BACKOFF_BASE_MS = 5_000;
export const PULL_BACKOFF_MAX_MS = 300_000;

const DOCKER_HUB_HOST = 'docker.io';
const DOCKER_HUB_ALIASES = new Set([
  'docker.io',
  'index.docker.io',
  'registry-1.docker.io',
  'registry.hub.docker.com',
]);

interface Waiter {
  limit: number;
  grant: (release: () => void) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface RegistryState {
  active: number;
  queue: Waiter[];
  blockedUntil: number;
  consecutiveThrottles: number;
  timer?: ReturnType<typeof setTimeout>;
}

export interface PullPacingLog {
  warn: (message: string) => void;
}

export interface AcquireOptions {
  /** Max concurrent daemon pulls for the host. */
  limit?: number;
  signal?: AbortSignal;
}

const registries = new Map<string, RegistryState>();

/**
 * Normalize the registry host of an image reference. References without an
 * explicit registry, and every Docker Hub alias, share the `docker.io` key.
 */
export function normalizePullRegistryHost(imageReference: string): string {
  const firstSegment = imageReference.split('/')[0];
  const hasExplicitHost =
    imageReference.includes('/') &&
    (firstSegment.includes('.') || firstSegment.includes(':') || firstSegment === 'localhost');
  if (!hasExplicitHost) {
    return DOCKER_HUB_HOST;
  }
  const host = firstSegment.toLowerCase();
  return DOCKER_HUB_ALIASES.has(host) ? DOCKER_HUB_HOST : host;
}

function getState(host: string): RegistryState {
  let state = registries.get(host);
  if (!state) {
    state = { active: 0, queue: [], blockedUntil: 0, consecutiveThrottles: 0 };
    registries.set(host, state);
  }
  return state;
}

function pruneIfIdle(host: string, state: RegistryState): void {
  if (
    state.active === 0 &&
    state.queue.length === 0 &&
    state.blockedUntil <= Date.now() &&
    state.consecutiveThrottles === 0
  ) {
    registries.delete(host);
  }
}

function makeRelease(host: string, state: RegistryState): () => void {
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    state.active--;
    pump(host, state);
    pruneIfIdle(host, state);
  };
}

function pump(host: string, state: RegistryState): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = undefined;
  }
  while (state.queue.length > 0) {
    const waiter = state.queue[0];
    const now = Date.now();
    if (now < state.blockedUntil) {
      state.timer = setTimeout(() => {
        state.timer = undefined;
        pump(host, state);
        pruneIfIdle(host, state);
      }, state.blockedUntil - now);
      return;
    }
    if (state.active >= waiter.limit) {
      return;
    }
    state.queue.shift();
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
    state.active++;
    waiter.grant(makeRelease(host, state));
  }
}

/**
 * Wait for a pull slot on a registry. Resolves with a release function that
 * must be called exactly when the pull finishes (calling it twice is safe).
 * An aborted waiter is removed from the queue and rejects with the signal's
 * reason; it never holds a permit.
 */
export function acquirePullSlot(host: string, options: AcquireOptions = {}): Promise<() => void> {
  const limit = options.limit ?? DEFAULT_PULL_CONCURRENCY;
  const { signal } = options;
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }
  const state = getState(host);
  return new Promise((resolve, reject) => {
    const waiter: Waiter = { limit, grant: resolve, signal };
    if (signal) {
      waiter.onAbort = () => {
        // The listener is removed on grant, so a still-attached one means queued.
        state.queue.splice(state.queue.indexOf(waiter), 1);
        pump(host, state);
        pruneIfIdle(host, state);
        reject(signal.reason);
      };
      signal.addEventListener('abort', waiter.onAbort, { once: true });
    }
    state.queue.push(waiter);
    pump(host, state);
  });
}

/** Mark a pull on this host as successful, clearing the escalating backoff. */
export function reportPullSuccess(host: string): void {
  const state = registries.get(host);
  if (state) {
    state.consecutiveThrottles = 0;
    pruneIfIdle(host, state);
  }
}

/**
 * Parse a Retry-After value (delta-seconds or HTTP date) into milliseconds.
 */
export function parseRetryAfterMs(value: unknown, now = Date.now()): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value * 1000;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.max(0, date - now);
}

function readRetryAfterHeader(error: unknown): unknown {
  const headers = (error as { headers?: Record<string, unknown> } | undefined)?.headers;
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }
  return headers['retry-after'] ?? headers['Retry-After'];
}

/**
 * Detect a registry throttling error from a daemon pull failure. Returns
 * `undefined` for other errors, otherwise an object whose `retryAfterMs` is set
 * when the error carries a parseable Retry-After.
 */
export function detectPullThrottle(error: unknown): { retryAfterMs?: number } | undefined {
  const statusCode = (error as { statusCode?: unknown } | undefined)?.statusCode;
  const message = getErrorMessage(error);
  const throttled =
    statusCode === 429 || /toomanyrequests|too many requests|\b429\b/i.test(message);
  if (!throttled) {
    return undefined;
  }
  const headerValue = readRetryAfterHeader(error);
  if (headerValue !== undefined) {
    return { retryAfterMs: parseRetryAfterMs(headerValue) };
  }
  const match = /retry[- ]after:?\s*(\d+)(?:\s*s(?:ec(?:onds?)?)?)?/i.exec(message);
  return { retryAfterMs: match ? Number.parseInt(match[1], 10) * 1000 : undefined };
}

/**
 * Record a throttle on a host and defer its pending pulls. Honors Retry-After
 * when given, else bounded exponential backoff with jitter. Returns the delay
 * applied in milliseconds.
 */
export function reportPullThrottle(
  host: string,
  retryAfterMs: number | undefined,
  log?: PullPacingLog,
): number {
  const state = getState(host);
  state.consecutiveThrottles++;
  let delayMs: number;
  if (retryAfterMs === undefined) {
    const exponential = PULL_BACKOFF_BASE_MS * 2 ** (state.consecutiveThrottles - 1);
    delayMs = Math.min(PULL_BACKOFF_MAX_MS, Math.round(exponential * (1 + Math.random() * 0.25)));
  } else {
    delayMs = Math.min(PULL_BACKOFF_MAX_MS, retryAfterMs);
  }
  state.blockedUntil = Math.max(state.blockedUntil, Date.now() + delayMs);
  pump(host, state);
  log?.warn(
    `Registry ${host} throttled image pulls; deferring ${state.queue.length} pending pull(s) for ${Math.round(delayMs / 1000)}s${
      retryAfterMs === undefined ? ' (exponential backoff)' : ' (Retry-After)'
    }`,
  );
  return delayMs;
}

/** Snapshot of one registry for status text and tests. */
export function getPullPacingState(host: string) {
  const state = registries.get(host);
  return {
    active: state?.active ?? 0,
    queued: state?.queue.length ?? 0,
    blockedUntil: state && state.blockedUntil > Date.now() ? state.blockedUntil : undefined,
  };
}

/** Test hook: drop all coordinator state and timers. */
export function resetPullPacing(): void {
  for (const state of registries.values()) {
    if (state.timer) {
      clearTimeout(state.timer);
    }
  }
  registries.clear();
}
