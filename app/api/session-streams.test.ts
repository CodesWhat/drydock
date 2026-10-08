const { mockWarn, mockGetSession, mockCheckSessionIdentity } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
  mockGetSession: vi.fn(),
  mockCheckSessionIdentity: vi.fn(),
}));

vi.mock('../log/index.js', () => ({ default: { child: () => ({ warn: mockWarn }) } }));
vi.mock('../store/session.js', () => ({ getSession: mockGetSession }));
vi.mock('./totp-identity.js', () => ({ checkSessionIdentity: mockCheckSessionIdentity }));

type SessionStreams = typeof import('./session-streams.js');

let closeStreamsForRevokedSessions: SessionStreams['closeStreamsForRevokedSessions'];
let createSessionStreamRecheck: SessionStreams['createSessionStreamRecheck'];
let registerSessionStreamCloser: SessionStreams['registerSessionStreamCloser'];
let trackSessionSocket: SessionStreams['trackSessionSocket'];
let trackSessionStream: SessionStreams['trackSessionStream'];

// The registry is module state, so each test gets a module of its own and one
// test's closers never answer for another's.
beforeEach(async () => {
  vi.resetModules();
  mockWarn.mockClear();
  ({
    closeStreamsForRevokedSessions,
    createSessionStreamRecheck,
    registerSessionStreamCloser,
    trackSessionSocket,
    trackSessionStream,
  } = await import('./session-streams.js'));
});

describe('session streams', () => {
  test('asks every registered closer and adds up what they closed', () => {
    const sse = vi.fn(() => 2);
    const logs = vi.fn(() => 1);
    registerSessionStreamCloser(sse);
    registerSessionStreamCloser(logs);

    expect(closeStreamsForRevokedSessions(['a', 'b'])).toBe(3);

    expect(sse).toHaveBeenCalledWith(new Set(['a', 'b']));
    expect(logs).toHaveBeenCalledWith(new Set(['a', 'b']));
  });

  test('registering a closer twice does not double-count it', () => {
    const closer = vi.fn(() => 1);
    registerSessionStreamCloser(closer);
    registerSessionStreamCloser(closer);

    closeStreamsForRevokedSessions(['a']);

    expect(closer).toHaveBeenCalledTimes(1);
  });

  test('an empty revocation closes nothing and calls nobody', () => {
    const closer = vi.fn(() => 5);
    registerSessionStreamCloser(closer);

    expect(closeStreamsForRevokedSessions([])).toBe(0);
    expect(closer).not.toHaveBeenCalled();
  });
});

describe('streams tracked by the session that opened them', () => {
  test('ending the session closes its streams and no other session’s', () => {
    const mine = vi.fn();
    const alsoMine = vi.fn();
    const theirs = vi.fn();
    const forget = [
      trackSessionStream('tracked-a', mine),
      trackSessionStream('tracked-a', alsoMine),
      trackSessionStream('tracked-b', theirs),
    ];

    expect(closeStreamsForRevokedSessions(['tracked-a'])).toBe(2);

    expect(mine).toHaveBeenCalledTimes(1);
    expect(alsoMine).toHaveBeenCalledTimes(1);
    expect(theirs).not.toHaveBeenCalled();
    for (const release of forget) {
      release();
    }
  });

  test('a stream that ended on its own is forgotten, so a later revocation finds nothing', () => {
    const first = vi.fn();
    const second = vi.fn();
    const forgetFirst = trackSessionStream('tracked-c', first);
    const forgetSecond = trackSessionStream('tracked-c', second);

    forgetFirst();
    expect(closeStreamsForRevokedSessions(['tracked-c'])).toBe(1);
    expect(first).not.toHaveBeenCalled();

    forgetSecond();
    forgetSecond();
    expect(closeStreamsForRevokedSessions(['tracked-c'])).toBe(0);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test.each([[undefined], [''], [42]])(
    'a stream with no session id of its own (%j) is not tracked',
    (sessionId) => {
      const close = vi.fn();
      const forget = trackSessionStream(sessionId, close);

      expect(closeStreamsForRevokedSessions(['', 'undefined', '42'])).toBe(0);
      expect(close).not.toHaveBeenCalled();
      expect(() => forget()).not.toThrow();
    },
  );

  test('a socket is closed with a policy close', () => {
    const webSocket = { close: vi.fn() };
    const forget = trackSessionSocket('tracked-socket', webSocket);

    expect(closeStreamsForRevokedSessions(['tracked-socket'])).toBe(1);

    expect(webSocket.close).toHaveBeenCalledWith(1008, 'Session revoked');
    forget();
  });
});

describe('a closer that throws', () => {
  test('is logged and does not stop the others, and the call itself never throws', () => {
    const before = vi.fn(() => 1);
    const failing = vi.fn(() => {
      throw new Error('socket already gone');
    });
    const after = vi.fn(() => 2);
    registerSessionStreamCloser(before);
    registerSessionStreamCloser(failing);
    registerSessionStreamCloser(after);

    expect(closeStreamsForRevokedSessions(['throwing-closer'])).toBe(3);

    expect(before).toHaveBeenCalled();
    expect(after).toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('socket already gone'));
  });

  test('one tracked stream failing to close does not leave the session’s other streams open', () => {
    const failing = vi.fn(() => {
      throw new Error('destroy failed');
    });
    const other = vi.fn();
    const forget = [
      trackSessionStream('throwing-stream', failing),
      trackSessionStream('throwing-stream', other),
    ];

    expect(closeStreamsForRevokedSessions(['throwing-stream'])).toBe(1);

    expect(other).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('destroy failed'));
    // The id it failed for is not written to the log.
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('throwing-stream');
    for (const release of forget) {
      release();
    }
  });

  test('a stream that never says it ended is not kept once its session is gone', () => {
    // Neither stream calls the function that forgets it: one throws while
    // closing, the other closes and stays silent.
    const failing = vi.fn(() => {
      throw new Error('destroy failed');
    });
    const silent = vi.fn();
    trackSessionStream('ended-session', failing);
    trackSessionStream('ended-session', silent);

    expect(closeStreamsForRevokedSessions(['ended-session'])).toBe(1);
    expect(closeStreamsForRevokedSessions(['ended-session'])).toBe(0);

    expect(failing).toHaveBeenCalledTimes(1);
    expect(silent).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });
});

describe('the sessions that hold a stream are asked about again', () => {
  const RECHECK_INTERVAL_MS = 15_000;

  /** The row express-session keeps for a signed-in session. */
  function storedSession(sid: string, user: unknown = { username: 'scott' }) {
    return {
      sid,
      expiresAt: Date.now() + 60_000,
      data: JSON.stringify({ cookie: {}, passport: { user: JSON.stringify(user) } }),
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    mockGetSession.mockReset();
    mockGetSession.mockImplementation((sid: string) => storedSession(sid));
    mockCheckSessionIdentity.mockReset();
    mockCheckSessionIdentity.mockReturnValue('valid');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('a stream whose session is still good stays open, however long it has been', () => {
    const close = vi.fn();
    const forget = trackSessionStream('still-good', close);

    vi.advanceTimersByTime(RECHECK_INTERVAL_MS * 10);

    expect(close).not.toHaveBeenCalled();
    expect(mockGetSession).toHaveBeenCalledTimes(10);
    // The validator sees the user the row holds, not something kept from connect.
    expect(mockCheckSessionIdentity).toHaveBeenLastCalledWith({ username: 'scott' });
    forget();
  });

  test('a session that holds nothing but a tracked stream is closed once its row is gone', () => {
    const stream = vi.fn();
    const webSocket = { close: vi.fn() };
    trackSessionStream('row-gone', stream);
    trackSessionSocket('row-gone', webSocket);
    const kept = vi.fn();
    const forgetKept = trackSessionStream('row-kept', kept);
    mockGetSession.mockImplementation((sid: string) =>
      sid === 'row-gone' ? undefined : storedSession(sid),
    );

    vi.advanceTimersByTime(RECHECK_INTERVAL_MS - 1);
    expect(stream).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(stream).toHaveBeenCalledTimes(1);
    expect(webSocket.close).toHaveBeenCalledWith(1008, 'Session revoked');
    expect(kept).not.toHaveBeenCalled();
    // The identity was never the question: there is no row to hold one.
    expect(mockCheckSessionIdentity).toHaveBeenCalledTimes(1);
    forgetKept();
  });

  test.each([
    ['has expired', (sid: string) => ({ ...storedSession(sid), expiresAt: Date.now() })],
    ['holds no user', (sid: string) => ({ ...storedSession(sid), data: '{"cookie":{}}' })],
    ['holds nothing at all', (sid: string) => ({ ...storedSession(sid), data: 'null' })],
    ['does not parse', (sid: string) => ({ ...storedSession(sid), data: '{not json' })],
    ['holds a user that does not deserialize', (sid: string) => storedSession(sid, { v: 9 })],
  ])('a session whose row %s is closed without the validator being asked', (_name, row) => {
    const close = vi.fn();
    trackSessionStream('bad-row', close);
    mockGetSession.mockImplementation(row);

    vi.advanceTimersByTime(RECHECK_INTERVAL_MS);

    expect(close).toHaveBeenCalledTimes(1);
    expect(mockCheckSessionIdentity).not.toHaveBeenCalled();
  });

  test('a session the validator reads as stale is closed at the next re-check, and no other', () => {
    const gone = vi.fn();
    const kept = vi.fn();
    trackSessionStream('gone', gone);
    const forgetKept = trackSessionStream('kept', kept);
    mockGetSession.mockImplementation((sid: string) => storedSession(sid, { username: sid }));
    mockCheckSessionIdentity.mockImplementation((user: { username: string }) =>
      user.username === 'gone' ? 'stale' : 'valid',
    );

    vi.advanceTimersByTime(RECHECK_INTERVAL_MS);

    expect(gone).toHaveBeenCalledTimes(1);
    expect(kept).not.toHaveBeenCalled();
    forgetKept();
  });

  describe('when the store cannot answer', () => {
    /** The two ways a re-check goes unanswered: the validator's store read fails, or the row's does. */
    const faults: Array<[string, () => void, () => void]> = [
      [
        'the validator cannot read the factor store',
        () => mockCheckSessionIdentity.mockReturnValue('unavailable'),
        () => mockCheckSessionIdentity.mockReturnValue('valid'),
      ],
      [
        'the session row cannot be read',
        () =>
          mockGetSession.mockImplementation(() => {
            throw new Error('database is locked');
          }),
        () => mockGetSession.mockImplementation((sid: string) => storedSession(sid)),
      ],
    ];

    test.each(faults)(
      'a fault that passes leaves the stream open (%s)',
      (_name, breakStore, mendStore) => {
        const close = vi.fn();
        const forget = trackSessionStream('waited-for', close);

        breakStore();
        vi.advanceTimersByTime(RECHECK_INTERVAL_MS * 3);
        expect(close).not.toHaveBeenCalled();

        mendStore();
        vi.advanceTimersByTime(RECHECK_INTERVAL_MS);
        expect(close).not.toHaveBeenCalled();

        // The wait starts over: three more unanswered re-checks are waited out again.
        breakStore();
        vi.advanceTimersByTime(RECHECK_INTERVAL_MS * 3);
        expect(close).not.toHaveBeenCalled();
        mendStore();
        forget();
      },
    );

    test.each(faults)(
      'a fault that lasts closes the stream on the fourth unanswered re-check (%s)',
      (_name, breakStore) => {
        const close = vi.fn();
        trackSessionStream('given-up-on', close);
        breakStore();

        vi.advanceTimersByTime(RECHECK_INTERVAL_MS * 3);
        expect(close).not.toHaveBeenCalled();

        vi.advanceTimersByTime(RECHECK_INTERVAL_MS);
        expect(close).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    test('a row that cannot be read is logged without the session id', () => {
      trackSessionStream('unreadable-session', vi.fn());
      mockGetSession.mockImplementation(() => {
        throw new Error('database is locked');
      });

      vi.advanceTimersByTime(RECHECK_INTERVAL_MS * 4);

      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('database is locked'));
      expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('unreadable-session');
    });

    test('a session that is known to have ended is not waited for', () => {
      const close = vi.fn();
      trackSessionStream('ended-meanwhile', close);
      mockCheckSessionIdentity.mockReturnValue('unavailable');
      vi.advanceTimersByTime(RECHECK_INTERVAL_MS * 2);
      expect(close).not.toHaveBeenCalled();

      // The store answers again, and the answer is that the row is gone.
      mockGetSession.mockReturnValue(undefined);
      vi.advanceTimersByTime(RECHECK_INTERVAL_MS);

      expect(close).toHaveBeenCalledTimes(1);
    });

    test('each session waits on its own count', () => {
      const early = vi.fn();
      const late = vi.fn();
      const answered = vi.fn();
      trackSessionStream('early', early);
      const forgetAnswered = trackSessionStream('answered', answered);
      mockGetSession.mockImplementation((sid: string) => storedSession(sid, { username: sid }));
      mockCheckSessionIdentity.mockImplementation((user: { username: string }) =>
        user.username === 'answered' ? 'valid' : 'unavailable',
      );

      vi.advanceTimersByTime(RECHECK_INTERVAL_MS * 2);
      trackSessionStream('late', late);
      vi.advanceTimersByTime(RECHECK_INTERVAL_MS * 2);

      expect(early).toHaveBeenCalledTimes(1);
      expect(late).not.toHaveBeenCalled();
      expect(answered).not.toHaveBeenCalled();

      vi.advanceTimersByTime(RECHECK_INTERVAL_MS * 2);
      expect(late).toHaveBeenCalledTimes(1);
      expect(answered).not.toHaveBeenCalled();
      forgetAnswered();
    });

    test('a count does not outlive the timer that kept it', () => {
      const first = vi.fn();
      const second = vi.fn();
      mockCheckSessionIdentity.mockReturnValue('unavailable');
      const forgetFirst = trackSessionStream('came-back-later', first);
      vi.advanceTimersByTime(RECHECK_INTERVAL_MS * 3);
      // The last stream goes, and the asking stops with it.
      forgetFirst();
      expect(vi.getTimerCount()).toBe(0);

      trackSessionStream('came-back-later', second);
      vi.advanceTimersByTime(RECHECK_INTERVAL_MS * 3);
      expect(second).not.toHaveBeenCalled();

      vi.advanceTimersByTime(RECHECK_INTERVAL_MS);
      expect(second).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
    });

    test('a session that stopped being asked about is not remembered when it holds a stream again', () => {
      const first = vi.fn();
      const second = vi.fn();
      const other = vi.fn();
      // Another session keeps the re-check running throughout.
      const forgetOther = trackSessionStream('other', other);
      mockGetSession.mockImplementation((sid: string) => storedSession(sid, { username: sid }));
      mockCheckSessionIdentity.mockImplementation((user: { username: string }) =>
        user.username === 'other' ? 'valid' : 'unavailable',
      );
      const forgetFirst = trackSessionStream('came-back', first);
      vi.advanceTimersByTime(RECHECK_INTERVAL_MS * 3);
      forgetFirst();
      vi.advanceTimersByTime(RECHECK_INTERVAL_MS);

      trackSessionStream('came-back', second);
      vi.advanceTimersByTime(RECHECK_INTERVAL_MS * 3);
      expect(second).not.toHaveBeenCalled();

      vi.advanceTimersByTime(RECHECK_INTERVAL_MS);
      expect(second).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
      forgetOther();
    });
  });

  test('nothing is asked once the last stream has gone, and asking starts again with the next', () => {
    const forgetFirst = trackSessionStream('first', vi.fn());
    const forgetSecond = trackSessionStream('second', vi.fn());
    forgetFirst();
    vi.advanceTimersByTime(RECHECK_INTERVAL_MS);
    expect(mockGetSession.mock.calls).toEqual([['second']]);

    forgetSecond();
    mockGetSession.mockClear();
    vi.advanceTimersByTime(RECHECK_INTERVAL_MS * 3);
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    const forgetThird = trackSessionStream('third', vi.fn());
    vi.advanceTimersByTime(RECHECK_INTERVAL_MS);
    expect(mockGetSession.mock.calls).toEqual([['third']]);
    forgetThird();
  });

  test('revoking the last session that held a stream stops the asking too', () => {
    trackSessionStream('revoked', vi.fn());

    closeStreamsForRevokedSessions(['revoked']);

    expect(vi.getTimerCount()).toBe(0);
  });

  test('a stream kept in a registry of its own is asked about by id, once per session', () => {
    const closer = vi.fn(() => 1);
    registerSessionStreamCloser(closer);
    mockGetSession.mockImplementation((sid: string) =>
      sid === 'registry-gone' ? undefined : storedSession(sid),
    );

    createSessionStreamRecheck()(['registry-kept', 'registry-gone', 'registry-gone']);

    expect(mockGetSession).toHaveBeenCalledTimes(2);
    expect(closer).toHaveBeenCalledTimes(1);
    expect(closer).toHaveBeenCalledWith(new Set(['registry-gone']));
  });

  test('when every session asked about is still good, no closer is called', () => {
    const closer = vi.fn(() => 1);
    registerSessionStreamCloser(closer);

    createSessionStreamRecheck()(['registry-kept']);

    expect(closer).not.toHaveBeenCalled();
  });

  test('a registry’s re-check waits out an unanswering store on its own count, then closes', () => {
    const closer = vi.fn(() => 1);
    registerSessionStreamCloser(closer);
    mockCheckSessionIdentity.mockReturnValue('unavailable');
    const recheck = createSessionStreamRecheck();
    const elsewhere = createSessionStreamRecheck();

    recheck(['registry-unanswered']);
    recheck(['registry-unanswered']);
    recheck(['registry-unanswered']);
    // Another asker's count is not this one's.
    elsewhere(['registry-unanswered']);
    expect(closer).not.toHaveBeenCalled();

    recheck(['registry-unanswered']);
    expect(closer).toHaveBeenCalledTimes(1);
    expect(closer).toHaveBeenCalledWith(new Set(['registry-unanswered']));
  });
});
