/**
 * TOTP flat store (spec 11.1.2, slice 1).
 *
 * Backed by `totp_factors`, `totp_enrollments`, `totp_recovery_codes` and
 * `totp_subject_versions` (migration 10). Nothing in the running app calls this
 * yet. It persists opaque values only: the seed is already AES-GCM ciphertext
 * and recovery codes are already digests when they arrive, so this module never
 * imports key material and never sees a usable secret.
 *
 * Every race the spec calls out is a single SQL statement or one transaction on
 * the shared connection: accepted-counter advance and recovery-code use are
 * compare-and-set updates whose `changes` count says who won; activation,
 * removal and recovery replacement check the subject version or generation and
 * write everything or nothing. Errors carry a fixed message and a stable code,
 * never a row value.
 */
import crypto from 'node:crypto';
import type { Database, Row } from './db/driver.js';
import { writeStoreMetadata } from './db/import.js';

export type TotpStoreErrorCode =
  | 'NOT_INITIALIZED'
  | 'INVALID_ARGUMENT'
  | 'ENROLLMENT_PENDING'
  | 'ENROLLMENT_NOT_FOUND'
  | 'ENROLLMENT_EXPIRED'
  | 'VERSION_CONFLICT'
  | 'BINDING_MISMATCH'
  | 'FACTOR_NOT_FOUND'
  | 'SUBJECT_HAS_FACTOR'
  | 'GENERATION_CONFLICT';

const MESSAGES: Record<TotpStoreErrorCode, string> = {
  NOT_INITIALIZED: 'totp collection not initialized',
  INVALID_ARGUMENT: 'Invalid TOTP store argument',
  ENROLLMENT_PENDING: 'A TOTP enrollment is already pending for this subject',
  ENROLLMENT_NOT_FOUND: 'TOTP enrollment not found',
  ENROLLMENT_EXPIRED: 'TOTP enrollment expired',
  VERSION_CONFLICT: 'TOTP factor version changed',
  BINDING_MISMATCH: 'TOTP factor does not match its enrollment',
  FACTOR_NOT_FOUND: 'TOTP factor not found',
  SUBJECT_HAS_FACTOR: 'The subject already has a TOTP factor',
  GENERATION_CONFLICT: 'TOTP recovery code generation changed',
};

export class TotpStoreError extends Error {
  readonly code: TotpStoreErrorCode;

  constructor(code: TotpStoreErrorCode) {
    super(MESSAGES[code]);
    this.name = 'TotpStoreError';
    this.code = code;
  }
}

export interface TotpFactorRecord {
  schemaVersion: 1;
  factorId: string;
  subjectId: string;
  providerId: string;
  username: string;
  factorVersion: number;
  encryptionKeyId: string;
  secretNonce: string;
  secretCiphertext: string;
  secretAuthTag: string;
  algorithm: 'SHA1';
  digits: 6;
  periodSeconds: 30;
  allowedSkewSteps: 1;
  createdAt: string;
  activatedAt: string;
  updatedAt: string;
  lastAcceptedCounter: number | null;
  recoveryGeneration: number;
}

/** What a caller supplies at activation; the store assigns the rest. */
export type NewTotpFactor = Omit<
  TotpFactorRecord,
  'factorVersion' | 'updatedAt' | 'lastAcceptedCounter' | 'recoveryGeneration'
>;

export interface TotpEnrollmentRecord {
  schemaVersion: 1;
  enrollmentId: string;
  subjectId: string;
  providerId: string;
  username: string;
  expectedFactorVersion: number;
  replacesFactorId: string | null;
  encryptionKeyId: string;
  secretNonce: string;
  secretCiphertext: string;
  secretAuthTag: string;
  createdAt: string;
  expiresAt: string;
}

export interface TotpRecoveryCodeRecord {
  schemaVersion: 1;
  codeId: string;
  factorId: string;
  subjectId: string;
  generation: number;
  codeDigest: string;
  createdAt: string;
  usedAt: string | null;
}

export interface ActivateEnrollmentInput {
  enrollmentId: string;
  factor: NewTotpFactor;
  /** Counter of the confirmation code, recorded as spent so it cannot be replayed. */
  acceptedCounter: number;
  recoveryCodeDigests: readonly string[];
  now?: Date;
}

export interface ActivatedFactor {
  factor: TotpFactorRecord;
  recoveryCodeIds: string[];
}

let db: Database | undefined;

function requireDb(): Database {
  if (!db) {
    throw new TotpStoreError('NOT_INITIALIZED');
  }
  return db;
}

/**
 * Bind the module to the store connection.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
}

function randomId(): string {
  return crypto.randomUUID();
}

function isValidCounter(counter: number): boolean {
  return Number.isSafeInteger(counter) && counter >= 0;
}

const RECOVERY_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function toFactor(row: Row): TotpFactorRecord {
  if (
    row.algorithm !== 'SHA1' ||
    Number(row.digits) !== 6 ||
    Number(row.period_seconds) !== 30 ||
    Number(row.allowed_skew_steps) !== 1
  ) {
    throw new TotpStoreError('INVALID_ARGUMENT');
  }
  return {
    schemaVersion: 1,
    factorId: String(row.factor_id),
    subjectId: String(row.subject_id),
    providerId: String(row.provider_id),
    username: String(row.username),
    factorVersion: Number(row.factor_version),
    encryptionKeyId: String(row.encryption_key_id),
    secretNonce: String(row.secret_nonce),
    secretCiphertext: String(row.secret_ciphertext),
    secretAuthTag: String(row.secret_auth_tag),
    algorithm: row.algorithm,
    digits: 6,
    periodSeconds: 30,
    allowedSkewSteps: 1,
    createdAt: String(row.created_at),
    activatedAt: String(row.activated_at),
    updatedAt: String(row.updated_at),
    lastAcceptedCounter:
      row.last_accepted_counter === null ? null : Number(row.last_accepted_counter),
    recoveryGeneration: Number(row.recovery_generation),
  };
}

function toEnrollment(row: Row): TotpEnrollmentRecord {
  return {
    schemaVersion: 1,
    enrollmentId: String(row.enrollment_id),
    subjectId: String(row.subject_id),
    providerId: String(row.provider_id),
    username: String(row.username),
    expectedFactorVersion: Number(row.expected_factor_version),
    replacesFactorId: row.replaces_factor_id === null ? null : String(row.replaces_factor_id),
    encryptionKeyId: String(row.encryption_key_id),
    secretNonce: String(row.secret_nonce),
    secretCiphertext: String(row.secret_ciphertext),
    secretAuthTag: String(row.secret_auth_tag),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
  };
}

function toRecoveryCode(row: Row): TotpRecoveryCodeRecord {
  return {
    schemaVersion: 1,
    codeId: String(row.code_id),
    factorId: String(row.factor_id),
    subjectId: String(row.subject_id),
    generation: Number(row.generation),
    codeDigest: String(row.code_digest),
    createdAt: String(row.created_at),
    usedAt: row.used_at === null ? null : String(row.used_at),
  };
}

/* ------------------------------------------------------------------ */
/* Subject version                                                     */
/* ------------------------------------------------------------------ */

function readSubjectVersion(database: Database, subjectId: string): number {
  const row = database
    .prepare('SELECT factor_version FROM totp_subject_versions WHERE subject_id = ?')
    .get(subjectId);
  return row ? Number(row.factor_version) : 0;
}

function writeSubjectVersion(
  database: Database,
  subjectId: string,
  username: string,
  version: number,
): void {
  database
    .prepare(
      `INSERT INTO totp_subject_versions (subject_id, factor_version, username) VALUES (?, ?, ?)
       ON CONFLICT(subject_id) DO UPDATE SET
         factor_version = excluded.factor_version, username = excluded.username`,
    )
    .run(subjectId, version, username);
}

/** The subject's current factor version; 0 for a subject that never enrolled. */
export function getSubjectVersion(subjectId: string): number {
  return readSubjectVersion(requireDb(), subjectId);
}

/** Sessions of this subject issued before this instant (epoch ms) are revoked; 0 for none. */
export function getSessionsNotBefore(subjectId: string): number {
  const row = requireDb()
    .prepare('SELECT sessions_not_before FROM totp_subject_versions WHERE subject_id = ?')
    .get(subjectId);
  return row ? Number(row.sessions_not_before) : 0;
}

/**
 * Revoke every session of the subject issued before `notBefore` (epoch ms).
 * The marker only moves forward, so a repeated or late call cannot reopen an
 * older session. A subject with no version row gets one at version 0, which
 * reads exactly like no row at all everywhere else.
 */
export function revokeSessionsIssuedBefore(
  subjectId: string,
  username: string,
  notBefore: number,
): void {
  requireDb()
    .prepare(
      `INSERT INTO totp_subject_versions (subject_id, factor_version, username, sessions_not_before)
       VALUES (?, 0, ?, ?)
       ON CONFLICT(subject_id) DO UPDATE SET
         sessions_not_before = MAX(sessions_not_before, excluded.sessions_not_before)`,
    )
    .run(subjectId, username, notBefore);
}

export interface FactorFailureState {
  /** Wrong second-factor proofs since the last successful one. */
  failures: number;
  /** Epoch ms the current lock ends; 0 or in the past for none. */
  lockedUntil: number;
}

export function getFactorFailureState(subjectId: string): FactorFailureState {
  const row = requireDb()
    .prepare(
      'SELECT factor_failures, factor_locked_until FROM totp_subject_versions WHERE subject_id = ?',
    )
    .get(subjectId);
  return {
    failures: row ? Number(row.factor_failures) : 0,
    lockedUntil: row ? Number(row.factor_locked_until) : 0,
  };
}

/**
 * Count one wrong second-factor proof against the subject and set the lock it
 * earns. Nothing here expires with time: the count only returns to zero through
 * {@link clearFactorFailures} after a successful proof, so a lapsed lock buys
 * one more guess before the next, longer one. From the `threshold`th failure on
 * every failure locks for `baseLockMs * 2^(failures - threshold)`, capped at
 * `maxLockMs` (or at `baseLockMs` when that is already longer).
 */
export function recordFactorFailure(input: {
  subjectId: string;
  username: string;
  now: number;
  threshold: number;
  baseLockMs: number;
  maxLockMs: number;
}): FactorFailureState {
  const database = requireDb();
  return database.transaction((): FactorFailureState => {
    const failures = getFactorFailureState(input.subjectId).failures + 1;
    const lockedUntil =
      failures >= input.threshold
        ? input.now +
          Math.min(
            input.baseLockMs * 2 ** Math.min(failures - input.threshold, 40),
            Math.max(input.maxLockMs, input.baseLockMs),
          )
        : 0;
    database
      .prepare(
        `INSERT INTO totp_subject_versions
           (subject_id, factor_version, username, factor_failures, factor_locked_until)
         VALUES (?, 0, ?, ?, ?)
         ON CONFLICT(subject_id) DO UPDATE SET
           factor_failures = excluded.factor_failures,
           factor_locked_until = excluded.factor_locked_until`,
      )
      .run(input.subjectId, input.username, failures, lockedUntil);
    return { failures, lockedUntil };
  });
}

/** A successful proof: forgive every failure and lift any lock. */
export function clearFactorFailures(subjectId: string): void {
  requireDb()
    .prepare(
      `UPDATE totp_subject_versions SET factor_failures = 0, factor_locked_until = 0
        WHERE subject_id = ?`,
    )
    .run(subjectId);
}

/**
 * Has any subject for this exact username ever enrolled a factor? A row with
 * an unknown username counts for everyone: it cannot be ruled out, and the
 * caller fails closed. The version never returns to 0, so this stays true after
 * a removal.
 */
export function hasEnrolledUsername(username: string): boolean {
  const row = requireDb()
    .prepare(
      `SELECT 1 AS present FROM totp_subject_versions
        WHERE factor_version > 0 AND (username = ? OR username IS NULL) LIMIT 1`,
    )
    .get(username);
  return row !== undefined;
}

/* ------------------------------------------------------------------ */
/* Factors                                                             */
/* ------------------------------------------------------------------ */

function readFactorBySubject(database: Database, subjectId: string): TotpFactorRecord | undefined {
  const row = database.prepare('SELECT * FROM totp_factors WHERE subject_id = ?').get(subjectId);
  return row ? toFactor(row) : undefined;
}

export function getFactor(factorId: string): TotpFactorRecord | undefined {
  const row = requireDb().prepare('SELECT * FROM totp_factors WHERE factor_id = ?').get(factorId);
  return row ? toFactor(row) : undefined;
}

export function getFactorBySubject(subjectId: string): TotpFactorRecord | undefined {
  return readFactorBySubject(requireDb(), subjectId);
}

/** Every factor, for a key-rotation sweep. */
export function listFactors(): TotpFactorRecord[] {
  return requireDb().prepare('SELECT * FROM totp_factors ORDER BY rowid').all().map(toFactor);
}

/**
 * Record `counter` as the newest accepted code, but only if it is strictly
 * newer than what is stored. The single UPDATE is the compare-and-set: of any
 * number of callers presenting the same counter, exactly one sees `true`.
 * `factorVersion` is the version the code was verified against, so a code
 * checked against an earlier seed cannot advance a factor that replaced it.
 */
export function advanceLastAcceptedCounter(
  factorId: string,
  counter: number,
  factorVersion: number,
): boolean {
  if (!isValidCounter(counter) || !isValidCounter(factorVersion)) {
    throw new TotpStoreError('INVALID_ARGUMENT');
  }
  const result = requireDb()
    .prepare(
      `UPDATE totp_factors SET last_accepted_counter = ?
       WHERE factor_id = ? AND factor_version = ?
         AND (last_accepted_counter IS NULL OR last_accepted_counter < ?)`,
    )
    .run(counter, factorId, factorVersion, counter);
  return result.changes === 1;
}

interface SecretFields {
  encryptionKeyId: string;
  secretNonce: string;
  secretCiphertext: string;
  secretAuthTag: string;
}

/**
 * Swap in a re-encrypted seed, but only while the stored ciphertext is still
 * the one `from` read, so a concurrent rotation or replacement is never
 * overwritten with a stale copy.
 */
export function rewrapFactorSecret(
  factorId: string,
  from: Pick<SecretFields, 'encryptionKeyId' | 'secretNonce'>,
  to: SecretFields,
  now: Date = new Date(),
): boolean {
  const result = requireDb()
    .prepare(
      `UPDATE totp_factors
         SET encryption_key_id = ?, secret_nonce = ?, secret_ciphertext = ?, secret_auth_tag = ?,
             updated_at = ?
       WHERE factor_id = ? AND encryption_key_id = ? AND secret_nonce = ?`,
    )
    .run(
      to.encryptionKeyId,
      to.secretNonce,
      to.secretCiphertext,
      to.secretAuthTag,
      now.toISOString(),
      factorId,
      from.encryptionKeyId,
      from.secretNonce,
    );
  return result.changes === 1;
}

/**
 * Delete the subject's factor and its recovery codes and move the subject to
 * the next version. `expectedFactorVersion` must match the stored one.
 * @returns the new version
 */
export function removeFactor(input: { subjectId: string; expectedFactorVersion: number }): number {
  const database = requireDb();
  const outcome = database.transaction((): number | TotpStoreErrorCode => {
    const factor = readFactorBySubject(database, input.subjectId);
    if (!factor) {
      return 'FACTOR_NOT_FOUND';
    }
    if (readSubjectVersion(database, input.subjectId) !== input.expectedFactorVersion) {
      return 'VERSION_CONFLICT';
    }
    database.prepare('DELETE FROM totp_recovery_codes WHERE factor_id = ?').run(factor.factorId);
    database.prepare('DELETE FROM totp_factors WHERE factor_id = ?').run(factor.factorId);
    database.prepare('DELETE FROM totp_enrollments WHERE subject_id = ?').run(input.subjectId);
    const next = input.expectedFactorVersion + 1;
    writeSubjectVersion(database, input.subjectId, factor.username, next);
    return next;
  });
  if (typeof outcome === 'string') {
    throw new TotpStoreError(outcome);
  }
  return outcome;
}

/**
 * Move a factor whose account was renamed onto the subject the account has
 * now (spec 11.1.2 decision 10). The seed's authenticated data names its
 * subject, so the caller supplies it encrypted again for the new one, and
 * `from` is the ciphertext it read, as in {@link rewrapFactorSecret}. The
 * recovery codes, the replay counter and the failure count follow the factor.
 * Both subjects move to a version above anything either has issued, so no
 * session minted before the move survives it, and the pending enrollments of
 * both are dropped. A target that already has a factor is refused.
 * @returns the factor as stored after the move
 */
export function rebindFactor(input: {
  factorId: string;
  from: Pick<SecretFields, 'encryptionKeyId' | 'secretNonce'>;
  subjectId: string;
  providerId: string;
  username: string;
  secret: SecretFields;
  now?: Date;
}): TotpFactorRecord {
  const database = requireDb();
  const nowIso = (input.now ?? new Date()).toISOString();
  const outcome = database.transaction((): TotpFactorRecord | TotpStoreErrorCode => {
    const row = database
      .prepare('SELECT * FROM totp_factors WHERE factor_id = ?')
      .get(input.factorId);
    if (!row) {
      return 'FACTOR_NOT_FOUND';
    }
    const factor = toFactor(row);
    if (factor.subjectId === input.subjectId) {
      return 'INVALID_ARGUMENT';
    }
    if (readFactorBySubject(database, input.subjectId)) {
      return 'SUBJECT_HAS_FACTOR';
    }
    const sourceVersion = Math.max(
      readSubjectVersion(database, factor.subjectId),
      factor.factorVersion,
    );
    const version = Math.max(sourceVersion, readSubjectVersion(database, input.subjectId)) + 1;
    // The compare-and-set is the first write, so a refusal leaves nothing behind.
    const moved = database
      .prepare(
        `UPDATE totp_factors
            SET subject_id = ?, provider_id = ?, username = ?, factor_version = ?,
                encryption_key_id = ?, secret_nonce = ?, secret_ciphertext = ?, secret_auth_tag = ?,
                updated_at = ?
          WHERE factor_id = ? AND encryption_key_id = ? AND secret_nonce = ?`,
      )
      .run(
        input.subjectId,
        input.providerId,
        input.username,
        version,
        input.secret.encryptionKeyId,
        input.secret.secretNonce,
        input.secret.secretCiphertext,
        input.secret.secretAuthTag,
        nowIso,
        factor.factorId,
        input.from.encryptionKeyId,
        input.from.secretNonce,
      );
    if (moved.changes !== 1) {
      return 'VERSION_CONFLICT';
    }
    database
      .prepare('UPDATE totp_recovery_codes SET subject_id = ? WHERE factor_id = ?')
      .run(input.subjectId, factor.factorId);
    database
      .prepare('DELETE FROM totp_enrollments WHERE subject_id IN (?, ?)')
      .run(factor.subjectId, input.subjectId);
    const failureState = getFactorFailureState(factor.subjectId);
    database
      .prepare(
        `INSERT INTO totp_subject_versions
           (subject_id, factor_version, username, factor_failures, factor_locked_until)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(subject_id) DO UPDATE SET
           factor_version = excluded.factor_version,
           username = excluded.username,
           factor_failures = excluded.factor_failures,
           factor_locked_until = excluded.factor_locked_until`,
      )
      .run(
        input.subjectId,
        version,
        input.username,
        failureState.failures,
        failureState.lockedUntil,
      );
    writeSubjectVersion(database, factor.subjectId, factor.username, sourceVersion + 1);
    return readFactorBySubject(database, input.subjectId) as TotpFactorRecord;
  });
  if (typeof outcome === 'string') {
    throw new TotpStoreError(outcome);
  }
  return outcome;
}

export interface TotpKeyUsage {
  keyId: string;
  factors: number;
  enrollments: number;
}

/**
 * How many factors and pending enrollments are encrypted under each key id. A
 * key that no longer appears here protects nothing and can leave the key ring.
 */
export function listKeyUsage(): TotpKeyUsage[] {
  return requireDb()
    .prepare(
      `SELECT key_id, SUM(factors) AS factors, SUM(enrollments) AS enrollments FROM (
         SELECT encryption_key_id AS key_id, COUNT(*) AS factors, 0 AS enrollments
           FROM totp_factors GROUP BY encryption_key_id
         UNION ALL
         SELECT encryption_key_id AS key_id, 0 AS factors, COUNT(*) AS enrollments
           FROM totp_enrollments GROUP BY encryption_key_id
       ) GROUP BY key_id ORDER BY key_id`,
    )
    .all()
    .map((row) => ({
      keyId: String(row.key_id),
      factors: Number(row.factors),
      enrollments: Number(row.enrollments),
    }));
}

/* ------------------------------------------------------------------ */
/* Enrollments                                                         */
/* ------------------------------------------------------------------ */

function deleteExpiredForSubject(database: Database, subjectId: string, now: Date): void {
  database
    .prepare('DELETE FROM totp_enrollments WHERE subject_id = ? AND expires_at <= ?')
    .run(subjectId, now.toISOString());
}

/**
 * Start an enrollment. One pending enrollment per subject; an expired one does
 * not count. `expectedFactorVersion` and `replacesFactorId` must describe the
 * subject's actual state, so a stale client cannot queue a replacement for a
 * factor that has since changed. `expiresAt` must be an ISO-8601 UTC string,
 * because expiry compares as text.
 */
export function createEnrollment(record: TotpEnrollmentRecord, now: Date = new Date()): void {
  const expiry = new Date(record.expiresAt);
  if (Number.isNaN(expiry.getTime()) || expiry.toISOString() !== record.expiresAt) {
    throw new TotpStoreError('INVALID_ARGUMENT');
  }
  const database = requireDb();
  const outcome = database.transaction((): TotpStoreErrorCode | undefined => {
    deleteExpiredForSubject(database, record.subjectId, now);
    const pending = database
      .prepare('SELECT 1 AS present FROM totp_enrollments WHERE subject_id = ?')
      .get(record.subjectId);
    if (pending) {
      return 'ENROLLMENT_PENDING';
    }
    const active = readFactorBySubject(database, record.subjectId);
    if (
      readSubjectVersion(database, record.subjectId) !== record.expectedFactorVersion ||
      (active?.factorId ?? null) !== record.replacesFactorId
    ) {
      return 'VERSION_CONFLICT';
    }
    database
      .prepare(
        `INSERT INTO totp_enrollments (
           enrollment_id, schema_version, subject_id, provider_id, username,
           expected_factor_version, replaces_factor_id, encryption_key_id, secret_nonce,
           secret_ciphertext, secret_auth_tag, created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.enrollmentId,
        record.schemaVersion,
        record.subjectId,
        record.providerId,
        record.username,
        record.expectedFactorVersion,
        record.replacesFactorId,
        record.encryptionKeyId,
        record.secretNonce,
        record.secretCiphertext,
        record.secretAuthTag,
        record.createdAt,
        record.expiresAt,
      );
    return undefined;
  });
  if (outcome) {
    throw new TotpStoreError(outcome);
  }
}

function readLiveEnrollment(
  database: Database,
  column: 'enrollment_id' | 'subject_id',
  value: string,
  now: Date,
): TotpEnrollmentRecord | undefined {
  const row = database.prepare(`SELECT * FROM totp_enrollments WHERE ${column} = ?`).get(value);
  if (!row) {
    return undefined;
  }
  const enrollment = toEnrollment(row);
  if (enrollment.expiresAt <= now.toISOString()) {
    database
      .prepare('DELETE FROM totp_enrollments WHERE enrollment_id = ?')
      .run(enrollment.enrollmentId);
    return undefined;
  }
  return enrollment;
}

/** The enrollment, or undefined. An expired one is deleted by the read. */
export function getEnrollment(enrollmentId: string, now: Date = new Date()) {
  return readLiveEnrollment(requireDb(), 'enrollment_id', enrollmentId, now);
}

/**
 * The enrollment whether or not it has expired, and without deleting it. The
 * confirm route needs the difference between an unknown id (404) and one that
 * ran out (410), which {@link getEnrollment} erases by deleting on read.
 */
export function getEnrollmentIncludingExpired(
  enrollmentId: string,
): TotpEnrollmentRecord | undefined {
  const row = requireDb()
    .prepare('SELECT * FROM totp_enrollments WHERE enrollment_id = ?')
    .get(enrollmentId);
  return row ? toEnrollment(row) : undefined;
}

export function getEnrollmentBySubject(subjectId: string, now: Date = new Date()) {
  return readLiveEnrollment(requireDb(), 'subject_id', subjectId, now);
}

/** Cancel an enrollment. Idempotent; false when there was nothing to cancel. */
export function deleteEnrollment(enrollmentId: string): boolean {
  return (
    requireDb().prepare('DELETE FROM totp_enrollments WHERE enrollment_id = ?').run(enrollmentId)
      .changes === 1
  );
}

/**
 * Count one wrong confirmation code against a pending enrollment. The failure
 * that brings the count to `maxFailures` deletes the enrollment, so its seed
 * takes no more guesses and the person starts over with a new one. Both writes
 * are one transaction, so a failure is never counted without being acted on.
 * @returns whether this failure deleted the enrollment
 */
export function recordEnrollmentFailure(enrollmentId: string, maxFailures: number): boolean {
  const database = requireDb();
  return database.transaction((): boolean => {
    database
      .prepare(
        'UPDATE totp_enrollments SET failed_attempts = failed_attempts + 1 WHERE enrollment_id = ?',
      )
      .run(enrollmentId);
    return (
      database
        .prepare('DELETE FROM totp_enrollments WHERE enrollment_id = ? AND failed_attempts >= ?')
        .run(enrollmentId, maxFailures).changes === 1
    );
  });
}

/** Delete every expired enrollment (the hourly sweep). Returns how many. */
export function sweepExpiredEnrollments(now: Date = new Date()): number {
  return requireDb()
    .prepare('DELETE FROM totp_enrollments WHERE expires_at <= ?')
    .run(now.toISOString()).changes;
}

/**
 * Delete the pending enrollments encrypted under any key but `keyId`. A key
 * rotation runs with nobody signed in, so whoever was part-way through setting
 * up starts again rather than keeping a retired key in use. Returns how many.
 */
export function deleteEnrollmentsNotUnderKey(keyId: string): number {
  return requireDb().prepare('DELETE FROM totp_enrollments WHERE encryption_key_id <> ?').run(keyId)
    .changes;
}

/**
 * Confirm an enrollment: write (or replace) the factor, create the first
 * recovery generation, delete the enrollment and move the subject to the next
 * version, all in one transaction. The caller supplies the factor already
 * encrypted under the factor's own row id, because the seed's authenticated
 * data binds the row it lives in and the enrollment row has a different id.
 */
export function activateEnrollment(input: ActivateEnrollmentInput): ActivatedFactor {
  if (!isValidCounter(input.acceptedCounter)) {
    throw new TotpStoreError('INVALID_ARGUMENT');
  }
  const database = requireDb();
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const outcome = database.transaction((): ActivatedFactor | TotpStoreErrorCode => {
    const row = database
      .prepare('SELECT * FROM totp_enrollments WHERE enrollment_id = ?')
      .get(input.enrollmentId);
    if (!row) {
      return 'ENROLLMENT_NOT_FOUND';
    }
    const enrollment = toEnrollment(row);
    if (enrollment.expiresAt <= nowIso) {
      return 'ENROLLMENT_EXPIRED';
    }
    const { factor } = input;
    if (
      factor.subjectId !== enrollment.subjectId ||
      factor.providerId !== enrollment.providerId ||
      factor.username !== enrollment.username
    ) {
      return 'BINDING_MISMATCH';
    }
    const active = readFactorBySubject(database, enrollment.subjectId);
    if (
      readSubjectVersion(database, enrollment.subjectId) !== enrollment.expectedFactorVersion ||
      (active?.factorId ?? null) !== enrollment.replacesFactorId
    ) {
      return 'VERSION_CONFLICT';
    }

    if (active) {
      database.prepare('DELETE FROM totp_recovery_codes WHERE factor_id = ?').run(active.factorId);
      database.prepare('DELETE FROM totp_factors WHERE factor_id = ?').run(active.factorId);
    }
    const factorVersion = enrollment.expectedFactorVersion + 1;
    database
      .prepare(
        `INSERT INTO totp_factors (
           factor_id, schema_version, subject_id, provider_id, username, factor_version,
           encryption_key_id, secret_nonce, secret_ciphertext, secret_auth_tag, algorithm, digits,
           period_seconds, allowed_skew_steps, created_at, activated_at, updated_at,
           last_accepted_counter, recovery_generation
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        factor.factorId,
        factor.schemaVersion,
        factor.subjectId,
        factor.providerId,
        factor.username,
        factorVersion,
        factor.encryptionKeyId,
        factor.secretNonce,
        factor.secretCiphertext,
        factor.secretAuthTag,
        factor.algorithm,
        factor.digits,
        factor.periodSeconds,
        factor.allowedSkewSteps,
        factor.createdAt,
        factor.activatedAt,
        nowIso,
        input.acceptedCounter,
      );
    const recoveryCodeIds = insertRecoveryCodes(
      database,
      factor.factorId,
      factor.subjectId,
      1,
      input.recoveryCodeDigests,
      nowIso,
    );
    database
      .prepare('DELETE FROM totp_enrollments WHERE enrollment_id = ?')
      .run(enrollment.enrollmentId);
    writeSubjectVersion(database, enrollment.subjectId, enrollment.username, factorVersion);

    const stored = readFactorBySubject(database, enrollment.subjectId) as TotpFactorRecord;
    return { factor: stored, recoveryCodeIds };
  });

  if (typeof outcome === 'string') {
    if (outcome === 'ENROLLMENT_EXPIRED') {
      deleteEnrollment(input.enrollmentId);
    }
    throw new TotpStoreError(outcome);
  }
  return outcome;
}

/* ------------------------------------------------------------------ */
/* Recovery codes                                                      */
/* ------------------------------------------------------------------ */

function insertRecoveryCodes(
  database: Database,
  factorId: string,
  subjectId: string,
  generation: number,
  digests: readonly string[],
  createdAt: string,
): string[] {
  if (!digests.every((digest) => RECOVERY_DIGEST_PATTERN.test(digest))) {
    throw new TotpStoreError('INVALID_ARGUMENT');
  }
  const insert = database.prepare(
    `INSERT INTO totp_recovery_codes (
       code_id, schema_version, factor_id, subject_id, generation, code_digest, created_at
     ) VALUES (?, 1, ?, ?, ?, ?, ?)`,
  );
  return digests.map((digest) => {
    const codeId = randomId();
    insert.run(codeId, factorId, subjectId, generation, digest, createdAt);
    return codeId;
  });
}

/** Rows of the factor's current generation, used and unused, in creation order. */
export function listRecoveryCodes(factorId: string): TotpRecoveryCodeRecord[] {
  return requireDb()
    .prepare(
      `SELECT c.* FROM totp_recovery_codes c
         JOIN totp_factors f ON f.factor_id = c.factor_id AND f.recovery_generation = c.generation
       WHERE c.factor_id = ? ORDER BY c.rowid`,
    )
    .all(factorId)
    .map(toRecoveryCode);
}

export function countUnusedRecoveryCodes(factorId: string): number {
  const row = requireDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM totp_recovery_codes c
         JOIN totp_factors f ON f.factor_id = c.factor_id AND f.recovery_generation = c.generation
       WHERE c.factor_id = ? AND c.used_at IS NULL`,
    )
    .get(factorId);
  return Number(row?.n);
}

/**
 * Mark a code used. The UPDATE only matches an unused row of the factor's
 * current generation, so of any number of callers presenting the same code
 * exactly one sees `true`, and a code from a replaced generation never does.
 */
export function markRecoveryCodeUsed(codeId: string, now: Date = new Date()): boolean {
  const result = requireDb()
    .prepare(
      `UPDATE totp_recovery_codes SET used_at = ?
       WHERE code_id = ? AND used_at IS NULL
         AND generation = (SELECT recovery_generation FROM totp_factors
                           WHERE factor_id = totp_recovery_codes.factor_id)`,
    )
    .run(now.toISOString(), codeId);
  return result.changes === 1;
}

/**
 * Undo {@link markRecoveryCodeUsed} for a code the caller itself just spent,
 * when the login it was spent for then failed before a session existed. Only a
 * used row of the factor's current generation matches, and nothing but the
 * caller that won the spend knows the code is spent and unredeemed, so this
 * cannot revive a code someone else used.
 */
export function releaseRecoveryCodeUse(codeId: string): boolean {
  const result = requireDb()
    .prepare(
      `UPDATE totp_recovery_codes SET used_at = NULL
       WHERE code_id = ? AND used_at IS NOT NULL
         AND generation = (SELECT recovery_generation FROM totp_factors
                           WHERE factor_id = totp_recovery_codes.factor_id)`,
    )
    .run(codeId);
  return result.changes === 1;
}

/**
 * Replace the factor's recovery codes with a new generation. The old rows are
 * deleted, so none of them can be redeemed. The factor version is unchanged.
 * @returns the new generation
 */
export function replaceRecoveryCodes(input: {
  factorId: string;
  expectedGeneration: number;
  recoveryCodeDigests: readonly string[];
  now?: Date;
}): number {
  const database = requireDb();
  const nowIso = (input.now ?? new Date()).toISOString();
  const outcome = database.transaction((): number | TotpStoreErrorCode => {
    const row = database
      .prepare('SELECT * FROM totp_factors WHERE factor_id = ?')
      .get(input.factorId);
    if (!row) {
      return 'FACTOR_NOT_FOUND';
    }
    const factor = toFactor(row);
    if (factor.recoveryGeneration !== input.expectedGeneration) {
      return 'GENERATION_CONFLICT';
    }
    const next = factor.recoveryGeneration + 1;
    database.prepare('DELETE FROM totp_recovery_codes WHERE factor_id = ?').run(factor.factorId);
    insertRecoveryCodes(
      database,
      factor.factorId,
      factor.subjectId,
      next,
      input.recoveryCodeDigests,
      nowIso,
    );
    database
      .prepare(
        'UPDATE totp_factors SET recovery_generation = ?, updated_at = ? WHERE factor_id = ?',
      )
      .run(next, nowIso, factor.factorId);
    return next;
  });
  if (typeof outcome === 'string') {
    throw new TotpStoreError(outcome);
  }
  return outcome;
}

/* ------------------------------------------------------------------ */
/* Offline operation markers                                           */
/* ------------------------------------------------------------------ */

/**
 * What the offline command did to a subject while Drydock was stopped. It
 * writes one of these beside the change, and the next start turns each into an
 * audit entry (spec 11.1.2 decision 5). Ids and a time only.
 */
export interface TotpOfflineOperation {
  operation: 'remove' | 'rebind';
  /** The subject the factor was removed from, or moved away from. */
  subjectId: string;
  factorId: string;
  /** A rebind only: the subject the factor belongs to now. */
  targetSubjectId?: string;
  /** ISO-8601 time the command ran. */
  at: string;
}

// Rows of the generic `store_metadata` table, as the one-shot markers of
// `mqtt-hass.ts` are. Every key sits between these two bounds, ':' and ';'
// being neighbours, so the range is exactly the prefix.
const OFFLINE_OPERATION_KEY_PREFIX = 'totp-offline-operation:';
const OFFLINE_OPERATION_KEY_END = 'totp-offline-operation;';

function parseOfflineOperation(value: string): TotpOfflineOperation | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const { operation, subjectId, factorId, targetSubjectId, at } = parsed as Record<string, unknown>;
  if (
    (operation !== 'remove' && operation !== 'rebind') ||
    typeof subjectId !== 'string' ||
    typeof factorId !== 'string' ||
    typeof at !== 'string' ||
    (targetSubjectId !== undefined && typeof targetSubjectId !== 'string')
  ) {
    return undefined;
  }
  return {
    operation,
    subjectId,
    factorId,
    ...(typeof targetSubjectId === 'string' ? { targetSubjectId } : {}),
    at,
  };
}

/** Leave a marker for the next start to record. Call it in the transaction that makes the change. */
export function recordOfflineOperation(operation: TotpOfflineOperation): void {
  writeStoreMetadata(
    requireDb(),
    `${OFFLINE_OPERATION_KEY_PREFIX}${randomId()}`,
    JSON.stringify(operation),
  );
}

export function countPendingOfflineOperations(): number {
  const row = requireDb()
    .prepare('SELECT COUNT(*) AS n FROM store_metadata WHERE key >= ? AND key < ?')
    .get(OFFLINE_OPERATION_KEY_PREFIX, OFFLINE_OPERATION_KEY_END);
  return Number(row?.n);
}

/**
 * Hand every pending marker to `record` and delete it, in one transaction: a
 * marker is only gone once `record` returned for it, and a throw keeps them
 * all for the next start. A marker that cannot be read is deleted and counted
 * rather than handed on.
 */
export function consumeOfflineOperations(record: (operation: TotpOfflineOperation) => void): {
  recorded: number;
  discarded: number;
} {
  const database = requireDb();
  return database.transaction(() => {
    const rows = database
      .prepare(
        'SELECT key, value FROM store_metadata WHERE key >= ? AND key < ? ORDER BY updated_at, key',
      )
      .all(OFFLINE_OPERATION_KEY_PREFIX, OFFLINE_OPERATION_KEY_END);
    let recorded = 0;
    for (const row of rows) {
      const operation = parseOfflineOperation(String(row.value));
      if (operation !== undefined) {
        record(operation);
        recorded += 1;
      }
      database.prepare('DELETE FROM store_metadata WHERE key = ?').run(row.key);
    }
    return { recorded, discarded: rows.length - recorded };
  });
}
