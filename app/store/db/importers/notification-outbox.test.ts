import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { COLLECTION_IMPORTERS } from './index.js';
import { notificationOutboxImporter } from './notification-outbox.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({
      collections: [{ name: 'notificationOutbox', data: documents.map((data) => ({ data })) }],
    }),
    'dd.json',
  );
}

describe('store/db/importers/notification-outbox', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return notificationOutboxImporter.importInto({
      db,
      snapshot: snapshotOf(documents),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(notificationOutboxImporter);
    expect(notificationOutboxImporter.collection).toBe('notificationOutbox');
    expect(notificationOutboxImporter.table).toBe('notification_outbox');
  });

  test('carries a pending entry across field for field, serialising the payload as JSON text', () => {
    expect(
      run([
        {
          id: 'outbox-pending',
          eventName: 'container.updated',
          payload: { message: 'plain text payload' },
          triggerId: 'trigger-one',
          containerId: 'watcher-web',
          attempts: 0,
          maxAttempts: 5,
          nextAttemptAt: '2026-01-01T00:00:00.000Z',
          status: 'pending',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    ).toBe(1);
    expect(db.prepare('SELECT * FROM notification_outbox').get()).toEqual({
      id: 'outbox-pending',
      event_name: 'container.updated',
      trigger_id: 'trigger-one',
      container_id: 'watcher-web',
      attempts: 0,
      max_attempts: 5,
      next_attempt_at: '2026-01-01T00:00:00.000Z',
      status: 'pending',
      last_error: null,
      created_at: '2026-01-01T00:00:00.000Z',
      delivered_at: null,
      failed_at: null,
      payload: JSON.stringify({ message: 'plain text payload' }),
    });
  });

  test('carries a terminal dead-letter entry with its failedAt and lastError', () => {
    expect(
      run([
        {
          id: 'outbox-terminal',
          eventName: 'container.updated',
          payload: { message: 'plain text payload' },
          triggerId: 'trigger-one',
          containerId: 'watcher-web',
          attempts: 5,
          maxAttempts: 5,
          nextAttemptAt: '2026-01-01T00:00:00.000Z',
          status: 'dead-letter',
          createdAt: '2026-01-01T00:00:00.000Z',
          failedAt: '2026-01-02T00:00:00.000Z',
          lastError: 'delivery failed',
        },
      ]),
    ).toBe(1);
    const row = db.prepare('SELECT status, failed_at, last_error FROM notification_outbox').get();
    expect(row).toEqual({
      status: 'dead-letter',
      failed_at: '2026-01-02T00:00:00.000Z',
      last_error: 'delivery failed',
    });
  });

  test('defaults a missing attempts/maxAttempts and an empty payload rather than skipping the row', () => {
    expect(
      run([
        {
          id: 'outbox-defaults',
          eventName: 'container.updated',
          triggerId: 'trigger-one',
          nextAttemptAt: '2026-01-01T00:00:00.000Z',
          status: 'pending',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    ).toBe(1);
    const row = db
      .prepare('SELECT attempts, max_attempts, container_id, payload FROM notification_outbox')
      .get();
    expect(row).toEqual({
      attempts: 0,
      max_attempts: 5,
      container_id: null,
      payload: '{}',
    });
  });

  test('skips a document missing id, eventName, triggerId, status, nextAttemptAt or createdAt', () => {
    const base = {
      id: 'x',
      eventName: 'e',
      triggerId: 't',
      status: 'pending',
      nextAttemptAt: 'a',
      createdAt: 'c',
    };
    for (const key of Object.keys(base)) {
      const doc = { ...base };
      delete (doc as Record<string, unknown>)[key];
      expect(run([doc])).toBe(0);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get()).toEqual({ n: 0 });
  });

  test('writes no rows when the store never had this collection', () => {
    expect(run([])).toBe(0);
  });
});
