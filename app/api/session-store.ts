/**
 * express-session `Store` over the shared SQLite database (roadmap 7-STORE,
 * slice 11), replacing the pre-1.8 session store package.
 *
 * The pre-1.8 session store opened its own, independent database instance on
 * the exact file the main store already had open (DR-121, spec section 1.4).
 * That legacy engine always serialized the whole in-memory database on save,
 * so whichever instance saved last erased the other's writes. This store
 * reads and writes the `sessions` table through `app/store/session.ts`, the
 * same database every other collection now lives in, so there is exactly one
 * writer and the clobber cannot recur.
 *
 * Expiry: `set()`/`touch()` derive `expires_at` from the session's own
 * `cookie.expires` (the same field express-session's cookie serializer
 * always populates once a `maxAge` is configured), falling back to `ttlMs`
 * only for a session that somehow carries neither. A background sweep timer,
 * unref'd so it never keeps the process alive on its own, deletes expired
 * rows on an interval; `get()` also opportunistically deletes a row it finds
 * already expired rather than serving it. Either way the streams the session
 * opened are closed with it, as they are when it is destroyed.
 */
import session from 'express-session';
import logger from '../log/index.js';
import * as sessionStore from '../store/session.js';
import { closeStreamsForRevokedSessions } from './session-streams.js';

const log = logger.child({ component: 'api.session-store' });

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
// A destroyed sid only needs refusing for as long as a request that was
// already running can still finish and try to save it.
const DEFAULT_TOMBSTONE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_TOMBSTONES = 10_000;

export interface SessionStoreOptions {
  /** Fallback session lifetime, milliseconds, used only when a session carries no parseable cookie expiry. */
  ttlMs?: number;
  /** How often the background sweep deletes expired rows. */
  sweepIntervalMs?: number;
  /** How long a destroyed sid is refused a write, milliseconds. */
  tombstoneTtlMs?: number;
  /** The most destroyed sids remembered at once; the oldest is forgotten first. */
  maxTombstones?: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveExpiresAt(sessionData: session.SessionData, ttlMs: number): number {
  const cookie = (sessionData as unknown as Record<string, unknown>).cookie;
  const expires = isPlainRecord(cookie) ? cookie.expires : undefined;
  if (expires instanceof Date && !Number.isNaN(expires.getTime())) {
    return expires.getTime();
  }
  if (typeof expires === 'string') {
    const parsed = Date.parse(expires);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now() + ttlMs;
}

function unref(timer: ReturnType<typeof setInterval>): void {
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
}

export class SessionStore extends session.Store {
  private readonly ttlMs: number;
  private readonly tombstoneTtlMs: number;
  private readonly maxTombstones: number;
  /**
   * Destroyed sid to the instant it stops being refused. A request that loaded
   * a session before it was destroyed saves it again when it finishes, and
   * `set()` is an upsert, so without this a logout, an eviction or a recovery
   * revocation is undone by whoever was mid-request. Every entry lives the same
   * time, so insertion order is expiry order and the front is always oldest.
   */
  private readonly tombstones = new Map<string, number>();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: SessionStoreOptions = {}) {
    super();
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.tombstoneTtlMs = options.tombstoneTtlMs ?? DEFAULT_TOMBSTONE_TTL_MS;
    this.maxTombstones = options.maxTombstones ?? DEFAULT_MAX_TOMBSTONES;
    this.sweepTimer = setInterval(
      () => this.sweepExpiredNow(),
      options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS,
    );
    unref(this.sweepTimer);
  }

  /**
   * Delete every expired row now, outside the timer's own schedule. Safe to call any time, including after stop().
   *
   * An expired session ends the way a destroyed one does, so its streams are
   * closed first, for the same reason `destroy()` closes them first. Both
   * statements read the one instant, so the rows deleted are the rows whose
   * streams were told.
   */
  sweepExpiredNow(): number {
    const now = Date.now();
    closeStreamsForRevokedSessions(sessionStore.listExpiredSessionIds(now));
    const removed = sessionStore.sweepExpiredSessions(now);
    if (removed > 0) {
      log.debug(`Swept ${removed} expired session(s)`);
    }
    return removed;
  }

  /** Stop the background sweep timer. Idempotent; call on shutdown or when replacing the store in tests. */
  stop(): void {
    if (this.sweepTimer !== undefined) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  private isDestroyed(sid: string): boolean {
    const now = Date.now();
    for (const [tombstoned, until] of this.tombstones) {
      if (until > now) {
        break;
      }
      this.tombstones.delete(tombstoned);
    }
    return this.tombstones.has(sid);
  }

  private bury(sid: string): void {
    this.tombstones.delete(sid);
    this.tombstones.set(sid, Date.now() + this.tombstoneTtlMs);
    while (this.tombstones.size > this.maxTombstones) {
      const oldest = this.tombstones.keys().next().value as string;
      this.tombstones.delete(oldest);
    }
  }

  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    try {
      const row = sessionStore.getSession(sid);
      if (!row) {
        callback(null, null);
        return;
      }
      if (row.expiresAt <= Date.now()) {
        // Opportunistic sweep: an expired row read here is dropped rather than
        // served, and the streams it opened close with it.
        closeStreamsForRevokedSessions([sid]);
        sessionStore.destroySession(sid);
        callback(null, null);
        return;
      }
      callback(null, JSON.parse(row.data) as session.SessionData);
    } catch (error: unknown) {
      callback(error);
    }
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: unknown) => void): void {
    try {
      if (this.isDestroyed(sid)) {
        callback?.();
        return;
      }
      const expiresAt = resolveExpiresAt(sessionData, this.ttlMs);
      sessionStore.setSession(sid, expiresAt, JSON.stringify(sessionData));
      callback?.();
    } catch (error: unknown) {
      callback?.(error);
    }
  }

  /**
   * Every way a session ends early comes through here: a logout, an eviction,
   * a revocation, and the old id express-session drops when it regenerates. A
   * stream authenticated once with that id and never reads the store again, so
   * this is where it is told, and before the row goes so that a delete that
   * fails still closes it. Closing never throws (a stream that fails to close
   * is logged there), so nothing a stream does can keep the row alive.
   */
  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      this.bury(sid);
      closeStreamsForRevokedSessions([sid]);
      sessionStore.destroySession(sid);
      callback?.();
    } catch (error: unknown) {
      callback?.(error);
    }
  }

  touch(sid: string, sessionData: session.SessionData, callback?: (err?: unknown) => void): void {
    try {
      if (this.isDestroyed(sid)) {
        callback?.();
        return;
      }
      const expiresAt = resolveExpiresAt(sessionData, this.ttlMs);
      sessionStore.touchSession(sid, expiresAt);
      callback?.();
    } catch (error: unknown) {
      log.warn(`Failed to touch session ${sid}: ${String(error)}`);
      callback?.(error);
    }
  }

  all(
    callback: (
      err: unknown,
      obj?: session.SessionData[] | { [sid: string]: session.SessionData } | null,
    ) => void,
  ): void {
    try {
      const now = Date.now();
      const sessions: { [sid: string]: session.SessionData } = {};
      for (const row of sessionStore.listSessions()) {
        if (row.expiresAt > now) {
          sessions[row.sid] = JSON.parse(row.data) as session.SessionData;
        }
      }
      callback(null, sessions);
    } catch (error: unknown) {
      callback(error);
    }
  }

  length(callback: (err: unknown, length?: number) => void): void {
    try {
      callback(null, sessionStore.countSessions());
    } catch (error: unknown) {
      callback(error);
    }
  }

  clear(callback?: (err?: unknown) => void): void {
    try {
      sessionStore.clearSessions();
      callback?.();
    } catch (error: unknown) {
      callback?.(error);
    }
  }
}
