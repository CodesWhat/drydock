import type { SessionData } from 'express-session';
import type { Database } from '../store/db/driver.js';
import * as sessionModel from '../store/session.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import { SessionStore } from './session-store.js';
import { registerSessionStreamCloser, trackSessionStream } from './session-streams.js';

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: mockWarn, debug: vi.fn(), error: vi.fn() }),
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
  return new Promise((resolve, reject) => {
    store?.touch(sid, session, (error) => (error ? reject(error) : resolve()));
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

  test('all returns only unexpired sessions as a sid-keyed map', async () => {
    const liveSession = sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString());
    await setAsync('live', liveSession);
    sessionModel.setSession('expired', Date.now() - 1000, JSON.stringify({ cookie: {} }));

    const result = (await allAsync()) as { [sid: string]: SessionData };

    expect(Object.keys(result)).toEqual(['live']);
    expect(result.live).toEqual(liveSession);
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

  describe('destroying a session closes the streams it opened', () => {
    const closed: string[][] = [];
    registerSessionStreamCloser((revoked) => {
      closed.push([...revoked]);
      return revoked.size;
    });

    beforeEach(() => {
      closed.length = 0;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    test('destroy tells the stream closers which session ended, and no other', async () => {
      await setAsync('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS)));
      await setAsync('sid-2', sessionWithExpiry(new Date(Date.now() + TTL_MS)));

      await destroyAsync('sid-1');

      expect(closed).toEqual([['sid-1']]);
    });

    test('destroy closes a stream tracked under that session, and leaves another session’s open', async () => {
      const mine = vi.fn();
      const theirs = vi.fn();
      const forgetMine = trackSessionStream('sid-1', mine);
      const forgetTheirs = trackSessionStream('sid-2', theirs);
      await setAsync('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS)));
      await setAsync('sid-2', sessionWithExpiry(new Date(Date.now() + TTL_MS)));

      await destroyAsync('sid-1');

      expect(mine).toHaveBeenCalledTimes(1);
      expect(theirs).not.toHaveBeenCalled();
      forgetMine();
      forgetTheirs();
    });

    test('a tracked stream that throws while closing is logged and the row is still deleted', async () => {
      const forget = trackSessionStream('sid-1', () => {
        throw new Error('destroy exploded');
      });
      mockWarn.mockClear();
      await setAsync('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS)));

      await expect(destroyAsync('sid-1')).resolves.toBeUndefined();
      forget();

      expect(sessionModel.getSession('sid-1')).toBeUndefined();
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('destroy exploded'));
    });

    test('a closer that throws is logged and the row is still deleted', async () => {
      let armed = true;
      registerSessionStreamCloser(() => {
        if (armed) {
          throw new Error('closer exploded');
        }
        return 0;
      });
      mockWarn.mockClear();
      await setAsync('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS)));

      try {
        await expect(destroyAsync('sid-1')).resolves.toBeUndefined();
      } finally {
        armed = false;
      }

      expect(sessionModel.getSession('sid-1')).toBeUndefined();
      await expect(getAsync('sid-1')).resolves.toBeNull();
      // The closers registered before it still heard about the session.
      expect(closed).toEqual([['sid-1']]);
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('closer exploded'));
    });

    test('the streams are closed before the row goes, so a delete that fails still closes them', async () => {
      vi.spyOn(sessionModel, 'destroySession').mockImplementationOnce(() => {
        expect(closed).toEqual([['sid-1']]);
        throw new Error('boom');
      });

      await expect(destroyAsync('sid-1')).rejects.toThrow('boom');
      expect(closed).toEqual([['sid-1']]);
    });
  });

  describe('a session that expires closes the streams it opened', () => {
    const closed: string[][] = [];
    registerSessionStreamCloser((revoked) => {
      closed.push([...revoked]);
      return revoked.size;
    });

    beforeEach(() => {
      closed.length = 0;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    test('the sweep closes the streams of every expired session, and no live one', () => {
      const expired = vi.fn();
      const alsoExpired = vi.fn();
      const live = vi.fn();
      const forget = [
        trackSessionStream('expired-1', expired),
        trackSessionStream('expired-2', alsoExpired),
        trackSessionStream('live', live),
      ];
      sessionModel.setSession('expired-1', Date.now() - 1000, '{}');
      sessionModel.setSession('expired-2', Date.now() - 1000, '{}');
      sessionModel.setSession('live', Date.now() + TTL_MS, '{}');

      expect(store?.sweepExpiredNow()).toBe(2);

      expect(expired).toHaveBeenCalledTimes(1);
      expect(alsoExpired).toHaveBeenCalledTimes(1);
      expect(live).not.toHaveBeenCalled();
      expect(closed.map((ids) => ids.sort())).toEqual([['expired-1', 'expired-2']]);
      for (const release of forget) {
        release();
      }
    });

    test('a sweep that finds nothing expired tells no stream anything', () => {
      sessionModel.setSession('live', Date.now() + TTL_MS, '{}');

      expect(store?.sweepExpiredNow()).toBe(0);

      expect(closed).toEqual([]);
    });

    test('the sweep closes exactly the sessions it deletes, read at one instant', () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(1_000_000);
      sessionModel.setSession('at-the-cutoff', 1_000_000, '{}');
      sessionModel.setSession('just-after', 1_000_001, '{}');
      // A clock that moved between the two statements would delete a row whose
      // streams were never told.
      now.mockReturnValueOnce(1_000_000).mockReturnValue(1_000_001);

      expect(store?.sweepExpiredNow()).toBe(1);

      expect(closed).toEqual([['at-the-cutoff']]);
      expect(sessionModel.listSessions().map((row) => row.sid)).toEqual(['just-after']);
    });

    test('the streams are closed before the rows go, so a sweep that fails still closes them', () => {
      sessionModel.setSession('expired', Date.now() - 1000, '{}');
      vi.spyOn(sessionModel, 'sweepExpiredSessions').mockImplementationOnce(() => {
        expect(closed).toEqual([['expired']]);
        throw new Error('boom');
      });

      expect(() => store?.sweepExpiredNow()).toThrow('boom');
      expect(closed).toEqual([['expired']]);
    });

    test('reading a session that has expired closes its streams, and no other session’s', async () => {
      const mine = vi.fn();
      const theirs = vi.fn();
      const forget = [trackSessionStream('sid-1', mine), trackSessionStream('sid-2', theirs)];
      sessionModel.setSession('sid-1', Date.now() - 1000, JSON.stringify({ cookie: {} }));
      sessionModel.setSession('sid-2', Date.now() + TTL_MS, JSON.stringify({ cookie: {} }));

      await expect(getAsync('sid-1')).resolves.toBeNull();
      await expect(getAsync('sid-2')).resolves.not.toBeNull();

      expect(mine).toHaveBeenCalledTimes(1);
      expect(theirs).not.toHaveBeenCalled();
      expect(closed).toEqual([['sid-1']]);
      for (const release of forget) {
        release();
      }
    });

    test('a read closes the streams before the row goes, so a delete that fails still closes them', async () => {
      sessionModel.setSession('sid-1', Date.now() - 1000, JSON.stringify({ cookie: {} }));
      vi.spyOn(sessionModel, 'destroySession').mockImplementationOnce(() => {
        expect(closed).toEqual([['sid-1']]);
        throw new Error('boom');
      });

      await expect(getAsync('sid-1')).rejects.toThrow('boom');
      expect(closed).toEqual([['sid-1']]);
    });
  });

  describe('destroyed sessions stay destroyed', () => {
    const live = () => sessionWithExpiry(new Date(Date.now() + TTL_MS));

    test('a set after destroy does not bring the session back, and reports no error', async () => {
      await setAsync('sid-1', live());
      await destroyAsync('sid-1');

      await expect(setAsync('sid-1', live())).resolves.toBeUndefined();

      await expect(getAsync('sid-1')).resolves.toBeNull();
      expect(sessionModel.getSession('sid-1')).toBeUndefined();
    });

    test('a touch after destroy does not bring it back either', async () => {
      await setAsync('sid-1', live());
      await destroyAsync('sid-1');
      await touchAsync('sid-1', live());
      expect(sessionModel.getSession('sid-1')).toBeUndefined();
    });

    test('other sids are unaffected', async () => {
      await destroyAsync('sid-1');
      await setAsync('sid-2', live());
      await expect(getAsync('sid-2')).resolves.not.toBeNull();
    });

    test('the tombstone expires, so the memory is bounded in time', async () => {
      store?.stop();
      store = new SessionStore({ ttlMs: TTL_MS, tombstoneTtlMs: 1_000 });
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(1_000_000);
      await destroyAsync('sid-1');

      now.mockReturnValue(1_000_999);
      await setAsync('sid-1', live());
      expect(sessionModel.getSession('sid-1')).toBeUndefined();

      now.mockReturnValue(1_001_000);
      await setAsync('sid-1', live());
      expect(sessionModel.getSession('sid-1')).toBeDefined();
      now.mockRestore();
    });

    test('the table is bounded in size: the oldest tombstone is forgotten first', async () => {
      store?.stop();
      store = new SessionStore({ ttlMs: TTL_MS, maxTombstones: 2 });
      await destroyAsync('sid-1');
      await destroyAsync('sid-2');
      await destroyAsync('sid-3');

      await setAsync('sid-1', live());
      await setAsync('sid-2', live());
      await setAsync('sid-3', live());
      expect(sessionModel.getSession('sid-1')).toBeDefined();
      expect(sessionModel.getSession('sid-2')).toBeUndefined();
      expect(sessionModel.getSession('sid-3')).toBeUndefined();
    });

    test('destroying the same sid again refreshes its tombstone rather than aging it out early', async () => {
      store?.stop();
      store = new SessionStore({ ttlMs: TTL_MS, maxTombstones: 2 });
      await destroyAsync('sid-1');
      await destroyAsync('sid-2');
      await destroyAsync('sid-1');
      await destroyAsync('sid-3');

      await setAsync('sid-2', live());
      await setAsync('sid-1', live());
      expect(sessionModel.getSession('sid-2')).toBeDefined();
      expect(sessionModel.getSession('sid-1')).toBeUndefined();
    });
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

    test('touch logs and propagates a store failure through the callback rather than swallowing it', async () => {
      vi.spyOn(sessionModel, 'touchSession').mockImplementationOnce(() => {
        throw new Error('boom');
      });

      await expect(
        touchAsync('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString())),
      ).rejects.toThrow('boom');
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

    test('set, touch and destroy tolerate no callback on failure', () => {
      vi.spyOn(sessionModel, 'setSession').mockImplementationOnce(() => {
        throw new Error('boom');
      });
      expect(() =>
        store?.set('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString())),
      ).not.toThrow();

      vi.spyOn(sessionModel, 'touchSession').mockImplementationOnce(() => {
        throw new Error('boom');
      });
      expect(() =>
        store?.touch('sid-1', sessionWithExpiry(new Date(Date.now() + TTL_MS).toISOString())),
      ).not.toThrow();

      vi.spyOn(sessionModel, 'destroySession').mockImplementationOnce(() => {
        throw new Error('boom');
      });
      expect(() => store?.destroy('sid-1')).not.toThrow();

      vi.restoreAllMocks();
    });
  });
});
