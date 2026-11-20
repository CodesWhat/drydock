import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import { readStoreMetadata, writeStoreMetadata } from './db/import.js';
import * as silenceStore from './notification-silence.js';

const NOW = Date.parse('2026-03-01T12:00:00Z');
const inMinutes = (minutes: number) => new Date(NOW + minutes * 60_000);

let db: Database;

beforeEach(() => {
  silenceStore.resetSilencesForTests();
  db = createMigratedMemoryDatabase();
  silenceStore.createCollections(db);
});

afterEach(() => {
  db.close();
  silenceStore.resetSilencesForTests();
});

describe('notification silence store', () => {
  test('adds, lists soonest-expiring first and removes a silence', () => {
    const later = silenceStore.addSilence(
      { ruleId: 'container-stopped', expiresAt: inMinutes(60), createdBy: 'scott', reason: 'x' },
      NOW,
    );
    const sooner = silenceStore.addSilence({ expiresAt: inMinutes(5) }, NOW);

    expect(silenceStore.getActiveSilences(NOW).map((silence) => silence.id)).toEqual([
      sooner.id,
      later.id,
    ]);
    expect(later).toMatchObject({
      ruleId: 'container-stopped',
      createdBy: 'scott',
      reason: 'x',
      createdAt: '2026-03-01T12:00:00.000Z',
      expiresAt: '2026-03-01T13:00:00.000Z',
    });
    expect(sooner.ruleId).toBeUndefined();

    expect(silenceStore.removeSilence(later.id, NOW)?.id).toBe(later.id);
    expect(silenceStore.removeSilence(later.id, NOW)).toBeUndefined();
    expect(silenceStore.getActiveSilences(NOW)).toHaveLength(1);
  });

  test('a silence stops applying at its expiry instant and is dropped from the store', () => {
    silenceStore.addSilence({ ruleId: 'agent-disconnect', expiresAt: inMinutes(10) }, NOW);
    const opts = { respectGlobal: true };

    expect(silenceStore.findMatchingSilence('agent-disconnect', opts, NOW)).toBeDefined();
    expect(
      silenceStore.findMatchingSilence('agent-disconnect', opts, inMinutes(10).getTime() - 1),
    ).toBeDefined();
    expect(
      silenceStore.findMatchingSilence('agent-disconnect', opts, inMinutes(10).getTime()),
    ).toBeUndefined();
    expect(readStoreMetadata(db, 'notification-silences')).toBe('[]');
  });

  test('a rule silence matches only its rule; a global one matches every rule it respects', () => {
    silenceStore.addSilence({ ruleId: 'container-stopped', expiresAt: inMinutes(10) }, NOW);
    silenceStore.addSilence({ expiresAt: inMinutes(20) }, NOW);

    expect(
      silenceStore.findMatchingSilence('container-stopped', { respectGlobal: false }, NOW),
    ).toMatchObject({ ruleId: 'container-stopped' });
    expect(
      silenceStore.findMatchingSilence('update-failed', { respectGlobal: false }, NOW),
    ).toBeUndefined();
    expect(
      silenceStore.findMatchingSilence('update-failed', { respectGlobal: true }, NOW)?.ruleId,
    ).toBeUndefined();
    expect(
      silenceStore.findMatchingSilence('update-failed', { respectGlobal: true }, NOW),
    ).toBeDefined();
  });

  test('refuses to grow past the cap', () => {
    for (let i = 0; i < silenceStore.MAX_NOTIFICATION_SILENCES; i += 1) {
      silenceStore.addSilence({ expiresAt: inMinutes(10) }, NOW);
    }
    expect(() => silenceStore.addSilence({ expiresAt: inMinutes(10) }, NOW)).toThrow(/At most/);
    // Expired entries free their slots.
    expect(() =>
      silenceStore.addSilence({ expiresAt: inMinutes(90) }, inMinutes(30)),
    ).not.toThrow();
  });

  test('silences survive a restart and expired ones are not reloaded as active', () => {
    const kept = silenceStore.addSilence({ expiresAt: inMinutes(60) }, NOW);
    silenceStore.createCollections(db);

    expect(silenceStore.getActiveSilences(NOW).map((silence) => silence.id)).toEqual([kept.id]);
    expect(silenceStore.getActiveSilences(inMinutes(61).getTime())).toEqual([]);
  });

  test('a corrupt or malformed stored document loads as no silences', () => {
    writeStoreMetadata(db, 'notification-silences', 'not json');
    silenceStore.createCollections(db);
    expect(silenceStore.getActiveSilences(NOW)).toEqual([]);

    writeStoreMetadata(db, 'notification-silences', '{"a":1}');
    silenceStore.createCollections(db);
    expect(silenceStore.getActiveSilences(NOW)).toEqual([]);

    writeStoreMetadata(
      db,
      'notification-silences',
      JSON.stringify([
        null,
        { id: 1 },
        { id: 'a', createdAt: 'x', expiresAt: 'not a date' },
        { id: 'b', ruleId: 4, createdAt: 'x', expiresAt: inMinutes(5).toISOString() },
        { id: 'ok', createdAt: 'x', expiresAt: inMinutes(5).toISOString() },
      ]),
    );
    silenceStore.createCollections(db);
    expect(silenceStore.getActiveSilences(NOW).map((silence) => silence.id)).toEqual(['ok']);
  });

  test('works without a database, in memory only', () => {
    silenceStore.resetSilencesForTests();
    const silence = silenceStore.addSilence({ expiresAt: inMinutes(5) }, NOW);
    expect(silenceStore.getActiveSilences(NOW)).toHaveLength(1);
    expect(silenceStore.removeSilence(silence.id, NOW)).toBeDefined();
  });
});
