import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import * as uiPreferences from './ui-preferences.js';

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: vi.fn() })) } }));

describe('UI preferences store', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it('returns null before createCollections has been called', async () => {
    vi.resetModules();
    const fresh = await import('./ui-preferences.js');
    expect(fresh.getPreferences('alice')).toBeNull();
    expect(() => fresh.replacePreferences('alice', 11, {})).toThrow(
      'ui-preferences store not initialized',
    );
  });

  it('returns null for an unknown user', () => {
    uiPreferences.createCollections(db);
    expect(uiPreferences.getPreferences('missing')).toBeNull();
  });

  it('returns a known record', () => {
    db.prepare(
      `INSERT INTO ui_preferences (username, schema_version, preferences, updated_at)
       VALUES ('alice', 11, ?, '2026-07-11T12:00:00.000Z')`,
    ).run(JSON.stringify({ sync: { enabled: true } }));

    uiPreferences.createCollections(db);
    expect(uiPreferences.getPreferences('alice')).toEqual({
      username: 'alice',
      schemaVersion: 11,
      preferences: { sync: { enabled: true } },
      updatedAt: '2026-07-11T12:00:00.000Z',
    });
  });

  it('inserts a new record with server time', () => {
    vi.setSystemTime('2026-07-11T12:34:56.000Z');
    uiPreferences.createCollections(db);

    const result = uiPreferences.replacePreferences('alice', 11, { theme: 'dark' });

    expect(
      db.prepare('SELECT username, schema_version, preferences FROM ui_preferences').get(),
    ).toEqual({
      username: 'alice',
      schema_version: 11,
      preferences: JSON.stringify({ theme: 'dark' }),
    });
    expect(result.updatedAt).toBe('2026-07-11T12:34:56.000Z');
    vi.useRealTimers();
  });

  it('replaces an existing record for the same username', () => {
    uiPreferences.createCollections(db);
    uiPreferences.replacePreferences('alice', 10, {});
    uiPreferences.replacePreferences('alice', 11, { newer: true });

    expect(db.prepare('SELECT COUNT(*) AS n FROM ui_preferences').get()).toEqual({ n: 1 });
    expect(uiPreferences.getPreferences('alice')).toMatchObject({
      schemaVersion: 11,
      preferences: { newer: true },
    });
  });

  it('isolates persisted preferences from later input mutations', () => {
    uiPreferences.createCollections(db);
    const input = { appearance: { fontSize: 1 } };
    uiPreferences.replacePreferences('alice', 11, input);

    input.appearance.fontSize = 1.3;

    expect(uiPreferences.getPreferences('alice')?.preferences).toEqual({
      appearance: { fontSize: 1 },
    });
  });

  it('isolates persisted preferences from mutations to returned records', () => {
    uiPreferences.createCollections(db);
    const returned = uiPreferences.replacePreferences('alice', 11, {
      appearance: { fontSize: 1 },
    });

    (returned.preferences.appearance as { fontSize: number }).fontSize = 1.3;

    expect(uiPreferences.getPreferences('alice')?.preferences).toEqual({
      appearance: { fontSize: 1 },
    });
  });
});
