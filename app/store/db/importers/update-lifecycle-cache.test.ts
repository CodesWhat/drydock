import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { COLLECTION_IMPORTERS } from './index.js';
import { updateLifecycleCacheImporter } from './update-lifecycle-cache.js';

function snapshotOf(
  cacheDocuments: Record<string, unknown>[],
  containerRecords: Record<string, unknown>[] = [],
) {
  return parseLokiDatabase(
    JSON.stringify({
      collections: [
        { name: 'update-lifecycle-cache', data: cacheDocuments },
        { name: 'containers', data: containerRecords.map((data) => ({ data })) },
      ],
    }),
    'dd.json',
  );
}

function cacheDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cacheKey: 'local::myapp',
    updateDetectedAt: '2026-01-01T00:00:00.000Z',
    resultSignature: '{"tag":"v2"}',
    expiresAt: 1_000,
    ...overrides,
  };
}

function containerRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'container-1',
    watcher: 'local',
    name: 'myapp',
    ...overrides,
  };
}

describe('store/db/importers/update-lifecycle-cache', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(
    cacheDocuments: Record<string, unknown>[],
    containerRecords: Record<string, unknown>[] = [],
  ): number {
    return updateLifecycleCacheImporter.importInto({
      db,
      snapshot: snapshotOf(cacheDocuments, containerRecords),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(updateLifecycleCacheImporter);
    expect(updateLifecycleCacheImporter.collection).toBe('update-lifecycle-cache');
    expect(updateLifecycleCacheImporter.table).toBe('update_lifecycle_cache');
  });

  test('maps a legacy watcher::name key forward to the matching container identity key', () => {
    expect(run([cacheDocument()], [containerRecord()])).toBe(1);

    expect(
      db
        .prepare(
          'SELECT cache_key, update_detected_at, result_signature, expires_at FROM update_lifecycle_cache',
        )
        .get(),
    ).toEqual({
      cache_key: '::local::myapp',
      update_detected_at: '2026-01-01T00:00:00.000Z',
      result_signature: '{"tag":"v2"}',
      expires_at: 1_000,
    });
  });

  test('carries firstSeenAt and maturityGatePendingSince across when present', () => {
    expect(
      run(
        [
          cacheDocument({
            firstSeenAt: '2025-12-01T00:00:00.000Z',
            maturityGatePendingSince: '2026-01-01T00:00:00.000Z',
          }),
        ],
        [containerRecord()],
      ),
    ).toBe(1);

    const row = db
      .prepare('SELECT first_seen_at, maturity_gate_pending_since FROM update_lifecycle_cache')
      .get();
    expect(row).toEqual({
      first_seen_at: '2025-12-01T00:00:00.000Z',
      maturity_gate_pending_since: '2026-01-01T00:00:00.000Z',
    });
  });

  test('leaves first_seen_at and maturity_gate_pending_since NULL when absent', () => {
    expect(run([cacheDocument()], [containerRecord()])).toBe(1);

    const row = db
      .prepare('SELECT first_seen_at, maturity_gate_pending_since FROM update_lifecycle_cache')
      .get();
    expect(row).toEqual({ first_seen_at: null, maturity_gate_pending_since: null });
  });

  test('drops a legacy row whose container no longer exists in the imported data', () => {
    expect(run([cacheDocument({ cacheKey: 'local::ghost-app' })], [containerRecord()])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM update_lifecycle_cache').get()).toEqual({ n: 0 });
  });

  test('drops a legacy row when two containers claim the same watcher::name key', () => {
    expect(
      run(
        [cacheDocument()],
        [containerRecord({ id: 'container-1' }), containerRecord({ id: 'container-2' })],
      ),
    ).toBe(0);
  });

  test('drops a legacy row whose matching container has no derivable identity', () => {
    expect(
      run(
        [cacheDocument({ cacheKey: '::ghost' })],
        [containerRecord({ watcher: '', name: 'ghost' })],
      ),
    ).toBe(0);
  });

  test('drops the second of two legacy rows that both resolve to the same new identity key', () => {
    const composeLabels = {
      'com.docker.compose.project': 'stack',
      'com.docker.compose.service': 'web',
    };
    expect(
      run(
        [
          cacheDocument({ cacheKey: 'local::web-1' }),
          cacheDocument({ cacheKey: 'local::web-2', updateDetectedAt: '2026-02-01T00:00:00.000Z' }),
        ],
        [
          containerRecord({ id: 'c1', name: 'web-1', labels: composeLabels }),
          containerRecord({ id: 'c2', name: 'web-2', labels: composeLabels }),
        ],
      ),
    ).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM update_lifecycle_cache').get()).toEqual({ n: 1 });
  });

  test('ignores a container document with no derivable legacy key when indexing', () => {
    const malformedContainer = containerRecord({ id: 'malformed' });
    delete malformedContainer.watcher;

    expect(run([cacheDocument()], [malformedContainer, containerRecord()])).toBe(1);
  });

  test('ignores an agent-owned container when matching legacy keys', () => {
    expect(run([cacheDocument()], [containerRecord({ agent: 'edge-1' })])).toBe(0);
  });

  test.each(['cacheKey', 'updateDetectedAt', 'resultSignature', 'expiresAt'])(
    'skips a document missing %s',
    (field) => {
      const document = cacheDocument();
      delete document[field];

      expect(run([document], [containerRecord()])).toBe(0);
    },
  );

  test('writes no rows when the store never had this collection', () => {
    expect(run([])).toBe(0);
  });

  // Review finding 1 (roadmap 7-STORE slice 7): the sibling
  // update-policy-retention-cache importer needed an upsert because a plain
  // INSERT throws on a duplicate cacheKey. This importer's insert.run() is
  // always gated on `!seenNewKeys.has(newKey)` immediately before it runs
  // (see importInto above), so two legacy documents sharing a raw cacheKey
  // resolve to the same container, the same derived newKey, and the second
  // is skipped before any insert is attempted — no plain-INSERT throw is
  // possible here, so no upsert was needed. This pins that down: the first
  // document wins because it is the one that gets inserted, not the last.
  test('does not throw on two legacy documents sharing a cacheKey — the dedup already prevents the second insert', () => {
    expect(
      run(
        [
          cacheDocument({ resultSignature: '{"tag":"first"}' }),
          cacheDocument({ resultSignature: '{"tag":"second"}' }),
        ],
        [containerRecord()],
      ),
    ).toBe(1);

    expect(db.prepare('SELECT result_signature FROM update_lifecycle_cache').get()).toEqual({
      result_signature: '{"tag":"first"}',
    });
  });
});
