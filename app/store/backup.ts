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
 * Get all backups for a container by name, sorted by timestamp desc.
 * Uses containerName (stable across recreates) rather than containerId
 * (which changes every time Docker recreates the container).
 *
 * `backups` carries a `container_identity_key` column (roadmap 7-STORE,
 * slice 5), populated on every write, but this reader stays a thin
 * name-keyed wrapper until identity-based lookups replace it in a later
 * slice — nothing above the store changes yet.
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
  if (backup.containerName !== scope.containerName) {
    return false;
  }
  if (backup.containerIdentityKey) {
    return backup.containerIdentityKey === scope.containerIdentityKey;
  }
  return scope.includeLegacy;
}

/** Get backups belonging to one canonical container identity. */
export function getBackupsForContainer(scope: ContainerBackupScope): ImageBackup[] {
  return getBackupsByName(scope.containerName).filter((backup) => isBackupInScope(backup, scope));
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
 * Delete a backup by id.
 * @param id
 */
export function deleteBackup(id: string): boolean {
  if (!db) {
    return false;
  }
  const result = db.prepare('DELETE FROM backups WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Prune old backups for a container, keeping only the N most recent.
 * @param containerScope
 * @param maxCount
 */
export function pruneOldBackups(
  containerScope: string | ContainerBackupScope,
  maxCount: number | undefined,
): number {
  if (!db) {
    return 0;
  }
  if (typeof maxCount !== 'number' || !Number.isFinite(maxCount)) {
    return 0;
  }
  const containerName =
    typeof containerScope === 'string' ? containerScope : containerScope.containerName;
  const backups = getBackupsByName(containerName).filter(
    (backup) => typeof containerScope === 'string' || isBackupInScope(backup, containerScope),
  );
  const toRemove = backups.slice(maxCount);
  for (const removed of toRemove) {
    db.prepare('DELETE FROM backups WHERE id = ?').run(removed.id);
  }
  return toRemove.length;
}
