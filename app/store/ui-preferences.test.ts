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
      revision: 1,
    });
  });

  it('inserts a new record with server time', () => {
    vi.setSystemTime('2026-07-11T12:34:56.000Z');
    uiPreferences.createCollections(db);

    const result = uiPreferences.replacePreferences('alice', 11, { theme: 'dark' })!;

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
    })!;

    (returned.preferences.appearance as { fontSize: number }).fontSize = 1.3;

    expect(uiPreferences.getPreferences('alice')?.preferences).toEqual({
      appearance: { fontSize: 1 },
    });
  });

  it('starts at revision 0 for an unknown user and bumps on every write', () => {
    uiPreferences.createCollections(db);
    expect(uiPreferences.getRevision('alice')).toBe(0);
    expect(uiPreferences.replacePreferences('alice', 11, {})?.revision).toBe(1);
    expect(uiPreferences.replacePreferences('alice', 11, { a: 1 })?.revision).toBe(2);
    expect(uiPreferences.getRevision('alice')).toBe(2);
    expect(uiPreferences.getRevision('bob')).toBe(0);
  });

  it('writes when the expected revision matches', () => {
    uiPreferences.createCollections(db);
    expect(uiPreferences.replacePreferences('alice', 11, { a: 1 }, 0)?.revision).toBe(1);
    expect(uiPreferences.replacePreferences('alice', 11, { a: 2 }, 1)?.revision).toBe(2);
    expect(uiPreferences.getPreferences('alice')?.preferences).toEqual({ a: 2 });
  });

  it('refuses a stale expected revision and leaves the stored document alone', () => {
    uiPreferences.createCollections(db);
    uiPreferences.replacePreferences('alice', 11, { a: 1 });
    uiPreferences.replacePreferences('alice', 11, { a: 2 });

    expect(uiPreferences.replacePreferences('alice', 11, { a: 'stale' }, 1)).toBeNull();
    expect(uiPreferences.replacePreferences('bob', 11, { a: 'first' }, 4)).toBeNull();
    expect(uiPreferences.getPreferences('alice')).toMatchObject({
      preferences: { a: 2 },
      revision: 2,
    });
    expect(uiPreferences.getPreferences('bob')).toBeNull();
  });

  it('keeps the second device edit when a lost-response write is replayed', () => {
    uiPreferences.createCollections(db);
    // Device A writes against revision 0 and the server commits it, but the
    // response never reaches A, so A still believes the document is at revision 0.
    expect(uiPreferences.replacePreferences('alice', 11, { theme: 'dark' }, 0)?.revision).toBe(1);
    // Device B reads revision 1 and makes its own edit.
    const seenByB = uiPreferences.getPreferences('alice')!;
    expect(
      uiPreferences.replacePreferences(
        'alice',
        11,
        { theme: 'dark', sidebar: true },
        seenByB.revision,
      )?.revision,
    ).toBe(2);
    // A retries the same full-replace blob with its old revision and is refused.
    expect(uiPreferences.replacePreferences('alice', 11, { theme: 'dark' }, 0)).toBeNull();
    expect(uiPreferences.getPreferences('alice')?.preferences).toEqual({
      theme: 'dark',
      sidebar: true,
    });
  });
});
