import { reactive, watch } from 'vue';
import { migrate, migrateFromLegacyKeys } from './migrate';
import { DEFAULTS, type PreferencesSchema } from './schema';

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

function flush() {
  if (!dirty) return;
  dirty = false;
  flushScheduled = false;
  try {
    localStorage.setItem('dd-preferences', JSON.stringify(preferences));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(flush);
  } else {
    setTimeout(flush, 100);
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
