/**
 * Long-lived streams (SSE, the log WebSocket) authenticate once, at connect,
 * and then stay open. A session that is revoked afterwards has no event to tell
 * them, so whatever destroys sessions has to say so. The streams live in
 * modules that would be heavy and circular to import from the session code, so
 * each registers one closer here and the session code calls this module only.
 */

export type SessionStreamCloser = (revokedSessionIds: ReadonlySet<string>) => number;

const closers = new Set<SessionStreamCloser>();

/** Register a closer for one kind of stream. Registering the same function twice is a no-op. */
export function registerSessionStreamCloser(closer: SessionStreamCloser): void {
  closers.add(closer);
}

/**
 * Close every open stream that authenticated with one of these sessions.
 * @returns how many streams were closed
 */
export function closeStreamsForRevokedSessions(revokedSessionIds: readonly string[]): number {
  if (revokedSessionIds.length === 0) {
    return 0;
  }
  const revoked = new Set(revokedSessionIds);
  let closed = 0;
  for (const closer of closers) {
    closed += closer(revoked);
  }
  return closed;
}
