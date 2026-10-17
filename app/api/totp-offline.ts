/**
 * Offline two-factor maintenance (spec 11.1.2, slice 6): what an operator with
 * the store file in front of them can do that no HTTP route can.
 *
 * - Key rotation: re-encrypt every seed under the key ring's active key, and
 *   say which keys still protect something, so a retired key is only removed
 *   once nothing needs it.
 * - Break glass: remove one subject's factor and recovery codes when the
 *   device, the codes or the encryption key are gone. It never reads the seed,
 *   so it works with no key ring at all.
 * - Rebind: move a factor whose account was renamed onto the account's new
 *   subject. The seed is bound to its subject, so this one does need the key.
 *
 * Everything that changes the store runs through {@link runExclusively}, which
 * refuses while any other process has the store open: a running Drydock holds
 * state these commands cannot reach (open streams of the sessions they end,
 * the key ring it loaded at start), and the audit entry they leave is written
 * at the next start. Nothing here returns, logs or throws seed, key or code
 * material.
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { type Database, openDatabase, StoreError } from '../store/db/driver.js';
import { MIGRATIONS } from '../store/db/migrations.js';
import {
  clearFactorFailures,
  countPendingOfflineOperations,
  countUnusedRecoveryCodes,
  createCollections,
  deleteEnrollmentsNotUnderKey,
  getFactorBySubject,
  getSubjectVersion,
  listFactors,
  listKeyUsage,
  rebindFactor,
  recordOfflineOperation,
  removeFactor,
  rewrapFactorSecret,
  type TotpFactorRecord,
  type TotpKeyUsage,
} from '../store/totp.js';
import {
  decryptTotpSeed,
  encryptTotpSeed,
  rewrapTotpSeed,
  type TotpKeyring,
  totpSeedNeedsRewrap,
} from './totp-crypto.js';
import { seedBindingFor } from './totp-proof.js';

type OfflineStoreErrorCode = 'NOT_FOUND' | 'UNREADABLE' | 'SCHEMA_MISMATCH' | 'IN_USE';

const STORE_ERROR_MESSAGES: Record<OfflineStoreErrorCode, string> = {
  NOT_FOUND: 'No store database exists at that path',
  UNREADABLE: 'The file is not a readable SQLite database',
  SCHEMA_MISMATCH: 'The database is not a Drydock store at the schema this version uses',
  IN_USE: 'The store is in use by another process',
};

export class OfflineStoreError extends Error {
  readonly code: OfflineStoreErrorCode;

  constructor(code: OfflineStoreErrorCode) {
    super(STORE_ERROR_MESSAGES[code]);
    this.name = 'OfflineStoreError';
    this.code = code;
  }
}

const EXPECTED_SCHEMA_VERSION = Math.max(...MIGRATIONS.map((migration) => migration.version));
const DEFAULT_BUSY_TIMEOUT_MS = 2000;

const SQLITE_HEADER_BYTES = 20;
/** Bytes 18 and 19 of the header are the file format versions; 2 means write-ahead log. */
const WAL_FILE_FORMAT = 2;

function isWalFormat(databasePath: string): boolean {
  const header = Buffer.alloc(SQLITE_HEADER_BYTES);
  const descriptor = fs.openSync(databasePath, 'r');
  try {
    fs.readSync(descriptor, header, 0, SQLITE_HEADER_BYTES, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return header[18] === WAL_FILE_FORMAT || header[19] === WAL_FILE_FORMAT;
}

/**
 * A connection that cannot write, and that leaves nothing beside the file.
 *
 * SQLite reads a write-ahead-log database through its `-wal` and `-shm`
 * files, and creates them when they are missing, even for a reader. So when
 * the file says it is in that mode and no log exists, the file is complete on
 * its own and is opened as immutable, which creates nothing. When a log does
 * exist, something has (or had) the store open and its newest rows may live
 * only there, so it is read the ordinary way, through files that are already
 * present. A rollback-journal database never gets side files from a reader.
 */
function openReadOnly(databasePath: string, busyTimeoutMs: number): Database {
  const selfContained = isWalFormat(databasePath) && !fs.existsSync(`${databasePath}-wal`);
  return openDatabase(
    selfContained ? `${pathToFileURL(databasePath).href}?immutable=1` : databasePath,
    { readOnly: true, busyTimeoutMs },
  );
}

/** The schema version, or undefined for a database that has no `schema_migrations`: not a store. */
function readSchemaVersion(db: Database): number | undefined {
  try {
    const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
    return Number(row?.version);
  } catch (error: unknown) {
    if (error instanceof StoreError && error.code === 'SQLITE_ERROR') {
      return undefined;
    }
    throw error;
  }
}

/**
 * Open an existing store and bind the two-factor store module to it.
 *
 * The file is first identified through a read-only connection, before any
 * pragma or write can reach it: a missing file is never created, a file that
 * is not a SQLite database or not a Drydock store is refused exactly as it
 * was found, and a schema this version did not write is refused rather than
 * migrated (bringing a store up to date is what starting Drydock does, with
 * the import and repair steps that go with it). Only then, and only when
 * `writable` is asked for, is it opened for writing the way the store itself
 * opens it. Everything that only reads keeps the read-only connection.
 */
export function openOfflineStore(
  databasePath: string,
  {
    writable,
    busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS,
  }: { writable: boolean; busyTimeoutMs?: number },
): Database {
  if (!fs.existsSync(databasePath)) {
    throw new OfflineStoreError('NOT_FOUND');
  }
  let reader: Database | undefined;
  let schemaVersion: number | undefined;
  try {
    reader = openReadOnly(databasePath, busyTimeoutMs);
    schemaVersion = readSchemaVersion(reader);
  } catch {
    reader?.close();
    throw new OfflineStoreError('UNREADABLE');
  }
  if (schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    reader.close();
    throw new OfflineStoreError('SCHEMA_MISMATCH');
  }
  if (!writable) {
    createCollections(reader);
    return reader;
  }
  reader.close();
  const db = openDatabase(databasePath, { busyTimeoutMs });
  createCollections(db);
  return db;
}

/**
 * Run `run` in one transaction with the store held exclusively. In WAL mode
 * every open connection keeps a shared lock on the database file, so asking
 * for the exclusive one fails while a running Drydock (or anything else) has
 * the store open, before `run` is called. A store that fell back to a rollback
 * journal (some network mounts) gives no such signal: the transaction still
 * keeps the change atomic, and stopping Drydock first is on the operator.
 */
export function runExclusively<T>(db: Database, run: () => T): T {
  db.pragma('locking_mode', 'EXCLUSIVE');
  try {
    return db.transaction(run, 'immediate');
  } catch (error: unknown) {
    if (error instanceof StoreError && error.code === 'SQLITE_BUSY') {
      throw new OfflineStoreError('IN_USE');
    }
    throw error;
  }
}

/** A local account as configured right now: one Basic provider and its username. */
export interface LocalIdentity {
  providerId: string;
  username: string;
  subjectId: string;
}

/** The key ring as this process could load it. An unusable one is a lost one. */
export type KeyringState =
  | { status: 'loaded'; keyring: TotpKeyring }
  | { status: 'absent' }
  | { status: 'unusable'; code: string };

/**
 * Whether the key ring can still read a factor's seed: `ok` under the active
 * key, `needs-rewrap` under a retired one, `key-missing` when its key id is
 * not in the key ring, `undecryptable` when the key by that id is the wrong
 * one (or the row was altered), and `unchecked` with no usable key ring.
 */
export type FactorKeyState = 'ok' | 'needs-rewrap' | 'key-missing' | 'undecryptable' | 'unchecked';

type UnreadableKeyState = Extract<FactorKeyState, 'key-missing' | 'undecryptable'>;

function unreadableKeyState(error: unknown): UnreadableKeyState {
  return (error as { code?: unknown }).code === 'KEY_NOT_FOUND' ? 'key-missing' : 'undecryptable';
}

function bindingOf(factor: TotpFactorRecord, subjectId: string = factor.subjectId) {
  return seedBindingFor(subjectId, factor.factorId, factor);
}

/**
 * Why the key ring cannot read a factor's seed, or undefined when it can. The
 * only proof is decrypting it: a key ring can hold different key material
 * under the id a factor names, and then the id matching means nothing.
 */
function findUnreadableState(
  factor: TotpFactorRecord,
  keyring: TotpKeyring,
): UnreadableKeyState | undefined {
  try {
    decryptTotpSeed(factor, bindingOf(factor), keyring).fill(0);
    return undefined;
  } catch (error: unknown) {
    return unreadableKeyState(error);
  }
}

function readKeyState(factor: TotpFactorRecord, keyring: KeyringState): FactorKeyState {
  if (keyring.status !== 'loaded') {
    return 'unchecked';
  }
  return (
    findUnreadableState(factor, keyring.keyring) ??
    (totpSeedNeedsRewrap(factor, keyring.keyring) ? 'needs-rewrap' : 'ok')
  );
}

interface FactorStatus {
  factor: TotpFactorRecord;
  keyState: FactorKeyState;
  /** No configured account derives this factor's subject: it was renamed or removed. */
  orphaned: boolean;
  recoveryCodesRemaining: number;
}

/** A key's place in the key ring: `unknown` when there is no usable key ring to look in. */
export interface KeyStatus extends TotpKeyUsage {
  role: 'active' | 'retired' | 'missing' | 'unknown';
}

export interface StoreStatus {
  factors: FactorStatus[];
  /** Every key id a row references or the key ring holds, with what it still protects. */
  keys: KeyStatus[];
  pendingOfflineOperations: number;
}

function keyRole(keyId: string, keyring: KeyringState): KeyStatus['role'] {
  if (keyring.status !== 'loaded') {
    return 'unknown';
  }
  if (keyId === keyring.keyring.activeKeyId) {
    return 'active';
  }
  return keyring.keyring.keys.has(keyId) ? 'retired' : 'missing';
}

/** Read-only: what is enrolled, under which key, and what is left over. */
export function describeStore(
  keyring: KeyringState,
  identities: readonly LocalIdentity[],
): StoreStatus {
  const configured = new Set(identities.map((identity) => identity.subjectId));
  const usage = new Map(listKeyUsage().map((entry) => [entry.keyId, entry]));
  const ringKeyIds = keyring.status === 'loaded' ? [...keyring.keyring.keys.keys()] : [];
  const keyIds = [...new Set([...usage.keys(), ...ringKeyIds])].sort();
  return {
    factors: listFactors().map((factor) => ({
      factor,
      keyState: readKeyState(factor, keyring),
      orphaned: !configured.has(factor.subjectId),
      recoveryCodesRemaining: countUnusedRecoveryCodes(factor.factorId),
    })),
    keys: keyIds.map((keyId) => ({
      ...(usage.get(keyId) ?? { keyId, factors: 0, enrollments: 0 }),
      role: keyRole(keyId, keyring),
    })),
    pendingOfflineOperations: countPendingOfflineOperations(),
  };
}

export interface RewrapOutcome {
  /** Factors re-encrypted under the active key, or that would be. */
  rewrapped: number;
  /** Factors already under the active key, which the key was checked to decrypt. */
  alreadyActive: number;
  /** Factors left as they are because the key ring cannot read them, whatever key id they name. */
  failed: { factor: TotpFactorRecord; keyState: UnreadableKeyState }[];
  /** Pending enrollments under a retired key, deleted so nothing keeps that key in use. */
  enrollmentsDiscarded: number;
}

/**
 * Re-encrypt every factor that is not under the active key. Idempotent: a
 * factor already there is left alone, so a second run changes nothing. Every
 * factor is decrypted first, the ones already under the active key id
 * included, and one the key ring cannot read is skipped and reported as a
 * failure; the rest still move. With `apply` false nothing is written and the
 * numbers are what a real run would do.
 */
export function rewrapFactors(
  keyring: TotpKeyring,
  { apply, now }: { apply: boolean; now?: Date },
): RewrapOutcome {
  const outcome: RewrapOutcome = {
    rewrapped: 0,
    alreadyActive: 0,
    failed: [],
    enrollmentsDiscarded: 0,
  };
  for (const factor of listFactors()) {
    const unreadable = findUnreadableState(factor, keyring);
    if (unreadable !== undefined) {
      outcome.failed.push({ factor, keyState: unreadable });
      continue;
    }
    if (!totpSeedNeedsRewrap(factor, keyring)) {
      outcome.alreadyActive += 1;
      continue;
    }
    const next = rewrapTotpSeed(factor, bindingOf(factor), keyring);
    outcome.rewrapped += apply ? Number(rewrapFactorSecret(factor.factorId, factor, next, now)) : 1;
  }
  outcome.enrollmentsDiscarded = apply
    ? deleteEnrollmentsNotUnderKey(keyring.activeKeyId)
    : listKeyUsage()
        .filter((entry) => entry.keyId !== keyring.activeKeyId)
        .reduce((total, entry) => total + entry.enrollments, 0);
  return outcome;
}

export interface FactorSelector {
  subjectId?: string;
  providerId?: string;
  username?: string;
}

/** Every stored factor matching all the given fields, exactly and case-sensitively. */
export function findFactors(selector: FactorSelector): TotpFactorRecord[] {
  return listFactors().filter(
    (factor) =>
      (selector.subjectId === undefined || factor.subjectId === selector.subjectId) &&
      (selector.providerId === undefined || factor.providerId === selector.providerId) &&
      (selector.username === undefined || factor.username === selector.username),
  );
}

/**
 * Break glass: delete the factor, its recovery codes and any pending
 * enrollment of its subject, move the subject to its next version so every
 * session minted before this is stale, forgive its wrong-code count, and leave
 * the marker the next start records. All of it or none of it.
 * @returns the subject's new version
 */
export function removeFactorOffline(db: Database, factor: TotpFactorRecord, now: Date): number {
  return db.transaction(() => {
    const version = removeFactor({
      subjectId: factor.subjectId,
      expectedFactorVersion: getSubjectVersion(factor.subjectId),
    });
    clearFactorFailures(factor.subjectId);
    recordOfflineOperation({
      operation: 'remove',
      subjectId: factor.subjectId,
      factorId: factor.factorId,
      at: now.toISOString(),
    });
    return version;
  });
}

export type RebindRefusal =
  | 'source-configured'
  | 'target-has-factor'
  | 'keyring-unavailable'
  | UnreadableKeyState;

/**
 * Whether `factor` can move to `target`: the key ring to do it with, or why
 * not. A rebind is only for a factor whose own account is gone, so one that is
 * still configured is refused, as is a target that already has a factor of its
 * own, and a factor the key ring cannot read cannot be bound to anything.
 */
export function planRebind(
  factor: TotpFactorRecord,
  target: LocalIdentity,
  identities: readonly LocalIdentity[],
  keyring: KeyringState,
): { refusal: RebindRefusal } | { keyring: TotpKeyring } {
  if (identities.some((identity) => identity.subjectId === factor.subjectId)) {
    return { refusal: 'source-configured' };
  }
  if (getFactorBySubject(target.subjectId) !== undefined) {
    return { refusal: 'target-has-factor' };
  }
  if (keyring.status !== 'loaded') {
    return { refusal: 'keyring-unavailable' };
  }
  const keyState = readKeyState(factor, keyring);
  return keyState === 'key-missing' || keyState === 'undecryptable'
    ? { refusal: keyState }
    : { keyring: keyring.keyring };
}

/**
 * Move `factor` to `target`: read the seed under the subject it was bound to,
 * encrypt it again bound to the new one under the active key, and write the
 * move and its marker together. Call {@link planRebind} first.
 * @returns the factor as stored after the move
 */
export function rebindFactorOffline(
  db: Database,
  factor: TotpFactorRecord,
  target: LocalIdentity,
  keyring: TotpKeyring,
  now: Date,
): TotpFactorRecord {
  const seed = decryptTotpSeed(factor, bindingOf(factor), keyring);
  const secret = encryptTotpSeed(seed, bindingOf(factor, target.subjectId), keyring);
  seed.fill(0);
  return db.transaction(() => {
    const moved = rebindFactor({
      factorId: factor.factorId,
      from: factor,
      subjectId: target.subjectId,
      providerId: target.providerId,
      username: target.username,
      secret,
      now,
    });
    recordOfflineOperation({
      operation: 'rebind',
      subjectId: factor.subjectId,
      factorId: factor.factorId,
      targetSubjectId: target.subjectId,
      at: now.toISOString(),
    });
    return moved;
  });
}
