import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { approvalsImporter } from './approvals.js';
import { COLLECTION_IMPORTERS } from './index.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({ collections: [{ name: 'approvals', data: documents }] }),
    'dd.json',
  );
}

function pendingDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'approval-fixture-pending',
    containerId: 'container-web',
    containerIdentityKey: 'watcher-web',
    containerName: 'web',
    watcher: 'local',
    image: 'library/web',
    fromRef: 'one',
    toRef: 'two',
    candidateRef: 'two',
    updateKind: 'tag',
    semverDiff: 'minor',
    createdAt: '2026-01-08T00:00:00.000Z',
    createdAtMs: 1767830400000,
    decision: 'pending',
    ...overrides,
  };
}

describe('store/db/importers/approvals', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return approvalsImporter.importInto({
      db,
      snapshot: snapshotOf(documents),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(approvalsImporter);
    expect(approvalsImporter.collection).toBe('approvals');
    expect(approvalsImporter.table).toBe('approvals');
  });

  test('carries a pending row across field for field, omitting decision fields it never had', () => {
    expect(run([pendingDocument()])).toBe(1);

    expect(
      db
        .prepare(
          `SELECT id, schema_version, container_id, container_identity_key, container_name, watcher,
                  agent, image, from_ref, to_ref, candidate_ref, update_kind, semver_diff,
                  created_at, created_at_ms, decision, decided_at, decided_by, operation_id
             FROM approvals`,
        )
        .get(),
    ).toEqual({
      id: 'approval-fixture-pending',
      schema_version: 1,
      container_id: 'container-web',
      container_identity_key: 'watcher-web',
      container_name: 'web',
      watcher: 'local',
      agent: null,
      image: 'library/web',
      from_ref: 'one',
      to_ref: 'two',
      candidate_ref: 'two',
      update_kind: 'tag',
      semver_diff: 'minor',
      created_at: '2026-01-08T00:00:00.000Z',
      created_at_ms: 1767830400000,
      decision: 'pending',
      decided_at: null,
      decided_by: null,
      operation_id: null,
    });
  });

  test('carries a decided row across field for field, including the scan summary and agent', () => {
    expect(
      run([
        pendingDocument({
          id: 'approval-fixture-decided',
          agent: 'edge-1',
          releaseNotesUrl: 'https://example.test/notes',
          scanCritical: 1,
          scanHigh: 2,
          scanMedium: 3,
          scanLow: 4,
          scanUnknown: 5,
          scanAt: '2026-01-07T00:00:00.000Z',
          decision: 'approved',
          decidedAt: '2026-01-09T00:00:00.000Z',
          decidedBy: 'scott',
          decisionNote: 'looks fine',
          operationId: 'operation-one',
          outcome: 'applied',
        }),
      ]),
    ).toBe(1);

    const row = db
      .prepare(
        `SELECT agent, release_notes_url, scan_critical, scan_high, scan_medium, scan_low,
                scan_unknown, scan_at, decision, decided_at, decided_by, decision_note,
                operation_id, outcome
           FROM approvals`,
      )
      .get();
    expect(row).toEqual({
      agent: 'edge-1',
      release_notes_url: 'https://example.test/notes',
      scan_critical: 1,
      scan_high: 2,
      scan_medium: 3,
      scan_low: 4,
      scan_unknown: 5,
      scan_at: '2026-01-07T00:00:00.000Z',
      decision: 'approved',
      decided_at: '2026-01-09T00:00:00.000Z',
      decided_by: 'scott',
      decision_note: 'looks fine',
      operation_id: 'operation-one',
      outcome: 'applied',
    });
  });

  test.each([
    'id',
    'containerId',
    'containerIdentityKey',
    'containerName',
    'watcher',
    'image',
    'fromRef',
    'toRef',
    'candidateRef',
    'updateKind',
    'semverDiff',
    'schemaVersion',
    'createdAt',
    'createdAtMs',
    'decision',
  ])('skips a document missing %s', (field) => {
    const document = pendingDocument();
    delete document[field];

    expect(run([document])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM approvals').get()).toEqual({ n: 0 });
  });

  test('writes no rows when the store never had this collection', () => {
    expect(run([])).toBe(0);
  });
});
