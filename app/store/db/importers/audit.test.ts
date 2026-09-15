import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { auditImporter } from './audit.js';
import { COLLECTION_IMPORTERS } from './index.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({ collections: [{ name: 'audit', data: documents }] }),
    'dd.json',
  );
}

describe('store/db/importers/audit', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return auditImporter.importInto({
      db,
      snapshot: snapshotOf(documents),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(auditImporter);
    expect(auditImporter.collection).toBe('audit');
    expect(auditImporter.table).toBe('audit');
  });

  test('carries an entry with an explicit timestampMs across field for field', () => {
    expect(
      run([
        {
          data: {
            id: 'audit-one',
            timestamp: '2026-01-10T00:00:00.000Z',
            action: 'update-applied',
            containerName: 'web',
            containerIdentityKey: 'watcher-web',
            containerImage: 'library/web',
            fromVersion: 'one',
            toVersion: 'two',
            updateKind: 'tag',
            semverDiff: 'minor',
            triggerName: 'docker.default',
            status: 'success',
            details: 'plain details text',
          },
          timestampMs: 1768003200000,
        },
      ]),
    ).toBe(1);
    expect(db.prepare('SELECT * FROM audit').get()).toEqual({
      id: 'audit-one',
      timestamp: '2026-01-10T00:00:00.000Z',
      timestamp_ms: 1768003200000,
      action: 'update-applied',
      container_name: 'web',
      container_identity_key: 'watcher-web',
      container_image: 'library/web',
      from_version: 'one',
      to_version: 'two',
      update_kind: 'tag',
      semver_diff: 'minor',
      trigger_name: 'docker.default',
      status: 'success',
      details: 'plain details text',
    });
  });

  test('fills a missing timestampMs from the stored timestamp', () => {
    expect(
      run([
        {
          data: {
            id: 'audit-two',
            timestamp: '2026-01-11T00:00:00.000Z',
            action: 'update-failed',
            containerName: 'app',
            status: 'error',
          },
        },
      ]),
    ).toBe(1);
    const row = db.prepare('SELECT timestamp_ms FROM audit WHERE id = ?').get('audit-two');
    expect(row?.timestamp_ms).toBe(Date.parse('2026-01-11T00:00:00.000Z'));
  });

  test('falls back to 0 when the stored timestamp does not parse either', () => {
    expect(
      run([
        {
          data: {
            id: 'audit-three',
            timestamp: 'not-a-date',
            action: 'update-failed',
            containerName: 'app',
            status: 'error',
          },
        },
      ]),
    ).toBe(1);
    const row = db.prepare('SELECT timestamp_ms FROM audit WHERE id = ?').get('audit-three');
    expect(row?.timestamp_ms).toBe(0);
  });

  test('stores an empty timestamp when the document never recorded one', () => {
    expect(
      run([
        {
          data: {
            id: 'audit-four',
            action: 'update-failed',
            containerName: 'app',
            status: 'error',
          },
          timestampMs: 1700000000000,
        },
      ]),
    ).toBe(1);
    const row = db.prepare('SELECT timestamp FROM audit WHERE id = ?').get('audit-four');
    expect(row?.timestamp).toBe('');
  });

  test('skips a document missing id, action, containerName or status', () => {
    expect(
      run([{ data: { action: 'update-applied', containerName: 'web', status: 'success' } }]),
    ).toBe(0);
    expect(run([{ data: { id: 'x', containerName: 'web', status: 'success' } }])).toBe(0);
    expect(run([{ data: { id: 'x', action: 'update-applied', status: 'success' } }])).toBe(0);
    expect(run([{ data: { id: 'x', action: 'update-applied', containerName: 'web' } }])).toBe(0);
    expect(run([{ data: 'not-an-object' }])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit').get()).toEqual({ n: 0 });
  });

  test('writes no rows when the store never had this collection', () => {
    expect(run([])).toBe(0);
  });
});
