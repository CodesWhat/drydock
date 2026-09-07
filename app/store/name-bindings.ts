/**
 * Persisted agent-name → pubKeyId identity-binding store.
 *
 * Backs the in-memory `nameToKeyId` cache in app/api/portwing-ws.ts (squat/theft
 * prevention for edge-agent display names — see the design note next to that
 * map). Backed by the `name_bindings` table (roadmap 7-STORE, slice 4), one
 * row per binding.
 *
 * Without this, the binding cache lived only in a bare process-memory Map —
 * wiped on every restart, including the restart that deploys this very fix,
 * which reopens the squat window the binding was meant to close for as long
 * as it takes agents to reconnect and re-establish their bindings. Persisting
 * the bindings means a restarted server still knows which key owns which name
 * before any agent reconnects.
 */
import type { Database, Row } from './db/driver.js';

export interface NameBindingRecord {
  agentName: string; // sanitized/fallback display name (see computeAgentName)
  keyId: string; // 16 lowercase hex chars — the pubKeyId that owns this name
  lastSeenAt: number; // epoch ms of the most recent hello admitted under this binding
}

let db: Database | undefined;

function rowToRecord(row: Row): NameBindingRecord {
  return {
    agentName: String(row.agent_name),
    keyId: String(row.key_id),
    lastSeenAt: Number(row.last_seen_at),
  };
}

/**
 * Wire the name-bindings store to the shared SQLite database.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
}

/**
 * Insert or update the persisted binding for agentName.
 * A no-op (rather than a throw) when the store has not been initialized
 * yet — callers (portwing-ws.ts) run on every hello and must not fail admission
 * just because the durable store isn't wired up (e.g. in unit tests that only
 * exercise the in-memory cache).
 */
export function upsertBinding(agentName: string, keyId: string, lastSeenAt: number): void {
  if (!db) {
    return;
  }
  db.prepare(
    `INSERT INTO name_bindings (agent_name, key_id, last_seen_at) VALUES (?, ?, ?)
     ON CONFLICT(agent_name) DO UPDATE SET key_id = excluded.key_id, last_seen_at = excluded.last_seen_at`,
  ).run(agentName, keyId, lastSeenAt);
}

/**
 * Delete the persisted binding for agentName, if any.
 */
export function deleteBinding(agentName: string): void {
  if (!db) {
    return;
  }
  db.prepare('DELETE FROM name_bindings WHERE agent_name = ?').run(agentName);
}

/**
 * Delete every persisted binding owned by keyId (key revocation).
 * Returns the agentNames that were released, mirroring the in-memory purge in
 * disconnectByKeyId().
 */
export function deleteBindingsForKey(keyId: string): string[] {
  if (!db) {
    return [];
  }
  const released = db
    .prepare('SELECT agent_name FROM name_bindings WHERE key_id = ?')
    .all(keyId)
    .map((row) => String(row.agent_name));
  if (released.length > 0) {
    db.prepare('DELETE FROM name_bindings WHERE key_id = ?').run(keyId);
  }
  return released;
}

/**
 * List every persisted binding. Used once at startup to rehydrate the
 * in-memory nameToKeyId cache — see rehydrateNameBindings() in portwing-ws.ts.
 */
export function listBindings(): NameBindingRecord[] {
  if (!db) {
    return [];
  }
  return db
    .prepare('SELECT agent_name, key_id, last_seen_at FROM name_bindings')
    .all()
    .map(rowToRecord);
}

/** Exposed for tests to reset module state between cases. */
export function clearCollectionForTesting(): void {
  db = undefined;
}
