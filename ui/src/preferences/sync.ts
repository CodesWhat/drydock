import { nextTick, watch } from 'vue';
import { setI18nLocale } from '../boot/i18n';
import {
  getPreferences,
  PreferencesRevisionConflictError,
  updatePreferences,
} from '../services/preferences';
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
// The server document revision this client last read or wrote, sent with every
// write so the server can refuse one made against a document that has since
// moved on (a retried PATCH whose response was lost, an edit on another device).
let knownRevision = 0;
// The server document as of knownRevision. It is the common ancestor for the
// section-level merge after a stale write.
let serverBase: PreferencesSchema | undefined;

function snapshotPreferences(): PreferencesSchema {
  return JSON.parse(JSON.stringify(preferences));
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Three-way merge by top-level section. A section edited only here keeps the
 * local value, a section edited on the server (or on both sides) takes the
 * server value. Without a base (an edit made before hydration finished, or
 * after it failed) nothing can be attributed to either side, and the pending
 * local edit is the one thing known to be wanted, so the local blob wins, as
 * it did before writes carried a revision.
 */
function mergeSections(
  base: PreferencesSchema | undefined,
  local: PreferencesSchema,
  server: PreferencesSchema,
): PreferencesSchema {
  if (!base) {
    return local;
  }
  const merged: Record<string, unknown> = { ...server };
  const baseRecord = base as unknown as Record<string, unknown>;
  const localRecord = local as unknown as Record<string, unknown>;
  const serverRecord = server as unknown as Record<string, unknown>;
  for (const key of Object.keys(serverRecord)) {
    const editedLocally = !sameValue(localRecord[key], baseRecord[key]);
    const editedOnServer = !sameValue(serverRecord[key], baseRecord[key]);
    if (editedLocally && !editedOnServer) {
      merged[key] = localRecord[key];
    }
  }
  return merged as unknown as PreferencesSchema;
}

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
    // The snapshot is the newest server state and nothing local is pending, so
    // the next write is made against this revision.
    knownRevision = response.revision ?? 0;
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
    serverBase = structuredClone(migrated);
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
  knownRevision = 0;
  serverBase = undefined;
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
    try {
      await writePreferences();
    } catch (error) {
      if (!(error instanceof PreferencesRevisionConflictError)) {
        throw error;
      }
      // The toggle is an explicit decision: take the server's current revision
      // and write over it once instead of surfacing the conflict.
      const current = await getPreferences();
      knownRevision = current.revision ?? 0;
      await writePreferences();
    }
  } finally {
    syncWriteInFlight = false;
  }
  // The toggle flip itself trips the deep `sync` watcher and arms the
  // ambient debounce; this explicit push already carried that state, so
  // consume the pending flush or an identical PATCH + broadcast fires 3s later.
  syncDirty = false;
  clearSyncFlushTimer();
}

/**
 * PATCH the current blob against the known revision and record the revision
 * and base the server now holds.
 */
async function writePreferences(): Promise<void> {
  const sent = snapshotPreferences();
  const envelope = await updatePreferences(preferences.schemaVersion, preferences, knownRevision);
  knownRevision = envelope.revision ?? knownRevision;
  serverBase = sent;
}

function clearSyncFlushTimer(): void {
  if (syncFlushTimer !== undefined) {
    clearTimeout(syncFlushTimer);
    syncFlushTimer = undefined;
  }
}

/**
 * A write made against an older revision was refused. Re-fetch the server
 * document, merge by section (this device's own edits survive unless the server
 * changed the same section), adopt the new revision, and re-queue whatever the
 * server doesn't have yet.
 */
async function resolveRevisionConflict(writingSessionId: number): Promise<void> {
  const response = await getPreferences();
  if (writingSessionId !== syncSessionId) {
    return;
  }
  knownRevision = response.revision ?? 0;
  if (!response.preferences) {
    // Nothing stored server-side: the local blob is the only copy, push it.
    queueRetryWrite();
    return;
  }
  const server = migrate(response.preferences);
  if (!server.sync.enabled) {
    // The apply-gate: a server blob with sync off never overrides this device,
    // so the local blob goes out against the fresh revision.
    queueRetryWrite();
    return;
  }
  const merged = mergeSections(serverBase, snapshotPreferences(), server);
  await applyServerMerge(merged);
  serverBase = structuredClone(server);
  if (!sameValue(merged, server)) {
    queueRetryWrite();
  }
}

function queueRetryWrite(): void {
  syncDirty = true;
  syncRetryCount = 0;
  scheduleSyncFlush();
}

function handleWriteFailure(error: unknown, writingSessionId: number): void {
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
    try {
      await writePreferences();
      syncRetryCount = 0;
    } catch (error) {
      if (!(error instanceof PreferencesRevisionConflictError)) {
        throw error;
      }
      await resolveRevisionConflict(writingSessionId);
    }
  } catch (error) {
    handleWriteFailure(error, writingSessionId);
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
