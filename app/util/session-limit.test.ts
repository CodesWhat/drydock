const { mockHasEnrolledUsername } = vi.hoisted(() => ({ mockHasEnrolledUsername: vi.fn() }));

vi.mock('../store/totp.js', () => ({
  getSubjectVersion: vi.fn(() => 0),
  getFactorBySubject: vi.fn(),
  hasEnrolledUsername: mockHasEnrolledUsername,
}));

vi.mock('../log/index.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { deriveSubjectId } from '../api/totp-identity.js';
import { enforceConcurrentSessionLimit } from './session-limit.js';

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
