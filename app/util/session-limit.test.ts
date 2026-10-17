const { mockHasEnrolledUsername } = vi.hoisted(() => ({ mockHasEnrolledUsername: vi.fn() }));

vi.mock('../store/totp.js', () => ({
  getSubjectVersion: vi.fn(() => 0),
  getFactorBySubject: vi.fn(),
  getSessionsNotBefore: vi.fn(() => 0),
  hasEnrolledUsername: mockHasEnrolledUsername,
}));

const { mockCloseStreams } = vi.hoisted(() => ({ mockCloseStreams: vi.fn() }));
vi.mock('../api/session-streams.js', () => ({ closeStreamsForRevokedSessions: mockCloseStreams }));

vi.mock('../log/index.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { deriveSubjectId } from '../api/totp-identity.js';
import { destroyOtherSubjectSessions, enforceConcurrentSessionLimit } from './session-limit.js';

beforeEach(() => {
  mockHasEnrolledUsername.mockReset();
  mockHasEnrolledUsername.mockReturnValue(false);
});

test('enforceConcurrentSessionLimit should return 0 for invalid input', async () => {
  await expect(
    enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 2,
    }),
  ).resolves.toBe(0);

  await expect(
    enforceConcurrentSessionLimit({
      username: '  ',
      maxConcurrentSessions: 2,
      sessionStore: {
        all: vi.fn((done) => done(null, {})),
        destroy: vi.fn((_sid, done) => done()),
      },
    }),
  ).resolves.toBe(0);

  await expect(
    enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 0,
      sessionStore: {
        all: vi.fn((done) => done(null, {})),
        destroy: vi.fn((_sid, done) => done()),
      },
    }),
  ).resolves.toBe(0);
});

test('enforceConcurrentSessionLimit should normalize mixed object payload formats', async () => {
  const sessionStore = {
    all: vi.fn((done) =>
      done(null, {
        '': {
          passport: { user: JSON.stringify({ username: 'john' }) },
        },
        'session-string-valid': JSON.stringify({
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-02T00:00:00.000Z' },
        }),
        'session-wrapper': {
          session: {
            passport: { user: { username: 'john' } },
            cookie: {
              _expires: new Date('invalid-date'),
              originalMaxAge: {},
            },
          },
        },
        'session-max-age': {
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { originalMaxAge: 5000 },
        },
        'session-current': {
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-04T00:00:00.000Z' },
        },
        'session-no-passport': {
          cookie: { expires: '2026-01-03T00:00:00.000Z' },
        },
        'session-user-not-string': {
          passport: { user: 123 },
          cookie: {},
        },
        'session-user-object-empty': {
          passport: { user: { username: '' } },
          cookie: { expires: '2026-01-03T00:00:00.000Z' },
        },
        'session-user-string-not-object': {
          passport: { user: '123' },
          cookie: { originalMaxAge: Number.POSITIVE_INFINITY },
        },
        'session-user-string-object-no-username': {
          passport: { user: '{}' },
          cookie: { expires: '2026-01-03T00:00:00.000Z' },
        },
        'session-user-invalid-json': {
          passport: { user: '{not-json' },
          cookie: { expires: '2026-01-03T00:00:00.000Z' },
        },
        'session-no-cookie': {
          passport: { user: JSON.stringify({ username: 'jane' }) },
        },
        'session-date-object': {
          passport: { user: JSON.stringify({ username: 'jane' }) },
          cookie: { _expires: new Date('2026-01-05T00:00:00.000Z') },
        },
        'session-bad-date-string': {
          passport: { user: JSON.stringify({ username: 'jane' }) },
          cookie: { expires: 'not-a-date' },
        },
        'session-string-malformed': '{not-json',
        'session-string-not-object': '123',
        'session-non-object': 42,
      }),
    ),
    destroy: vi.fn((_sid, done) => done()),
  };

  const destroyedCount = await enforceConcurrentSessionLimit({
    username: 'john',
    maxConcurrentSessions: 2,
    currentSessionId: 'session-current',
    sessionStore,
  });

  expect(destroyedCount).toBe(2);
  expect(sessionStore.destroy).toHaveBeenNthCalledWith(1, 'session-wrapper', expect.any(Function));
  expect(sessionStore.destroy).toHaveBeenNthCalledWith(2, 'session-max-age', expect.any(Function));
});

test('enforceConcurrentSessionLimit should handle non-object session dumps', async () => {
  const sessionStore = {
    all: vi.fn((done) => done(null, null)),
    destroy: vi.fn((_sid, done) => done()),
  };

  const destroyedCount = await enforceConcurrentSessionLimit({
    username: 'john',
    maxConcurrentSessions: 2,
    currentSessionId: 'new-session',
    sessionStore,
  });

  expect(destroyedCount).toBe(0);
  expect(sessionStore.destroy).not.toHaveBeenCalled();
});

test('enforceConcurrentSessionLimit should handle array session dumps', async () => {
  const sessionStore = {
    all: vi.fn((done) =>
      done(null, [
        null,
        { sid: '' },
        { sid: 123 },
        {
          sid: 'session-array-invalid',
          session: '{bad-json',
        },
        {
          sid: 'session-array-oldest',
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-01T00:00:00.000Z' },
        },
        {
          sid: 'session-array-newer',
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-03T00:00:00.000Z' },
        },
      ]),
    ),
    destroy: vi.fn((_sid, done) => done()),
  };

  const destroyedCount = await enforceConcurrentSessionLimit({
    username: 'john',
    maxConcurrentSessions: 2,
    currentSessionId: 'new-session',
    sessionStore,
  });

  expect(destroyedCount).toBe(1);
  expect(sessionStore.destroy).toHaveBeenCalledWith('session-array-oldest', expect.any(Function));
});

test('enforceConcurrentSessionLimit should use sid ordering when timestamps tie', async () => {
  const sessionStore = {
    all: vi.fn((done) =>
      done(null, {
        'session-b': {
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-01T00:00:00.000Z' },
        },
        'session-a': {
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-01T00:00:00.000Z' },
        },
      }),
    ),
    destroy: vi.fn((_sid, done) => done()),
  };

  const destroyedCount = await enforceConcurrentSessionLimit({
    username: 'john',
    maxConcurrentSessions: 2,
    currentSessionId: 'new-session',
    sessionStore,
  });

  expect(destroyedCount).toBe(1);
  expect(sessionStore.destroy).toHaveBeenCalledWith('session-a', expect.any(Function));
});

test('enforceConcurrentSessionLimit should destroy overflow sessions in parallel', async () => {
  let inFlight = 0;
  let maxInFlight = 0;

  const sessionStore = {
    all: vi.fn((done) =>
      done(null, {
        'session-oldest': {
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-01T00:00:00.000Z' },
        },
        'session-middle': {
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-02T00:00:00.000Z' },
        },
        'session-newest': {
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-03T00:00:00.000Z' },
        },
      }),
    ),
    destroy: vi.fn((_sid, done) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      setTimeout(() => {
        inFlight -= 1;
        done();
      }, 10);
    }),
  };

  const destroyedCount = await enforceConcurrentSessionLimit({
    username: 'john',
    maxConcurrentSessions: 1,
    currentSessionId: 'new-session',
    sessionStore,
  });

  expect(destroyedCount).toBe(3);
  expect(sessionStore.destroy).toHaveBeenCalledTimes(3);
  expect(maxInFlight).toBeGreaterThan(1);
});

test('enforceConcurrentSessionLimit should reject when session enumeration fails', async () => {
  const sessionStore = {
    all: vi.fn((done) => done(new Error('all failed'))),
    destroy: vi.fn((_sid, done) => done()),
  };

  await expect(
    enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 2,
      currentSessionId: 'new-session',
      sessionStore,
    }),
  ).rejects.toThrow('all failed');
});

test('enforceConcurrentSessionLimit should reject when session destruction fails', async () => {
  const sessionStore = {
    all: vi.fn((done) =>
      done(null, {
        'session-oldest': {
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-01T00:00:00.000Z' },
        },
      }),
    ),
    destroy: vi.fn((_sid, done) => done(new Error('destroy failed'))),
  };

  await expect(
    enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 1,
      currentSessionId: 'new-session',
      sessionStore,
    }),
  ).rejects.toThrow('destroy failed');
});

test('enforceConcurrentSessionLimit should avoid full session scans after index warmup', async () => {
  const sessionStore = {
    all: vi.fn((done) =>
      done(null, {
        'session-oldest': {
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-01T00:00:00.000Z' },
        },
        'session-newer': {
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-02T00:00:00.000Z' },
        },
      }),
    ),
    destroy: vi.fn((_sid, done) => done()),
  };

  await expect(
    enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 10,
      currentSessionId: 'current-session-1',
      sessionStore,
    }),
  ).resolves.toBe(0);

  await expect(
    enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 10,
      currentSessionId: 'current-session-2',
      sessionStore,
    }),
  ).resolves.toBe(0);

  expect(sessionStore.all).toHaveBeenCalledTimes(1);
});

test('enforceConcurrentSessionLimit should return 0 when sessions cannot be listed and cache is cold', async () => {
  const sessionStore = {
    destroy: vi.fn((_sid, done) => done()),
  };

  const destroyedCount = await enforceConcurrentSessionLimit({
    username: 'john',
    maxConcurrentSessions: 1,
    currentSessionId: 'new-session',
    sessionStore,
  });

  expect(destroyedCount).toBe(0);
  expect(sessionStore.destroy).not.toHaveBeenCalled();
});

test('enforceConcurrentSessionLimit should continue using a warmed index when listing is unavailable', async () => {
  const sessionStore = {
    all: vi.fn((done) =>
      done(null, {
        'existing-session': {
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-01T00:00:00.000Z' },
        },
      }),
    ),
    destroy: vi.fn((_sid, done) => done()),
  };

  await expect(
    enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 10,
      currentSessionId: 'cached-session',
      sessionStore,
    }),
  ).resolves.toBe(0);

  sessionStore.all = undefined;

  const destroyedCount = await enforceConcurrentSessionLimit({
    username: 'john',
    maxConcurrentSessions: 1,
    currentSessionId: 'next-session',
    sessionStore,
  });

  expect(destroyedCount).toBe(2);
  expect(sessionStore.destroy).toHaveBeenNthCalledWith(1, 'existing-session', expect.any(Function));
  expect(sessionStore.destroy).toHaveBeenNthCalledWith(2, 'cached-session', expect.any(Function));
});

test('enforceConcurrentSessionLimit should treat missing all callback as an empty session list', async () => {
  const listSessions = vi.fn((done) =>
    done(null, {
      'existing-session': {
        passport: { user: JSON.stringify({ username: 'john' }) },
        cookie: { expires: '2026-01-01T00:00:00.000Z' },
      },
    }),
  );
  let allReads = 0;
  const sessionStore = {
    get all() {
      allReads += 1;
      return allReads === 1 ? listSessions : undefined;
    },
    destroy: vi.fn((_sid, done) => done()),
  };

  const destroyedCount = await enforceConcurrentSessionLimit({
    username: 'john',
    maxConcurrentSessions: 1,
    currentSessionId: 'new-session',
    sessionStore,
  });

  expect(destroyedCount).toBe(0);
  expect(listSessions).not.toHaveBeenCalled();
});

test('enforceConcurrentSessionLimit should share in-flight index loading across concurrent calls', async () => {
  let listCallback: ((error: unknown, sessions?: unknown) => void) | undefined;
  const sessionStore = {
    all: vi.fn((done) => {
      listCallback = done;
    }),
    destroy: vi.fn((_sid, done) => done()),
  };

  const firstPromise = enforceConcurrentSessionLimit({
    username: 'john',
    maxConcurrentSessions: 5,
    currentSessionId: 'session-a',
    sessionStore,
  });
  const secondPromise = enforceConcurrentSessionLimit({
    username: 'john',
    maxConcurrentSessions: 5,
    currentSessionId: 'session-b',
    sessionStore,
  });

  expect(sessionStore.all).toHaveBeenCalledTimes(1);
  listCallback?.(null, {
    'existing-session': {
      passport: { user: JSON.stringify({ username: 'john' }) },
      cookie: { expires: '2026-01-01T00:00:00.000Z' },
    },
  });

  await expect(Promise.all([firstPromise, secondPromise])).resolves.toEqual([0, 0]);
});

test('enforceConcurrentSessionLimit should tolerate concurrent index pruning when no current session is provided', async () => {
  const sessionStore = {
    all: vi.fn((done) =>
      done(null, {
        'existing-session': {
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-01T00:00:00.000Z' },
        },
      }),
    ),
    destroy: vi.fn((_sid, done) => setTimeout(() => done(), 0)),
  };

  const firstPromise = enforceConcurrentSessionLimit({
    username: 'john',
    maxConcurrentSessions: 1,
    sessionStore,
  });
  const secondPromise = enforceConcurrentSessionLimit({
    username: 'john',
    maxConcurrentSessions: 1,
    sessionStore,
  });

  await expect(Promise.all([firstPromise, secondPromise])).resolves.toEqual([1, 1]);
  expect(sessionStore.destroy).toHaveBeenCalledTimes(2);
  expect(sessionStore.destroy).toHaveBeenCalledWith('existing-session', expect.any(Function));
});

test('enforceConcurrentSessionLimit counts v2 local and OIDC sessions against the username', async () => {
  const v2Local = JSON.stringify({
    v: 2,
    kind: 'local',
    username: 'john',
    subjectId: deriveSubjectId('basic.default', 'john'),
    providerId: 'basic.default',
    assurance: 'password',
    factorVersion: 0,
    issuedAt: 1_000,
  });
  const v2Oidc = JSON.stringify({ v: 2, kind: 'oidc', username: 'john' });
  const sessionStore = {
    all: vi.fn((done) =>
      done(null, {
        'session-legacy': {
          passport: { user: JSON.stringify({ username: 'john' }) },
          cookie: { expires: '2026-01-01T00:00:00.000Z' },
        },
        'session-v2-local': {
          passport: { user: v2Local },
          cookie: { expires: '2026-01-02T00:00:00.000Z' },
        },
        'session-v2-oidc': {
          passport: { user: v2Oidc },
          cookie: { expires: '2026-01-03T00:00:00.000Z' },
        },
        'session-v2-invalid': {
          passport: { user: JSON.stringify({ v: 2, kind: 'local', username: 'john' }) },
          cookie: { expires: '2025-12-01T00:00:00.000Z' },
        },
      }),
    ),
    destroy: vi.fn((_sid, done) => done()),
  };

  const destroyedCount = await enforceConcurrentSessionLimit({
    username: 'john',
    maxConcurrentSessions: 2,
    currentSessionId: 'session-new',
    sessionStore,
  });

  expect(destroyedCount).toBe(2);
  expect(sessionStore.destroy).toHaveBeenNthCalledWith(1, 'session-legacy', expect.any(Function));
  expect(sessionStore.destroy).toHaveBeenNthCalledWith(2, 'session-v2-local', expect.any(Function));
});

describe('stale sessions', () => {
  const legacy = (username: string) => JSON.stringify({ username });
  const local = (username: string, factorVersion = 0) =>
    JSON.stringify({
      v: 2,
      kind: 'local',
      username,
      subjectId: deriveSubjectId('basic.default', username),
      providerId: 'basic.default',
      assurance: 'password',
      factorVersion,
      issuedAt: 1_000,
    });

  function storeOf(sessions: Record<string, unknown>) {
    return {
      all: vi.fn((done) => done(null, sessions)),
      destroy: vi.fn((_sid, done) => done()),
    };
  }

  test('destroys stale sessions and does not let them occupy slots', async () => {
    mockHasEnrolledUsername.mockReturnValue(true);
    const sessionStore = storeOf({
      'valid-oidc': {
        passport: { user: JSON.stringify({ v: 2, kind: 'oidc', username: 'john' }) },
        cookie: { expires: '2026-01-01T00:00:00.000Z' },
      },
      'stale-legacy-a': {
        passport: { user: legacy('john') },
        cookie: { expires: '2026-01-02T00:00:00.000Z' },
      },
      'stale-legacy-b': {
        passport: { user: legacy('john') },
        cookie: { expires: '2026-01-03T00:00:00.000Z' },
      },
    });

    const destroyed = await enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 2,
      currentSessionId: 'new',
      sessionStore,
    });

    expect(destroyed).toBe(2);
    expect(sessionStore.destroy.mock.calls.map(([sid]) => sid).sort()).toEqual([
      'stale-legacy-a',
      'stale-legacy-b',
    ]);
  });

  test('evicts the oldest valid session only when valid ones alone overflow', async () => {
    const sessionStore = storeOf({
      'valid-old': {
        passport: { user: local('john') },
        cookie: { expires: '2026-01-01T00:00:00.000Z' },
      },
      'valid-new': {
        passport: { user: local('john') },
        cookie: { expires: '2026-01-02T00:00:00.000Z' },
      },
    });

    await enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 2,
      currentSessionId: 'new',
      sessionStore,
    });

    expect(sessionStore.destroy).toHaveBeenCalledTimes(1);
    expect(sessionStore.destroy).toHaveBeenCalledWith('valid-old', expect.any(Function));
  });

  test('revalidates a cached index so a session that went stale since is dropped, not counted', async () => {
    const oidc = JSON.stringify({ v: 2, kind: 'oidc', username: 'john' });
    const sessionStore = storeOf({
      oldest: { passport: { user: oidc }, cookie: { expires: '2026-01-01T00:00:00.000Z' } },
      a: { passport: { user: legacy('john') }, cookie: { expires: '2026-01-02T00:00:00.000Z' } },
      b: { passport: { user: legacy('john') }, cookie: { expires: '2026-01-03T00:00:00.000Z' } },
    });
    await enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 5,
      currentSessionId: 'first',
      sessionStore,
    });
    expect(sessionStore.destroy).not.toHaveBeenCalled();

    mockHasEnrolledUsername.mockReturnValue(true);
    const destroyed = await enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 4,
      currentSessionId: 'second',
      sessionStore,
    });

    expect(sessionStore.all).toHaveBeenCalledTimes(1);
    expect(destroyed).toBe(2);
    expect(sessionStore.destroy.mock.calls.map(([sid]) => sid).sort()).toEqual(['a', 'b']);
  });

  test('with the store unavailable it destroys nothing at all, stale or valid', async () => {
    mockHasEnrolledUsername.mockImplementation(() => {
      throw new Error('totp collection not initialized');
    });
    const sessionStore = storeOf({
      a: { passport: { user: legacy('john') }, cookie: { expires: '2026-01-01T00:00:00.000Z' } },
      b: { passport: { user: local('john') }, cookie: { expires: '2026-01-02T00:00:00.000Z' } },
      oidc: {
        passport: { user: JSON.stringify({ v: 2, kind: 'oidc', username: 'john' }) },
        cookie: { expires: '2026-01-03T00:00:00.000Z' },
      },
    });

    const destroyed = await enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 1,
      currentSessionId: 'new',
      sessionStore,
    });

    expect(destroyed).toBe(0);
    expect(sessionStore.destroy).not.toHaveBeenCalled();
  });
});

describe('sessions that ended without the limit being asked', () => {
  const oidc = (username: string) => JSON.stringify({ v: 2, kind: 'oidc', username });

  /**
   * A store that behaves like the real one: a login records its session with
   * the limit and then saves the row, and a logout or an expiry removes the row
   * without the limit ever hearing of it.
   */
  function createStore(initial: Record<string, unknown> = {}) {
    const rows = new Map<string, unknown>(Object.entries(initial));
    const evicted: string[] = [];
    const sessionStore = {
      all: vi.fn((done: (error: unknown, sessions?: unknown) => void) =>
        done(null, Object.fromEntries(rows)),
      ),
      get: vi.fn((sid: string, done: (error: unknown, session?: unknown) => void) =>
        done(null, rows.get(sid) ?? null),
      ),
      destroy: vi.fn((sid: string, done: (error?: unknown) => void) => {
        evicted.push(sid);
        rows.delete(sid);
        done();
      }),
    };
    return {
      sessionStore,
      rows,
      evicted,
      async login(sid: string, maxConcurrentSessions = 5, username = 'john') {
        const destroyed = await enforceConcurrentSessionLimit({
          username,
          maxConcurrentSessions,
          currentSessionId: sid,
          sessionStore,
        });
        rows.set(sid, { passport: { user: oidc(username) }, cookie: {} });
        // Logins are never in the same millisecond, so the order is theirs.
        vi.advanceTimersByTime(1_000);
        return destroyed;
      },
      /** What a logout, an expiry sweep or a regenerated id does: the row goes, nothing else. */
      end(sid: string) {
        rows.delete(sid);
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-01-01T00:00:00.000Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('four login and logout cycles elsewhere do not cost the one other live session its place', async () => {
    const store = createStore();
    await store.login('desktop');
    for (const sid of ['phone-1', 'phone-2', 'phone-3', 'phone-4']) {
      await store.login(sid);
      store.end(sid);
    }

    await expect(store.login('phone-5')).resolves.toBe(0);

    expect(store.evicted).toEqual([]);
    expect([...store.rows.keys()]).toEqual(['desktop', 'phone-5']);
  });

  test('the limit still evicts the oldest live session, and only that one', async () => {
    const store = createStore();
    for (const sid of ['s1', 's2', 's3', 's4', 's5']) {
      await expect(store.login(sid)).resolves.toBe(0);
    }

    await expect(store.login('s6')).resolves.toBe(1);
    expect(store.evicted).toEqual(['s1']);

    await expect(store.login('s7')).resolves.toBe(1);
    expect(store.evicted).toEqual(['s1', 's2']);
    expect([...store.rows.keys()]).toEqual(['s3', 's4', 's5', 's6', 's7']);
  });

  test('an ended session frees its slot, and the next overflow evicts the oldest live one', async () => {
    const store = createStore();
    await store.login('a', 3);
    await store.login('b', 3);
    await store.login('c', 3);
    store.end('b');

    await expect(store.login('d', 3)).resolves.toBe(0);
    expect(store.evicted).toEqual([]);

    await expect(store.login('e', 3)).resolves.toBe(1);
    expect(store.evicted).toEqual(['a']);
  });

  test('a session the index loaded at startup stops counting once its row has expired', async () => {
    const store = createStore({
      'from-disk-old': {
        passport: { user: oidc('john') },
        cookie: { expires: '2026-01-02T00:00:00.000Z' },
      },
      'from-disk-new': {
        passport: { user: oidc('john') },
        cookie: { expires: '2026-01-03T00:00:00.000Z' },
      },
    });
    await expect(store.login('first', 3)).resolves.toBe(0);
    store.end('from-disk-old');

    await expect(store.login('second', 3)).resolves.toBe(0);

    expect(store.evicted).toEqual([]);
    expect(store.sessionStore.all).toHaveBeenCalledTimes(1);
  });

  test('an ended session is forgotten, not asked about again on every login', async () => {
    const store = createStore();
    await store.login('gone');
    store.end('gone');
    await store.login('second');
    expect(store.sessionStore.get).toHaveBeenCalledWith('gone', expect.any(Function));
    store.sessionStore.get.mockClear();

    await store.login('third');

    expect(store.sessionStore.get.mock.calls.map(([sid]) => sid)).toEqual(['second']);
  });

  test('one person’s ended sessions do not touch another person’s', async () => {
    const store = createStore();
    await store.login('jane-1', 1, 'jane');
    await store.login('john-1', 1);
    store.end('john-1');

    await expect(store.login('john-2', 1)).resolves.toBe(0);

    expect(store.evicted).toEqual([]);
    expect(store.rows.has('jane-1')).toBe(true);
    expect(store.sessionStore.get).not.toHaveBeenCalledWith('jane-1', expect.any(Function));
  });

  describe('a login that was recorded and then failed', () => {
    /** The login answered 500 after the limit recorded it; what it leaves is a saved row with nobody in it. */
    async function failedLogin(
      store: ReturnType<typeof createStore>,
      sid: string,
      row: unknown,
      maxConcurrentSessions = 2,
    ) {
      await enforceConcurrentSessionLimit({
        username: 'john',
        maxConcurrentSessions,
        currentSessionId: sid,
        sessionStore: store.sessionStore,
      });
      store.rows.set(sid, row);
      vi.advanceTimersByTime(1_000);
    }

    test.each([
      ['no user', { cookie: {} }],
      ['a user that names nobody', { passport: { user: '{}' }, cookie: {} }],
      ['a payload that does not parse', '{not json'],
    ])('does not hold a slot when its row carries %s', async (_name, row) => {
      const store = createStore();
      await store.login('desktop', 2);
      await failedLogin(store, 'failed', row);

      // Two live sessions fit a limit of two. Counting the failed one evicted the desktop.
      await expect(store.login('phone', 2)).resolves.toBe(0);

      expect(store.evicted).toEqual([]);
      expect([...store.rows.keys()]).toEqual(['desktop', 'failed', 'phone']);
    });

    test('is forgotten, so the limit still evicts the oldest live session at the right login', async () => {
      const store = createStore();
      await store.login('desktop', 2);
      await failedLogin(store, 'failed', { cookie: {} });
      await store.login('phone', 2);

      await expect(store.login('tablet', 2)).resolves.toBe(1);

      expect(store.evicted).toEqual(['desktop']);
    });
  });

  test('a login that recorded its session while the store was being read is still counted', async () => {
    const store = createStore({
      a: { passport: { user: oidc('john') }, cookie: { expires: '2025-01-01T00:00:00.000Z' } },
    });
    let answerFirstRead: () => void = () => {};
    store.sessionStore.get.mockImplementationOnce((sid, done) => {
      answerFirstRead = () => done(null, store.rows.get(sid) ?? null);
    });
    const slow = enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 2,
      currentSessionId: 'b',
      sessionStore: store.sessionStore,
    });
    await vi.waitFor(() => expect(store.sessionStore.get).toHaveBeenCalledTimes(1));

    await expect(store.login('c', 2)).resolves.toBe(0);
    answerFirstRead();

    // `a`, `c` and now `b` are one more than the limit allows.
    await expect(slow).resolves.toBe(1);
    expect(store.evicted).toEqual(['a']);
  });

  test('a store that cannot be read fails the check and destroys nothing', async () => {
    const store = createStore();
    await store.login('desktop', 1);
    store.sessionStore.get.mockImplementationOnce((_sid, done) => done(new Error('disk gone')));

    await expect(store.login('phone', 1)).rejects.toThrow('disk gone');

    expect(store.evicted).toEqual([]);
  });
});

describe('destroyOtherSubjectSessions', () => {
  const subjectId = deriveSubjectId('basic.default', 'john');
  const local = (username: string, subject = subjectId) =>
    JSON.stringify({
      v: 2,
      kind: 'local',
      username,
      subjectId: subject,
      providerId: 'basic.default',
      assurance: 'totp',
      factorVersion: 1,
      issuedAt: 1_000,
    });

  test('destroys the other local sessions of that subject and the legacy sessions of its username, and nothing else', async () => {
    const sessionStore = {
      all: vi.fn((done) =>
        done(null, {
          current: { passport: { user: local('john') } },
          'same-subject': { passport: { user: local('john') } },
          'other-subject': {
            passport: { user: local('john', deriveSubjectId('basic.b', 'john')) },
          },
          'other-user': {
            passport: { user: local('jane', deriveSubjectId('basic.default', 'jane')) },
          },
          oidc: { passport: { user: JSON.stringify({ v: 2, kind: 'oidc', username: 'john' }) } },
          legacy: { passport: { user: JSON.stringify({ username: 'john' }) } },
          'legacy-other-user': { passport: { user: JSON.stringify({ username: 'jane' }) } },
          'object-user': { passport: { user: { username: 'john' } } },
        }),
      ),
      destroy: vi.fn((_sid, done) => done()),
    };

    const destroyed = await destroyOtherSubjectSessions({
      subjectId,
      username: 'john',
      sessionStore,
      currentSessionId: 'current',
    });

    expect(destroyed).toBe(2);
    expect(sessionStore.destroy.mock.calls.map(([sid]) => sid)).toEqual(['same-subject', 'legacy']);
    expect(mockCloseStreams).toHaveBeenCalledWith(['same-subject', 'legacy']);
  });

  test('the current session is the one exception, whatever shape it has', async () => {
    const sessionStore = {
      all: vi.fn((done) =>
        done(null, {
          current: { passport: { user: JSON.stringify({ username: 'john' }) } },
          legacy: { passport: { user: JSON.stringify({ username: 'john' }) } },
        }),
      ),
      destroy: vi.fn((_sid, done) => done()),
    };

    await destroyOtherSubjectSessions({
      subjectId,
      username: 'john',
      sessionStore,
      currentSessionId: 'current',
    });

    expect(sessionStore.destroy.mock.calls.map(([sid]) => sid)).toEqual(['legacy']);
  });

  test('closes the revoked sessions’ open streams even when a destroy fails', async () => {
    const sessionStore = {
      all: vi.fn((done) => done(null, { stale: { passport: { user: local('john') } } })),
      destroy: vi.fn((_sid, done) => done(new Error('disk full'))),
    };

    await expect(
      destroyOtherSubjectSessions({
        subjectId,
        username: 'john',
        sessionStore,
        currentSessionId: 'current',
      }),
    ).rejects.toThrow('disk full');

    expect(mockCloseStreams).toHaveBeenCalledWith(['stale']);
  });

  test('closes nothing when there is nothing to revoke', async () => {
    const sessionStore = {
      all: vi.fn((done) => done(null, { current: { passport: { user: local('john') } } })),
      destroy: vi.fn((_sid, done) => done()),
    };

    await destroyOtherSubjectSessions({
      subjectId,
      username: 'john',
      sessionStore,
      currentSessionId: 'current',
    });

    expect(mockCloseStreams).toHaveBeenCalledWith([]);
  });

  test('also drops them from a username index built earlier', async () => {
    const stored: Record<string, unknown> = {
      a: { passport: { user: local('john') } },
      b: { passport: { user: local('john') } },
    };
    const sessionStore = {
      all: vi.fn((done) => done(null, stored)),
      destroy: vi.fn((sid, done) => {
        delete stored[sid];
        done();
      }),
    };
    // Build the cached index, which holds both sessions.
    await enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 5,
      sessionStore,
      currentSessionId: 'b',
    });

    await destroyOtherSubjectSessions({
      subjectId,
      username: 'john',
      sessionStore,
      currentSessionId: 'b',
    });
    const result = await enforceConcurrentSessionLimit({
      username: 'john',
      maxConcurrentSessions: 1,
      sessionStore,
      currentSessionId: 'b',
    });

    expect(result).toBe(0);
    expect(sessionStore.destroy).toHaveBeenCalledTimes(1);
  });

  test('is a no-op when nothing matches', async () => {
    const sessionStore = {
      all: vi.fn((done) => done(null, {})),
      destroy: vi.fn((_sid, done) => done()),
    };

    await expect(
      destroyOtherSubjectSessions({ subjectId, username: 'john', sessionStore }),
    ).resolves.toBe(0);
    expect(sessionStore.destroy).not.toHaveBeenCalled();
  });
});
