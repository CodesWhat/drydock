/**
 * Shared SQLite fixtures for store tests.
 *
 * Tests run against real `node:sqlite` databases rather than mocks: the
 * behaviour that matters (STRICT typing, constraint codes, transaction
 * rollback, WAL) only exists in the engine.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Database, MEMORY_DATABASE_LOCATION, openDatabase } from '../store/db/driver.js';
import { migrate } from '../store/db/migrations.js';

/** An in-memory database with no schema applied. */
export function createMemoryDatabase(): Database {
  return openDatabase(MEMORY_DATABASE_LOCATION);
}

/** An in-memory database with the full schema applied. */
export function createMigratedMemoryDatabase(): Database {
  const db = createMemoryDatabase();
  migrate(db);
  return db;
}

/** A throwaway directory standing in for `DD_STORE_PATH`. */
export function createTemporaryStoreDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-store-'));
}

export function removeTemporaryStoreDirectory(directoryPath: string): void {
  fs.rmSync(directoryPath, { recursive: true, force: true });
}

/** Serialise a LokiJS database file the way LokiJS itself would. */
export function writeLokiStoreFile(
  filePath: string,
  collections: { name: string; data: Record<string, unknown>[] }[],
): void {
  const serialized = {
    filename: filePath,
    collections: collections.map((collection, collectionIndex) => ({
      name: collection.name,
      data: collection.data.map((document, documentIndex) => ({
        ...document,
        meta: { revision: 0, created: 0, version: 0 },
        $loki: collectionIndex * 1000 + documentIndex + 1,
      })),
      idIndex: null,
      binaryIndices: {},
      transactional: false,
      cloneObjects: false,
      disableChangesApi: true,
    })),
    databaseVersion: 1.5,
    engineVersion: 1.5,
  };
  fs.writeFileSync(filePath, JSON.stringify(serialized), 'utf8');
}
