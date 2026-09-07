import type { SessionData } from 'express-session';
import type { Database } from '../store/db/driver.js';
import * as sessionModel from '../store/session.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import { SessionStore } from './session-store.js';

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  },
}));

const TTL_MS = 60_000;

let db: Database | undefined;
let store: SessionStore | undefined;

function sessionWithExpiry(expires: Date | string | undefined): SessionData {
  return { cookie: { originalMaxAge: null, expires } } as unknown as SessionData;
}

function getAsync(sid: string): Promise<SessionData | null | undefined> {
  return new Promise((resolve, reject) => {
    store?.get(sid, (error, session) => (error ? reject(error) : resolve(session)));
  });
}

function setAsync(sid: string, session: SessionData): Promise<void> {
  return new Promise((resolve, reject) => {
    store?.set(sid, session, (error) => (error ? reject(error) : resolve()));
  });
}

function destroyAsync(sid: string): Promise<void> {
  return new Promise((resolve, reject) => {
    store?.destroy(sid, (error) => (error ? reject(error) : resolve()));
  });
}

function touchAsync(sid: string, session: SessionData): Promise<void> {
  return new Promise((resolve) => {
    store?.touch(sid, session, () => resolve());
  });
}

function allAsync(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    store?.all((error, obj) => (error ? reject(error) : resolve(obj)));
  });
}

function lengthAsync(): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    store?.length((error, length) => (error ? reject(error) : resolve(length)));
  });
}

function clearAsync(): Promise<void> {
  return new Promise((resolve, reject) => {
    store?.clear((error) => (error ? reject(error) : resolve()));
  });
}

beforeEach(() => {
  db = createMigratedMemoryDatabase();
  sessionModel.createCollections(db);
  store = new SessionStore({ ttlMs: TTL_MS });
});

afterEach(() => {
  store?.stop();
  store = undefined;
  db?.close();
  db = undefined;
});

describe('SessionStore', () => {
  test('get on an unknown sid resolves null', async () => {
    await expect(getAsync('missing')).resolves.toBeNull();
  });

  test('set then get round-trips the session payload', async () => {
    const session = sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString());

    await setAsync('sid-1', session);

    await expect(getAsync('sid-1')).resolves.toEqual(session);
  });

  test('set derives expires_at from cookie.expires as a Date instance', async () => {
    const expires = new Date(Date.now() + TTL_MS);
    const session = sessionWithExpiry(expires);

    await setAsync('sid-1', session);

    expect(sessionModel.getSession('sid-1')?.expiresAt).toBe(expires.getTime());
  });

  test('set falls back to ttlMs when the session carries no parseable cookie expiry', async () => {
    const before = Date.now();
    await setAsync('sid-1', sessionWithExpiry(undefined));
    const after = Date.now();

    const row = sessionModel.getSession('sid-1');
    expect(row?.expiresAt).toBeGreaterThanOrEqual(before + TTL_MS);
    expect(row?.expiresAt).toBeLessThanOrEqual(after + TTL_MS);
  });

  test('set falls back to ttlMs when cookie.expires does not parse', async () => {
    const before = Date.now();
    await setAsync('sid-1', sessionWithExpiry('not-a-date'));
    const after = Date.now();

    const row = sessionModel.getSession('sid-1');
    expect(row?.expiresAt).toBeGreaterThanOrEqual(before + TTL_MS);
    expect(row?.expiresAt).toBeLessThanOrEqual(after + TTL_MS);
  });

  test('set falls back to ttlMs when cookie.expires is an invalid Date instance', async () => {
    const before = Date.now();
    await setAsync('sid-1', sessionWithExpiry(new Date(Number.NaN)));
    const after = Date.now();

    const row = sessionModel.getSession('sid-1');
    expect(row?.expiresAt).toBeGreaterThanOrEqual(before + TTL_MS);
    expect(row?.expiresAt).toBeLessThanOrEqual(after + TTL_MS);
  });

  test('set falls back to ttlMs when the session carries no cookie object at all', async () => {
    const before = Date.now();
    await setAsync('sid-1', {} as unknown as SessionData);
    const after = Date.now();

    const row = sessionModel.getSession('sid-1');
    expect(row?.expiresAt).toBeGreaterThanOrEqual(before + TTL_MS);
    expect(row?.expiresAt).toBeLessThanOrEqual(after + TTL_MS);
  });

  test('a second set on the same sid upserts rather than duplicating', async () => {
    await setAsync('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString()));
    await setAsync('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString()));

    await expect(lengthAsync()).resolves.toBe(1);
  });

  test('get opportunistically sweeps a row it finds already expired instead of serving it', async () => {
    sessionModel.setSession('sid-1', Date.now() - 1000, JSON.stringify({ cookie: {} }));

    await expect(getAsync('sid-1')).resolves.toBeNull();
    expect(sessionModel.getSession('sid-1')).toBeUndefined();
  });

  test('destroy removes the row', async () => {
    await setAsync('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString()));

    await destroyAsync('sid-1');

    await expect(getAsync('sid-1')).resolves.toBeNull();
  });

  test('touch refreshes expiry without changing the payload', async () => {
    const session = sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString());
    await setAsync('sid-1', session);
    const originalExpiresAt = sessionModel.getSession('sid-1')?.expiresAt;

    const newExpiry = new Date(Date.now() + TTL_MS * 2);
    await touchAsync('sid-1', sessionWithExpiry(newExpiry));

    const row = sessionModel.getSession('sid-1');
    expect(row?.expiresAt).toBe(newExpiry.getTime());
    expect(row?.expiresAt).not.toBe(originalExpiresAt);
    expect(JSON.parse(row?.data ?? '{}')).toEqual(session);
  });

  test('touch on an unknown sid does not throw and still calls back', async () => {
    await expect(
      touchAsync('missing', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString())),
    ).resolves.toBeUndefined();
  });

  test('all returns only unexpired sessions as {sid, session} entries', async () => {
    await setAsync('live', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString()));
    sessionModel.setSession('expired', Date.now() - 1000, JSON.stringify({ cookie: {} }));

    const result = (await allAsync()) as Array<{ sid: string; session: SessionData }>;

    expect(result.map((entry) => entry.sid)).toEqual(['live']);
  });

  test('length reports the row count', async () => {
    await expect(lengthAsync()).resolves.toBe(0);

    await setAsync('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString()));
    await setAsync('sid-2', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString()));

    await expect(lengthAsync()).resolves.toBe(2);
  });

  test('clear empties the store', async () => {
    await setAsync('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString()));
    await setAsync('sid-2', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString()));

    await clearAsync();

    await expect(lengthAsync()).resolves.toBe(0);
  });

  test('sweepExpiredNow deletes expired rows and returns the count removed', () => {
    sessionModel.setSession('expired-1', Date.now() - 1000, '{}');
    sessionModel.setSession('expired-2', Date.now() - 1000, '{}');
    sessionModel.setSession('live', Date.now() + TTL_MS, '{}');

    expect(store?.sweepExpiredNow()).toBe(2);
    expect(sessionModel.listSessions().map((row) => row.sid)).toEqual(['live']);
  });

  test('sweepExpiredNow returns 0 and logs nothing when nothing is expired', () => {
    sessionModel.setSession('live', Date.now() + TTL_MS, '{}');

    expect(store?.sweepExpiredNow()).toBe(0);
  });

  test('the background sweep timer is unref-able and stop() is idempotent', () => {
    const timerStore = new SessionStore({ sweepIntervalMs: 50 });
    expect(() => timerStore.stop()).not.toThrow();
    expect(() => timerStore.stop()).not.toThrow();
  });

  test('tolerates a timer handle without unref support', () => {
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockReturnValue(0 as unknown as NodeJS.Timeout);

    try {
      let timerStore: SessionStore | undefined;
      expect(() => {
        timerStore = new SessionStore({ sweepIntervalMs: 50 });
      }).not.toThrow();
      expect(setIntervalSpy).toHaveBeenCalled();
      timerStore?.stop();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  test('the background sweep timer removes expired rows on its own schedule', async () => {
    sessionModel.setSession('expired', Date.now() - 1000, '{}');
    const timerStore = new SessionStore({ sweepIntervalMs: 10 });

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sessionModel.getSession('expired')).toBeUndefined();
    } finally {
      timerStore.stop();
    }
  });

  describe('error propagation', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    test('get reports a store failure through the callback rather than throwing', async () => {
      vi.spyOn(sessionModel, 'getSession').mockImplementationOnce(() => {
        throw new Error('boom');
      });

      await expect(getAsync('sid-1')).rejects.toThrow('boom');
    });

    test('set reports a store failure through the callback rather than throwing', async () => {
      vi.spyOn(sessionModel, 'setSession').mockImplementationOnce(() => {
        throw new Error('boom');
      });

      await expect(
        setAsync('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString())),
      ).rejects.toThrow('boom');
    });

    test('destroy reports a store failure through the callback rather than throwing', async () => {
      vi.spyOn(sessionModel, 'destroySession').mockImplementationOnce(() => {
        throw new Error('boom');
      });

      await expect(destroyAsync('sid-1')).rejects.toThrow('boom');
    });

    test('touch logs and still calls back on a store failure instead of throwing', async () => {
      vi.spyOn(sessionModel, 'touchSession').mockImplementationOnce(() => {
        throw new Error('boom');
      });

      await expect(
        touchAsync('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString())),
      ).resolves.toBeUndefined();
    });

    test('all reports a store failure through the callback rather than throwing', async () => {
      vi.spyOn(sessionModel, 'listSessions').mockImplementationOnce(() => {
        throw new Error('boom');
      });

      await expect(allAsync()).rejects.toThrow('boom');
    });

    test('length reports a store failure through the callback rather than throwing', async () => {
      vi.spyOn(sessionModel, 'countSessions').mockImplementationOnce(() => {
        throw new Error('boom');
      });

      await expect(lengthAsync()).rejects.toThrow('boom');
    });

    test('clear reports a store failure through the callback rather than throwing', async () => {
      vi.spyOn(sessionModel, 'clearSessions').mockImplementationOnce(() => {
        throw new Error('boom');
      });

      await expect(clearAsync()).rejects.toThrow('boom');
    });
  });

  describe('optional callback', () => {
    test('set, destroy, touch and clear tolerate no callback on success', () => {
      const session = sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString());
      expect(() => store?.set('sid-1', session)).not.toThrow();
      expect(() => store?.touch('sid-1', session)).not.toThrow();
      expect(() => store?.clear()).not.toThrow();
      expect(() => store?.destroy('sid-1')).not.toThrow();
    });

    test('set and destroy tolerate no callback on failure', () => {
      vi.spyOn(sessionModel, 'setSession').mockImplementationOnce(() => {
        throw new Error('boom');
      });
      expect(() =>
        store?.set('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString())),
      ).not.toThrow();

      vi.spyOn(sessionModel, 'destroySession').mockImplementationOnce(() => {
        throw new Error('boom');
      });
      expect(() => store?.destroy('sid-1')).not.toThrow();

      vi.restoreAllMocks();
    });
  });
});
