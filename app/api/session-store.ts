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
 * already expired rather than serving it.
 */
import session from 'express-session';
import logger from '../log/index.js';
import * as sessionStore from '../store/session.js';

const log = logger.child({ component: 'api.session-store' });

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export interface SessionStoreOptions {
  /** Fallback session lifetime, milliseconds, used only when a session carries no parseable cookie expiry. */
  ttlMs?: number;
  /** How often the background sweep deletes expired rows. */
  sweepIntervalMs?: number;
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
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: SessionStoreOptions = {}) {
    super();
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.sweepTimer = setInterval(
      () => this.sweepExpiredNow(),
      options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS,
    );
    unref(this.sweepTimer);
  }

  /** Delete every expired row now, outside the timer's own schedule. Safe to call any time, including after stop(). */
  sweepExpiredNow(): number {
    const removed = sessionStore.sweepExpiredSessions();
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

  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    try {
      const row = sessionStore.getSession(sid);
      if (!row) {
        callback(null, null);
        return;
      }
      if (row.expiresAt <= Date.now()) {
        // Opportunistic sweep: an expired row read here is dropped rather than served.
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
      const expiresAt = resolveExpiresAt(sessionData, this.ttlMs);
      sessionStore.setSession(sid, expiresAt, JSON.stringify(sessionData));
      callback?.();
    } catch (error: unknown) {
      callback?.(error);
    }
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      sessionStore.destroySession(sid);
      callback?.();
    } catch (error: unknown) {
      callback?.(error);
    }
  }

  touch(sid: string, sessionData: session.SessionData, callback?: (err?: unknown) => void): void {
    try {
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
