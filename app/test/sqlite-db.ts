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

/** An in-memory database with no schema applied. */
export function createMemoryDatabase(): Database {
  return openDatabase(MEMORY_DATABASE_LOCATION);
}

/** A throwaway directory standing in for `DD_STORE_PATH`. */
export function createTemporaryStoreDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-store-'));
}

export function removeTemporaryStoreDirectory(directoryPath: string): void {
  fs.rmSync(directoryPath, { recursive: true, force: true });
}
