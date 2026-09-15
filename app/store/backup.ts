import crypto from 'node:crypto';
import type { ImageBackup } from '../model/backup.js';
import type { ContainerBackupScope } from '../util/backup.js';
import type { Database, Row } from './db/driver.js';

let db: Database | undefined;

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function rowToBackup(row: Row): ImageBackup {
  return {
    id: String(row.id),
    containerId: String(row.container_id),
    containerName: String(row.container_name),
    containerIdentityKey: optionalString(row.container_identity_key),
    imageName: String(row.image_name),
    imageTag: String(row.image_tag),
    imageDigest: optionalString(row.image_digest),
    timestamp: String(row.timestamp),
    triggerName: String(row.trigger_name),
  };
}

/**
 * Wire the backup store to the shared SQLite database. Schema creation is the
 * migration runner's job; this only captures the handle.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
}

/**
 * Insert a new backup record.
 * @param backup
 */
export function insertBackup(backup: ImageBackup): ImageBackup {
  const backupToSave: ImageBackup = {
    ...backup,
    id: backup.id || crypto.randomUUID(),
    timestamp: backup.timestamp || new Date().toISOString(),
  };
  if (db) {
    db.prepare(
      `INSERT INTO backups
         (id, container_identity_key, container_name, container_id, image_name, image_tag, image_digest, timestamp, trigger_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      backupToSave.id,
      backupToSave.containerIdentityKey ?? null,
      backupToSave.containerName,
      backupToSave.containerId,
      backupToSave.imageName,
      backupToSave.imageTag,
      backupToSave.imageDigest ?? null,
      backupToSave.timestamp,
      backupToSave.triggerName,
    );
  }
  return backupToSave;
}

/**
 * Get all backups for a container by name, sorted by timestamp desc. This is
 * a display/listing convenience (the `?containerName=` query param on
 * `GET /api/v1/backups`) — not an ownership scope. Backup ownership goes
 * through `getBackupsForContainer`, keyed on the durable identity, so a
 * renamed or recreated container still finds its own backups.
 * @param containerName
 */
export function getBackupsByName(containerName: string): ImageBackup[] {
  if (!db) {
    return [];
  }
  return db
    .prepare('SELECT * FROM backups WHERE container_name = ? ORDER BY timestamp DESC')
    .all(containerName)
    .map(rowToBackup);
}

/** Return whether a backup belongs to a container's canonical identity scope. */
export function isBackupInScope(backup: ImageBackup, scope: ContainerBackupScope): boolean {
  return (
    Boolean(scope.containerIdentityKey) &&
    backup.containerIdentityKey === scope.containerIdentityKey
  );
}

/**
 * Get backups belonging to one canonical container identity, sorted by
 * timestamp desc. Queries `container_identity_key` directly instead of
 * filtering a by-name result set, so a rename (which changes `containerName`
 * but not the identity key) doesn't lose the backup history (roadmap
 * 7-STORE, slice 10).
 */
export function getBackupsForContainer(scope: ContainerBackupScope): ImageBackup[] {
  if (!db || !scope.containerIdentityKey) {
    return [];
  }
  return db
    .prepare('SELECT * FROM backups WHERE container_identity_key = ? ORDER BY timestamp DESC')
    .all(scope.containerIdentityKey)
    .map(rowToBackup);
}

/**
 * Get all backups across all containers.
 */
export function getAllBackups(): ImageBackup[] {
  if (!db) {
    return [];
  }
  return db.prepare('SELECT * FROM backups ORDER BY timestamp DESC').all().map(rowToBackup);
}

/**
 * Get a single backup by id.
 * @param id
 */
export function getBackup(id: string): ImageBackup | undefined {
  if (!db) {
    return undefined;
  }
  const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(id);
  return row ? rowToBackup(row) : undefined;
}

/**
 * Prune old backups for a container's canonical identity, keeping only the N
 * most recent.
 * @param scope
 * @param maxCount
 */
export function pruneOldBackups(scope: ContainerBackupScope, maxCount: number | undefined): number {
  if (!db) {
    return 0;
  }
  if (typeof maxCount !== 'number' || !Number.isFinite(maxCount)) {
    return 0;
  }
  const backups = getBackupsForContainer(scope);
  const toRemove = backups.slice(maxCount);
  for (const removed of toRemove) {
    db.prepare('DELETE FROM backups WHERE id = ?').run(removed.id);
  }
  return toRemove.length;
}
