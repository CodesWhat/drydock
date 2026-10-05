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
 */
import logger from '../log/index.js';
import { getErrorMessage } from '../util/error.js';

export type SessionStreamCloser = (revokedSessionIds: ReadonlySet<string>) => number;

interface TrackedStream {
  close: () => void;
}

const closers = new Set<SessionStreamCloser>();
const streamsBySession = new Map<string, Set<TrackedStream>>();

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
  return () => {
    const held = streamsBySession.get(sessionId);
    held?.delete(stream);
    if (held?.size === 0) {
      streamsBySession.delete(sessionId);
    }
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
  }
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
