/**
 * Importer for `sessions` (roadmap 7-STORE slice 11).
 *
 * `dd.json`'s (or DR-121's `dd-sessions.json`'s) `Sessions` collection is the
 * pre-1.8 session store's own record shape: `{ sid, content, updatedAt }`,
 * where `content` is the express-session payload express-session itself
 * already serialized. `app/api/session-store.ts`, the SQLite-backed `Store`
 * that replaces it, stores exactly that payload in `sessions.data` and keys
 * expiry off `sessions.expires_at`, so this importer derives `expires_at`
 * from `content.cookie.expires` the same way a fresh `set()` would.
 *
 * A document with no parseable expiry, or one already in the past, cannot be
 * carried forward with a meaningful TTL and is skipped — the same convention
 * every other importer follows for a document missing a field a row cannot
 * exist without. Skipping an expired session costs nothing: the user it
 * belonged to re-authenticates once, same as if the session had never been
 * imported at all.
 *
 * `resolveLegacySessionDocuments()` (`app/store/db/loki-json.ts`) has already
 * picked the right source file for these documents — DR-121's sibling
 * sessions file when present, `dd.json`'s own `Sessions` collection
 * otherwise — so this importer reads `ImportContext.sessionDocuments` rather
 * than `snapshot.documents()` directly.
 */
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'Sessions';
const TARGET_TABLE = 'sessions';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Mirrors app/api/session-store.ts's resolveExpiresAt for the on-disk cookie shape. */
function resolveExpiresAt(content: Record<string, unknown>): number | undefined {
  const cookie = content.cookie;
  if (!isPlainRecord(cookie)) {
    return undefined;
  }
  const expires = cookie.expires;
  if (typeof expires !== 'string') {
    return undefined;
  }
  const parsed = Date.parse(expires);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export const sessionsImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, sessionDocuments }: ImportContext): number {
    const insert = db.prepare('INSERT INTO sessions (sid, expires_at, data) VALUES (?, ?, ?)');
    const now = Date.now();
    let rows = 0;
    for (const doc of sessionDocuments) {
      if (typeof doc.sid !== 'string' || doc.sid.length === 0 || !isPlainRecord(doc.content)) {
        continue;
      }
      const expiresAt = resolveExpiresAt(doc.content);
      if (expiresAt === undefined || expiresAt < now) {
        continue;
      }
      insert.run(doc.sid, expiresAt, JSON.stringify(doc.content));
      rows += 1;
    }
    return rows;
  },
};
