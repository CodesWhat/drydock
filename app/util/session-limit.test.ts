import { enforceConcurrentSessionLimit } from './session-limit.js';

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
