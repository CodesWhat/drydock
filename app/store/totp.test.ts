/**
 * Tests for the TOTP flat store. They run on real node:sqlite databases because
 * the guarantees that matter (compare-and-set, cascade, unique indexes, what is
 * physically on disk) only exist in the engine.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  decryptTotpSeed,
  digestRecoveryCode,
  encryptTotpSeed,
  findRecoveryCodeMatch,
  generateRecoveryCodes,
  generateTotpSeed,
  parseTotpKeyring,
  type TotpSeedBinding,
  totpCounterAt,
  verifyTotp,
} from '../api/totp-crypto.js';
import { createMigratedMemoryDatabase, createTemporaryStoreDirectory } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import { openDatabase } from './db/driver.js';
import { migrate } from './db/migrations.js';

const { mockLog } = vi.hoisted(() => ({
  mockLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../log/index.js', () => ({ default: { child: vi.fn(() => mockLog) } }));

import * as totp from './totp.js';

const NOW = new Date('2026-10-03T12:00:00.000Z');
const CONFIRM_COUNTER = totpCounterAt(NOW.getTime()) - 1;
const LATER = new Date(NOW.getTime() + 60 * 60 * 1000);
const keyring = parseTotpKeyring(
  JSON.stringify({ k1: Buffer.alloc(32, 1).toString('base64') }),
  'k1',
);

let db: Database;

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

function enrollmentFor(
  subjectId = 'subject-a',
  overrides: Partial<totp.TotpEnrollmentRecord> = {},
  seed = generateTotpSeed(),
): totp.TotpEnrollmentRecord {
  const enrollmentId = overrides.enrollmentId ?? `enrollment-${subjectId}`;
  return {
    schemaVersion: 1,
    enrollmentId,
    subjectId,
    providerId: 'basic.one',
    username: 'scott',
    expectedFactorVersion: 0,
    replacesFactorId: null,
    ...encryptTotpSeed(seed, bindingFor(subjectId, enrollmentId), keyring),
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 10 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function factorFor(
  enrollment: totp.TotpEnrollmentRecord,
  factorId = `factor-${enrollment.subjectId}`,
  seed = generateTotpSeed(),
): totp.NewTotpFactor {
  return {
    schemaVersion: 1,
    factorId,
    subjectId: enrollment.subjectId,
    providerId: enrollment.providerId,
    username: enrollment.username,
    ...encryptTotpSeed(seed, bindingFor(enrollment.subjectId, factorId), keyring),
    algorithm: 'SHA1',
    digits: 6,
    periodSeconds: 30,
    allowedSkewSteps: 1,
    createdAt: NOW.toISOString(),
    activatedAt: NOW.toISOString(),
  };
}

function activate(subjectId = 'subject-a', now = NOW) {
  const enrollment = enrollmentFor(subjectId);
  totp.createEnrollment(enrollment, now);
  const codes = generateRecoveryCodes();
  const factor = factorFor(enrollment);
  const result = totp.activateEnrollment({
    enrollmentId: enrollment.enrollmentId,
    acceptedCounter: CONFIRM_COUNTER,
    factor,
    recoveryCodeDigests: codes.map(digestRecoveryCode),
    now,
  });
  return { enrollment, factor, codes, result };
}

function expectCode(fn: () => unknown, code: string) {
  expect(fn).toThrow(expect.objectContaining({ name: 'TotpStoreError', code }));
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMigratedMemoryDatabase();
  totp.createCollections(db);
});

afterEach(() => {
  db.close();
});

describe('before the collection exists', () => {
  test('every operation fails with a clear error', async () => {
    vi.resetModules();
    const fresh = await import('./totp.js');
    expectCode(() => fresh.getSubjectVersion('s'), 'NOT_INITIALIZED');
    expectCode(() => fresh.hasEnrolledUsername('s'), 'NOT_INITIALIZED');
  });
});

describe('subject version', () => {
  test('is zero for a subject nobody has touched', () => {
    expect(totp.getSubjectVersion('nobody')).toBe(0);
  });

  test('records the username on every write, activation and removal alike', () => {
    activate('subject-a');
    const row = () =>
      db
        .prepare('SELECT username, factor_version FROM totp_subject_versions WHERE subject_id = ?')
        .get('subject-a');
    expect(row()).toEqual({ username: 'scott', factor_version: 1 });
    totp.removeFactor({ subjectId: 'subject-a', expectedFactorVersion: 1 });
    expect(row()).toEqual({ username: 'scott', factor_version: 2 });
  });

  test('hasEnrolledUsername is false with no rows and for versions still at 0', () => {
    expect(totp.hasEnrolledUsername('scott')).toBe(false);
    db.prepare(
      'INSERT INTO totp_subject_versions (subject_id, factor_version, username) VALUES (?, 0, ?)',
    ).run('s0', 'scott');
    expect(totp.hasEnrolledUsername('scott')).toBe(false);
  });

  test('hasEnrolledUsername is true for the exact username once a version is positive, removal included', () => {
    activate('subject-a');
    expect(totp.hasEnrolledUsername('scott')).toBe(true);
    expect(totp.hasEnrolledUsername('Scott')).toBe(false);
    expect(totp.hasEnrolledUsername('other')).toBe(false);
    totp.removeFactor({ subjectId: 'subject-a', expectedFactorVersion: 1 });
    expect(totp.hasEnrolledUsername('scott')).toBe(true);
  });

  test('hasEnrolledUsername treats a positive row with an unknown username as enrolled for everyone', () => {
    db.prepare(
      'INSERT INTO totp_subject_versions (subject_id, factor_version, username) VALUES (?, 2, NULL)',
    ).run('unknown-row');
    expect(totp.hasEnrolledUsername('anyone')).toBe(true);
  });
});

describe('enrollments', () => {
  test('stores and reads back an enrollment', () => {
    const enrollment = enrollmentFor();
    totp.createEnrollment(enrollment, NOW);
    expect(totp.getEnrollment(enrollment.enrollmentId, NOW)).toEqual(enrollment);
    expect(totp.getEnrollmentBySubject('subject-a', NOW)).toEqual(enrollment);
  });

  test('returns undefined for an unknown enrollment or subject', () => {
    expect(totp.getEnrollment('nope', NOW)).toBeUndefined();
    expect(totp.getEnrollmentBySubject('nope', NOW)).toBeUndefined();
  });

  test('allows only one pending enrollment per subject', () => {
    totp.createEnrollment(enrollmentFor(), NOW);
    expectCode(
      () => totp.createEnrollment(enrollmentFor('subject-a', { enrollmentId: 'other' }), NOW),
      'ENROLLMENT_PENDING',
    );
  });

  test('keeps enrollments of different subjects separate', () => {
    totp.createEnrollment(enrollmentFor('subject-a'), NOW);
    totp.createEnrollment(enrollmentFor('subject-b'), NOW);
    expect(totp.getEnrollmentBySubject('subject-b', NOW)?.subjectId).toBe('subject-b');
  });

  test('deletes an expired enrollment when it is read', () => {
    const enrollment = enrollmentFor();
    totp.createEnrollment(enrollment, NOW);
    expect(totp.getEnrollment(enrollment.enrollmentId, LATER)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
  });

  test('deletes an expired enrollment when it is read by subject', () => {
    totp.createEnrollment(enrollmentFor(), NOW);
    expect(totp.getEnrollmentBySubject('subject-a', LATER)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
  });

  test('an expired pending enrollment does not block a new one', () => {
    totp.createEnrollment(enrollmentFor(), NOW);
    const replacement = enrollmentFor('subject-a', {
      enrollmentId: 'fresh',
      expiresAt: new Date(LATER.getTime() + 600_000).toISOString(),
    });
    totp.createEnrollment(replacement, LATER);
    expect(totp.getEnrollmentBySubject('subject-a', LATER)?.enrollmentId).toBe('fresh');
  });

  test('the hourly sweep removes only expired rows', () => {
    totp.createEnrollment(enrollmentFor('subject-a'), NOW);
    totp.createEnrollment(
      enrollmentFor('subject-b', { expiresAt: new Date(LATER.getTime() + 1000).toISOString() }),
      NOW,
    );
    expect(totp.sweepExpiredEnrollments(LATER)).toBe(1);
    expect(totp.getEnrollmentBySubject('subject-b', LATER)).toBeDefined();
    expect(totp.sweepExpiredEnrollments(LATER)).toBe(0);
  });

  test('cancelling is idempotent', () => {
    const enrollment = enrollmentFor();
    totp.createEnrollment(enrollment, NOW);
    expect(totp.deleteEnrollment(enrollment.enrollmentId)).toBe(true);
    expect(totp.deleteEnrollment(enrollment.enrollmentId)).toBe(false);
  });

  test('refuses an enrollment built against a stale factor version', () => {
    expectCode(
      () => totp.createEnrollment(enrollmentFor('subject-a', { expectedFactorVersion: 4 }), NOW),
      'VERSION_CONFLICT',
    );
  });

  test('a replacement must name the factor that is actually active', () => {
    activate();
    const wrong = enrollmentFor('subject-a', {
      enrollmentId: 'e2',
      expectedFactorVersion: 1,
      replacesFactorId: 'not-the-factor',
    });
    expectCode(() => totp.createEnrollment(wrong, NOW), 'VERSION_CONFLICT');
    const none = enrollmentFor('subject-a', { enrollmentId: 'e3', expectedFactorVersion: 1 });
    expectCode(() => totp.createEnrollment(none, NOW), 'VERSION_CONFLICT');
  });

  test('refuses an expiry that is not ISO-8601 UTC', () => {
    expectCode(
      () => totp.createEnrollment(enrollmentFor('subject-a', { expiresAt: 'tomorrow' }), NOW),
      'INVALID_ARGUMENT',
    );
  });

  test('a first enrollment cannot claim to replace something', () => {
    expectCode(
      () => totp.createEnrollment(enrollmentFor('subject-a', { replacesFactorId: 'ghost' }), NOW),
      'VERSION_CONFLICT',
    );
  });
});

describe('activation', () => {
  test('creates the factor at version 1 and consumes the enrollment', () => {
    const { enrollment, factor, result, codes } = activate();
    expect(result.factor).toMatchObject({
      factorId: factor.factorId,
      subjectId: 'subject-a',
      factorVersion: 1,
      recoveryGeneration: 1,
      lastAcceptedCounter: CONFIRM_COUNTER,
      updatedAt: NOW.toISOString(),
    });
    expect(result.recoveryCodeIds).toHaveLength(codes.length);
    expect(totp.getSubjectVersion('subject-a')).toBe(1);
    expect(totp.getEnrollment(enrollment.enrollmentId, NOW)).toBeUndefined();
    expect(totp.getFactorBySubject('subject-a')).toEqual(result.factor);
    expect(totp.getFactor(factor.factorId)).toEqual(result.factor);
    expect(totp.countUnusedRecoveryCodes(factor.factorId)).toBe(10);
  });

  test('the stored seed is decryptable with the original binding only', () => {
    const { factor } = activate();
    const stored = totp.getFactor(factor.factorId) as totp.TotpFactorRecord;
    expect(decryptTotpSeed(stored, bindingFor('subject-a', factor.factorId), keyring)).toHaveLength(
      20,
    );
    expect(() =>
      decryptTotpSeed(stored, bindingFor('subject-a', 'some-other-row'), keyring),
    ).toThrow();
  });

  test('returns undefined for an unknown factor', () => {
    expect(totp.getFactor('nope')).toBeUndefined();
    expect(totp.getFactorBySubject('nope')).toBeUndefined();
  });

  test.each([['unknown', () => 'missing', 'ENROLLMENT_NOT_FOUND']])(
    'refuses an %s enrollment',
    (_name, id, code) => {
      const enrollment = enrollmentFor();
      expectCode(
        () =>
          totp.activateEnrollment({
            enrollmentId: id(),
            acceptedCounter: CONFIRM_COUNTER,
            factor: factorFor(enrollment),
            recoveryCodeDigests: [],
            now: NOW,
          }),
        code,
      );
    },
  );

  test('refuses an expired enrollment and removes it', () => {
    const enrollment = enrollmentFor();
    totp.createEnrollment(enrollment, NOW);
    expectCode(
      () =>
        totp.activateEnrollment({
          enrollmentId: enrollment.enrollmentId,
          acceptedCounter: CONFIRM_COUNTER,
          factor: factorFor(enrollment),
          recoveryCodeDigests: [],
          now: LATER,
        }),
      'ENROLLMENT_EXPIRED',
    );
    expect(db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
  });

  test.each([
    ['subject', { subjectId: 'subject-b' }],
    ['provider', { providerId: 'basic.two' }],
    ['username', { username: 'someone-else' }],
  ])('refuses a factor for a different %s', (_name, override) => {
    const enrollment = enrollmentFor();
    totp.createEnrollment(enrollment, NOW);
    expectCode(
      () =>
        totp.activateEnrollment({
          enrollmentId: enrollment.enrollmentId,
          acceptedCounter: CONFIRM_COUNTER,
          factor: { ...factorFor(enrollment), ...override },
          recoveryCodeDigests: [],
          now: NOW,
        }),
      'BINDING_MISMATCH',
    );
    expect(totp.getEnrollment(enrollment.enrollmentId, NOW)).toBeDefined();
  });

  test('refuses when the subject version moved after enrollment started', () => {
    const enrollment = enrollmentFor();
    totp.createEnrollment(enrollment, NOW);
    db.prepare('INSERT INTO totp_subject_versions (subject_id, factor_version) VALUES (?, ?)').run(
      'subject-a',
      3,
    );
    expectCode(
      () =>
        totp.activateEnrollment({
          enrollmentId: enrollment.enrollmentId,
          acceptedCounter: CONFIRM_COUNTER,
          factor: factorFor(enrollment),
          recoveryCodeDigests: [],
          now: NOW,
        }),
      'VERSION_CONFLICT',
    );
  });

  test('refuses when the factor being replaced is no longer the active one', () => {
    activate();
    const replacement = enrollmentFor('subject-a', {
      enrollmentId: 'e2',
      expectedFactorVersion: 1,
      replacesFactorId: 'factor-subject-a',
    });
    totp.createEnrollment(replacement, NOW);
    db.prepare('DELETE FROM totp_factors').run();
    expectCode(
      () =>
        totp.activateEnrollment({
          enrollmentId: 'e2',
          acceptedCounter: CONFIRM_COUNTER,
          factor: factorFor(replacement, 'factor-2'),
          recoveryCodeDigests: [],
          now: NOW,
        }),
      'VERSION_CONFLICT',
    );
  });

  test('is atomic: a failure part-way leaves everything as it was', () => {
    const enrollment = enrollmentFor();
    totp.createEnrollment(enrollment, NOW);
    const digest = digestRecoveryCode(generateRecoveryCodes(1)[0]);
    expect(() =>
      totp.activateEnrollment({
        enrollmentId: enrollment.enrollmentId,
        acceptedCounter: CONFIRM_COUNTER,
        factor: factorFor(enrollment),
        recoveryCodeDigests: [digest, digest],
        now: NOW,
      }),
    ).toThrow();
    expect(totp.getFactorBySubject('subject-a')).toBeUndefined();
    expect(totp.getSubjectVersion('subject-a')).toBe(0);
    expect(totp.getEnrollment(enrollment.enrollmentId, NOW)).toBeDefined();
  });

  test('replacement swaps the factor, bumps the version and discards the old recovery codes', () => {
    const first = activate();
    const replacement = enrollmentFor('subject-a', {
      enrollmentId: 'e2',
      expectedFactorVersion: 1,
      replacesFactorId: first.factor.factorId,
    });
    totp.createEnrollment(replacement, NOW);
    const newCodes = generateRecoveryCodes();
    const result = totp.activateEnrollment({
      enrollmentId: 'e2',
      acceptedCounter: CONFIRM_COUNTER,
      factor: factorFor(replacement, 'factor-2'),
      recoveryCodeDigests: newCodes.map(digestRecoveryCode),
      now: NOW,
    });
    expect(result.factor.factorVersion).toBe(2);
    expect(totp.getFactor(first.factor.factorId)).toBeUndefined();
    expect(totp.getFactorBySubject('subject-a')?.factorId).toBe('factor-2');
    expect(db.prepare('SELECT COUNT(*) AS n FROM totp_recovery_codes').get()).toEqual({ n: 10 });
    expect(totp.getSubjectVersion('subject-a')).toBe(2);
  });

  test('a replacement that is abandoned leaves the old factor intact', () => {
    const first = activate();
    const replacement = enrollmentFor('subject-a', {
      enrollmentId: 'e2',
      expectedFactorVersion: 1,
      replacesFactorId: first.factor.factorId,
    });
    totp.createEnrollment(replacement, NOW);
    expect(totp.getEnrollment('e2', LATER)).toBeUndefined();
    expect(totp.getFactorBySubject('subject-a')?.factorVersion).toBe(1);
  });
});

describe('removal', () => {
  test('deletes the factor and its codes and keeps counting versions', () => {
    const { factor } = activate();
    expect(totp.removeFactor({ subjectId: 'subject-a', expectedFactorVersion: 1 })).toBe(2);
    expect(totp.getFactor(factor.factorId)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM totp_recovery_codes').get()).toEqual({ n: 0 });
    expect(totp.getSubjectVersion('subject-a')).toBe(2);
  });

  test('re-enrolling after removal continues from the new version', () => {
    activate();
    totp.removeFactor({ subjectId: 'subject-a', expectedFactorVersion: 1 });
    const again = enrollmentFor('subject-a', { enrollmentId: 'e9', expectedFactorVersion: 2 });
    totp.createEnrollment(again, NOW);
    const result = totp.activateEnrollment({
      enrollmentId: 'e9',
      acceptedCounter: CONFIRM_COUNTER,
      factor: factorFor(again, 'factor-9'),
      recoveryCodeDigests: [],
      now: NOW,
    });
    expect(result.factor.factorVersion).toBe(3);
  });

  test('reports an absent factor', () => {
    expectCode(
      () => totp.removeFactor({ subjectId: 'nope', expectedFactorVersion: 0 }),
      'FACTOR_NOT_FOUND',
    );
  });

  test('refuses a stale version', () => {
    activate();
    expectCode(
      () => totp.removeFactor({ subjectId: 'subject-a', expectedFactorVersion: 0 }),
      'VERSION_CONFLICT',
    );
    expect(totp.getFactorBySubject('subject-a')).toBeDefined();
  });

  test('also drops a pending replacement so it cannot outlive the factor', () => {
    const first = activate();
    totp.createEnrollment(
      enrollmentFor('subject-a', {
        enrollmentId: 'e2',
        expectedFactorVersion: 1,
        replacesFactorId: first.factor.factorId,
      }),
      NOW,
    );
    totp.removeFactor({ subjectId: 'subject-a', expectedFactorVersion: 1 });
    expect(totp.getEnrollmentBySubject('subject-a', NOW)).toBeUndefined();
  });
});

describe('accepted counter replay', () => {
  const counter = totpCounterAt(NOW.getTime());

  test('the first acceptance wins and the same counter cannot be taken again', () => {
    const { factor } = activate();
    expect(totp.advanceLastAcceptedCounter(factor.factorId, counter, 1)).toBe(true);
    expect(totp.advanceLastAcceptedCounter(factor.factorId, counter, 1)).toBe(false);
    expect(totp.getFactor(factor.factorId)?.lastAcceptedCounter).toBe(counter);
  });

  test('refuses a lower counter after a higher one (clock rollback)', () => {
    const { factor } = activate();
    expect(totp.advanceLastAcceptedCounter(factor.factorId, counter + 1, 1)).toBe(true);
    expect(totp.advanceLastAcceptedCounter(factor.factorId, counter, 1)).toBe(false);
    expect(totp.getFactor(factor.factorId)?.lastAcceptedCounter).toBe(counter + 1);
  });

  test('accepts a higher counter', () => {
    const { factor } = activate();
    totp.advanceLastAcceptedCounter(factor.factorId, counter, 1);
    expect(totp.advanceLastAcceptedCounter(factor.factorId, counter + 1, 1)).toBe(true);
  });

  test('the confirmation code counter is already spent at activation', () => {
    const { factor } = activate();
    expect(totp.getFactor(factor.factorId)?.lastAcceptedCounter).toBe(CONFIRM_COUNTER);
    expect(totp.advanceLastAcceptedCounter(factor.factorId, CONFIRM_COUNTER, 1)).toBe(false);
    expect(totp.advanceLastAcceptedCounter(factor.factorId, CONFIRM_COUNTER + 1, 1)).toBe(true);
  });

  test('a stale factor version cannot advance the counter', () => {
    const { factor } = activate();
    expect(totp.advanceLastAcceptedCounter(factor.factorId, counter + 5, 0)).toBe(false);
    expect(totp.advanceLastAcceptedCounter(factor.factorId, counter + 5, 2)).toBe(false);
    expect(totp.getFactor(factor.factorId)?.lastAcceptedCounter).toBe(CONFIRM_COUNTER);
  });

  test('rejects an invalid factor version', () => {
    const { factor } = activate();
    expectCode(
      () => totp.advanceLastAcceptedCounter(factor.factorId, counter, -1),
      'INVALID_ARGUMENT',
    );
    expectCode(
      () => totp.advanceLastAcceptedCounter(factor.factorId, counter, 1.5),
      'INVALID_ARGUMENT',
    );
  });

  test('returns false for an unknown factor', () => {
    expect(totp.advanceLastAcceptedCounter('nope', counter, 1)).toBe(false);
  });

  test('rejects an invalid counter', () => {
    const { factor } = activate();
    expectCode(() => totp.advanceLastAcceptedCounter(factor.factorId, -1, 1), 'INVALID_ARGUMENT');
    expectCode(() => totp.advanceLastAcceptedCounter(factor.factorId, 1.5, 1), 'INVALID_ARGUMENT');
  });

  test('two concurrent verifications of one code produce exactly one winner', async () => {
    const { factor } = activate();
    const seed = decryptTotpSeed(
      totp.getFactor(factor.factorId) as totp.TotpFactorRecord,
      bindingFor('subject-a', factor.factorId),
      keyring,
    );
    const code = (await import('../api/totp-crypto.js')).generateTotp(seed, NOW.getTime());

    const attempt = async () => {
      // Both attempts read the same stored counter before either writes.
      const stored = totp.getFactor(factor.factorId) as totp.TotpFactorRecord;
      await Promise.resolve();
      const verdict = verifyTotp({
        secret: seed,
        code,
        nowMs: NOW.getTime(),
        lastAcceptedCounter: stored.lastAcceptedCounter,
      });
      await Promise.resolve();
      return verdict.valid && totp.advanceLastAcceptedCounter(factor.factorId, verdict.counter, 1);
    };

    const outcomes = await Promise.all([attempt(), attempt(), attempt(), attempt()]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });
});

describe('recovery codes', () => {
  test('lists the active generation with digests only', () => {
    const { factor, codes } = activate();
    const rows = totp.listRecoveryCodes(factor.factorId);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      factorId: factor.factorId,
      subjectId: 'subject-a',
      generation: 1,
      usedAt: null,
      schemaVersion: 1,
    });
    expect(new Set(rows.map((row) => row.codeDigest)).size).toBe(10);
    expect(JSON.stringify(rows)).not.toContain(codes[0]);
    expect(findRecoveryCodeMatch(codes[3], rows)).toBeDefined();
  });

  test('a code can be marked used once and only once', () => {
    const { factor, codes } = activate();
    const row = findRecoveryCodeMatch(codes[0], totp.listRecoveryCodes(factor.factorId));
    expect(row).toBeDefined();
    const codeId = (row as totp.TotpRecoveryCodeRecord).codeId;
    expect(totp.markRecoveryCodeUsed(codeId, NOW)).toBe(true);
    expect(totp.markRecoveryCodeUsed(codeId, NOW)).toBe(false);
    expect(totp.countUnusedRecoveryCodes(factor.factorId)).toBe(9);
    expect(
      findRecoveryCodeMatch(codes[0], totp.listRecoveryCodes(factor.factorId)),
    ).toBeUndefined();
  });

  test('concurrent use of one code has a single winner', async () => {
    const { factor, codes } = activate();
    const attempt = async () => {
      const rows = totp.listRecoveryCodes(factor.factorId);
      await Promise.resolve();
      const match = findRecoveryCodeMatch(codes[5], rows);
      await Promise.resolve();
      return match !== undefined && totp.markRecoveryCodeUsed(match.codeId, NOW);
    };
    const outcomes = await Promise.all([attempt(), attempt(), attempt()]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });

  test('using up every code leaves the factor in place with none remaining', () => {
    const { factor, codes } = activate();
    for (const code of codes) {
      const row = findRecoveryCodeMatch(code, totp.listRecoveryCodes(factor.factorId));
      expect(totp.markRecoveryCodeUsed((row as totp.TotpRecoveryCodeRecord).codeId, NOW)).toBe(
        true,
      );
    }
    expect(totp.countUnusedRecoveryCodes(factor.factorId)).toBe(0);
    expect(totp.getFactor(factor.factorId)).toBeDefined();
  });

  test('marking an unknown code is a no-op', () => {
    expect(totp.markRecoveryCodeUsed('nope', NOW)).toBe(false);
  });

  test('replacement invalidates the old generation and installs the new one', () => {
    const { factor, codes } = activate();
    const fresh = generateRecoveryCodes();
    const oldRow = findRecoveryCodeMatch(
      codes[0],
      totp.listRecoveryCodes(factor.factorId),
    ) as totp.TotpRecoveryCodeRecord;

    const generation = totp.replaceRecoveryCodes({
      factorId: factor.factorId,
      expectedGeneration: 1,
      recoveryCodeDigests: fresh.map(digestRecoveryCode),
      now: NOW,
    });
    expect(generation).toBe(2);
    expect(totp.getFactor(factor.factorId)?.recoveryGeneration).toBe(2);
    expect(
      findRecoveryCodeMatch(codes[0], totp.listRecoveryCodes(factor.factorId)),
    ).toBeUndefined();
    expect(findRecoveryCodeMatch(fresh[0], totp.listRecoveryCodes(factor.factorId))).toBeDefined();
    expect(totp.markRecoveryCodeUsed(oldRow.codeId, NOW)).toBe(false);
    expect(totp.countUnusedRecoveryCodes(factor.factorId)).toBe(10);
    expect(db.prepare('SELECT COUNT(*) AS n FROM totp_recovery_codes').get()).toEqual({ n: 10 });
  });

  test('replacement does not change the factor version', () => {
    const { factor } = activate();
    totp.replaceRecoveryCodes({
      factorId: factor.factorId,
      expectedGeneration: 1,
      recoveryCodeDigests: [digestRecoveryCode(generateRecoveryCodes(1)[0])],
      now: NOW,
    });
    expect(totp.getFactor(factor.factorId)?.factorVersion).toBe(1);
    expect(totp.getSubjectVersion('subject-a')).toBe(1);
  });

  test('replacement refuses a stale generation or an unknown factor', () => {
    const { factor } = activate();
    expectCode(
      () =>
        totp.replaceRecoveryCodes({
          factorId: factor.factorId,
          expectedGeneration: 7,
          recoveryCodeDigests: [],
          now: NOW,
        }),
      'GENERATION_CONFLICT',
    );
    expectCode(
      () =>
        totp.replaceRecoveryCodes({
          factorId: 'nope',
          expectedGeneration: 1,
          recoveryCodeDigests: [],
          now: NOW,
        }),
      'FACTOR_NOT_FOUND',
    );
  });

  test('replacement is atomic', () => {
    const { factor, codes } = activate();
    const digest = digestRecoveryCode(generateRecoveryCodes(1)[0]);
    expect(() =>
      totp.replaceRecoveryCodes({
        factorId: factor.factorId,
        expectedGeneration: 1,
        recoveryCodeDigests: [digest, digest],
        now: NOW,
      }),
    ).toThrow();
    expect(totp.getFactor(factor.factorId)?.recoveryGeneration).toBe(1);
    expect(findRecoveryCodeMatch(codes[0], totp.listRecoveryCodes(factor.factorId))).toBeDefined();
  });
});

describe('seed rewrap persistence', () => {
  test('swaps the stored ciphertext only if it is still the one that was read', () => {
    const { factor } = activate();
    const stored = totp.getFactor(factor.factorId) as totp.TotpFactorRecord;
    const next = encryptTotpSeed(
      generateTotpSeed(),
      bindingFor('subject-a', factor.factorId),
      keyring,
    );

    expect(totp.rewrapFactorSecret(factor.factorId, stored, next, NOW)).toBe(true);
    expect(totp.getFactor(factor.factorId)).toMatchObject({
      secretNonce: next.secretNonce,
      secretCiphertext: next.secretCiphertext,
      updatedAt: NOW.toISOString(),
      factorVersion: 1,
    });
    expect(totp.rewrapFactorSecret(factor.factorId, stored, next, NOW)).toBe(false);
  });

  test('lists every factor for a rotation sweep', () => {
    activate('subject-a');
    activate('subject-b');
    expect(
      totp
        .listFactors()
        .map((row) => row.subjectId)
        .sort(),
    ).toEqual(['subject-a', 'subject-b']);
  });
});

describe('default clock', () => {
  test('activation and recovery replacement use the current time when none is given', () => {
    const live = new Date();
    const enrollment = enrollmentFor('subject-live', {
      createdAt: live.toISOString(),
      expiresAt: new Date(live.getTime() + 600_000).toISOString(),
    });
    totp.createEnrollment(enrollment);
    const { factor } = totp.activateEnrollment({
      enrollmentId: enrollment.enrollmentId,
      acceptedCounter: CONFIRM_COUNTER,
      factor: factorFor(enrollment),
      recoveryCodeDigests: [digestRecoveryCode(generateRecoveryCodes(1)[0])],
    });
    expect(Date.parse(factor.updatedAt)).toBeGreaterThanOrEqual(live.getTime());
    totp.replaceRecoveryCodes({
      factorId: factor.factorId,
      expectedGeneration: 1,
      recoveryCodeDigests: [],
    });
    expect(totp.getFactor(factor.factorId)?.recoveryGeneration).toBe(2);
  });
});

describe('schema invariants', () => {
  test('one factor per subject', () => {
    activate();
    expect(() =>
      db
        .prepare(
          `INSERT INTO totp_factors (factor_id, schema_version, subject_id, provider_id, username,
             factor_version, encryption_key_id, secret_nonce, secret_ciphertext, secret_auth_tag,
             algorithm, digits, period_seconds, allowed_skew_steps, created_at, activated_at,
             updated_at, recovery_generation)
           VALUES ('dup', 1, 'subject-a', 'p', 'u', 1, 'k', 'n', 'c', 't', 'SHA1', 6, 30, 1, 'x', 'x', 'x', 1)`,
        )
        .run(),
    ).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }));
  });

  test('the recovery index covers factor, generation and used state', () => {
    const plan = db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT * FROM totp_recovery_codes WHERE factor_id = ? AND generation = ? AND used_at IS NULL',
      )
      .all('f', 1)
      .map((row) => String(row.detail))
      .join(' ');
    expect(plan).toContain('totp_recovery_codes_factor_generation_used');
  });
});

describe('persistence and plaintext', () => {
  test('survives a restart and holds no plaintext secret on disk', () => {
    const directory = createTemporaryStoreDirectory();
    const location = path.join(directory, 'dd.sqlite');
    try {
      const first = openDatabase(location);
      migrate(first);
      totp.createCollections(first);

      const seed = generateTotpSeed();
      const enrollment = enrollmentFor('subject-a', {}, seed);
      totp.createEnrollment(enrollment, NOW);
      const codes = generateRecoveryCodes();
      const factor = factorFor(enrollment, 'factor-subject-a', seed);
      totp.activateEnrollment({
        enrollmentId: enrollment.enrollmentId,
        acceptedCounter: CONFIRM_COUNTER,
        factor,
        recoveryCodeDigests: codes.map(digestRecoveryCode),
        now: NOW,
      });
      first.pragma('wal_checkpoint', 'TRUNCATE');
      first.close();

      const reopened = openDatabase(location);
      migrate(reopened);
      totp.createCollections(reopened);
      const stored = totp.getFactorBySubject('subject-a') as totp.TotpFactorRecord;
      expect(stored.factorVersion).toBe(1);
      expect(
        decryptTotpSeed(stored, bindingFor('subject-a', factor.factorId), keyring).equals(seed),
      ).toBe(true);
      expect(totp.countUnusedRecoveryCodes(factor.factorId)).toBe(10);
      reopened.pragma('wal_checkpoint', 'TRUNCATE');
      reopened.close();

      const onDisk = fs
        .readdirSync(directory)
        .map((name) => fs.readFileSync(path.join(directory, name)))
        .reduce((all, next) => Buffer.concat([all, next]), Buffer.alloc(0));
      expect(onDisk.includes(seed)).toBe(false);
      expect(onDisk.includes(Buffer.from(seed.toString('base64')))).toBe(false);
      expect(onDisk.includes(Buffer.from(seed.toString('hex')))).toBe(false);
      for (const code of codes) {
        expect(onDisk.includes(Buffer.from(code))).toBe(false);
        expect(onDisk.includes(Buffer.from(code.replaceAll('-', '')))).toBe(false);
      }
      expect(onDisk.includes(Buffer.from(keyring.keys.get('k1') as Buffer))).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('never logs or throws secret material', () => {
    const seed = generateTotpSeed();
    const enrollment = enrollmentFor('subject-a', {}, seed);
    totp.createEnrollment(enrollment, NOW);
    const codes = generateRecoveryCodes();
    totp.activateEnrollment({
      enrollmentId: enrollment.enrollmentId,
      acceptedCounter: CONFIRM_COUNTER,
      factor: factorFor(enrollment, 'factor-subject-a', seed),
      recoveryCodeDigests: codes.map(digestRecoveryCode),
      now: NOW,
    });
    let message = '';
    try {
      totp.createEnrollment(enrollmentFor('subject-a', { enrollmentId: 'x' }), NOW);
    } catch (error) {
      message = (error as Error).message;
    }
    const logged = JSON.stringify(
      Object.values(mockLog).flatMap((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls),
    );
    for (const text of [message, logged]) {
      expect(text).not.toContain(seed.toString('base64'));
      expect(text).not.toContain(enrollment.secretCiphertext);
      expect(text).not.toContain(codes[0]);
    }
  });
});

describe('activation confirmation counter validation', () => {
  test.each([[-1], [1.5], [Number.NaN], [Number.MAX_SAFE_INTEGER + 1]])(
    'rejects acceptedCounter %s',
    (acceptedCounter) => {
      const enrollment = enrollmentFor();
      totp.createEnrollment(enrollment, NOW);
      expectCode(
        () =>
          totp.activateEnrollment({
            enrollmentId: enrollment.enrollmentId,
            acceptedCounter,
            factor: factorFor(enrollment),
            recoveryCodeDigests: [],
            now: NOW,
          }),
        'INVALID_ARGUMENT',
      );
      expect(totp.getEnrollment(enrollment.enrollmentId, NOW)).toBeDefined();
    },
  );
});

describe('recovery digest validation', () => {
  const insertRaw = (digest: string) =>
    db
      .prepare(
        `INSERT INTO totp_recovery_codes (code_id, schema_version, factor_id, subject_id, generation,
           code_digest, created_at) VALUES ('raw', 1, ?, 'subject-a', 1, ?, 'x')`,
      )
      .run(activate().factor.factorId, digest);

  test.each([['short'], ['A'.repeat(64)], ['g'.repeat(64)], ['a'.repeat(63)], ['a'.repeat(65)]])(
    'the schema refuses digest %s',
    (digest) => {
      expect(() => insertRaw(digest)).toThrow(
        expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }),
      );
    },
  );

  test('activation refuses a malformed digest and writes nothing', () => {
    const enrollment = enrollmentFor();
    totp.createEnrollment(enrollment, NOW);
    expectCode(
      () =>
        totp.activateEnrollment({
          enrollmentId: enrollment.enrollmentId,
          acceptedCounter: CONFIRM_COUNTER,
          factor: factorFor(enrollment),
          recoveryCodeDigests: ['not-a-digest'],
          now: NOW,
        }),
      'INVALID_ARGUMENT',
    );
    expect(totp.getFactorBySubject('subject-a')).toBeUndefined();
    expect(totp.getEnrollment(enrollment.enrollmentId, NOW)).toBeDefined();
  });

  test('replacement refuses a malformed digest and keeps the old generation', () => {
    const { factor } = activate();
    expectCode(
      () =>
        totp.replaceRecoveryCodes({
          factorId: factor.factorId,
          expectedGeneration: 1,
          recoveryCodeDigests: ['ABC'],
          now: NOW,
        }),
      'INVALID_ARGUMENT',
    );
    expect(totp.getFactor(factor.factorId)?.recoveryGeneration).toBe(1);
    expect(totp.countUnusedRecoveryCodes(factor.factorId)).toBe(10);
  });
});

describe('stored factor parameters', () => {
  test('reads the stored parameters when they are the supported set', () => {
    const { factor } = activate();
    expect(totp.getFactor(factor.factorId)).toMatchObject({
      algorithm: 'SHA1',
      digits: 6,
      periodSeconds: 30,
      allowedSkewSteps: 1,
    });
  });

  test('a row that never accepted a code reads back with a null counter and can advance', () => {
    const { factor } = activate();
    db.prepare('UPDATE totp_factors SET last_accepted_counter = NULL WHERE factor_id = ?').run(
      factor.factorId,
    );
    expect(totp.getFactor(factor.factorId)?.lastAcceptedCounter).toBeNull();
    expect(totp.advanceLastAcceptedCounter(factor.factorId, 0, 1)).toBe(true);
  });

  test.each([
    ['algorithm', "'SHA256'"],
    ['digits', '8'],
    ['period_seconds', '60'],
    ['allowed_skew_steps', '2'],
  ])('a row with unsupported %s is refused with a fixed error', (column, value) => {
    const { factor } = activate();
    db.prepare(`UPDATE totp_factors SET ${column} = ${value} WHERE factor_id = ?`).run(
      factor.factorId,
    );
    expectCode(() => totp.getFactor(factor.factorId), 'INVALID_ARGUMENT');
    expectCode(() => totp.getFactorBySubject('subject-a'), 'INVALID_ARGUMENT');
    expectCode(() => totp.listFactors(), 'INVALID_ARGUMENT');
  });
});
