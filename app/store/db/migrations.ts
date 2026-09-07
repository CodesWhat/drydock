/**
 * Versioned schema migrations for the v1.8 store (roadmap 7-STORE, slice 1).
 *
 * The runner is idempotent: it records every applied version in
 * `schema_migrations` and applies only the versions missing from that table, so
 * calling it on an already migrated database is a no-op. Each run happens in
 * one transaction, so a migration that throws part-way leaves the schema and
 * the bookkeeping row consistent with each other.
 */

import logger from '../../log/index.js';
import type { Database } from './driver.js';
import { INITIAL_SCHEMA_SQL, SCHEMA_MIGRATIONS_TABLE_SQL } from './schema.js';

const log = logger.child({ component: 'store.db' });

export interface Migration {
  /** Strictly increasing. Never reused, never reordered, never edited once shipped. */
  version: number;
  note: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    note: 'initial schema',
    sql: INITIAL_SCHEMA_SQL,
  },
  {
    version: 2,
    // findApprovalByOperationId (app/store/approval.ts) has always queried this
    // column; the initial schema (slice 1) shipped without an index for it,
    // deferred to slice 6, the point the approvals store actually moves onto
    // this table.
    note: 'index approvals.operation_id (roadmap 7-STORE slice 6)',
    sql: 'CREATE INDEX approvals_operation_id ON approvals(operation_id);',
  },
  {
    version: 3,
    // Eviction in app/store/container.ts reads Map insertion order as its
    // LRU for both caches, but a SELECT with no ORDER BY does not reproduce
    // that order across a restart, and an upsert (ON CONFLICT DO UPDATE)
    // never moves a row's rowid — so a just-refreshed entry could resurface
    // ahead of the row it should have outlived (roadmap 7-STORE slice 7
    // review fix). refresh_order is a monotonic counter each store module
    // bumps on every insert/refresh; rehydration orders by it instead of by
    // document order or expires_at, which only ever approximated refresh
    // order and ties on equal timestamps.
    note: 'add refresh_order to the lifecycle/retention caches for eviction-order fidelity (roadmap 7-STORE slice 7)',
    sql: `
ALTER TABLE update_lifecycle_cache ADD COLUMN refresh_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE update_policy_retention_cache ADD COLUMN refresh_order INTEGER NOT NULL DEFAULT 0;
`,
  },
];

/** Versions already recorded in `schema_migrations`, ascending. */
export function getAppliedSchemaVersions(db: Database): number[] {
  db.exec(SCHEMA_MIGRATIONS_TABLE_SQL);
  return db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => Number(row.version));
}

/**
 * Bring `db` up to the latest schema version. Returns the versions applied by
 * this call, so a second call on the same database returns an empty array.
 */
export function migrate(db: Database, migrations: readonly Migration[] = MIGRATIONS): number[] {
  const applied = new Set(getAppliedSchemaVersions(db));
  const pending = [...migrations]
    .sort((first, second) => first.version - second.version)
    .filter((migration) => !applied.has(migration.version));
  if (pending.length === 0) {
    return [];
  }

  return db.transaction(() => {
    const record = db.prepare(
      'INSERT INTO schema_migrations (version, applied_at, note) VALUES (?, ?, ?)',
    );
    const appliedAt = new Date().toISOString();
    const versions: number[] = [];
    for (const migration of pending) {
      db.exec(migration.sql);
      record.run(migration.version, appliedAt, migration.note);
      versions.push(migration.version);
      log.info(`Applied store schema migration ${migration.version} (${migration.note})`);
    }
    return versions;
  });
}
