/**
 * Persisted agent-name → pubKeyId identity-binding store.
 *
 * Backs the in-memory `nameToKeyId` cache in app/api/portwing-ws.ts (squat/theft
 * prevention for edge-agent display names — see the design note next to that
 * map). Mirrors agent-keys.ts: one LokiJS collection, loaded/autosaved by the
 * shared store, one document per binding.
 *
 * Without this, the binding cache lived only in a bare process-memory Map —
 * wiped on every restart, including the restart that deploys this very fix,
 * which reopens the squat window the binding was meant to close for as long
 * as it takes agents to reconnect and re-establish their bindings. Persisting
 * the bindings means a restarted server still knows which key owns which name
 * before any agent reconnects.
 */
import { initCollection } from './util.js';

export interface NameBindingRecord {
  agentName: string; // sanitized/fallback display name (see computeAgentName)
  keyId: string; // 16 lowercase hex chars — the pubKeyId that owns this name
  lastSeenAt: number; // epoch ms of the most recent hello admitted under this binding
}

interface NameBindingCollection {
  findOne(query: Record<string, unknown>): NameBindingRecord | null;
  find(query?: Record<string, unknown>): NameBindingRecord[];
  insert(document: NameBindingRecord): void;
  update(document: NameBindingRecord): void;
  remove(document: NameBindingRecord): void;
}

interface NameBindingStoreDb {
  getCollection(name: string): NameBindingCollection | null;
  addCollection(name: string, options?: Record<string, unknown>): NameBindingCollection;
}

let nameBindingCollection: NameBindingCollection | undefined;

/**
 * Create the name-bindings collection.
 * @param db
 */
export function createCollections(db: NameBindingStoreDb): void {
  nameBindingCollection = initCollection(db, 'name-bindings', {
    indices: ['agentName', 'keyId'],
  }) as NameBindingCollection;
}

/**
 * Insert or update the persisted binding for agentName.
 * A no-op (rather than a throw) when the collection has not been initialized
 * yet — callers (portwing-ws.ts) run on every hello and must not fail admission
 * just because the durable store isn't wired up (e.g. in unit tests that only
 * exercise the in-memory cache).
 */
export function upsertBinding(agentName: string, keyId: string, lastSeenAt: number): void {
  if (!nameBindingCollection) {
    return;
  }
  const existing = nameBindingCollection.findOne({ agentName });
  if (existing) {
    existing.keyId = keyId;
    existing.lastSeenAt = lastSeenAt;
    nameBindingCollection.update(existing);
    return;
  }
  nameBindingCollection.insert({ agentName, keyId, lastSeenAt });
}

/**
 * Delete the persisted binding for agentName, if any.
 */
export function deleteBinding(agentName: string): void {
  if (!nameBindingCollection) {
    return;
  }
  const existing = nameBindingCollection.findOne({ agentName });
  if (existing) {
    nameBindingCollection.remove(existing);
  }
}

/**
 * Delete every persisted binding owned by keyId (key revocation).
 * Returns the agentNames that were released, mirroring the in-memory purge in
 * disconnectByKeyId().
 */
export function deleteBindingsForKey(keyId: string): string[] {
  if (!nameBindingCollection) {
    return [];
  }
  const matches = nameBindingCollection.find({ keyId });
  for (const doc of matches) {
    nameBindingCollection.remove(doc);
  }
  return matches.map((doc) => doc.agentName);
}

/**
 * List every persisted binding. Used once at startup to rehydrate the
 * in-memory nameToKeyId cache — see rehydrateNameBindings() in portwing-ws.ts.
 */
export function listBindings(): NameBindingRecord[] {
  if (!nameBindingCollection) {
    return [];
  }
  return nameBindingCollection.find();
}

/** Exposed for tests to reset module state between cases. */
export function clearCollectionForTesting(): void {
  nameBindingCollection = undefined;
}
