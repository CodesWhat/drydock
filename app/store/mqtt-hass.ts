/**
 * MQTT Home Assistant one-shot markers.
 *
 * Backed by the generic `store_metadata` key/value table (the same table the
 * legacy-JSON import marker uses, see `app/store/db/import.ts`), not a
 * dedicated table: this needs exactly one durable "has this run" bit per
 * route, and `store_metadata` already exists for precisely that shape of
 * fact.
 */

import { createHash } from 'node:crypto';
import type { Database } from './db/driver.js';
import { readStoreMetadata, writeStoreMetadata } from './db/import.js';

/**
 * Presence of a `${HASS_IDENTITY_TOPIC_CLEANUP_MARKER_KEY}:${routeKey}` key
 * in `store_metadata` means the one-time post-upgrade cleanup of pre-v1.8
 * name-based Home Assistant discovery topics (the MQTT identity cut) has
 * already run for that route (see `getHassIdentityTopicCleanupRouteKey`).
 */
export const HASS_IDENTITY_TOPIC_CLEANUP_MARKER_KEY = 'mqtt-hass-identity-topic-cleanup';

let db: Database | undefined;

export function createCollections(database: Database): void {
  db = database;
}

/**
 * The route a one-shot Home Assistant legacy-topic cleanup sweep actually
 * ran over (roadmap 7-STORE slice 10 review finding 2). "Already ran" only
 * means something for the exact broker + base topic + discovery prefix +
 * agent-topic-segment mode combination a sweep swept — two discovery-enabled
 * MQTT triggers can share one store (and so one `store_metadata` table)
 * while pointing at different brokers or topic layouts, and a marker with no
 * route scope would let the first trigger's run silently suppress the
 * second's forever.
 */
export interface HassIdentityTopicCleanupRoute {
  brokerUrl: string | undefined;
  baseTopic: string;
  discoveryPrefix: string;
  agentTopicSegment: boolean;
}

/**
 * Stable route key for the one-shot cleanup marker. A short sha256 hex of
 * the route fields joined on a separator (`\0`) that none of them can
 * plausibly contain, so two different routes can never collide onto the
 * same key the way naive string concatenation could (`topic: 'a', prefix:
 * 'b:1'` vs `topic: 'a:b', prefix: '1'`).
 */
export function getHassIdentityTopicCleanupRouteKey(route: HassIdentityTopicCleanupRoute): string {
  const canonical = [
    route.brokerUrl ?? '',
    route.baseTopic,
    route.discoveryPrefix,
    route.agentTopicSegment ? '1' : '0',
  ].join('\0');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function getMarkerKey(routeKey: string): string {
  return `${HASS_IDENTITY_TOPIC_CLEANUP_MARKER_KEY}:${routeKey}`;
}

/**
 * Whether the one-time post-upgrade Home Assistant legacy discovery topic
 * cleanup has already run for this route.
 */
export function hasRunHassIdentityTopicCleanup(routeKey: string): boolean {
  if (!db) {
    return false;
  }
  return readStoreMetadata(db, getMarkerKey(routeKey)) !== undefined;
}

/**
 * Record that the one-time post-upgrade Home Assistant legacy discovery
 * topic cleanup has run for this route, so it is never attempted again for
 * it.
 */
export function markHassIdentityTopicCleanupComplete(routeKey: string): void {
  if (!db) {
    return;
  }
  writeStoreMetadata(db, getMarkerKey(routeKey), new Date().toISOString());
}
