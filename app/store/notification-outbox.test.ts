import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import {
  _resetOutboxStoreForTests,
  createCollections,
  enqueueOutboxEntry,
  findAllOutboxEntries,
  findOutboxEntriesByStatus,
  findReadyForDelivery,
  getOutboxEntry,
  markOutboxEntryAttempted,
  markOutboxEntryDelivered,
  purgeTerminalOutboxEntriesOlderThan,
  removeOutboxEntry,
  requeueDeadLetterEntry,
} from './notification-outbox.js';

vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

const BASE_INPUT = {
  eventName: 'container.updated',
  payload: { image: 'nginx:latest' },
  triggerId: 'trigger-1',
};

let db: Database | undefined;

beforeEach(() => {
  _resetOutboxStoreForTests();
});

afterEach(() => {
  db?.close();
  db = undefined;
});

// ─── createCollections ───────────────────────────────────────────────────────

describe('createCollections', () => {
  test('wires the store to the given database so subsequent operations work', () => {
    db = createMigratedMemoryDatabase();
    createCollections(db);
    const entry = enqueueOutboxEntry(BASE_INPUT);
    expect(getOutboxEntry(entry.id)).toEqual(entry);
  });
});

// ─── uninitialised early-return guards ───────────────────────────────────────

describe('uninitialised guards (before createCollections)', () => {
  test('enqueueOutboxEntry returns entry but does not persist', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    expect(entry.status).toBe('pending');
    // After reset, no collection — getOutboxEntry won't find it
    db = createMigratedMemoryDatabase();
    createCollections(db);
    expect(getOutboxEntry(entry.id)).toBeUndefined();
  });

  test('getOutboxEntry returns undefined', () => {
    expect(getOutboxEntry('any-id')).toBeUndefined();
  });

  test('findReadyForDelivery returns []', () => {
    expect(findReadyForDelivery()).toEqual([]);
  });

  test('findOutboxEntriesByStatus returns []', () => {
    expect(findOutboxEntriesByStatus('pending')).toEqual([]);
  });

  test('findAllOutboxEntries returns []', () => {
    expect(findAllOutboxEntries()).toEqual([]);
  });

  test('markOutboxEntryAttempted returns undefined', () => {
    expect(
      markOutboxEntryAttempted('x', { error: 'e', nextAttemptAt: new Date().toISOString() }),
    ).toBeUndefined();
  });

  test('markOutboxEntryDelivered returns undefined', () => {
    expect(markOutboxEntryDelivered('x')).toBeUndefined();
  });

  test('requeueDeadLetterEntry returns undefined', () => {
    expect(requeueDeadLetterEntry('x')).toBeUndefined();
  });

  test('removeOutboxEntry returns false', () => {
    expect(removeOutboxEntry('x')).toBe(false);
  });

  test('purgeTerminalOutboxEntriesOlderThan returns 0', () => {
    expect(purgeTerminalOutboxEntriesOlderThan(new Date().toISOString())).toBe(0);
  });
});

// ─── enqueueOutboxEntry ──────────────────────────────────────────────────────

describe('enqueueOutboxEntry', () => {
  beforeEach(() => {
    db = createMigratedMemoryDatabase();
    createCollections(db);
  });

  test('defaults: attempts=0, maxAttempts=5, status=pending, id is uuid', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    expect(entry.attempts).toBe(0);
    expect(entry.maxAttempts).toBe(5);
    expect(entry.status).toBe('pending');
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('createdAt and default nextAttemptAt are set to now (within 1s)', () => {
    const before = Date.now();
    const entry = enqueueOutboxEntry(BASE_INPUT);
    const after = Date.now();
    expect(new Date(entry.createdAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(entry.createdAt).getTime()).toBeLessThanOrEqual(after);
    expect(entry.nextAttemptAt).toBe(entry.createdAt);
  });

  test('custom maxAttempts is honoured', () => {
    const entry = enqueueOutboxEntry({ ...BASE_INPUT, maxAttempts: 3 });
    expect(entry.maxAttempts).toBe(3);
  });

  test('custom nextAttemptAt is honoured', () => {
    const entry = enqueueOutboxEntry({ ...BASE_INPUT, nextAttemptAt: '2099-01-01T00:00:00.000Z' });
    expect(entry.nextAttemptAt).toBe('2099-01-01T00:00:00.000Z');
  });

  test('optional containerId is preserved when provided', () => {
    const entry = enqueueOutboxEntry({ ...BASE_INPUT, containerId: 'c1' });
    expect(entry.containerId).toBe('c1');
  });

  test('containerId is undefined when omitted', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    expect(entry.containerId).toBeUndefined();
  });

  test('entry is retrievable after enqueue', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    expect(getOutboxEntry(entry.id)).toEqual(entry);
  });
});

// ─── getOutboxEntry ──────────────────────────────────────────────────────────

describe('getOutboxEntry', () => {
  beforeEach(() => {
    db = createMigratedMemoryDatabase();
    createCollections(db);
  });

  test('returns entry when found', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    expect(getOutboxEntry(entry.id)).toEqual(entry);
  });

  test('returns undefined when not found', () => {
    expect(getOutboxEntry('missing')).toBeUndefined();
  });
});

// ─── findReadyForDelivery ────────────────────────────────────────────────────

describe('findReadyForDelivery', () => {
  beforeEach(() => {
    db = createMigratedMemoryDatabase();
    createCollections(db);
  });

  test('queries only pending entries due at or before nowIso', () => {
    const past = enqueueOutboxEntry({ ...BASE_INPUT, nextAttemptAt: '2000-01-01T00:00:00.000Z' });
    enqueueOutboxEntry({ ...BASE_INPUT, nextAttemptAt: '2099-01-01T00:00:00.000Z' });

    const ready = findReadyForDelivery('2026-01-01T00:00:00.000Z');
    expect(ready.map((e) => e.id)).toEqual([past.id]);
  });

  test('returns pending entries whose nextAttemptAt <= nowIso', () => {
    const entry = enqueueOutboxEntry({ ...BASE_INPUT, nextAttemptAt: '2020-01-01T00:00:00.000Z' });
    expect(findReadyForDelivery('2020-01-01T00:00:00.000Z').map((e) => e.id)).toEqual([entry.id]);
  });

  test('uses current time when nowIso is omitted', () => {
    const entry = enqueueOutboxEntry({ ...BASE_INPUT, nextAttemptAt: '2000-01-01T00:00:00.000Z' });
    expect(findReadyForDelivery().map((e) => e.id)).toEqual([entry.id]);
  });

  test('results are sorted ascending by nextAttemptAt', () => {
    const later = enqueueOutboxEntry({ ...BASE_INPUT, nextAttemptAt: '2020-06-01T00:00:00.000Z' });
    const earlier = enqueueOutboxEntry({
      ...BASE_INPUT,
      nextAttemptAt: '2020-01-01T00:00:00.000Z',
    });
    expect(findReadyForDelivery('2026-01-01T00:00:00.000Z').map((e) => e.id)).toEqual([
      earlier.id,
      later.id,
    ]);
  });

  test('excludes non-pending entries', () => {
    const entry = enqueueOutboxEntry({ ...BASE_INPUT, nextAttemptAt: '2000-01-01T00:00:00.000Z' });
    markOutboxEntryDelivered(entry.id);
    expect(findReadyForDelivery('2026-01-01T00:00:00.000Z')).toEqual([]);
  });
});

// ─── findOutboxEntriesByStatus ───────────────────────────────────────────────

describe('findOutboxEntriesByStatus', () => {
  beforeEach(() => {
    db = createMigratedMemoryDatabase();
    createCollections(db);
  });

  test('returns entries matching the requested status', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    markOutboxEntryDelivered(entry.id);
    expect(findOutboxEntriesByStatus('delivered').map((e) => e.id)).toEqual([entry.id]);
  });

  test('returns empty array when no entries match', () => {
    expect(findOutboxEntriesByStatus('dead-letter')).toEqual([]);
  });

  test('results are sorted ascending by createdAt', () => {
    const first = enqueueOutboxEntry(BASE_INPUT);
    const second = enqueueOutboxEntry(BASE_INPUT);
    expect(findOutboxEntriesByStatus('pending').map((e) => e.id)).toEqual([first.id, second.id]);
  });
});

// ─── findAllOutboxEntries ────────────────────────────────────────────────────

describe('findAllOutboxEntries', () => {
  beforeEach(() => {
    db = createMigratedMemoryDatabase();
    createCollections(db);
  });

  test('returns entries across statuses sorted ascending by createdAt', () => {
    const first = enqueueOutboxEntry(BASE_INPUT);
    const second = enqueueOutboxEntry(BASE_INPUT);
    markOutboxEntryDelivered(first.id);
    expect(findAllOutboxEntries().map((e) => e.id)).toEqual([first.id, second.id]);
  });
});

// ─── markOutboxEntryAttempted ────────────────────────────────────────────────

describe('markOutboxEntryAttempted', () => {
  beforeEach(() => {
    db = createMigratedMemoryDatabase();
    createCollections(db);
  });

  test('increments attempts and sets lastError + nextAttemptAt', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    const next = markOutboxEntryAttempted(entry.id, {
      error: 'timeout',
      nextAttemptAt: '2099-01-01T00:00:00.000Z',
    });
    expect(next?.attempts).toBe(1);
    expect(next?.lastError).toBe('timeout');
    expect(next?.nextAttemptAt).toBe('2099-01-01T00:00:00.000Z');
    expect(next?.status).toBe('pending');
  });

  test('scrubs authorization header values before persisting lastError', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    const next = markOutboxEntryAttempted(entry.id, {
      error:
        'webhook failed with headers: Authorization: Bearer secret-token-123, x-request-id=abc',
      nextAttemptAt: '2099-01-01T00:00:00.000Z',
    });

    expect(next?.lastError).toContain('Authorization: Bearer [REDACTED]');
    expect(next?.lastError).not.toContain('secret-token-123');
    expect(getOutboxEntry(entry.id)?.lastError).toBe(next?.lastError);
  });

  test('transitions to dead-letter when attempts >= maxAttempts', () => {
    const entry = enqueueOutboxEntry({ ...BASE_INPUT, maxAttempts: 2 });
    markOutboxEntryAttempted(entry.id, { error: 'e1', nextAttemptAt: '2099-01-01T00:00:00.000Z' });
    const final = markOutboxEntryAttempted(entry.id, {
      error: 'e2',
      nextAttemptAt: '2099-01-01T00:00:00.000Z',
    });
    expect(final?.status).toBe('dead-letter');
    expect(final?.failedAt).toBeDefined();
  });

  test('returns undefined when entry not found', () => {
    expect(
      markOutboxEntryAttempted('missing', { error: 'e', nextAttemptAt: new Date().toISOString() }),
    ).toBeUndefined();
  });

  test('each call increments attempts by 1', () => {
    const entry = enqueueOutboxEntry({ ...BASE_INPUT, maxAttempts: 10 });
    markOutboxEntryAttempted(entry.id, { error: 'e', nextAttemptAt: '2099-01-01T00:00:00.000Z' });
    const updated = markOutboxEntryAttempted(entry.id, {
      error: 'e',
      nextAttemptAt: '2099-01-01T00:00:00.000Z',
    });
    expect(updated?.attempts).toBe(2);
  });
});

// ─── markOutboxEntryDelivered ────────────────────────────────────────────────

describe('markOutboxEntryDelivered', () => {
  beforeEach(() => {
    db = createMigratedMemoryDatabase();
    createCollections(db);
  });

  test('sets status=delivered, deliveredAt, clears lastError, increments attempts', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    // first put a lastError on it
    markOutboxEntryAttempted(entry.id, { error: 'oops', nextAttemptAt: new Date().toISOString() });
    const delivered = markOutboxEntryDelivered(entry.id);
    expect(delivered?.status).toBe('delivered');
    expect(delivered?.deliveredAt).toBeDefined();
    expect(delivered?.lastError).toBeUndefined();
    expect(delivered?.attempts).toBe(2);
  });

  test('returns undefined when entry not found', () => {
    expect(markOutboxEntryDelivered('missing')).toBeUndefined();
  });
});

// ─── requeueDeadLetterEntry ──────────────────────────────────────────────────

describe('requeueDeadLetterEntry', () => {
  beforeEach(() => {
    db = createMigratedMemoryDatabase();
    createCollections(db);
  });

  function makeDeadLetter() {
    const entry = enqueueOutboxEntry({ ...BASE_INPUT, maxAttempts: 1 });
    markOutboxEntryAttempted(entry.id, {
      error: 'boom',
      nextAttemptAt: '2099-01-01T00:00:00.000Z',
    });
    return entry;
  }

  test('resets dead-letter entry to pending, clears failedAt/lastError, resets attempts', () => {
    const entry = makeDeadLetter();
    const future = '2099-06-01T00:00:00.000Z';
    const requeued = requeueDeadLetterEntry(entry.id, future);
    expect(requeued?.status).toBe('pending');
    expect(requeued?.attempts).toBe(0);
    expect(requeued?.failedAt).toBeUndefined();
    expect(requeued?.lastError).toBeUndefined();
    expect(requeued?.nextAttemptAt).toBe(future);
  });

  test('uses current time when nextAttemptAt is omitted', () => {
    const entry = makeDeadLetter();
    const before = new Date().toISOString();
    const requeued = requeueDeadLetterEntry(entry.id);
    const after = new Date().toISOString();
    expect(requeued?.nextAttemptAt >= before).toBe(true);
    expect(requeued?.nextAttemptAt <= after).toBe(true);
  });

  test('returns undefined when entry not found', () => {
    expect(requeueDeadLetterEntry('missing')).toBeUndefined();
  });

  test('returns undefined when entry is not dead-letter (e.g. pending)', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    expect(requeueDeadLetterEntry(entry.id)).toBeUndefined();
  });
});

// ─── removeOutboxEntry ───────────────────────────────────────────────────────

describe('removeOutboxEntry', () => {
  beforeEach(() => {
    db = createMigratedMemoryDatabase();
    createCollections(db);
  });

  test('removes entry and returns true', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    expect(removeOutboxEntry(entry.id)).toBe(true);
    expect(getOutboxEntry(entry.id)).toBeUndefined();
  });

  test('returns false when entry not found', () => {
    expect(removeOutboxEntry('nonexistent')).toBe(false);
  });
});

// ─── purgeTerminalOutboxEntriesOlderThan ─────────────────────────────────────

describe('purgeTerminalOutboxEntriesOlderThan', () => {
  beforeEach(() => {
    db = createMigratedMemoryDatabase();
    createCollections(db);
  });

  test('removes delivered entries older than cutoff', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    markOutboxEntryDelivered(entry.id);
    const future = '2099-01-01T00:00:00.000Z';
    const count = purgeTerminalOutboxEntriesOlderThan(future);
    expect(count).toBe(1);
  });

  test('removes dead-letter entries older than cutoff', () => {
    const entry = enqueueOutboxEntry({ ...BASE_INPUT, maxAttempts: 1 });
    markOutboxEntryAttempted(entry.id, { error: 'e', nextAttemptAt: '2099-01-01T00:00:00.000Z' });
    const future = '2099-01-01T00:00:00.000Z';
    const count = purgeTerminalOutboxEntriesOlderThan(future);
    expect(count).toBe(1);
  });

  test('does not purge pending entries', () => {
    enqueueOutboxEntry(BASE_INPUT);
    const count = purgeTerminalOutboxEntriesOlderThan('2099-01-01T00:00:00.000Z');
    expect(count).toBe(0);
  });

  test('does not purge terminal entries newer than cutoff', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    markOutboxEntryDelivered(entry.id);
    // Cutoff in the past means nothing qualifies
    const count = purgeTerminalOutboxEntriesOlderThan('2000-01-01T00:00:00.000Z');
    expect(count).toBe(0);
  });

  test('returns 0 when nothing to purge', () => {
    expect(purgeTerminalOutboxEntriesOlderThan('2099-01-01T00:00:00.000Z')).toBe(0);
  });

  test('only purges entries matching the cutoff threshold (mixed set)', () => {
    // Two delivered, one pending — should purge only the 2 delivered ones
    const e1 = enqueueOutboxEntry(BASE_INPUT);
    const e2 = enqueueOutboxEntry(BASE_INPUT);
    markOutboxEntryDelivered(e1.id);
    markOutboxEntryDelivered(e2.id);
    enqueueOutboxEntry(BASE_INPUT); // stays
    const count = purgeTerminalOutboxEntriesOlderThan('2099-01-01T00:00:00.000Z');
    expect(count).toBe(2);
    expect(findOutboxEntriesByStatus('pending')).toHaveLength(1);
  });
});
