import crypto from 'node:crypto';
import type { ImageBackup } from '../model/backup.js';
import { initCollection } from './util.js';

let backupCollection: ReturnType<typeof initCollection> | undefined;

/**
 * Create backup collections.
 * @param db
 */
export function createCollections(db: InstanceType<typeof import('lokijs')>): void {
  backupCollection = initCollection(db, 'backups');
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
    .find()
    .map((item) => item.data as ImageBackup)
    .filter((b) => b.containerName === containerName)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
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
  const doc = backupCollection.find().find((item) => item.data.id === id);
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
  const doc = backupCollection.find().find((item) => item.data.id === id);
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
export function pruneOldBackups(containerName: string, maxCount: number): number {
  if (!backupCollection) {
    return 0;
  }
  const docs = backupCollection.find().filter((item) => item.data.containerName === containerName);
  docs.sort((a, b) => new Date(b.data.timestamp).getTime() - new Date(a.data.timestamp).getTime());
  const toRemove = docs.slice(maxCount);
  toRemove.forEach((doc) => backupCollection.remove(doc));
  return toRemove.length;
}
