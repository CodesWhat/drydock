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
import { INITIAL_SCHEMA_SQL, SCHEMA_MIGRATIONS_TABLE_SQL, TOTP_TABLES_SQL } from './schema.js';

const log = logger.child({ component: 'store.db' });

export interface Migration {
  /** Strictly increasing. Never reused, never reordered, never edited once shipped. */
  version: number;
  note: string;
  sql: string;
}

/**
 * Spec 7.3 group policies. Named so the tests reference the number through this one
 * constant: a branch that lands another migration first renumbers this line only.
 */
export const GROUP_POLICIES_MIGRATION_VERSION = 8;

/** Spec 7.5 label-owned overrides. Always one past the group policies migration. */
export const LABEL_OVERRIDES_MIGRATION_VERSION = 9;

/** Spec 11.1.2 TOTP: factor, enrollment, recovery code and subject version tables. */
export const TOTP_MIGRATION_VERSION = 10;

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
  {
    version: 4,
    // The initial schema (slice 1) planned the containers table ahead of the
    // collection actually moving onto it, and missed two Container fields
    // that are neither queried/filtered/sorted/patched (so a promoted column)
    // nor part of an existing grouped JSON column: `sourceRepo` (a plain
    // string) and `currentReleaseNotes` (a ContainerReleaseNotes object).
    // Both are nullable, so a plain ADD COLUMN needs no backfill.
    note: 'add containers.source_repo and containers.current_release_notes (roadmap 7-STORE slice 8)',
    sql: `
ALTER TABLE containers ADD COLUMN source_repo TEXT;
ALTER TABLE containers ADD COLUMN current_release_notes TEXT;
`,
  },
  {
    version: 5,
    // #1280: replicas of one compose service share the identity key a stash is
    // written under, so the key alone cannot say which replica the stashed policy
    // came from. The canonical container name tells them apart. It is a column
    // rather than part of update_policy_overrides because that column is an opaque
    // policy blob (spec section 2.1, rule 2) applied to the replacement as-is.
    // Nullable: rows written before this migration have no name, which
    // app/store/container.ts reads as a legacy entry.
    note: 'add update_policy_retention_cache.container_name (#1280)',
    sql: 'ALTER TABLE update_policy_retention_cache ADD COLUMN container_name TEXT;',
  },
  {
    version: 6,
    // #1280: app/store/container.ts looks up a container's identity siblings with
    // `WHERE watcher = ? AND COALESCE(agent, '') = ? ORDER BY rowid`, on every
    // agent-owned insert that finds no retained policy. containers_watcher_status
    // only narrows that to the watcher name, which every agent's `local` watcher
    // shares, and then sorts. This index matches both terms exactly, and its
    // entries for one key are already in rowid order, so the lookup reads only
    // the rows of one watcher on one agent and needs no sort step.
    note: 'index containers by watcher and agent for the identity-sibling lookup (#1280)',
    sql: "CREATE INDEX containers_watcher_agent ON containers(watcher, COALESCE(agent, ''));",
  },
  {
    version: 7,
    // Spec 7.5 slice 1: the containers table shipped with no home for
    // `dependsOn`/`dependsOnSource`/`dependsOnAction`, so every read dropped
    // them and the dependency graph, list-view edges and batch waves saw no
    // edges. They are read together and never queried on their own, so they
    // share one grouped JSON column like trigger_config. Nullable: a row
    // written before this migration reads back with no dependencies until the
    // next watch cycle or event writes them.
    note: 'add containers.dependency_config (spec 7.5 slice 1)',
    sql: 'ALTER TABLE containers ADD COLUMN dependency_config TEXT;',
  },
  {
    version: GROUP_POLICIES_MIGRATION_VERSION,
    // Spec 7.3: one Drydock-owned policy per exact group name. group_name is a column
    // because the store looks policies up by it; BINARY collation keeps the match
    // case-sensitive and untrimmed, the #1251 group identity rule. The two bodies are
    // JSON ('{}' when empty) because nothing queries inside them. id is a random UUID,
    // the API path key, since group names are not URL-safe.
    //
    // containers.group_policy is the snapshot of the policy a container's last write
    // applied, NULL when none did. It lets a container response explain its effective
    // policy from one write, and lets startup reconciliation find drift without a join.
    note: 'add group_policies and containers.group_policy (spec 7.3 group policies)',
    sql: `
CREATE TABLE group_policies (
  id            TEXT PRIMARY KEY,
  group_name    TEXT NOT NULL UNIQUE,
  revision      INTEGER NOT NULL CHECK (revision >= 1),
  update_policy TEXT NOT NULL,
  actions       TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL
) STRICT;
ALTER TABLE containers ADD COLUMN group_policy TEXT;
`,
  },
  {
    version: LABEL_OVERRIDES_MIGRATION_VERSION,
    // Spec 7.5: durable Drydock overrides of the label-owned container fields, one row per
    // container identity (deriveContainerIdentityKey over the canonical name, so every
    // Compose replica of a service shares a row and a recreate under a new Docker id
    // finds it again). Nothing expires: unlike the update-policy retention stash, a row
    // lives until someone resets it. fields is JSON and never '{}', the row being deleted
    // when its last field is removed. id is a random UUID, the API handle.
    //
    // containers.label_owned is the declared layer behind a container's effective
    // label-owned fields, plus where each effective value came from. NULL until an
    // override has ever applied to the row, and a NULL row's flat fields are pristine.
    note: 'add container_label_overrides and containers.label_owned (spec 7.5 label overrides)',
    sql: `
CREATE TABLE container_label_overrides (
  id         TEXT PRIMARY KEY,
  scope_key  TEXT NOT NULL UNIQUE,
  agent      TEXT NOT NULL DEFAULT '',
  watcher    TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('container', 'compose-service')),
  scope_name TEXT NOT NULL,
  fields     TEXT NOT NULL,
  revision   INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX container_label_overrides_watcher_agent ON container_label_overrides(watcher, agent);
ALTER TABLE containers ADD COLUMN label_owned TEXT;
`,
  },
  {
    version: TOTP_MIGRATION_VERSION,
    // Spec 11.1.2 slice 1: encrypted TOTP seeds, pending enrollments, hashed
    // recovery codes and the per-subject version counter. Inert until the
    // login and management slices use them.
    note: 'add TOTP factor, enrollment, recovery code and subject version tables (spec 11.1.2 slice 1)',
    sql: TOTP_TABLES_SQL,
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
