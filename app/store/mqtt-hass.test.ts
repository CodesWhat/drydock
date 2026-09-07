import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import * as mqttHass from './mqtt-hass.js';

describe('MQTT Hass store', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  test('hasRunHassIdentityTopicCleanup returns false before createCollections runs', () => {
    expect(mqttHass.hasRunHassIdentityTopicCleanup()).toBe(false);
  });

  test('markHassIdentityTopicCleanupComplete is a no-op before createCollections runs', () => {
    expect(() => mqttHass.markHassIdentityTopicCleanupComplete()).not.toThrow();
  });

  test('hasRunHassIdentityTopicCleanup returns false when the marker has never been written', () => {
    mqttHass.createCollections(db);
    expect(mqttHass.hasRunHassIdentityTopicCleanup()).toBe(false);
  });

  test('markHassIdentityTopicCleanupComplete writes a store_metadata row hasRunHassIdentityTopicCleanup then reads back as true', () => {
    mqttHass.createCollections(db);
    mqttHass.markHassIdentityTopicCleanupComplete();

    expect(mqttHass.hasRunHassIdentityTopicCleanup()).toBe(true);
    const row = db
      .prepare('SELECT key, value FROM store_metadata WHERE key = ?')
      .get(mqttHass.HASS_IDENTITY_TOPIC_CLEANUP_MARKER_KEY);
    expect(row).toBeDefined();
  });

  test('marking complete twice does not error and stays true', () => {
    mqttHass.createCollections(db);
    mqttHass.markHassIdentityTopicCleanupComplete();
    mqttHass.markHassIdentityTopicCleanupComplete();

    expect(mqttHass.hasRunHassIdentityTopicCleanup()).toBe(true);
  });
});
