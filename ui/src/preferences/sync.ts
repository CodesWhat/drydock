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
// A failed write re-arms the same debounce as its backoff. After this many
// retries the edit stays pending (it still outranks any fetched server state)
// and goes out with the next local edit instead of looping on a dead server.
const SYNC_WRITE_MAX_RETRIES = 3;

let hydrated = false;
let currentUsername: string | undefined;
// Who owns the current sync session, recorded at sign-in. Separate from
// currentUsername, which only becomes set once hydrate runs and gates fetches.
let sessionOwner: string | undefined;
let suppressOutboundSync = false;
let syncDirty = false;
let syncFlushTimer: ReturnType<typeof setTimeout> | undefined;
let syncWriteInFlight = false;
let syncRetryCount = 0;
// Bumped on every session reset. A username compare cannot tell alice -> bob ->
// alice apart from alice throughout, so async completions compare this instead.
let syncSessionId = 0;

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
  // resulting broadcast. An in-flight PATCH must also block fetches —
  // `flushSyncWrite` clears `syncDirty` before awaiting, so without this flag
  // an SSE-triggered fetch landing mid-write could merge an older server
  // snapshot over the newer values mid-flight to the server (the skipped
  // snapshot is superseded by our own full-replace write under last-write-wins).
  if (syncDirty || syncFlushTimer !== undefined || syncWriteInFlight) {
    return;
  }
  const sessionId = syncSessionId;
  try {
    const response = await getPreferences();
    // A user switch happened while the fetch was in flight — discard the
    // stale completion.
    if (sessionId !== syncSessionId) {
      return;
    }
    // An edit or a failed write may have become pending while the fetch was in
    // flight; the pre-fetch guard above cannot see it. The snapshot predates
    // that edit, so merging it would revert the edit.
    if (syncDirty || syncFlushTimer !== undefined || syncWriteInFlight) {
      return;
    }
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

function resetSyncSessionState(): void {
  clearSyncFlushTimer();
  syncDirty = false;
  syncRetryCount = 0;
  hydrated = false;
  currentUsername = undefined;
  sessionOwner = undefined;
  syncSessionId += 1;
}

/**
 * Record the authenticated user before any navigation outcome. The API-key
 * review redirect returns before hydrateFromServer runs, so without this a
 * sign-in switch through that path would leave the previous user's pending
 * edit armed to flush under the new user's session on the next SSE reconnect.
 */
export function syncAuthenticatedUser(username: string): void {
  if (username === 'anonymous') {
    return;
  }
  const owner = sessionOwner ?? currentUsername;
  const pendingEdit = syncDirty || syncFlushTimer !== undefined;
  // A different owner, or a pending edit nobody has claimed, must not reach
  // this user's session.
  if ((owner !== undefined && owner !== username) || (owner === undefined && pendingEdit)) {
    resetSyncSessionState();
  }
  sessionOwner = username;
}

/**
 * Merge the server's synced preferences into localStorage. Runs at most once
 * per app session (module-level guard) and never throws — it is intentionally
 * NOT awaited by the router guard (fire-and-forget) so navigation is never
 * coupled to API responsiveness.
 */
export async function hydrateFromServer(username: string): Promise<void> {
  if (username === 'anonymous') {
    return;
  }
  // Logout is SPA navigation (no reload), so module state survives a
  // same-tab user switch; without this reset the new user's hydration is
  // skipped by the stale `hydrated` flag and a still-armed flush timer could
  // PATCH the previous user's blob into the new user's server record.
  syncAuthenticatedUser(username);
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
 * inline error banner. On success, consumes any pending ambient debounce so
 * the toggle flip doesn't also trigger a redundant follow-up PATCH.
 */
export async function pushInitialSync(username: string): Promise<void> {
  if (username === 'anonymous') {
    return;
  }
  syncWriteInFlight = true;
  try {
    await updatePreferences(preferences.schemaVersion, preferences);
  } finally {
    syncWriteInFlight = false;
  }
  // The toggle flip itself trips the deep `sync` watcher and arms the
  // ambient debounce; this explicit push already carried that state, so
  // consume the pending flush or an identical PATCH + broadcast fires 3s later.
  syncDirty = false;
  clearSyncFlushTimer();
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
  const writingSessionId = syncSessionId;
  try {
    syncWriteInFlight = true;
    await updatePreferences(preferences.schemaVersion, preferences);
    syncRetryCount = 0;
  } catch (error) {
    console.debug(`Preferences sync: server write failed: ${errorMessage(error)}`);
    // The edit never reached the server, so it is still pending: keep the
    // fetch guard up so a reconnect cannot overwrite it with older server state.
    if (preferences.sync.enabled && writingSessionId === syncSessionId) {
      syncDirty = true;
      if (syncRetryCount < SYNC_WRITE_MAX_RETRIES) {
        syncRetryCount += 1;
        scheduleSyncFlush();
      }
    }
  } finally {
    syncWriteInFlight = false;
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
  syncRetryCount = 0;
  scheduleSyncFlush();
}

for (const section of DEEP_WATCH_SECTIONS) {
  watch(() => preferences[section], markSyncDirty, { deep: true });
}

// The invalidation event carries no username by design (§3) — every client
// just re-fetches its own session-scoped preferences; the fetch guards make
// self-echo and foreign updates safe.
function handleRemotePreferencesUpdated(): void {
  if (!currentUsername) {
    return;
  }
  void fetchAndMergeFromServer(currentUsername);
}

function handleSseConnected(): void {
  if (!preferences.sync.enabled || !currentUsername) {
    return;
  }
  // A write that exhausted its retries leaves the edit pending with no timer,
  // so the fetch guard would swallow every reconnect until the next local edit.
  // The server is back: restart the retry budget and push the edit; the merge
  // happens on the next fetch once it has landed.
  if (syncDirty && !syncWriteInFlight && syncFlushTimer === undefined) {
    syncRetryCount = 0;
    scheduleSyncFlush();
    return;
  }
  void fetchAndMergeFromServer(currentUsername);
}

if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('dd:sse-preferences-updated', handleRemotePreferencesUpdated);
  globalThis.addEventListener('dd:sse-connected', handleSseConnected);
}
