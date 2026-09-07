import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { COLLECTION_IMPORTERS } from './index.js';
import { sessionsImporter } from './sessions.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

const EMPTY_SNAPSHOT = () => parseLokiDatabase(JSON.stringify({ collections: [] }), 'test');

describe('store/db/importers/sessions', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(sessionDocuments: Record<string, unknown>[]): number {
    return sessionsImporter.importInto({
      db,
      snapshot: EMPTY_SNAPSHOT(),
      sessionDocuments,
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(sessionsImporter);
    expect(sessionsImporter.collection).toBe('Sessions');
    expect(sessionsImporter.table).toBe('sessions');
  });

  test('imports a session whose cookie has not expired yet', () => {
    const expires = new Date(Date.now() + 60_000).toISOString();
    const content = { cookie: { expires }, passport: { user: { username: 'alice' } } };

    expect(run([{ sid: 'sid-live', content, updatedAt: '2026-01-01T00:00:00.000Z' }])).toBe(1);

    expect(db.prepare('SELECT sid, expires_at, data FROM sessions').all()).toEqual([
      { sid: 'sid-live', expires_at: Date.parse(expires), data: JSON.stringify(content) },
    ]);
  });

  test('skips a session whose cookie already expired', () => {
    const expires = new Date(Date.now() - 60_000).toISOString();
    const content = { cookie: { expires } };

    expect(run([{ sid: 'sid-expired', content }])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  test('skips a document with no sid', () => {
    expect(run([{ content: { cookie: { expires: new Date().toISOString() } } }])).toBe(0);
  });

  test('skips a document with an empty sid', () => {
    expect(run([{ sid: '', content: { cookie: { expires: new Date().toISOString() } } }])).toBe(0);
  });

  test('skips a document whose content is not a plain record', () => {
    expect(run([{ sid: 'sid-1', content: 'not-an-object' }])).toBe(0);
    expect(run([{ sid: 'sid-1', content: ['array'] }])).toBe(0);
    expect(run([{ sid: 'sid-1' }])).toBe(0);
  });

  test('skips a document whose cookie is missing or not a plain record', () => {
    expect(run([{ sid: 'sid-1', content: {} }])).toBe(0);
    expect(run([{ sid: 'sid-1', content: { cookie: 'not-an-object' } }])).toBe(0);
  });

  test('skips a document whose cookie.expires is missing or unparseable', () => {
    expect(run([{ sid: 'sid-1', content: { cookie: {} } }])).toBe(0);
    expect(run([{ sid: 'sid-1', content: { cookie: { expires: 'not-a-date' } } }])).toBe(0);
    expect(run([{ sid: 'sid-1', content: { cookie: { expires: 12345 } } }])).toBe(0);
  });

  test('imports only the still-live rows out of a mixed batch, preserving each payload', () => {
    const liveExpires = new Date(Date.now() + 60_000).toISOString();
    const expiredExpires = new Date(Date.now() - 60_000).toISOString();
    const liveContent = { cookie: { expires: liveExpires } };

    const rows = run([
      { sid: 'sid-live', content: liveContent },
      { sid: 'sid-expired', content: { cookie: { expires: expiredExpires } } },
      { content: { cookie: { expires: liveExpires } } },
    ]);

    expect(rows).toBe(1);
    expect(db.prepare('SELECT sid FROM sessions').all()).toEqual([{ sid: 'sid-live' }]);
  });

  test('writes no rows for an empty import', () => {
    expect(run([])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });
});
