/**
 * Tests for the offline two-factor operations, on real file-backed SQLite
 * stores: what matters here (who holds the file, what a transaction leaves
 * behind, what a wrong key can and cannot read) only exists in the engine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { type Database, openDatabase } from '../store/db/driver.js';
import { MIGRATIONS, migrate } from '../store/db/migrations.js';
import * as totpStore from '../store/totp.js';
import { createTemporaryStoreDirectory, removeTemporaryStoreDirectory } from '../test/sqlite-db.js';

vi.mock('../log/index.js', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return { default: logger };
});

import { generateTotp } from './totp-crypto.js';
import { deriveSubjectId } from './totp-identity.js';
import {
  describeStore,
  findFactors,
  type KeyringState,
  type LocalIdentity,
  OfflineStoreError,
  openOfflineStore,
  planRebind,
  rebindFactorOffline,
  removeFactorOffline,
  rewrapFactors,
  runExclusively,
} from './totp-offline.js';
import {
  createStoreFile,
  enrollFactor,
  keyringOf,
  NEW_KEY,
  OLD_KEY,
  startPendingEnrollment,
} from './totp-offline.test.helpers.js';
import { verifyTotpProof } from './totp-proof.js';

const NOW = new Date('2026-10-05T10:00:00.000Z');
const oldRing = keyringOf({ k1: OLD_KEY }, 'k1');
const bothRing = keyringOf({ k1: OLD_KEY, k2: NEW_KEY }, 'k2');
const newRing = keyringOf({ k2: NEW_KEY }, 'k2');
const wrongRing = keyringOf({ k1: NEW_KEY }, 'k1');

const loaded = (keyring: typeof oldRing): KeyringState => ({ status: 'loaded', keyring });
const identity = (providerId: string, username: string): LocalIdentity => ({
  providerId,
  username,
  subjectId: deriveSubjectId(providerId, username),
});

let directory: string;
let db: Database;

/** Run with the key ring the running app would load, then take it away again. */
async function withKeyringEnv(keys: Record<string, string>, activeKeyId: string, run: () => void) {
  const { ddEnvVars } = await import('../configuration/index.js');
  ddEnvVars.DD_AUTH_TOTP_KEYRING = JSON.stringify(keys);
  ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID = activeKeyId;
  try {
    run();
  } finally {
    delete ddEnvVars.DD_AUTH_TOTP_KEYRING;
    delete ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID;
  }
}

function expectStoreError(run: () => unknown, code: string) {
  expect(run).toThrow(expect.objectContaining({ name: 'OfflineStoreError', code }));
}

beforeEach(() => {
  directory = createTemporaryStoreDirectory();
  db = createStoreFile(directory);
});

afterEach(() => {
  db.close();
  removeTemporaryStoreDirectory(directory);
});

describe('opening a store offline', () => {
  const storePath = () => path.join(directory, 'dd.sqlite');

  test('opens a migrated store and binds the two-factor store to it', () => {
    const enrolled = enrollFactor('basic.eve', 'eve', oldRing);
    db.close();

    db = openOfflineStore(storePath());

    expect(totpStore.getFactor(enrolled.factorId)?.username).toBe('eve');
  });

  test('refuses a path with no file, and creates none', () => {
    const missing = path.join(directory, 'nope.sqlite');

    expectStoreError(() => openOfflineStore(missing), 'NOT_FOUND');

    expect(fs.existsSync(missing)).toBe(false);
  });

  test('refuses a file that is not a SQLite database', () => {
    const garbage = path.join(directory, 'garbage.sqlite');
    fs.writeFileSync(
      garbage,
      'this is not a database, however much it would like to be '.repeat(40),
    );

    expectStoreError(() => openOfflineStore(garbage), 'UNREADABLE');
  });

  test('refuses a database that is not a Drydock store', () => {
    const empty = path.join(directory, 'empty.sqlite');
    openDatabase(empty).close();

    expectStoreError(() => openOfflineStore(empty), 'SCHEMA_MISMATCH');
  });

  test('refuses a store whose schema is behind this version rather than migrating it', () => {
    const behindPath = path.join(directory, 'behind.sqlite');
    const behind = openDatabase(behindPath);
    migrate(behind, MIGRATIONS.slice(0, -1));
    behind.close();

    expectStoreError(() => openOfflineStore(behindPath), 'SCHEMA_MISMATCH');

    const reopened = openDatabase(behindPath);
    const versions = reopened.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get();
    reopened.close();
    expect(versions?.n).toBe(MIGRATIONS.length - 1);
  });
});

describe('running with the store to itself', () => {
  test('commits what the callback did', () => {
    runExclusively(db, () => {
      totpStore.revokeSessionsIssuedBefore('subject', 'eve', 5);
    });

    expect(totpStore.getSessionsNotBefore('subject')).toBe(5);
  });

  test('refuses while another connection has the store open, and changes nothing', () => {
    const running = openDatabase(path.join(directory, 'dd.sqlite'));
    const offline = openDatabase(path.join(directory, 'dd.sqlite'), { busyTimeoutMs: 50 });
    const ran = vi.fn();
    try {
      expectStoreError(() => runExclusively(offline, ran), 'IN_USE');
      expect(ran).not.toHaveBeenCalled();
    } finally {
      offline.close();
      running.close();
    }
  });

  test('rolls back and rethrows a failure of the callback itself', () => {
    expect(() =>
      runExclusively(db, () => {
        totpStore.revokeSessionsIssuedBefore('subject', 'eve', 5);
        throw new Error('halfway');
      }),
    ).toThrow('halfway');

    expect(totpStore.getSessionsNotBefore('subject')).toBe(0);
  });
});

describe('describing the store', () => {
  test('an empty store has no factors, and lists the key ring keys as unused', () => {
    expect(describeStore(loaded(bothRing), [])).toEqual({
      factors: [],
      keys: [
        { keyId: 'k1', factors: 0, enrollments: 0, role: 'retired' },
        { keyId: 'k2', factors: 0, enrollments: 0, role: 'active' },
      ],
      pendingOfflineOperations: 0,
    });
  });

  test('says which key each factor is under and whether that key still reads it', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    const bob = enrollFactor('basic.bob', 'bob', bothRing);
    const identities = [identity('basic.eve', 'eve'), identity('basic.bob', 'bob')];
    const states = (keyring: KeyringState) =>
      Object.fromEntries(
        describeStore(keyring, identities).factors.map((status) => [
          status.factor.factorId,
          status.keyState,
        ]),
      );

    expect(states(loaded(bothRing))).toEqual({
      [eve.factorId]: 'needs-rewrap',
      [bob.factorId]: 'ok',
    });
    expect(states(loaded(newRing))).toEqual({
      [eve.factorId]: 'key-missing',
      [bob.factorId]: 'ok',
    });
    expect(states(loaded(wrongRing))).toEqual({
      [eve.factorId]: 'undecryptable',
      [bob.factorId]: 'key-missing',
    });
    expect(states({ status: 'absent' })).toEqual({
      [eve.factorId]: 'unchecked',
      [bob.factorId]: 'unchecked',
    });
    expect(states({ status: 'unusable', code: 'KEYRING_INVALID' })).toEqual({
      [eve.factorId]: 'unchecked',
      [bob.factorId]: 'unchecked',
    });
  });

  test('counts what each key still protects, and names its place in the key ring', () => {
    enrollFactor('basic.eve', 'eve', oldRing);
    enrollFactor('basic.bob', 'bob', bothRing);
    startPendingEnrollment('basic.kim', 'kim', oldRing);

    expect(describeStore(loaded(bothRing), []).keys).toEqual([
      { keyId: 'k1', factors: 1, enrollments: 1, role: 'retired' },
      { keyId: 'k2', factors: 1, enrollments: 0, role: 'active' },
    ]);
    expect(describeStore(loaded(newRing), []).keys).toEqual([
      { keyId: 'k1', factors: 1, enrollments: 1, role: 'missing' },
      { keyId: 'k2', factors: 1, enrollments: 0, role: 'active' },
    ]);
    expect(describeStore({ status: 'absent' }, []).keys).toEqual([
      { keyId: 'k1', factors: 1, enrollments: 1, role: 'unknown' },
      { keyId: 'k2', factors: 1, enrollments: 0, role: 'unknown' },
    ]);
  });

  test('marks a factor whose account is no longer configured as orphaned', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    const gone = enrollFactor('basic.gone', 'eve', oldRing);

    const { factors } = describeStore(loaded(oldRing), [identity('basic.eve', 'eve')]);

    expect(factors.map((status) => [status.factor.factorId, status.orphaned])).toEqual([
      [eve.factorId, false],
      [gone.factorId, true],
    ]);
  });

  test('reports the unused recovery codes and the operations waiting for the next start', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    totpStore.markRecoveryCodeUsed(totpStore.listRecoveryCodes(eve.factorId)[0].codeId);
    totpStore.recordOfflineOperation({
      operation: 'remove',
      subjectId: 's',
      factorId: 'f',
      at: NOW.toISOString(),
    });

    const status = describeStore(loaded(oldRing), []);

    expect(status.factors[0].recoveryCodesRemaining).toBe(9);
    expect(status.pendingOfflineOperations).toBe(1);
  });
});

describe('rewrapping under the active key', () => {
  test('re-encrypts every factor under another key, and the old key is no longer needed', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    const bob = enrollFactor('basic.bob', 'bob', oldRing);

    expect(rewrapFactors(bothRing, { apply: true, now: NOW })).toEqual({
      rewrapped: 2,
      alreadyActive: 0,
      failed: [],
      enrollmentsDiscarded: 0,
    });

    expect(totpStore.listKeyUsage()).toEqual([{ keyId: 'k2', factors: 2, enrollments: 0 }]);
    expect(describeStore(loaded(newRing), []).factors.map((status) => status.keyState)).toEqual([
      'ok',
      'ok',
    ]);
    expect(totpStore.getFactor(eve.factorId)?.updatedAt).toBe(NOW.toISOString());
    expect(totpStore.getFactor(bob.factorId)?.encryptionKeyId).toBe('k2');
  });

  test('keeps the same seed: a code from the same authenticator verifies with the old key gone', async () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);

    rewrapFactors(bothRing, { apply: true });

    const factor = totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord;
    expect(Date.parse(factor.updatedAt)).toBeGreaterThan(NOW.getTime());
    await withKeyringEnv({ k2: NEW_KEY }, 'k2', () => {
      expect(verifyTotpProof(factor, generateTotp(eve.seed, Date.now()))).toBe(true);
    });
  });

  test('is idempotent: a second run finds nothing to do', () => {
    enrollFactor('basic.eve', 'eve', oldRing);
    rewrapFactors(bothRing, { apply: true, now: NOW });
    const before = totpStore.listFactors();

    expect(rewrapFactors(bothRing, { apply: true, now: NOW })).toEqual({
      rewrapped: 0,
      alreadyActive: 1,
      failed: [],
      enrollmentsDiscarded: 0,
    });
    expect(totpStore.listFactors()).toEqual(before);
  });

  test('without apply it reports the same numbers and writes nothing', () => {
    enrollFactor('basic.eve', 'eve', oldRing);
    enrollFactor('basic.bob', 'bob', bothRing);
    startPendingEnrollment('basic.kim', 'kim', oldRing);
    startPendingEnrollment('basic.lee', 'lee', bothRing);
    const before = totpStore.listFactors();

    expect(rewrapFactors(bothRing, { apply: false, now: NOW })).toEqual({
      rewrapped: 1,
      alreadyActive: 1,
      failed: [],
      enrollmentsDiscarded: 1,
    });

    expect(totpStore.listFactors()).toEqual(before);
    expect(totpStore.listKeyUsage()).toEqual([
      { keyId: 'k1', factors: 1, enrollments: 1 },
      { keyId: 'k2', factors: 1, enrollments: 1 },
    ]);
  });

  test('discards pending enrollments under a retired key and keeps those under the active one', () => {
    startPendingEnrollment('basic.kim', 'kim', oldRing);
    const kept = startPendingEnrollment('basic.lee', 'lee', bothRing);

    expect(rewrapFactors(bothRing, { apply: true, now: NOW }).enrollmentsDiscarded).toBe(1);

    expect(totpStore.getEnrollment(kept)).toBeDefined();
    expect(totpStore.listKeyUsage()).toEqual([{ keyId: 'k2', factors: 0, enrollments: 1 }]);
  });

  test('leaves a factor it cannot read where it is, and says why', () => {
    const lost = enrollFactor('basic.eve', 'eve', keyringOf({ k0: OLD_KEY }, 'k0'));
    const tampered = enrollFactor('basic.bob', 'bob', oldRing);
    const fine = enrollFactor('basic.kim', 'kim', oldRing);
    db.prepare('UPDATE totp_factors SET secret_auth_tag = ? WHERE factor_id = ?').run(
      Buffer.alloc(16, 9).toString('base64'),
      tampered.factorId,
    );

    const outcome = rewrapFactors(bothRing, { apply: true, now: NOW });

    expect(outcome.rewrapped).toBe(1);
    expect(outcome.failed.map((failure) => [failure.factor.factorId, failure.keyState])).toEqual([
      [lost.factorId, 'key-missing'],
      [tampered.factorId, 'undecryptable'],
    ]);
    expect(totpStore.getFactor(lost.factorId)?.encryptionKeyId).toBe('k0');
    expect(totpStore.getFactor(tampered.factorId)?.encryptionKeyId).toBe('k1');
    expect(totpStore.getFactor(fine.factorId)?.encryptionKeyId).toBe('k2');
  });
});

describe('finding the factor a command names', () => {
  test('by subject, by provider and username, or by either alone', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    const other = enrollFactor('basic.other', 'eve', oldRing);
    const bob = enrollFactor('basic.bob', 'bob', oldRing);
    const ids = (selector: Parameters<typeof findFactors>[0]) =>
      findFactors(selector).map((factor) => factor.factorId);

    expect(ids({ subjectId: eve.subjectId })).toEqual([eve.factorId]);
    expect(ids({ providerId: 'basic.other', username: 'eve' })).toEqual([other.factorId]);
    expect(ids({ providerId: 'basic.bob' })).toEqual([bob.factorId]);
    expect(ids({ username: 'bob' })).toEqual([bob.factorId]);
    expect(ids({ username: 'eve' })).toEqual([eve.factorId, other.factorId]);
    expect(ids({ username: 'EVE' })).toEqual([]);
    expect(ids({ subjectId: eve.subjectId, username: 'bob' })).toEqual([]);
  });
});

describe('removing a factor offline', () => {
  test('removes the factor, its recovery codes and any pending replacement, and nothing of anyone else', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    const bob = enrollFactor('basic.bob', 'bob', oldRing);
    startPendingEnrollment('basic.eve', 'eve', oldRing);
    const factor = totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord;

    expect(removeFactorOffline(db, factor, NOW)).toBe(2);

    expect(totpStore.getFactorBySubject(eve.subjectId)).toBeUndefined();
    expect(totpStore.getEnrollmentBySubject(eve.subjectId)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM totp_recovery_codes').get()?.n).toBe(10);
    expect(totpStore.getFactorBySubject(bob.subjectId)).toBeDefined();
    expect(totpStore.getSubjectVersion(bob.subjectId)).toBe(1);
  });

  test('moves the subject to a new version, so sessions minted before it are stale', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);

    removeFactorOffline(db, totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord, NOW);

    expect(totpStore.getSubjectVersion(eve.subjectId)).toBe(2);
    expect(totpStore.hasEnrolledUsername('eve')).toBe(true);
  });

  test('forgives the wrong-code count, so a fresh enrollment does not start locked', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    for (let count = 0; count < 6; count += 1) {
      totpStore.recordFactorFailure({
        subjectId: eve.subjectId,
        username: 'eve',
        now: NOW.getTime(),
        threshold: 5,
        baseLockMs: 60_000,
        maxLockMs: 600_000,
      });
    }

    removeFactorOffline(db, totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord, NOW);

    expect(totpStore.getFactorFailureState(eve.subjectId)).toEqual({ failures: 0, lockedUntil: 0 });
  });

  test('leaves a marker for the next start, holding ids and the time only', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);

    removeFactorOffline(db, totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord, NOW);

    const seen: totpStore.TotpOfflineOperation[] = [];
    totpStore.consumeOfflineOperations((operation) => seen.push(operation));
    expect(seen).toEqual([
      {
        operation: 'remove',
        subjectId: eve.subjectId,
        factorId: eve.factorId,
        at: NOW.toISOString(),
      },
    ]);
  });

  test('needs no key ring: it never reads the seed', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    db.prepare('UPDATE totp_factors SET secret_ciphertext = ?').run('not even base64 !!');

    removeFactorOffline(db, totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord, NOW);

    expect(totpStore.listFactors()).toEqual([]);
  });

  test('writes the removal and its marker together or not at all', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    const factor = totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord;
    db.exec(
      "CREATE TRIGGER refuse_marker BEFORE INSERT ON store_metadata BEGIN SELECT RAISE(ABORT, 'no markers'); END",
    );

    expect(() => removeFactorOffline(db, factor, NOW)).toThrow();

    expect(totpStore.getFactorBySubject(eve.subjectId)).toBeDefined();
    expect(totpStore.getSubjectVersion(eve.subjectId)).toBe(1);
  });
});

describe('rebinding a factor to a renamed account', () => {
  const renamed = identity('basic.evelyn', 'evelyn');

  test('is refused while the account the factor names is still configured', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    const factor = totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord;

    expect(
      planRebind(factor, renamed, [identity('basic.eve', 'eve'), renamed], loaded(oldRing)),
    ).toEqual({ refusal: 'source-configured' });
  });

  test('is refused when the account that would take it already has a factor', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    enrollFactor('basic.evelyn', 'evelyn', oldRing);
    const factor = totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord;

    expect(planRebind(factor, renamed, [renamed], loaded(oldRing))).toEqual({
      refusal: 'target-has-factor',
    });
  });

  test.each<[string, KeyringState, string]>([
    ['no key ring is configured', { status: 'absent' }, 'keyring-unavailable'],
    [
      'the key ring is unusable',
      { status: 'unusable', code: 'KEYRING_INVALID' },
      'keyring-unavailable',
    ],
    ['the key is gone from the key ring', loaded(newRing), 'key-missing'],
    ['the key in the key ring is the wrong one', loaded(wrongRing), 'undecryptable'],
  ])(
    'is refused when %s, because the seed has to be read to bind it again',
    (_label, keyring, refusal) => {
      const eve = enrollFactor('basic.eve', 'eve', oldRing);
      const factor = totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord;

      expect(planRebind(factor, renamed, [renamed], keyring)).toEqual({ refusal });
    },
  );

  test('is allowed for an orphaned factor the key ring can read', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    const factor = totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord;

    expect(planRebind(factor, renamed, [renamed], loaded(oldRing))).toEqual({ keyring: oldRing });
    expect(planRebind(factor, renamed, [renamed], loaded(bothRing))).toEqual({
      keyring: bothRing,
    });
  });

  test('moves the factor to the renamed account, where the same authenticator still verifies', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    const factor = totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord;

    const moved = rebindFactorOffline(db, factor, renamed, bothRing, NOW);

    expect(moved).toMatchObject({
      factorId: eve.factorId,
      subjectId: renamed.subjectId,
      providerId: 'basic.evelyn',
      username: 'evelyn',
      encryptionKeyId: 'k2',
      factorVersion: 2,
    });
    expect(totpStore.getFactorBySubject(eve.subjectId)).toBeUndefined();
    expect(describeStore(loaded(newRing), [renamed]).factors).toEqual([
      expect.objectContaining({ keyState: 'ok', orphaned: false, recoveryCodesRemaining: 10 }),
    ]);
  });

  test('the moved factor accepts a live code from the seed that was enrolled', async () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    const factor = totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord;

    const moved = rebindFactorOffline(db, factor, renamed, oldRing, NOW);

    await withKeyringEnv({ k1: OLD_KEY }, 'k1', () => {
      expect(verifyTotpProof(moved, generateTotp(eve.seed, Date.now()))).toBe(true);
    });
  });

  test('leaves a marker naming both subjects', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);

    rebindFactorOffline(
      db,
      totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord,
      renamed,
      oldRing,
      NOW,
    );

    const seen: totpStore.TotpOfflineOperation[] = [];
    totpStore.consumeOfflineOperations((operation) => seen.push(operation));
    expect(seen).toEqual([
      {
        operation: 'rebind',
        subjectId: eve.subjectId,
        factorId: eve.factorId,
        targetSubjectId: renamed.subjectId,
        at: NOW.toISOString(),
      },
    ]);
  });

  test('moves the factor and writes its marker together or not at all', () => {
    const eve = enrollFactor('basic.eve', 'eve', oldRing);
    const factor = totpStore.getFactor(eve.factorId) as totpStore.TotpFactorRecord;
    db.exec(
      "CREATE TRIGGER refuse_marker BEFORE INSERT ON store_metadata BEGIN SELECT RAISE(ABORT, 'no markers'); END",
    );

    expect(() => rebindFactorOffline(db, factor, renamed, oldRing, NOW)).toThrow();

    expect(totpStore.getFactorBySubject(eve.subjectId)).toEqual(factor);
    expect(totpStore.getFactorBySubject(renamed.subjectId)).toBeUndefined();
  });
});

test('an offline store error carries a stable code and a fixed message', () => {
  const error = new OfflineStoreError('IN_USE');

  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe('IN_USE');
  expect(error.message).toBe('The store is in use by another process');
});
