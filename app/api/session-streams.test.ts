import { closeStreamsForRevokedSessions, registerSessionStreamCloser } from './session-streams.js';

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
