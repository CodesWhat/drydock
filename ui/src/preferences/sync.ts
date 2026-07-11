import { nextTick, watch } from 'vue';
import { setI18nLocale } from '../boot/i18n';
import { getPreferences, updatePreferences } from '../services/preferences';
import { errorMessage } from '../utils/error';
import { applyFontSize } from './font-size';
import { migrate } from './migrate';
import { applyRadius } from './radius';
import type { PreferencesSchema } from './schema';
import { DEEP_WATCH_SECTIONS, preferences } from './store';

// The 2-5s range in the plan is a soft target, not a hard requirement — a flat
// middle-of-the-range debounce, no requestIdleCallback complexity needed for a
// network write (unlike the paint-sensitive localStorage flush in store.ts).
const SYNC_FLUSH_DEBOUNCE_MS = 3000;

let hydrated = false;
let currentUsername: string | undefined;
let suppressOutboundSync = false;
let syncDirty = false;
let syncFlushTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Diff-and-apply the server's migrated blob onto the reactive preferences
 * object. Suppresses the outbound sync debounce for this one assignment so
 * hydration never echoes straight back to the server (§6).
 */
async function applyServerMerge(migrated: PreferencesSchema): Promise<void> {
  const fontSizeChanged = migrated.appearance.fontSize !== preferences.appearance.fontSize;
  const radiusChanged = migrated.appearance.radius !== preferences.appearance.radius;
  const localeChanged = migrated.locale.language !== preferences.locale.language;

  suppressOutboundSync = true;
  Object.assign(preferences, migrated);
  await nextTick();
  suppressOutboundSync = false;

  if (fontSizeChanged) {
    applyFontSize(migrated.appearance.fontSize);
  }
  if (radiusChanged) {
    applyRadius(migrated.appearance.radius);
  }
  if (localeChanged) {
    setI18nLocale(migrated.locale.language);
  }
}

async function fetchAndMergeFromServer(username: string): Promise<void> {
  // Pending-local-edit guard: an unpushed local edit always outranks any
  // fetched server state. Without this, a delayed self-echo of an older
  // write can silently revert a newer edit still sitting in the debounce
  // window, and the next flush would then push the reverted value back out.
  // Skipping is safe under last-write-wins — the pending flush PATCHes
  // within the debounce window and every device converges on it via the
  // resulting broadcast.
  if (syncDirty || syncFlushTimer !== undefined) {
    return;
  }
  try {
    const response = await getPreferences();
    if (!response.preferences) {
      return;
    }
    const migrated = migrate(response.preferences);
    // Apply-gate: a server blob whose own flag is false means the user turned
    // sync off somewhere — localStorage stays authoritative on every device.
    // Without this, ungated server-wins hydration would silently re-enable
    // sync on the device that just turned it off. Covers all three fetch
    // paths (initial hydration, SSE-triggered, reconnect-triggered) since
    // they all funnel through this function.
    if (!migrated.sync.enabled) {
      return;
    }
    await applyServerMerge(migrated);
  } catch (error) {
    console.debug(`Preferences sync: hydration failed for ${username}: ${errorMessage(error)}`);
  }
}

/**
 * Merge the server's synced preferences into localStorage. Runs at most once
 * per app session (module-level guard) and never throws — safe to await
 * unconditionally from the router guard without blocking navigation.
 */
export async function hydrateFromServer(username: string): Promise<void> {
  if (username === 'anonymous') {
    return;
  }
  currentUsername = username;
  if (hydrated) {
    return;
  }
  hydrated = true;
  await fetchAndMergeFromServer(username);
}

/**
 * Explicit, non-debounced full push used by both toggle transitions: ON
 * pushes the enabled blob as the new baseline, OFF pushes the disabled blob
 * so the off-state reaches the server (the ambient debounce is gated on
 * `sync.enabled` and therefore cannot record its own flip to false). Unlike
 * hydrateFromServer, errors propagate to the caller so ConfigView can show an
 * inline error banner.
 */
export async function pushInitialSync(username: string): Promise<void> {
  if (username === 'anonymous') {
    return;
  }
  await updatePreferences(preferences.schemaVersion, preferences);
}

function clearSyncFlushTimer(): void {
  if (syncFlushTimer !== undefined) {
    clearTimeout(syncFlushTimer);
    syncFlushTimer = undefined;
  }
}

async function flushSyncWrite(): Promise<void> {
  if (!syncDirty) {
    return;
  }
  syncDirty = false;
  if (!preferences.sync.enabled) {
    return;
  }
  try {
    await updatePreferences(preferences.schemaVersion, preferences);
  } catch (error) {
    console.debug(`Preferences sync: server write failed: ${errorMessage(error)}`);
  }
}

function scheduleSyncFlush(): void {
  clearSyncFlushTimer();
  syncFlushTimer = setTimeout(() => {
    syncFlushTimer = undefined;
    void flushSyncWrite();
  }, SYNC_FLUSH_DEBOUNCE_MS);
}

function markSyncDirty(): void {
  if (suppressOutboundSync || !preferences.sync.enabled) {
    return;
  }
  syncDirty = true;
  scheduleSyncFlush();
}

for (const section of DEEP_WATCH_SECTIONS) {
  watch(() => preferences[section], markSyncDirty, { deep: true });
}

function handleRemotePreferencesUpdated(event: Event): void {
  const detail = (event as CustomEvent<{ username?: string }>).detail;
  if (!detail || !currentUsername || detail.username !== currentUsername) {
    return;
  }
  void fetchAndMergeFromServer(currentUsername);
}

function handleSseConnected(): void {
  if (!preferences.sync.enabled || !currentUsername) {
    return;
  }
  void fetchAndMergeFromServer(currentUsername);
}

if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('dd:sse-preferences-updated', handleRemotePreferencesUpdated);
  globalThis.addEventListener('dd:sse-connected', handleSseConnected);
}
