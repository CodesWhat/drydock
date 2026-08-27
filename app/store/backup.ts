import crypto from 'node:crypto';
import type { ImageBackup } from '../model/backup.js';
import type { ContainerBackupScope } from '../util/backup.js';
import { initCollection } from './util.js';

let backupCollection: ReturnType<typeof initCollection> | undefined;

/**
 * Create backup collections.
 * @param db
 */
export function createCollections(db: InstanceType<typeof import('lokijs')>): void {
  backupCollection = initCollection(db, 'backups', {
    indices: ['data.containerName', 'data.containerIdentityKey', 'data.id'],
  });
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
  if (backupCollection) {
    backupCollection.insert({ data: backupToSave });
  }
  return backupToSave;
}

/**
 * Get all backups for a container by name, sorted by timestamp desc.
 * Uses containerName (stable across recreates) rather than containerId
 * (which changes every time Docker recreates the container).
 * @param containerName
 */
export function getBackupsByName(containerName: string): ImageBackup[] {
  if (!backupCollection) {
    return [];
  }
  return backupCollection
    .find({ 'data.containerName': containerName })
    .map((item) => item.data as ImageBackup)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
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
  if (!backupCollection) {
    return [];
  }
  return backupCollection
    .find()
    .map((item) => item.data as ImageBackup)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * Get a single backup by id.
 * @param id
 */
export function getBackup(id: string): ImageBackup | undefined {
  if (!backupCollection) {
    return undefined;
  }
  const doc =
    typeof backupCollection.findOne === 'function'
      ? backupCollection.findOne({ 'data.id': id })
      : backupCollection.find({ 'data.id': id })[0];
  return doc ? (doc.data as ImageBackup) : undefined;
}

/**
 * Delete a backup by id.
 * @param id
 */
export function deleteBackup(id: string): boolean {
  if (!backupCollection) {
    return false;
  }
  const doc =
    typeof backupCollection.findOne === 'function'
      ? backupCollection.findOne({ 'data.id': id })
      : backupCollection.find({ 'data.id': id })[0];
  if (doc) {
    backupCollection.remove(doc);
    return true;
  }
  return false;
}

/**
 * Prune old backups for a container, keeping only the N most recent.
 * @param containerName
 * @param maxCount
 */
export function pruneOldBackups(
  containerScope: string | ContainerBackupScope,
  maxCount: number | undefined,
): number {
  if (!backupCollection) {
    return 0;
  }
  if (typeof maxCount !== 'number' || !Number.isFinite(maxCount)) {
    return 0;
  }
  const containerName =
    typeof containerScope === 'string' ? containerScope : containerScope.containerName;
  const docs = backupCollection
    .find({ 'data.containerName': containerName })
    .filter(
      (doc) =>
        typeof containerScope === 'string' ||
        isBackupInScope(doc.data as ImageBackup, containerScope),
    );
  docs.sort((a, b) => new Date(b.data.timestamp).getTime() - new Date(a.data.timestamp).getTime());
  const toRemove = docs.slice(maxCount);
  toRemove.forEach((doc) => backupCollection.remove(doc));
  return toRemove.length;
}
