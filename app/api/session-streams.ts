/**
 * Long-lived streams (SSE, the log WebSockets, the stats streams) authenticate
 * once, at connect, and then stay open. A session that is revoked afterwards
 * has no event to tell them, so whatever destroys sessions has to say so. The
 * streams live in modules that would be heavy and circular to import from the
 * session code, so they are tracked here and the session code calls this module
 * only.
 *
 * A stream that already keeps its own registry of open connections registers
 * one closer for all of them. A stream that keeps none tracks each connection
 * under the session that opened it and forgets it when it ends.
 *
 * Being told is the fast path. Under it is a floor: every session that holds a
 * stream is asked about again on a timer, so a session that ended without
 * anything saying so (a row deleted behind the store, a revocation whose
 * cleanup failed part-way) still loses its streams. The tracked streams are
 * asked about from here; the event stream asks from its own heartbeat.
 */
import logger from '../log/index.js';
import { getSession } from '../store/session.js';
import { getErrorMessage } from '../util/error.js';
import { SESSION_USER_KEY, validateSessionUser } from './session-principal.js';

export type SessionStreamCloser = (revokedSessionIds: ReadonlySet<string>) => number;

interface TrackedStream {
  close: () => void;
}

/** The pace of the event stream's heartbeat, so every kind of stream has the same floor. */
const SESSION_RECHECK_INTERVAL_MS = 15_000;

const closers = new Set<SessionStreamCloser>();
const streamsBySession = new Map<string, Set<TrackedStream>>();
let recheckTimer: ReturnType<typeof setInterval> | undefined;

function startRecheckingIfNeeded(): void {
  if (recheckTimer !== undefined) {
    return;
  }
  recheckTimer = setInterval(
    () => closeStreamsOfEndedSessions(streamsBySession.keys()),
    SESSION_RECHECK_INTERVAL_MS,
  );
  // The streams keep the process alive; asking about them must not.
  recheckTimer.unref();
}

function stopRecheckingIfIdle(): void {
  if (recheckTimer === undefined || streamsBySession.size > 0) {
    return;
  }
  clearInterval(recheckTimer);
  recheckTimer = undefined;
}

/** Register a closer for one kind of stream. Registering the same function twice is a no-op. */
export function registerSessionStreamCloser(closer: SessionStreamCloser): void {
  closers.add(closer);
}

/**
 * Track one open stream under the session that authenticated it, so ending the
 * session closes it. A stream that was not opened by a session (an API key, a
 * credential-less deployment) has no session id and is left alone.
 * @returns a function that forgets the stream, to call when it ends by itself
 */
export function trackSessionStream(sessionId: unknown, close: () => void): () => void {
  if (typeof sessionId !== 'string' || sessionId === '') {
    return () => {};
  }
  const stream: TrackedStream = { close };
  let streams = streamsBySession.get(sessionId);
  if (streams === undefined) {
    streams = new Set();
    streamsBySession.set(sessionId, streams);
  }
  streams.add(stream);
  startRecheckingIfNeeded();
  return () => {
    const held = streamsBySession.get(sessionId);
    held?.delete(stream);
    if (held?.size === 0) {
      streamsBySession.delete(sessionId);
    }
    stopRecheckingIfIdle();
  };
}

/** Track an open WebSocket; a revoked session closes it with a policy close. */
export function trackSessionSocket(
  sessionId: unknown,
  webSocket: { close: (code: number, reason: string) => void },
): () => void {
  return trackSessionStream(sessionId, () => webSocket.close(1008, 'Session revoked'));
}

// The session id is a credential, so the warning names the failure and not the session.
function warnOfFailedClose(error: unknown): void {
  logger
    .child({ component: 'api.session-streams' })
    .warn(`Failed to close a stream of a revoked session (${getErrorMessage(error)})`);
}

function closeTrackedStreams(revokedSessionIds: ReadonlySet<string>): number {
  let closed = 0;
  for (const sessionId of revokedSessionIds) {
    for (const stream of [...(streamsBySession.get(sessionId) ?? [])]) {
      try {
        stream.close();
        closed += 1;
      } catch (error: unknown) {
        warnOfFailedClose(error);
      }
    }
    // The session is gone for good, so nothing of it is kept: not a stream
    // that failed to close, and not one that never reports that it ended.
    streamsBySession.delete(sessionId);
  }
  stopRecheckingIfIdle();
  return closed;
}

/**
 * Close every open stream that authenticated with one of these sessions.
 *
 * Never throws. The callers are in the middle of ending a session, and a stream
 * that fails to close must not stop the session row from being deleted or the
 * remaining streams from being closed, so each failure is logged and skipped.
 * @returns how many streams were closed
 */
export function closeStreamsForRevokedSessions(revokedSessionIds: readonly string[]): number {
  if (revokedSessionIds.length === 0) {
    return 0;
  }
  const revoked = new Set(revokedSessionIds);
  let closed = closeTrackedStreams(revoked);
  for (const closer of closers) {
    try {
      closed += closer(revoked);
    } catch (error: unknown) {
      warnOfFailedClose(error);
    }
  }
  return closed;
}

/** The user a stored session payload holds, or undefined when it holds none or does not parse. */
function readStoredUser(data: string): unknown {
  try {
    const payload = JSON.parse(data) as Record<string, { user?: unknown } | undefined> | null;
    return payload?.[SESSION_USER_KEY]?.user;
  } catch {
    return undefined;
  }
}

/**
 * Would a request carrying this session id still be let in? Asked of the store
 * and not of what the stream saw at connect: the row has to be there, unexpired,
 * and holding a user the validator HTTP restoration and the WebSocket upgrade
 * use still accepts. Anything short of that is no, a store that cannot answer
 * included: that request would be refused too.
 */
function isSessionLive(sessionId: string, now: number): boolean {
  try {
    const row = getSession(sessionId);
    return (
      row !== undefined &&
      row.expiresAt > now &&
      validateSessionUser(readStoredUser(row.data)).status === 'valid'
    );
  } catch (error: unknown) {
    // The session id is a credential, so the warning names the failure and not the session.
    logger
      .child({ component: 'api.session-streams' })
      .warn(`Unable to read a session to re-check its streams (${getErrorMessage(error)})`);
    return false;
  }
}

/**
 * Close the streams of every one of these sessions that has ended since they
 * were opened. This is the floor under `closeStreamsForRevokedSessions`: it
 * runs on a timer for the tracked streams, and a stream that keeps a registry
 * of its own calls it with the sessions it holds.
 */
export function closeStreamsOfEndedSessions(sessionIds: Iterable<string>): void {
  const now = Date.now();
  // Copied first: closing removes entries from the map the ids may be read from.
  const ended = [...new Set(sessionIds)].filter((sessionId) => !isSessionLive(sessionId, now));
  closeStreamsForRevokedSessions(ended);
}
