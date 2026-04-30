import {
  _resetOutboxStoreForTests,
  createCollections,
  enqueueOutboxEntry,
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

function createDb() {
  function getByPath(obj: unknown, path: string): unknown {
    return path
      .split('.')
      .reduce((acc: unknown, key) => (acc as Record<string, unknown>)?.[key], obj);
  }
  function matchesQuery(doc: unknown, query: Record<string, unknown> = {}): boolean {
    return Object.entries(query).every(([key, value]) => getByPath(doc, key) === value);
  }
  const collections: Record<string, ReturnType<typeof makeCollection>> = {};
  function makeCollection() {
    const docs: unknown[] = [];
    return {
      insert: (doc: unknown) => {
        docs.push(doc);
      },
      find: (query: Record<string, unknown> = {}) => docs.filter((d) => matchesQuery(d, query)),
      findOne: (query: Record<string, unknown> = {}) =>
        docs.find((d) => matchesQuery(d, query)) ?? null,
      remove: (doc: unknown) => {
        const i = docs.indexOf(doc);
        if (i >= 0) docs.splice(i, 1);
      },
    };
  }
  return {
    getCollection: (name: string) => collections[name] ?? null,
    addCollection: (name: string) => {
      collections[name] = makeCollection();
      return collections[name];
    },
  };
}

const BASE_INPUT = {
  eventName: 'container.updated',
  payload: { image: 'nginx:latest' },
  triggerId: 'trigger-1',
};

beforeEach(() => {
  _resetOutboxStoreForTests();
});

// ─── createCollections ───────────────────────────────────────────────────────

describe('createCollections', () => {
  test('initialises the collection so subsequent operations work', () => {
    const db = createDb();
    createCollections(db as never);
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
    createCollections(createDb() as never);
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
    createCollections(createDb() as never);
  });

  test('defaults: attempts=0, maxAttempts=5, status=pending, id is uuid', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    expect(entry.attempts).toBe(0);
    expect(entry.maxAttempts).toBe(5);
    expect(entry.status).toBe('pending');
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('createdAt and default nextAttemptAt are set to now (within 1s)', () => {
    const before = new Date().toISOString();
    const entry = enqueueOutboxEntry(BASE_INPUT);
    const after = new Date().toISOString();
    expect(entry.createdAt >= before).toBe(true);
    expect(entry.createdAt <= after).toBe(true);
    expect(entry.nextAttemptAt >= before).toBe(true);
    expect(entry.nextAttemptAt <= after).toBe(true);
  });

  test('custom maxAttempts is honoured', () => {
    const entry = enqueueOutboxEntry({ ...BASE_INPUT, maxAttempts: 10 });
    expect(entry.maxAttempts).toBe(10);
  });

  test('custom nextAttemptAt is honoured', () => {
    const future = '2099-01-01T00:00:00.000Z';
    const entry = enqueueOutboxEntry({ ...BASE_INPUT, nextAttemptAt: future });
    expect(entry.nextAttemptAt).toBe(future);
  });

  test('optional containerId is preserved when provided', () => {
    const entry = enqueueOutboxEntry({ ...BASE_INPUT, containerId: 'ctr-abc' });
    expect(entry.containerId).toBe('ctr-abc');
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
    createCollections(createDb() as never);
  });

  test('returns entry when found', () => {
    const entry = enqueueOutboxEntry(BASE_INPUT);
    expect(getOutboxEntry(entry.id)).toEqual(entry);
  });

  test('returns undefined when not found', () => {
    expect(getOutboxEntry('nonexistent')).toBeUndefined();
  });
});

// ─── findReadyForDelivery ────────────────────────────────────────────────────

describe('findReadyForDelivery', () => {
  beforeEach(() => {
    createCollections(createDb() as never);
  });

  test('returns pending entries whose nextAttemptAt <= nowIso', () => {
    const past = '2000-01-01T00:00:00.000Z';
    const future = '2099-01-01T00:00:00.000Z';
    enqueueOutboxEntry({ ...BASE_INPUT, nextAttemptAt: past });
    enqueueOutboxEntry({ ...BASE_INPUT, nextAttemptAt: future });
    const now = new Date().toISOString();
    const ready = findReadyForDelivery(now);
    expect(ready).toHaveLength(1);
    expect(ready[0].nextAttemptAt).toBe(past);
  });

  test('uses current time when nowIso is omitted', () => {
    const past = '2000-01-01T00:00:00.000Z';
    enqueueOutboxEntry({ ...BASE_INPUT, nextAttemptAt: past });
    const ready = findReadyForDelivery();
    expect(ready).toHaveLength(1);
  });

  test('results are sorted ascending by nextAttemptAt', () => {
    enqueueOutboxEntry({ ...BASE_INPUT, nextAttemptAt: '2000-06-01T00:00:00.000Z' });
    enqueueOutboxEntry({ ...BASE_INPUT, nextAttemptAt: '2000-01-01T00:00:00.000Z' });
    const ready = findReadyForDelivery('2001-01-01T00:00:00.000Z');
    expect(ready[0].nextAttemptAt < ready[1].nextAttemptAt).toBe(true);
  });

  test('excludes non-pending entries', () => {
    const entry = enqueueOutboxEntry({ ...BASE_INPUT, nextAttemptAt: '2000-01-01T00:00:00.000Z' });
    markOutboxEntryDelivered(entry.id);
    const ready = findReadyForDelivery(new Date().toISOString());
    expect(ready).toHaveLength(0);
  });
});

// ─── findOutboxEntriesByStatus ───────────────────────────────────────────────

describe('findOutboxEntriesByStatus', () => {
  beforeEach(() => {
    createCollections(createDb() as never);
  });

  test('returns entries matching the requested status', () => {
    const e1 = enqueueOutboxEntry(BASE_INPUT);
    markOutboxEntryDelivered(e1.id);
    enqueueOutboxEntry(BASE_INPUT);
    const delivered = findOutboxEntriesByStatus('delivered');
    expect(delivered).toHaveLength(1);
    expect(delivered[0].status).toBe('delivered');
  });

  test('returns empty array when no entries match', () => {
    expect(findOutboxEntriesByStatus('dead-letter')).toEqual([]);
  });

  test('results are sorted ascending by createdAt', () => {
    // Insert two entries; because they're inserted sequentially, createdAt order is deterministic
    const e1 = enqueueOutboxEntry(BASE_INPUT);
    const e2 = enqueueOutboxEntry(BASE_INPUT);
    const entries = findOutboxEntriesByStatus('pending');
    const ids = entries.map((e) => e.id);
    expect(ids.indexOf(e1.id)).toBeLessThanOrEqual(ids.indexOf(e2.id));
  });
});

// ─── markOutboxEntryAttempted ────────────────────────────────────────────────

describe('markOutboxEntryAttempted', () => {
  beforeEach(() => {
    createCollections(createDb() as never);
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
    createCollections(createDb() as never);
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
    createCollections(createDb() as never);
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
    createCollections(createDb() as never);
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
    createCollections(createDb() as never);
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
