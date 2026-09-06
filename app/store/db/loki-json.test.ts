import fs from 'node:fs';
import path from 'node:path';
import {
  createTemporaryStoreDirectory,
  removeTemporaryStoreDirectory,
  writeLokiStoreFile,
} from '../../test/sqlite-db.js';
import { StoreError } from './driver.js';
import {
  LEGACY_SESSIONS_FILE,
  parseLokiDatabase,
  readLokiDatabase,
  resolveLegacySessionDocuments,
} from './loki-json.js';

vi.mock('../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

describe('store/db/loki-json', () => {
  let storeDirectory: string;

  beforeEach(() => {
    storeDirectory = createTemporaryStoreDirectory();
  });

  afterEach(() => {
    removeTemporaryStoreDirectory(storeDirectory);
  });

  describe('parseLokiDatabase', () => {
    test('reads a flat collection and drops the fields LokiJS injects', () => {
      const snapshot = parseLokiDatabase(
        JSON.stringify({
          collections: [
            {
              name: 'secrets',
              data: [{ sessionSecret: 'abc', meta: { revision: 3 }, $loki: 1 }],
            },
          ],
        }),
        'dd.json',
      );
      expect(snapshot.source).toBe('dd.json');
      expect(snapshot.collectionNames).toEqual(['secrets']);
      expect(snapshot.hasCollection('secrets')).toBe(true);
      expect(snapshot.hasCollection('containers')).toBe(false);
      expect(snapshot.documents('secrets')).toEqual([{ sessionSecret: 'abc' }]);
    });

    test('unwraps a {data} enveloped collection', () => {
      const snapshot = parseLokiDatabase(
        JSON.stringify({
          collections: [
            {
              name: 'audit',
              data: [
                { data: { id: 'a1', action: 'update-applied' }, timestampMs: 42, $loki: 1 },
                { timestampMs: 43, $loki: 2 },
              ],
            },
          ],
        }),
        'dd.json',
      );
      expect(snapshot.records('audit')).toEqual([{ id: 'a1', action: 'update-applied' }]);
      // documents() keeps the envelope's siblings, which audit needs.
      expect(snapshot.documents('audit')[0]).toMatchObject({ timestampMs: 42 });
    });

    test('ignores malformed entries rather than failing the whole import', () => {
      const snapshot = parseLokiDatabase(
        JSON.stringify({
          collections: [
            null,
            { data: [{ orphan: true }] },
            { name: 'settings' },
            { name: 'app', data: [{ name: 'drydock' }, 'not-a-document', null] },
          ],
        }),
        'dd.json',
      );
      expect(snapshot.collectionNames).toEqual(['settings', 'app']);
      expect(snapshot.documents('settings')).toEqual([]);
      expect(snapshot.documents('app')).toEqual([{ name: 'drydock' }]);
    });

    test('returns an empty list for a collection an older store never had', () => {
      const snapshot = parseLokiDatabase(JSON.stringify({ collections: [] }), 'dd.json');
      expect(snapshot.documents('approvals')).toEqual([]);
      expect(snapshot.records('approvals')).toEqual([]);
    });

    test.each([
      ['not json at all', 'not valid JSON'],
      ['[1,2,3]', 'not a JSON object'],
      ['{"engineVersion":1.5}', 'no "collections" array'],
    ])('refuses %s', (contents, reason) => {
      let thrown: unknown;
      try {
        parseLokiDatabase(contents, '/store/dd.json');
      } catch (error: unknown) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(StoreError);
      expect((thrown as StoreError).code).toBe('STORE_LEGACY_STORE_UNREADABLE');
      expect((thrown as Error).message).toContain(reason);
      expect((thrown as Error).message).toContain('/store/dd.json');
    });
  });

  describe('readLokiDatabase', () => {
    test('reads a serialised store from disk', () => {
      const storePath = path.join(storeDirectory, 'dd.json');
      writeLokiStoreFile(storePath, [{ name: 'secrets', data: [{ sessionSecret: 'abc' }] }]);
      expect(readLokiDatabase(storePath).documents('secrets')).toEqual([{ sessionSecret: 'abc' }]);
    });

    test('reports an unreadable file', () => {
      expect(() => readLokiDatabase(path.join(storeDirectory, 'missing.json'))).toThrow(
        /could not be read/,
      );
    });
  });

  describe('resolveLegacySessionDocuments', () => {
    test('prefers the dedicated sessions file when DR-121 has already split it out', () => {
      const storePath = path.join(storeDirectory, 'dd.json');
      writeLokiStoreFile(storePath, [{ name: 'Sessions', data: [{ sid: 'stale' }] }]);
      writeLokiStoreFile(path.join(storeDirectory, LEGACY_SESSIONS_FILE), [
        { name: 'Sessions', data: [{ sid: 'current' }] },
      ]);

      expect(resolveLegacySessionDocuments(storeDirectory, readLokiDatabase(storePath))).toEqual([
        { sid: 'current' },
      ]);
    });

    test('falls back to the Sessions collection inside the shared store file', () => {
      const storePath = path.join(storeDirectory, 'dd.json');
      writeLokiStoreFile(storePath, [{ name: 'Sessions', data: [{ sid: 'shared' }] }]);
      expect(resolveLegacySessionDocuments(storeDirectory, readLokiDatabase(storePath))).toEqual([
        { sid: 'shared' },
      ]);
    });

    test('is empty when neither source has any sessions', () => {
      const storePath = path.join(storeDirectory, 'dd.json');
      writeLokiStoreFile(storePath, [{ name: 'secrets', data: [] }]);
      expect(resolveLegacySessionDocuments(storeDirectory, readLokiDatabase(storePath))).toEqual(
        [],
      );
      expect(fs.existsSync(path.join(storeDirectory, LEGACY_SESSIONS_FILE))).toBe(false);
    });
  });
});
