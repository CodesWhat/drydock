/**
 * Tests for the approval ledger store (spec-ca-2-approval-queue.md, slice 1).
 *
 * Backed by a real LokiJS instance rather than a collection double, so the index
 * declarations, the flat-record shape and the serialize/reload round trip are all
 * exercised as they will be in production.
 */
import Loki from 'lokijs';
import { APPROVAL_SCHEMA_VERSION, type ApprovalRecordInput } from '../model/approval.js';
import * as approvalStore from './approval.js';

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  },
}));

const DAY_MS = 24 * 60 * 60 * 1000;

function createInput(overrides: Partial<ApprovalRecordInput> = {}): ApprovalRecordInput {
  return {
    containerId: 'container-1',
    containerIdentityKey: '::local::nginx',
    containerName: 'nginx',
    watcher: 'local',
    image: 'library/nginx',
    fromRef: '1.2.3',
    toRef: '1.2.4',
    candidateRef: '1.2.4',
    updateKind: 'tag',
    semverDiff: 'patch',
    ...overrides,
  };
}

function createDb(): Loki {
  return new Loki('approval-test.db');
}

beforeEach(() => {
  approvalStore.createCollections(createDb());
});

afterEach(() => {
  approvalStore.resetApprovalStoreForTests();
});

describe('createCollections', () => {
  test('declares the queryable indices', () => {
    const db = createDb();
    const addCollection = vi.spyOn(db, 'addCollection');

    approvalStore.createCollections(db);

    expect(addCollection).toHaveBeenCalledWith('approvals', {
      indices: ['containerId', 'candidateRef', 'decision', 'createdAtMs'],
    });
  });

  test('reuses an existing collection across a reload', () => {
    const db = createDb();
    approvalStore.createCollections(db);
    approvalStore.insertApproval(createInput());

    approvalStore.createCollections(db);

    expect(approvalStore.listApprovals().total).toBe(1);
  });
});

describe('insertApproval', () => {
  test('stamps schemaVersion, id, timestamps and the pending decision', () => {
    const now = Date.parse('2026-03-04T05:06:07.000Z');

    const record = approvalStore.insertApproval(createInput(), { now });

    expect(record).toMatchObject({
      schemaVersion: APPROVAL_SCHEMA_VERSION,
      containerId: 'container-1',
      candidateRef: '1.2.4',
      createdAt: '2026-03-04T05:06:07.000Z',
      createdAtMs: now,
      decision: 'pending',
    });
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('defaults the clock to now', () => {
    const before = Date.now();

    const record = approvalStore.insertApproval(createInput());

    expect(record.createdAtMs).toBeGreaterThanOrEqual(before);
    expect(record.createdAt).toBe(new Date(record.createdAtMs).toISOString());
  });

  test('carries every optional field through and omits the ones not supplied', () => {
    const record = approvalStore.insertApproval(
      createInput({
        agent: 'edge-1',
        releaseNotesUrl: 'https://example.test/notes',
        scanCritical: 1,
        scanHigh: 2,
        scanMedium: 3,
        scanLow: 4,
        scanUnknown: 5,
        scanAt: '2026-03-01T00:00:00.000Z',
      }),
    );

    expect(record.agent).toBe('edge-1');
    expect(record.scanCritical).toBe(1);
    expect(record.scanUnknown).toBe(5);
    expect(record.scanAt).toBe('2026-03-01T00:00:00.000Z');
    expect(approvalStore.insertApproval(createInput())).not.toHaveProperty('agent');
  });

  test('never leaks the LokiJS metadata fields onto a returned record', () => {
    approvalStore.insertApproval(createInput());

    const [record] = approvalStore.listApprovals().records;

    expect(record).not.toHaveProperty('$loki');
    expect(record).not.toHaveProperty('meta');
  });

  test('throws when the collection has not been created', () => {
    approvalStore.resetApprovalStoreForTests();

    expect(() => approvalStore.insertApproval(createInput())).toThrow(
      'approvals collection not initialized',
    );
  });
});

describe('getApprovalById', () => {
  test('returns the record', () => {
    const inserted = approvalStore.insertApproval(createInput());

    expect(approvalStore.getApprovalById(inserted.id)?.candidateRef).toBe('1.2.4');
  });

  test('returns undefined for an unknown id', () => {
    expect(approvalStore.getApprovalById('nope')).toBeUndefined();
  });

  test('returns undefined when the collection has not been created', () => {
    approvalStore.resetApprovalStoreForTests();

    expect(approvalStore.getApprovalById('nope')).toBeUndefined();
  });
});

describe('findApprovalsByContainerId', () => {
  test('returns only that container’s rows, newest first', () => {
    approvalStore.insertApproval(createInput({ candidateRef: '1.2.4' }), { now: 1_000 });
    approvalStore.insertApproval(createInput({ candidateRef: '1.2.5' }), { now: 2_000 });
    approvalStore.insertApproval(createInput({ containerId: 'container-2' }), { now: 3_000 });

    const records = approvalStore.findApprovalsByContainerId('container-1');

    expect(records.map((record) => record.candidateRef)).toStrictEqual(['1.2.5', '1.2.4']);
  });

  test('returns an empty list when the collection has not been created', () => {
    approvalStore.resetApprovalStoreForTests();

    expect(approvalStore.findApprovalsByContainerId('container-1')).toStrictEqual([]);
  });
});

describe('findApprovalByOperationId', () => {
  test('returns the row carrying that operation id', () => {
    const inserted = approvalStore.insertApproval(createInput());
    approvalStore.updateApproval(inserted.id, { operationId: 'op-1' });

    expect(approvalStore.findApprovalByOperationId('op-1')?.id).toBe(inserted.id);
  });

  test('returns undefined for an operation id no row carries', () => {
    approvalStore.insertApproval(createInput());

    expect(approvalStore.findApprovalByOperationId('op-1')).toBeUndefined();
  });

  test('returns undefined when the collection has not been created', () => {
    approvalStore.resetApprovalStoreForTests();

    expect(approvalStore.findApprovalByOperationId('op-1')).toBeUndefined();
  });
});

describe('updateApproval', () => {
  test('applies only the known mutable fields and persists them', () => {
    const inserted = approvalStore.insertApproval(createInput());

    const updated = approvalStore.updateApproval(inserted.id, {
      decision: 'deferred',
      deferredUntil: '2099-01-01T00:00:00.000Z',
      decidedBy: 'scott',
      decidedAt: '2026-03-04T00:00:00.000Z',
      decisionNote: 'next window',
    });

    expect(updated).toMatchObject({
      decision: 'deferred',
      deferredUntil: '2099-01-01T00:00:00.000Z',
      decidedBy: 'scott',
      decisionNote: 'next window',
    });
    expect(approvalStore.getApprovalById(inserted.id)?.decision).toBe('deferred');
  });

  test('ignores keys outside the mutable set', () => {
    const inserted = approvalStore.insertApproval(createInput());

    approvalStore.updateApproval(inserted.id, {
      containerId: 'hijacked',
      candidateRef: 'hijacked',
    } as never);

    expect(approvalStore.getApprovalById(inserted.id)).toMatchObject({
      containerId: 'container-1',
      candidateRef: '1.2.4',
    });
  });

  test('leaves a field alone when the patch carries it as undefined', () => {
    const inserted = approvalStore.insertApproval(createInput());
    approvalStore.updateApproval(inserted.id, { decidedBy: 'scott' });

    approvalStore.updateApproval(inserted.id, { decidedBy: undefined, decision: 'approved' });

    expect(approvalStore.getApprovalById(inserted.id)).toMatchObject({
      decidedBy: 'scott',
      decision: 'approved',
    });
  });

  test('returns undefined for an unknown id', () => {
    expect(approvalStore.updateApproval('nope', { decision: 'approved' })).toBeUndefined();
  });

  test('returns undefined when the collection has not been created', () => {
    approvalStore.resetApprovalStoreForTests();

    expect(approvalStore.updateApproval('nope', { decision: 'approved' })).toBeUndefined();
  });
});

describe('listApprovals', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z');

  function seed(): void {
    approvalStore.insertApproval(
      createInput({ containerId: 'c1', containerName: 'nginx', candidateRef: '1.2.4' }),
      { now: now - 4_000 },
    );
    const deferred = approvalStore.insertApproval(
      createInput({
        containerId: 'c2',
        containerName: 'redis',
        image: 'library/redis',
        candidateRef: '7.2.0',
        toRef: '7.2.0',
        semverDiff: 'minor',
        agent: 'edge-1',
      }),
      { now: now - 3_000 },
    );
    approvalStore.updateApproval(deferred.id, {
      decision: 'deferred',
      deferredUntil: '2026-07-01T00:00:00.000Z',
    });
    const expired = approvalStore.insertApproval(
      createInput({ containerId: 'c3', containerName: 'postgres', candidateRef: '16.1' }),
      { now: now - 2_000 },
    );
    approvalStore.updateApproval(expired.id, {
      decision: 'deferred',
      deferredUntil: '2026-05-01T00:00:00.000Z',
    });
    const approved = approvalStore.insertApproval(
      createInput({ containerId: 'c4', containerName: 'caddy', candidateRef: '2.8.0' }),
      { now: now - 1_000 },
    );
    approvalStore.updateApproval(approved.id, {
      decision: 'approved',
      decidedAt: '2026-06-01T00:00:00.000Z',
    });
  }

  test('defaults to the pending set, newest first', () => {
    seed();

    const { records, total } = approvalStore.listApprovals({ now });

    expect(total).toBe(2);
    expect(records.map((record) => record.containerName)).toStrictEqual(['postgres', 'nginx']);
  });

  test('lists the unexpired deferrals', () => {
    seed();

    const { records } = approvalStore.listApprovals({ status: 'deferred', now });

    expect(records.map((record) => record.containerName)).toStrictEqual(['redis']);
  });

  test('lists decided rows, which is everything neither pending nor deferred', () => {
    seed();

    const { records } = approvalStore.listApprovals({ status: 'decided', now });

    expect(records.map((record) => record.containerName)).toStrictEqual(['caddy']);
  });

  test('lists everything under status=all', () => {
    seed();

    expect(approvalStore.listApprovals({ status: 'all', now }).total).toBe(4);
  });

  test('filters by containerId, agent and semverDiff', () => {
    seed();

    expect(
      approvalStore.listApprovals({ status: 'all', containerId: 'c2', now }).records,
    ).toHaveLength(1);
    expect(
      approvalStore.listApprovals({ status: 'all', agent: 'edge-1', now }).records,
    ).toHaveLength(1);
    expect(
      approvalStore.listApprovals({ status: 'all', semverDiff: 'minor', now }).records,
    ).toHaveLength(1);
  });

  test('free-text search matches container name, image and either ref, case-insensitively', () => {
    seed();

    expect(approvalStore.listApprovals({ status: 'all', q: 'REDIS', now }).total).toBe(1);
    expect(approvalStore.listApprovals({ status: 'all', q: 'library/nginx', now }).total).toBe(3);
    expect(approvalStore.listApprovals({ status: 'all', q: '7.2.0', now }).total).toBe(1);
    expect(approvalStore.listApprovals({ status: 'all', q: '1.2.3', now }).total).toBe(4);
    expect(approvalStore.listApprovals({ status: 'all', q: 'nothing', now }).total).toBe(0);
  });

  test('ignores a blank free-text search', () => {
    seed();

    expect(approvalStore.listApprovals({ status: 'all', q: '   ', now }).total).toBe(4);
  });

  test('paginates while reporting the unpaginated total', () => {
    seed();

    const page = approvalStore.listApprovals({ status: 'all', limit: 2, offset: 1, now });

    expect(page.total).toBe(4);
    expect(page.records.map((record) => record.containerName)).toStrictEqual(['postgres', 'redis']);
  });

  test('a limit of zero returns no rows but still reports the total', () => {
    seed();

    const page = approvalStore.listApprovals({ status: 'all', limit: 0, now });

    expect(page.total).toBe(4);
    expect(page.records).toStrictEqual([]);
  });

  test('defaults the clock to now', () => {
    approvalStore.insertApproval(createInput());

    expect(approvalStore.listApprovals().total).toBe(1);
  });

  test('returns an empty page when the collection has not been created', () => {
    approvalStore.resetApprovalStoreForTests();

    expect(approvalStore.listApprovals()).toStrictEqual({ records: [], total: 0 });
  });
});

describe('countApprovals', () => {
  const now = Date.parse('2026-06-01T09:00:00.000Z');

  test('counts pending, deferred and rows decided since UTC midnight', () => {
    approvalStore.insertApproval(createInput({ containerId: 'c1' }));
    const deferred = approvalStore.insertApproval(createInput({ containerId: 'c2' }));
    approvalStore.updateApproval(deferred.id, {
      decision: 'deferred',
      deferredUntil: '2026-07-01T00:00:00.000Z',
    });
    const decidedToday = approvalStore.insertApproval(createInput({ containerId: 'c3' }));
    approvalStore.updateApproval(decidedToday.id, {
      decision: 'approved',
      decidedAt: '2026-06-01T08:00:00.000Z',
    });
    const decidedYesterday = approvalStore.insertApproval(createInput({ containerId: 'c4' }));
    approvalStore.updateApproval(decidedYesterday.id, {
      decision: 'rejected',
      decidedAt: '2026-05-31T23:00:00.000Z',
    });

    expect(approvalStore.countApprovals(now)).toStrictEqual({
      pending: 1,
      deferred: 1,
      decidedToday: 1,
    });
  });

  test('does not count a decided row with an unparseable or missing decidedAt', () => {
    const noTimestamp = approvalStore.insertApproval(createInput({ containerId: 'c1' }));
    approvalStore.updateApproval(noTimestamp.id, { decision: 'approved' });
    const badTimestamp = approvalStore.insertApproval(createInput({ containerId: 'c2' }));
    approvalStore.updateApproval(badTimestamp.id, {
      decision: 'approved',
      decidedAt: 'not-a-date',
    });

    expect(approvalStore.countApprovals(now).decidedToday).toBe(0);
  });

  test('defaults the clock to now', () => {
    approvalStore.insertApproval(createInput());

    expect(approvalStore.countApprovals()).toStrictEqual({
      pending: 1,
      deferred: 0,
      decidedToday: 0,
    });
  });

  test('returns zeroes when the collection has not been created', () => {
    approvalStore.resetApprovalStoreForTests();

    expect(approvalStore.countApprovals()).toStrictEqual({
      pending: 0,
      deferred: 0,
      decidedToday: 0,
    });
  });
});

describe('pruneOldApprovals', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z');

  test('removes decided rows past the retention window', () => {
    const old = approvalStore.insertApproval(createInput({ containerId: 'c1' }), {
      now: now - 100 * DAY_MS,
    });
    approvalStore.updateApproval(old.id, {
      decision: 'approved',
      decidedAt: new Date(now - 40 * DAY_MS).toISOString(),
    });

    expect(approvalStore.pruneOldApprovals(30, now)).toBe(1);
    expect(approvalStore.listApprovals({ status: 'all', now }).total).toBe(0);
  });

  test('measures retention from the terminal timestamp, not from creation', () => {
    const old = approvalStore.insertApproval(createInput({ containerId: 'c1' }), {
      now: now - 100 * DAY_MS,
    });
    approvalStore.updateApproval(old.id, {
      decision: 'rejected',
      decidedAt: new Date(now - 1 * DAY_MS).toISOString(),
    });

    expect(approvalStore.pruneOldApprovals(30, now)).toBe(0);
  });

  test('prefers resolvedAt over decidedAt as the terminal timestamp', () => {
    const resolved = approvalStore.insertApproval(createInput({ containerId: 'c1' }), {
      now: now - 100 * DAY_MS,
    });
    approvalStore.updateApproval(resolved.id, {
      decision: 'approved',
      decidedAt: new Date(now - 90 * DAY_MS).toISOString(),
      resolution: 'auto-applied',
      resolvedAt: new Date(now - 1 * DAY_MS).toISOString(),
    });

    expect(approvalStore.pruneOldApprovals(30, now)).toBe(0);
  });

  test('falls back to createdAtMs when a decided row carries no terminal timestamp', () => {
    const decided = approvalStore.insertApproval(createInput({ containerId: 'c1' }), {
      now: now - 100 * DAY_MS,
    });
    approvalStore.updateApproval(decided.id, { decision: 'approved' });

    expect(approvalStore.pruneOldApprovals(30, now)).toBe(1);
  });

  test('falls back to createdAtMs when the terminal timestamp is unparseable', () => {
    const resolved = approvalStore.insertApproval(createInput({ containerId: 'c1' }), {
      now: now - 100 * DAY_MS,
    });
    approvalStore.updateApproval(resolved.id, {
      resolution: 'superseded',
      resolvedAt: 'not-a-date',
    });

    expect(approvalStore.pruneOldApprovals(30, now)).toBe(1);
  });

  test('never prunes a pending row, however old', () => {
    approvalStore.insertApproval(createInput({ containerId: 'c1' }), { now: now - 400 * DAY_MS });

    expect(approvalStore.pruneOldApprovals(30, now)).toBe(0);
    expect(approvalStore.listApprovals({ now }).total).toBe(1);
  });

  test('never prunes a live deferral, however old the row', () => {
    const deferred = approvalStore.insertApproval(createInput({ containerId: 'c1' }), {
      now: now - 400 * DAY_MS,
    });
    approvalStore.updateApproval(deferred.id, {
      decision: 'deferred',
      decidedAt: new Date(now - 399 * DAY_MS).toISOString(),
      deferredUntil: '2027-01-01T00:00:00.000Z',
    });

    expect(approvalStore.pruneOldApprovals(30, now)).toBe(0);
  });

  test('defaults the clock to now', () => {
    expect(approvalStore.pruneOldApprovals(30)).toBe(0);
  });

  test('returns zero when the collection has not been created', () => {
    approvalStore.resetApprovalStoreForTests();

    expect(approvalStore.pruneOldApprovals(30)).toBe(0);
  });
});

describe('retention triggers', () => {
  test('prunes once the insert counter crosses the interval', () => {
    const stale = approvalStore.insertApproval(createInput({ containerId: 'stale' }), {
      now: Date.now() - 400 * DAY_MS,
    });
    approvalStore.updateApproval(stale.id, {
      decision: 'approved',
      decidedAt: new Date(Date.now() - 399 * DAY_MS).toISOString(),
    });

    for (let index = 0; index < approvalStore.APPROVAL_PRUNE_INSERT_INTERVAL; index += 1) {
      approvalStore.insertApproval(createInput({ containerId: `c-${index}` }));
    }

    expect(
      approvalStore
        .listApprovals({ status: 'all' })
        .records.some((record) => record.containerId === 'stale'),
    ).toBe(false);
  });

  test('prunes on the periodic timer', () => {
    vi.useFakeTimers();
    try {
      approvalStore.createCollections(createDb());
      const stale = approvalStore.insertApproval(createInput({ containerId: 'stale' }), {
        now: Date.now() - 400 * DAY_MS,
      });
      approvalStore.updateApproval(stale.id, {
        decision: 'approved',
        decidedAt: new Date(Date.now() - 399 * DAY_MS).toISOString(),
      });

      vi.advanceTimersByTime(60 * 60 * 1000);

      expect(approvalStore.listApprovals({ status: 'all' }).total).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('tolerates a timer handle without unref support', () => {
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockReturnValue(0 as unknown as NodeJS.Timeout);

    try {
      expect(() => approvalStore.createCollections(createDb())).not.toThrow();
      expect(setIntervalSpy).toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  test('prunes on collection creation', () => {
    const db = createDb();
    approvalStore.createCollections(db);
    const stale = approvalStore.insertApproval(createInput({ containerId: 'stale' }), {
      now: Date.now() - 400 * DAY_MS,
    });
    approvalStore.updateApproval(stale.id, {
      decision: 'approved',
      decidedAt: new Date(Date.now() - 399 * DAY_MS).toISOString(),
    });

    approvalStore.createCollections(db);

    expect(approvalStore.listApprovals({ status: 'all' }).total).toBe(0);
  });
});

// Spec edge case 17.
describe('store round trip', () => {
  test('rows survive a serialize and reload with schemaVersion intact', () => {
    const db = createDb();
    approvalStore.createCollections(db);
    const inserted = approvalStore.insertApproval(createInput({ agent: 'edge-1' }));

    const reloaded = createDb();
    reloaded.loadJSON(db.serialize());
    approvalStore.createCollections(reloaded);

    expect(approvalStore.getApprovalById(inserted.id)).toStrictEqual(inserted);
    expect(approvalStore.getApprovalById(inserted.id)?.schemaVersion).toBe(APPROVAL_SCHEMA_VERSION);
  });
});
