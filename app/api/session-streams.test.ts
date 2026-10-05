const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock('../log/index.js', () => ({ default: { child: () => ({ warn: mockWarn }) } }));

type SessionStreams = typeof import('./session-streams.js');

let closeStreamsForRevokedSessions: SessionStreams['closeStreamsForRevokedSessions'];
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
});
