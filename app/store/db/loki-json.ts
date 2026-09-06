/**
 * Reader for the LokiJS store file the v1.8 migration imports from.
 *
 * `dd.json` is one serialised LokiJS database: a `collections` array where each
 * entry has a `name` and a `data` array of documents. LokiJS injects `$loki`
 * and `meta` into every document; both are dropped here, so nothing downstream
 * has to guard against them the way `app/agent/api/container.ts` and
 * `app/store/api-key.ts` do today.
 *
 * Two document shapes exist and both are served, per spec section 1.1: eleven
 * collections are flat records, and six wrap the record in a `{ data: ... }`
 * envelope. `documents()` returns the stored document, `records()` returns the
 * inner record of an enveloped one. `audit` needs both, because it stores
 * `timestampMs` as a sibling of `data`.
 *
 * This module never throws for a missing collection: a store written by an
 * older drydock legitimately has fewer collections than the current build
 * creates. It throws only when the file is unreadable or is not a LokiJS
 * database at all, because importing half of an unrecognised file is worse than
 * refusing to start.
 */
import fs from 'node:fs';
import path from 'node:path';
import { StoreError } from './driver.js';

export type LokiDocument = Record<string, unknown>;

export const LEGACY_STORE_UNREADABLE_CODE = 'STORE_LEGACY_STORE_UNREADABLE';

/** The collection `connect-loki` writes into the shared store file. */
export const LEGACY_SESSIONS_COLLECTION = 'Sessions';
/**
 * DR-121 moves express-session records out of `dd.json` into their own LokiJS
 * file next to it. A store upgraded from a build that already has that change
 * keeps its sessions there; anything older still has them in `dd.json`.
 */
export const LEGACY_SESSIONS_FILE = 'dd-sessions.json';

const LOKI_INJECTED_FIELDS = new Set(['$loki', 'meta']);

export interface LokiDatabaseSnapshot {
  /** The path or label the snapshot was read from, for error messages. */
  readonly source: string;
  readonly collectionNames: readonly string[];
  hasCollection(name: string): boolean;
  /** Stored documents with LokiJS's injected fields removed. */
  documents(name: string): LokiDocument[];
  /** Inner records of a `{ data: ... }`-enveloped collection. */
  records(name: string): LokiDocument[];
}

function isPlainRecord(value: unknown): value is LokiDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripLokiMetadata(document: LokiDocument): LokiDocument {
  return Object.fromEntries(
    Object.entries(document).filter(([key]) => !LOKI_INJECTED_FIELDS.has(key)),
  );
}

function unreadable(source: string, reason: string, cause?: unknown): StoreError {
  return new StoreError(
    `Cannot read the legacy store at ${source}: ${reason}`,
    LEGACY_STORE_UNREADABLE_CODE,
    { cause },
  );
}

function collectDocuments(collections: unknown[]): Map<string, LokiDocument[]> {
  const byName = new Map<string, LokiDocument[]>();
  for (const entry of collections) {
    if (!isPlainRecord(entry) || typeof entry.name !== 'string') {
      continue;
    }
    const data = Array.isArray(entry.data) ? entry.data : [];
    byName.set(entry.name, data.filter(isPlainRecord).map(stripLokiMetadata));
  }
  return byName;
}

/** Parse a serialised LokiJS database. `source` only labels error messages. */
export function parseLokiDatabase(contents: string, source: string): LokiDatabaseSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error: unknown) {
    throw unreadable(source, 'it is not valid JSON', error);
  }
  if (!isPlainRecord(parsed)) {
    throw unreadable(source, 'it is not a JSON object');
  }
  if (!Array.isArray(parsed.collections)) {
    throw unreadable(source, 'it has no "collections" array, so it is not a LokiJS database');
  }
  const byName = collectDocuments(parsed.collections);

  return {
    source,
    collectionNames: [...byName.keys()],
    hasCollection(name: string): boolean {
      return byName.has(name);
    },
    documents(name: string): LokiDocument[] {
      return byName.get(name) ?? [];
    },
    records(name: string): LokiDocument[] {
      return (byName.get(name) ?? [])
        .map((document) => document.data)
        .filter(isPlainRecord)
        .map(stripLokiMetadata);
    },
  };
}

/** Read and parse a serialised LokiJS database from disk. */
export function readLokiDatabase(filePath: string): LokiDatabaseSnapshot {
  let contents: string;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    throw unreadable(filePath, 'the file could not be read', error);
  }
  return parseLokiDatabase(contents, filePath);
}

/**
 * Find the express-session documents to import.
 *
 * Prefers the dedicated sessions file DR-121 introduces, and falls back to the
 * `Sessions` collection `connect-loki` used to write into the shared store
 * file. Neither existing is normal and returns an empty list: sessions are
 * disposable, so a store with none imports none.
 */
export function resolveLegacySessionDocuments(
  storeDirectory: string,
  snapshot: LokiDatabaseSnapshot,
): LokiDocument[] {
  const sessionsPath = path.join(storeDirectory, LEGACY_SESSIONS_FILE);
  if (fs.existsSync(sessionsPath)) {
    return readLokiDatabase(sessionsPath).documents(LEGACY_SESSIONS_COLLECTION);
  }
  return snapshot.documents(LEGACY_SESSIONS_COLLECTION);
}
