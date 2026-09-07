import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import * as mqttHass from './mqtt-hass.js';

const ROUTE_A = {
  brokerUrl: 'mqtt://broker-a:1883',
  baseTopic: 'dd',
  discoveryPrefix: 'homeassistant',
  agentTopicSegment: false,
};

const ROUTE_B = {
  brokerUrl: 'mqtt://broker-b:1883',
  baseTopic: 'dd',
  discoveryPrefix: 'homeassistant',
  agentTopicSegment: false,
};

describe('MQTT Hass store', () => {
  let db: Database;
  let routeKeyA: string;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
    routeKeyA = mqttHass.getHassIdentityTopicCleanupRouteKey(ROUTE_A);
  });

  afterEach(() => {
    db.close();
  });

  test('hasRunHassIdentityTopicCleanup returns false before createCollections runs', () => {
    expect(mqttHass.hasRunHassIdentityTopicCleanup(routeKeyA)).toBe(false);
  });

  test('markHassIdentityTopicCleanupComplete is a no-op before createCollections runs', () => {
    expect(() => mqttHass.markHassIdentityTopicCleanupComplete(routeKeyA)).not.toThrow();
  });

  test('hasRunHassIdentityTopicCleanup returns false when the marker has never been written', () => {
    mqttHass.createCollections(db);
    expect(mqttHass.hasRunHassIdentityTopicCleanup(routeKeyA)).toBe(false);
  });

  test('markHassIdentityTopicCleanupComplete writes a store_metadata row hasRunHassIdentityTopicCleanup then reads back as true', () => {
    mqttHass.createCollections(db);
    mqttHass.markHassIdentityTopicCleanupComplete(routeKeyA);

    expect(mqttHass.hasRunHassIdentityTopicCleanup(routeKeyA)).toBe(true);
    const row = db
      .prepare('SELECT key, value FROM store_metadata WHERE key = ?')
      .get(`${mqttHass.HASS_IDENTITY_TOPIC_CLEANUP_MARKER_KEY}:${routeKeyA}`);
    expect(row).toBeDefined();
  });

  test('marking complete twice does not error and stays true', () => {
    mqttHass.createCollections(db);
    mqttHass.markHassIdentityTopicCleanupComplete(routeKeyA);
    mqttHass.markHassIdentityTopicCleanupComplete(routeKeyA);

    expect(mqttHass.hasRunHassIdentityTopicCleanup(routeKeyA)).toBe(true);
  });

  describe('getHassIdentityTopicCleanupRouteKey', () => {
    test('is stable for the same route', () => {
      expect(mqttHass.getHassIdentityTopicCleanupRouteKey(ROUTE_A)).toBe(
        mqttHass.getHassIdentityTopicCleanupRouteKey({ ...ROUTE_A }),
      );
    });

    test('differs when the broker url differs', () => {
      expect(mqttHass.getHassIdentityTopicCleanupRouteKey(ROUTE_A)).not.toBe(
        mqttHass.getHassIdentityTopicCleanupRouteKey(ROUTE_B),
      );
    });

    test('differs when the base topic differs', () => {
      expect(mqttHass.getHassIdentityTopicCleanupRouteKey(ROUTE_A)).not.toBe(
        mqttHass.getHassIdentityTopicCleanupRouteKey({ ...ROUTE_A, baseTopic: 'other' }),
      );
    });

    test('differs when the discovery prefix differs', () => {
      expect(mqttHass.getHassIdentityTopicCleanupRouteKey(ROUTE_A)).not.toBe(
        mqttHass.getHassIdentityTopicCleanupRouteKey({ ...ROUTE_A, discoveryPrefix: 'other' }),
      );
    });

    test('differs when the agent-topic-segment mode differs', () => {
      expect(mqttHass.getHassIdentityTopicCleanupRouteKey(ROUTE_A)).not.toBe(
        mqttHass.getHassIdentityTopicCleanupRouteKey({ ...ROUTE_A, agentTopicSegment: true }),
      );
    });

    test('treats an undefined broker url the same as an empty-string one (no broker configured either way)', () => {
      expect(
        mqttHass.getHassIdentityTopicCleanupRouteKey({ ...ROUTE_A, brokerUrl: undefined }),
      ).toBe(mqttHass.getHassIdentityTopicCleanupRouteKey({ ...ROUTE_A, brokerUrl: '' }));
    });
  });

  /**
   * Review finding 2 (roadmap 7-STORE slice 10): two discovery-enabled MQTT
   * triggers can share one store. Before the marker was route-scoped, the
   * first trigger's completed sweep set the one global marker and the second
   * trigger's own sweep — over an entirely different broker/topic route —
   * read that same marker as "already ran" and skipped its own cleanup.
   */
  test('two triggers on different routes each get their own independent marker', () => {
    mqttHass.createCollections(db);
    const routeKeyB = mqttHass.getHassIdentityTopicCleanupRouteKey(ROUTE_B);

    mqttHass.markHassIdentityTopicCleanupComplete(routeKeyA);

    expect(mqttHass.hasRunHassIdentityTopicCleanup(routeKeyA)).toBe(true);
    expect(mqttHass.hasRunHassIdentityTopicCleanup(routeKeyB)).toBe(false);
  });
});
