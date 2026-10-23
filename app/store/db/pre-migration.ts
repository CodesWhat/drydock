/**
 * Startup guard for an existing store database, run before the migration runner.
 *
 * 1. Refuse a database a newer build already migrated (`assertSchemaSupported`).
 * 2. When migrations are pending, write a consistent snapshot next to the
 *    database first, so a bad migration or later regret has a restore point.
 *
 * The snapshot uses `VACUUM INTO`, not `Database.backup()`: it is synchronous (so
 * startup order is unchanged), reads one consistent view including any WAL
 * content, and writes a single compact file with no sidecars. A failed snapshot
 * aborts startup instead of migrating unprotected. Nothing has been written to
 * the database yet at that point, so refusing is safe and the usual causes (disk
 * full, bad permissions) are fixable; a silent skip would defeat the point of
 * having a snapshot at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import logger from '../../log/index.js';
import type { Database } from './driver.js';
import { assertSchemaSupported, MIGRATIONS, type Migration } from './migrations.js';

const log = logger.child({ component: 'store.db' });

export const PRE_MIGRATION_SNAPSHOT_RETENTION = 3;
const SNAPSHOT_MODE = 0o600;
const TIMESTAMP_SUFFIX = /-(\d{8}T\d{9}Z)$/;

export class StoreSnapshotError extends Error {
  constructor(snapshotPath: string, cause: unknown) {
    super(
      `Could not write the pre-migration snapshot ${snapshotPath}: ${cause instanceof Error ? cause.message : String(cause)}. ` +
        'Refusing to migrate the store without a restore point. Free disk space or fix permissions on the store directory, then restart.',
      { cause },
    );
    this.name = 'StoreSnapshotError';
  }
}

export interface PreMigrationOptions {
  migrations?: readonly Migration[];
  retain?: number;
  now?: () => Date;
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '');
}

function pruneSnapshots(databasePath: string, retain: number): void {
  const directory = path.dirname(databasePath);
  const prefix = `${path.basename(databasePath)}.pre-migration-`;
  const snapshots = fs
    .readdirSync(directory)
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({ name, stamp: TIMESTAMP_SUFFIX.exec(name)?.[1] }))
    .filter((entry): entry is { name: string; stamp: string } => entry.stamp !== undefined)
    .sort((first, second) => second.stamp.localeCompare(first.stamp));
  for (const stale of snapshots.slice(retain)) {
    try {
      fs.rmSync(path.join(directory, stale.name), { force: true });
    } catch (error: unknown) {
      log.warn(`Could not delete old store snapshot ${stale.name}: ${String(error)}`);
    }
  }
}

/**
 * Returns the snapshot path, or undefined when no snapshot was needed (fresh
 * database, or nothing pending).
 */
export function prepareDatabaseForMigration(
  db: Database,
  databasePath: string,
  options: PreMigrationOptions = {},
): string | undefined {
  const migrations = options.migrations ?? MIGRATIONS;
  const applied = assertSchemaSupported(db, migrations, databasePath);
  if (applied.length === 0) {
    return undefined;
  }
  const appliedSet = new Set(applied);
  if (migrations.every((migration) => appliedSet.has(migration.version))) {
    return undefined;
  }

  const fromVersion = applied.at(-1);
  const stamp = formatTimestamp((options.now ?? (() => new Date()))());
  const snapshotPath = `${databasePath}.pre-migration-v${fromVersion}-${stamp}`;
  try {
    db.exec(`VACUUM INTO ${quoteSqlString(snapshotPath)}`);
    fs.chmodSync(snapshotPath, SNAPSHOT_MODE);
  } catch (error: unknown) {
    fs.rmSync(snapshotPath, { force: true });
    throw new StoreSnapshotError(snapshotPath, error);
  }
  log.info(`Wrote pre-migration store snapshot ${snapshotPath} (schema version ${fromVersion})`);
  pruneSnapshots(databasePath, options.retain ?? PRE_MIGRATION_SNAPSHOT_RETENTION);
  return snapshotPath;
}
