import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import {
  clearSessions,
  countSessions,
  createCollections,
  destroySession,
  getSession,
  listSessions,
  setSession,
  sweepExpiredSessions,
  touchSession,
} from './session.js';

let db: Database | undefined;

beforeEach(() => {
  db = createMigratedMemoryDatabase();
  createCollections(db);
});

afterEach(() => {
  db?.close();
  db = undefined;
});

describe('session store', () => {
  test('every function is inert before createCollections wires a database', async () => {
    // A fresh module instance has no db captured yet — this covers the
    // `if (!db)` guard branch every export takes.
    vi.resetModules();
    const freshModule = await import('./session.js');

    expect(freshModule.getSession('missing')).toBeUndefined();
    expect(freshModule.touchSession('missing', 1)).toBe(false);
    expect(freshModule.listSessions()).toEqual([]);
    expect(freshModule.countSessions()).toBe(0);
    expect(freshModule.sweepExpiredSessions(Date.now())).toBe(0);
    expect(() => freshModule.setSession('sid', 1, '{}')).not.toThrow();
    expect(() => freshModule.destroySession('sid')).not.toThrow();
    expect(() => freshModule.clearSessions()).not.toThrow();
  });

  test('setSession inserts, and a second call upserts rather than duplicating', () => {
    setSession('sid-1', 1000, '{"a":1}');
    expect(getSession('sid-1')).toEqual({ sid: 'sid-1', expiresAt: 1000, data: '{"a":1}' });

    setSession('sid-1', 2000, '{"a":2}');
    expect(getSession('sid-1')).toEqual({ sid: 'sid-1', expiresAt: 2000, data: '{"a":2}' });
    expect(countSessions()).toBe(1);
  });

  test('getSession returns undefined for an unknown sid', () => {
    expect(getSession('nope')).toBeUndefined();
  });

  test('touchSession updates only expiresAt and reports whether the sid existed', () => {
    setSession('sid-1', 1000, '{"a":1}');

    expect(touchSession('sid-1', 5000)).toBe(true);
    expect(getSession('sid-1')).toEqual({ sid: 'sid-1', expiresAt: 5000, data: '{"a":1}' });

    expect(touchSession('missing', 5000)).toBe(false);
  });

  test('destroySession removes exactly the named row', () => {
    setSession('sid-1', 1000, '{}');
    setSession('sid-2', 1000, '{}');

    destroySession('sid-1');

    expect(getSession('sid-1')).toBeUndefined();
    expect(getSession('sid-2')).toBeDefined();
  });

  test('listSessions and countSessions reflect every stored row', () => {
    expect(listSessions()).toEqual([]);
    expect(countSessions()).toBe(0);

    setSession('sid-1', 1000, '{"a":1}');
    setSession('sid-2', 2000, '{"a":2}');

    expect(countSessions()).toBe(2);
    expect(
      listSessions()
        .map((row) => row.sid)
        .sort(),
    ).toEqual(['sid-1', 'sid-2']);
  });

  test('clearSessions empties the table', () => {
    setSession('sid-1', 1000, '{}');
    setSession('sid-2', 1000, '{}');

    clearSessions();

    expect(listSessions()).toEqual([]);
    expect(countSessions()).toBe(0);
  });

  test('sweepExpiredSessions deletes rows at or before the cutoff and reports the count', () => {
    setSession('expired-1', 100, '{}');
    setSession('expired-2', 200, '{}');
    setSession('live', 5000, '{}');

    const removed = sweepExpiredSessions(200);

    expect(removed).toBe(2);
    expect(listSessions().map((row) => row.sid)).toEqual(['live']);
  });

  test('sweepExpiredSessions defaults to now when called with no argument', () => {
    setSession('expired', Date.now() - 1000, '{}');
    setSession('live', Date.now() + 60_000, '{}');

    expect(sweepExpiredSessions()).toBe(1);
    expect(listSessions().map((row) => row.sid)).toEqual(['live']);
  });
});
