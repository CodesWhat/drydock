/**
 * Fixtures for the offline two-factor tests: a real, file-backed, migrated
 * SQLite store, and factors enrolled in it through the store the way the
 * management API enrolls them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { type Database, openDatabase } from '../store/db/driver.js';
import { migrate } from '../store/db/migrations.js';
import * as totpStore from '../store/totp.js';
import {
  digestRecoveryCode,
  encryptTotpSeed,
  generateRecoveryCodes,
  generateTotpSeed,
  parseTotpKeyring,
  type TotpKeyring,
  type TotpSeedBinding,
  totpCounterAt,
} from './totp-crypto.js';
import { deriveSubjectId } from './totp-identity.js';

export const OLD_KEY = Buffer.alloc(32, 1).toString('base64');
export const NEW_KEY = Buffer.alloc(32, 2).toString('base64');

export function keyringJson(keys: Record<string, string>): string {
  return JSON.stringify(keys);
}

export function keyringOf(keys: Record<string, string>, activeKeyId: string): TotpKeyring {
  return parseTotpKeyring(keyringJson(keys), activeKeyId);
}

/** A migrated store file, opened and bound to the TOTP store module. Close it before copying. */
export function createStoreFile(directory: string, name = 'dd.sqlite'): Database {
  const db = openDatabase(path.join(directory, name));
  migrate(db);
  totpStore.createCollections(db);
  return db;
}

/** Copy a closed store the way an operator would before a drill. */
export function copyStoreFile(directory: string, from = 'dd.sqlite', to = 'drill.sqlite'): string {
  const target = path.join(directory, to);
  fs.copyFileSync(path.join(directory, from), target);
  return target;
}

function bindingFor(subjectId: string, rowId: string): TotpSeedBinding {
  return {
    subjectId,
    rowId,
    schemaVersion: 1,
    algorithm: 'SHA1',
    digits: 6,
    periodSeconds: 30,
    allowedSkewSteps: 1,
  };
}

export interface EnrolledFactor {
  providerId: string;
  username: string;
  subjectId: string;
  factorId: string;
  seed: Buffer;
  recoveryCodes: string[];
}

let serial = 0;

/** Enroll a factor in the store currently bound to the TOTP store module. */
export function enrollFactor(
  providerId: string,
  username: string,
  keyring: TotpKeyring,
): EnrolledFactor {
  serial += 1;
  const subjectId = deriveSubjectId(providerId, username);
  const enrollmentId = `enrollment-${serial}`;
  const factorId = `factor-${serial}`;
  const seed = generateTotpSeed();
  const recoveryCodes = generateRecoveryCodes();
  const now = new Date();
  totpStore.createEnrollment(
    {
      schemaVersion: 1,
      enrollmentId,
      subjectId,
      providerId,
      username,
      expectedFactorVersion: totpStore.getSubjectVersion(subjectId),
      replacesFactorId: null,
      ...encryptTotpSeed(seed, bindingFor(subjectId, enrollmentId), keyring),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 600_000).toISOString(),
    },
    now,
  );
  totpStore.activateEnrollment({
    enrollmentId,
    // Well behind the clock, so a code for the current step is not a replay.
    acceptedCounter: totpCounterAt(now.getTime()) - 5,
    factor: {
      schemaVersion: 1,
      factorId,
      subjectId,
      providerId,
      username,
      ...encryptTotpSeed(seed, bindingFor(subjectId, factorId), keyring),
      algorithm: 'SHA1',
      digits: 6,
      periodSeconds: 30,
      allowedSkewSteps: 1,
      createdAt: now.toISOString(),
      activatedAt: now.toISOString(),
    },
    recoveryCodeDigests: recoveryCodes.map(digestRecoveryCode),
    now,
  });
  return { providerId, username, subjectId, factorId, seed, recoveryCodes };
}

/** Start an enrollment nobody has confirmed, encrypted under the key ring's active key. */
export function startPendingEnrollment(
  providerId: string,
  username: string,
  keyring: TotpKeyring,
): string {
  serial += 1;
  const subjectId = deriveSubjectId(providerId, username);
  const enrollmentId = `pending-${serial}`;
  const now = new Date();
  const active = totpStore.getFactorBySubject(subjectId);
  totpStore.createEnrollment(
    {
      schemaVersion: 1,
      enrollmentId,
      subjectId,
      providerId,
      username,
      expectedFactorVersion: totpStore.getSubjectVersion(subjectId),
      replacesFactorId: active?.factorId ?? null,
      ...encryptTotpSeed(generateTotpSeed(), bindingFor(subjectId, enrollmentId), keyring),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 600_000).toISOString(),
    },
    now,
  );
  return enrollmentId;
}
