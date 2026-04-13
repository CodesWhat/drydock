import { reactive, watch } from 'vue';
import { migrate, migrateFromLegacyKeys } from './migrate';
import { DEFAULTS, type PreferencesSchema } from './schema';

const PREFERENCES_FLUSH_FALLBACK_MS = 100;
const PREFERENCES_IDLE_TIMEOUT_MS = 250;
const PREFERENCES_LIFECYCLE_HANDLERS_KEY = '__ddPreferencesLifecycleHandlers';

interface PreferencesLifecycleHandlers {
  pagehide: EventListener;
  visibilitychange: EventListener;
}

function load(): PreferencesSchema {
  try {
    const raw = localStorage.getItem('dd-preferences');
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        // Design decision: composables do not run runtime validation anymore.
        // Persisted preference values are normalized/validated once at migration-time here.
        return migrate(parsed);
      }
    }
  } catch {
    // Corrupt JSON — fall through
  }

  // No existing dd-preferences: check for legacy keys
  try {
    return migrateFromLegacyKeys();
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const preferences: PreferencesSchema = reactive(load());

// ─── Write coalescing ───────────────────────────────────────

let dirty = false;
let flushScheduled = false;
let scheduledFlushTimer: ReturnType<typeof setTimeout> | undefined;
let scheduledIdleCallbackId: number | undefined;

function clearScheduledFlush() {
  if (scheduledFlushTimer !== undefined) {
    clearTimeout(scheduledFlushTimer);
    scheduledFlushTimer = undefined;
  }
  if (
    scheduledIdleCallbackId !== undefined &&
    typeof globalThis.cancelIdleCallback === 'function'
  ) {
    globalThis.cancelIdleCallback(scheduledIdleCallbackId);
  }
  scheduledIdleCallbackId = undefined;
}

function flush() {
  clearScheduledFlush();
  flushScheduled = false;
  if (!dirty) return;
  dirty = false;
  try {
    localStorage.setItem('dd-preferences', JSON.stringify(preferences));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  if (typeof globalThis.requestIdleCallback === 'function') {
    scheduledIdleCallbackId = globalThis.requestIdleCallback(flush, {
      timeout: PREFERENCES_IDLE_TIMEOUT_MS,
    });
  } else {
    scheduledFlushTimer = setTimeout(flush, PREFERENCES_FLUSH_FALLBACK_MS);
  }
}

function markDirty() {
  dirty = true;
  scheduleFlush();
}

watch(() => preferences.schemaVersion, markDirty);

const DEEP_WATCH_SECTIONS = [
  'theme',
  'font',
  'icons',
  'appearance',
  'layout',
  'containers',
  'dashboard',
  'views',
] as const satisfies ReadonlyArray<Exclude<keyof PreferencesSchema, 'schemaVersion'>>;

for (const section of DEEP_WATCH_SECTIONS) {
  watch(() => preferences[section], markDirty, { deep: true });
}

function registerLifecycleFlushHandlers() {
  if (typeof document === 'undefined' || typeof globalThis.addEventListener !== 'function') {
    return;
  }

  const lifecycleState = globalThis as typeof globalThis & {
    [PREFERENCES_LIFECYCLE_HANDLERS_KEY]?: PreferencesLifecycleHandlers;
  };
  const previousHandlers = lifecycleState[PREFERENCES_LIFECYCLE_HANDLERS_KEY];
  if (previousHandlers) {
    document.removeEventListener('visibilitychange', previousHandlers.visibilitychange);
    globalThis.removeEventListener('pagehide', previousHandlers.pagehide);
  }

  const visibilitychange = () => {
    if (document.visibilityState === 'hidden') {
      flush();
    }
  };
  const pagehide = () => {
    flush();
  };

  document.addEventListener('visibilitychange', visibilitychange);
  globalThis.addEventListener('pagehide', pagehide);
  lifecycleState[PREFERENCES_LIFECYCLE_HANDLERS_KEY] = {
    pagehide,
    visibilitychange,
  };
}

registerLifecycleFlushHandlers();

/** Force synchronous write to localStorage. Primarily for tests. */
export function flushPreferences(): void {
  dirty = true;
  flush();
}

/** Reset preferences to defaults. Primarily for tests. */
export function resetPreferences(): void {
  Object.assign(preferences, structuredClone(DEFAULTS));
  flushPreferences();
}
