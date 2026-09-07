/**
 * MQTT Home Assistant one-shot markers.
 *
 * Backed by the generic `store_metadata` key/value table (the same table the
 * legacy-JSON import marker uses, see `app/store/db/import.ts`), not a
 * dedicated table: this needs exactly one durable "has this run" bit, and
 * `store_metadata` already exists for precisely that shape of fact.
 */

import type { Database } from './db/driver.js';
import { readStoreMetadata, writeStoreMetadata } from './db/import.js';

/**
 * Presence of this key in `store_metadata` means the one-time post-upgrade
 * cleanup of pre-v1.8 name-based Home Assistant discovery topics (the MQTT
 * identity cut) has already run.
 */
export const HASS_IDENTITY_TOPIC_CLEANUP_MARKER_KEY = 'mqtt-hass-identity-topic-cleanup';

let db: Database | undefined;

export function createCollections(database: Database): void {
  db = database;
}

/**
 * Whether the one-time post-upgrade Home Assistant legacy discovery topic
 * cleanup has already run.
 */
export function hasRunHassIdentityTopicCleanup(): boolean {
  if (!db) {
    return false;
  }
  return readStoreMetadata(db, HASS_IDENTITY_TOPIC_CLEANUP_MARKER_KEY) !== undefined;
}

/**
 * Record that the one-time post-upgrade Home Assistant legacy discovery
 * topic cleanup has run, so it is never attempted again.
 */
export function markHassIdentityTopicCleanupComplete(): void {
  if (!db) {
    return;
  }
  writeStoreMetadata(db, HASS_IDENTITY_TOPIC_CLEANUP_MARKER_KEY, new Date().toISOString());
}
