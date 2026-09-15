import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { COLLECTION_IMPORTERS } from './index.js';
import { notificationHistoryImporter } from './notification-history.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({
      collections: [{ name: 'notifications_history', data: documents.map((data) => ({ data })) }],
    }),
    'dd.json',
  );
}

describe('store/db/importers/notification-history', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return notificationHistoryImporter.importInto({
      db,
      snapshot: snapshotOf(documents),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(notificationHistoryImporter);
    expect(notificationHistoryImporter.collection).toBe('notifications_history');
    expect(notificationHistoryImporter.table).toBe('notification_history');
  });

  test('carries an entry across, with containerId landing in container_identity_key', () => {
    expect(
      run([
        {
          key: 'trigger-one::watcher-web::update-available',
          triggerId: 'trigger-one',
          containerId: 'watcher-web',
          eventKind: 'update-available',
          resultHash: 'hash-placeholder',
          notifiedAt: '2026-01-08T00:00:00.000Z',
        },
      ]),
    ).toBe(1);
    expect(db.prepare('SELECT * FROM notification_history').get()).toEqual({
      key: 'trigger-one::watcher-web::update-available',
      trigger_id: 'trigger-one',
      container_identity_key: 'watcher-web',
      event_kind: 'update-available',
      result_hash: 'hash-placeholder',
      notified_at: '2026-01-08T00:00:00.000Z',
    });
  });

  test('defaults a missing notifiedAt rather than skipping the row', () => {
    expect(
      run([
        {
          key: 'trigger-two::watcher-app::update-applied',
          triggerId: 'trigger-two',
          containerId: 'watcher-app',
          eventKind: 'update-applied',
          resultHash: 'hash-two',
        },
      ]),
    ).toBe(1);
    const row = db
      .prepare('SELECT notified_at FROM notification_history WHERE key = ?')
      .get('trigger-two::watcher-app::update-applied');
    expect(typeof row?.notified_at).toBe('string');
  });

  test('skips a document missing key, triggerId, containerId, eventKind or resultHash', () => {
    expect(
      run([{ triggerId: 't', containerId: 'c', eventKind: 'update-applied', resultHash: 'h' }]),
    ).toBe(0);
    expect(
      run([{ key: 'k', containerId: 'c', eventKind: 'update-applied', resultHash: 'h' }]),
    ).toBe(0);
    expect(run([{ key: 'k', triggerId: 't', eventKind: 'update-applied', resultHash: 'h' }])).toBe(
      0,
    );
    expect(run([{ key: 'k', triggerId: 't', containerId: 'c', resultHash: 'h' }])).toBe(0);
    expect(run([{ key: 'k', triggerId: 't', containerId: 'c', eventKind: 'update-applied' }])).toBe(
      0,
    );
    expect(db.prepare('SELECT COUNT(*) AS n FROM notification_history').get()).toEqual({ n: 0 });
  });

  test('writes no rows when the store never had this collection', () => {
    expect(run([])).toBe(0);
  });
});
