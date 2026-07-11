import * as uiPreferences from './ui-preferences.js';

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: vi.fn() })) } }));

function collection(initial: any = null, mutateInsert = false) {
  let value = initial;
  return {
    findOne: vi.fn((query) => (value?.username === query.username ? value : null)),
    insert: vi.fn((record) => {
      value = record;
      if (mutateInsert) Object.assign(record, { $loki: 1, meta: { revision: 0 } });
    }),
    remove: vi.fn((record) => {
      if (record === value) value = null;
    }),
  };
}

describe('UI preferences store', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null before collection initialization', async () => {
    vi.resetModules();
    const fresh = await import('./ui-preferences.js');
    expect(fresh.getPreferences('alice')).toBeNull();
    expect(() => fresh.replacePreferences('alice', 11, {})).toThrow(
      'ui-preferences collection not initialized',
    );
  });

  it('creates an indexed collection and returns null for an unknown user', () => {
    const c = collection();
    const db = { getCollection: vi.fn(() => null), addCollection: vi.fn(() => c) };
    uiPreferences.createCollections(db);
    expect(db.addCollection).toHaveBeenCalledWith('ui-preferences', { indices: ['username'] });
    expect(uiPreferences.getPreferences('missing')).toBeNull();
  });

  it('returns a known record without Loki metadata', () => {
    const stored = {
      username: 'alice',
      schemaVersion: 11,
      preferences: { sync: { enabled: true } },
      updatedAt: '2026-07-11T12:00:00.000Z',
      $loki: 3,
      meta: { revision: 0 },
    };
    const c = collection(stored);
    uiPreferences.createCollections({ getCollection: vi.fn(() => c), addCollection: vi.fn() });
    expect(uiPreferences.getPreferences('alice')).toEqual({
      username: 'alice',
      schemaVersion: 11,
      preferences: stored.preferences,
      updatedAt: stored.updatedAt,
    });
  });

  it('inserts a new record with server time without removing', () => {
    vi.setSystemTime('2026-07-11T12:34:56.000Z');
    const c = collection();
    uiPreferences.createCollections({ getCollection: vi.fn(() => c), addCollection: vi.fn() });
    const result = uiPreferences.replacePreferences('alice', 11, { theme: 'dark' });
    expect(c.remove).not.toHaveBeenCalled();
    expect(c.insert).toHaveBeenCalledWith({
      username: 'alice',
      schemaVersion: 11,
      preferences: { theme: 'dark' },
      updatedAt: '2026-07-11T12:34:56.000Z',
    });
    expect(result.updatedAt).toBe('2026-07-11T12:34:56.000Z');
    vi.useRealTimers();
  });

  it('removes an existing record before inserting its replacement', () => {
    const old = { username: 'alice', schemaVersion: 10, preferences: {}, updatedAt: 'old' };
    const c = collection(old);
    uiPreferences.createCollections({ getCollection: vi.fn(() => c), addCollection: vi.fn() });
    uiPreferences.replacePreferences('alice', 11, { newer: true });
    expect(c.remove).toHaveBeenCalledWith(old);
    expect(c.remove.mock.invocationCallOrder[0]).toBeLessThan(c.insert.mock.invocationCallOrder[0]);
  });

  it('strips Loki metadata injected by insert from the returned record', () => {
    const c = collection(null, true);
    uiPreferences.createCollections({ getCollection: vi.fn(() => c), addCollection: vi.fn() });
    const result = uiPreferences.replacePreferences('alice', 11, {});
    expect(result).not.toHaveProperty('$loki');
    expect(result).not.toHaveProperty('meta');
  });

  it('isolates persisted preferences from later input mutations', () => {
    const c = collection();
    uiPreferences.createCollections({ getCollection: vi.fn(() => c), addCollection: vi.fn() });
    const input = { appearance: { fontSize: 1 } };
    uiPreferences.replacePreferences('alice', 11, input);

    input.appearance.fontSize = 1.3;

    expect(uiPreferences.getPreferences('alice')?.preferences).toEqual({
      appearance: { fontSize: 1 },
    });
  });

  it('isolates persisted preferences from mutations to returned records', () => {
    const c = collection();
    uiPreferences.createCollections({ getCollection: vi.fn(() => c), addCollection: vi.fn() });
    const returned = uiPreferences.replacePreferences('alice', 11, {
      appearance: { fontSize: 1 },
    });

    (returned.preferences.appearance as { fontSize: number }).fontSize = 1.3;

    expect(uiPreferences.getPreferences('alice')?.preferences).toEqual({
      appearance: { fontSize: 1 },
    });
  });
});
