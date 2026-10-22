// App-level last-known store for the offline fallback. Only the closed set of
// keys below is ever written (safe GET views, never auth/session/secrets
// endpoints), so the footprint is bounded by construction. Entries expire
// after LAST_KNOWN_MAX_AGE_MS and are wiped on logout, login and any 401.

export const LAST_KNOWN_KEYS = [
  'containers',
  'containers-vulnerabilities',
  'container-summary',
  'container-recent-status',
  'container-groups',
  'server',
  'agents',
  'watchers',
  'registries',
] as const;

export type LastKnownKey = (typeof LAST_KNOWN_KEYS)[number];

export const LAST_KNOWN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const LAST_KNOWN_MAX_ENTRY_CHARS = 2_000_000;

const STORAGE_PREFIX = 'dd-last-known-v1:';

interface LastKnownEntry<T> {
  savedAt: number;
  data: T;
}

function storageKey(key: LastKnownKey): string {
  return `${STORAGE_PREFIX}${key}`;
}

export function saveLastKnown(key: LastKnownKey, data: unknown, now: number = Date.now()): void {
  try {
    const serialized = JSON.stringify({ savedAt: now, data });
    if (serialized.length > LAST_KNOWN_MAX_ENTRY_CHARS) {
      localStorage.removeItem(storageKey(key));
      return;
    }
    localStorage.setItem(storageKey(key), serialized);
  } catch {
    // Quota exceeded or storage unavailable: the fallback is best effort.
  }
}

export function readLastKnown<T>(
  key: LastKnownKey,
  now: number = Date.now(),
): LastKnownEntry<T> | undefined {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (raw === null) {
      return undefined;
    }
    const entry = JSON.parse(raw) as Partial<LastKnownEntry<T>> | null;
    if (
      !entry ||
      typeof entry.savedAt !== 'number' ||
      !('data' in entry) ||
      now - entry.savedAt > LAST_KNOWN_MAX_AGE_MS
    ) {
      localStorage.removeItem(storageKey(key));
      return undefined;
    }
    return entry as LastKnownEntry<T>;
  } catch {
    try {
      localStorage.removeItem(storageKey(key));
    } catch {
      // Nothing more to do.
    }
    return undefined;
  }
}

export function clearLastKnown(): void {
  for (const key of LAST_KNOWN_KEYS) {
    try {
      localStorage.removeItem(storageKey(key));
    } catch {
      // Storage unavailable: nothing was persisted.
    }
  }
}
