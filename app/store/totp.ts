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

export type TotpStoreErrorCode =
  | 'NOT_INITIALIZED'
  | 'INVALID_ARGUMENT'
  | 'ENROLLMENT_PENDING'
  | 'ENROLLMENT_NOT_FOUND'
  | 'ENROLLMENT_EXPIRED'
  | 'VERSION_CONFLICT'
  | 'BINDING_MISMATCH'
  | 'FACTOR_NOT_FOUND'
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

/** Delete every expired enrollment (the hourly sweep). Returns how many. */
export function sweepExpiredEnrollments(now: Date = new Date()): number {
  return requireDb()
    .prepare('DELETE FROM totp_enrollments WHERE expires_at <= ?')
    .run(now.toISOString()).changes;
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
