/**
 * Express-session storage.
 *
 * Backed by the `sessions` table (roadmap 7-STORE, slice 11), which replaces
 * the pre-1.8 session store's second, independent database instance — the
 * one that used to open the exact file the main store already had open
 * (DR-121, spec section 1.4's mutual clobber: that legacy engine always
 * serialized the whole in-memory database on save, so whichever of the two
 * instances saved last erased the other's writes). There is now exactly one
 * writer for exactly one database, so that hazard cannot recur.
 *
 * `app/api/session-store.ts` is the express-session `Store` adapter over
 * these functions; this module owns the table the same way every other
 * `app/store/*.ts` module owns its own.
 */
import type { Database, Row } from './db/driver.js';

export interface SessionRow {
  sid: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** The express-session payload, serialized to JSON by the caller. */
  data: string;
}

let db: Database | undefined;

/**
 * Wire the sessions store to the shared SQLite database. Schema creation is
 * the migration runner's job; this only captures the handle.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
}

function rowToSessionRow(row: Row): SessionRow {
  return {
    sid: String(row.sid),
    expiresAt: Number(row.expires_at),
    data: String(row.data),
  };
}

export function getSession(sid: string): SessionRow | undefined {
  if (!db) {
    return undefined;
  }
  const row = db.prepare('SELECT sid, expires_at, data FROM sessions WHERE sid = ?').get(sid);
  return row ? rowToSessionRow(row) : undefined;
}

/** Upsert a session. Idempotent on `sid`. */
export function setSession(sid: string, expiresAt: number, data: string): void {
  if (!db) {
    return;
  }
  db.prepare(
    `INSERT INTO sessions (sid, expires_at, data) VALUES (?, ?, ?)
     ON CONFLICT(sid) DO UPDATE SET expires_at = excluded.expires_at, data = excluded.data`,
  ).run(sid, expiresAt, data);
}

/** Refresh a session's expiry without touching its payload. Returns false when the sid is unknown. */
export function touchSession(sid: string, expiresAt: number): boolean {
  if (!db) {
    return false;
  }
  const result = db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(expiresAt, sid);
  return result.changes > 0;
}

export function destroySession(sid: string): void {
  if (!db) {
    return;
  }
  db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
}

export function listSessions(): SessionRow[] {
  if (!db) {
    return [];
  }
  return db.prepare('SELECT sid, expires_at, data FROM sessions').all().map(rowToSessionRow);
}

export function countSessions(): number {
  if (!db) {
    return 0;
  }
  // COUNT(*) always returns exactly one row with a numeric count, even when
  // the table is empty, so there is no undefined-row case to fall back from.
  const row = db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as Row;
  return Number(row.count);
}

export function clearSessions(): void {
  if (!db) {
    return;
  }
  db.prepare('DELETE FROM sessions').run();
}

/** Delete every session whose expiry is at or before `now`. Returns the count removed. */
export function sweepExpiredSessions(now: number = Date.now()): number {
  if (!db) {
    return 0;
  }
  const result = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  return result.changes;
}
