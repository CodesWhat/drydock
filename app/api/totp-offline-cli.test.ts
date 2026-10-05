/**
 * Tests for the `totp` command line: what it accepts, what it prints, and what
 * each command leaves in a real store file. Configuration is read the way the
 * running app reads it, so the tests set the same `DD_` values an operator has.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ddEnvVars } from '../configuration/index.js';
import { type Database, openDatabase } from '../store/db/driver.js';
import { MIGRATIONS, migrate } from '../store/db/migrations.js';
import * as totpStore from '../store/totp.js';
import { createTemporaryStoreDirectory, removeTemporaryStoreDirectory } from '../test/sqlite-db.js';

vi.mock('../log/index.js', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return { default: logger };
});

import { deriveSubjectId } from './totp-identity.js';
import {
  createStoreFile,
  type EnrolledFactor,
  enrollFactor,
  keyringJson,
  keyringOf,
  NEW_KEY,
  OLD_KEY,
  startPendingEnrollment,
} from './totp-offline.test.helpers.js';
import { runTotpCommand } from './totp-offline-cli.js';

const NOW = new Date('2026-10-05T10:00:00.000Z');
const oldRing = keyringOf({ k1: OLD_KEY }, 'k1');
const bothRing = keyringOf({ k1: OLD_KEY, k2: NEW_KEY }, 'k2');
const CHANGED_NOTHING = 'Nothing was changed.';

let directory: string;
let db: Database | undefined;
const configured: string[] = [];

function configure(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    ddEnvVars[key] = value;
    configured.push(key);
  }
}

function configureKeyring(keys: Record<string, string>, activeKeyId: string): void {
  configure({ DD_AUTH_TOTP_KEYRING: keyringJson(keys), DD_AUTH_TOTP_ACTIVE_KEY_ID: activeKeyId });
}

function configureAccount(name: string, username: string): void {
  configure({
    [`DD_AUTH_BASIC_${name.toUpperCase()}_USER`]: username,
    [`DD_AUTH_BASIC_${name.toUpperCase()}_HASH`]: 'argon2id$not$read$by$this$command',
  });
}

/** Seed the store, then close it: the command opens the file itself. */
function seed(build: () => void): void {
  db = createStoreFile(directory);
  build();
  db.close();
  db = undefined;
}

function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runTotpCommand(argv, {
    io: { out: (message) => out.push(message), err: (message) => err.push(message) },
    now: () => NOW,
    busyTimeoutMs: 50,
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/** Look at what a command left behind. */
function inspect<T>(read: () => T): T {
  const opened = openDatabase(path.join(directory, 'dd.sqlite'));
  totpStore.createCollections(opened);
  try {
    return read();
  } finally {
    opened.close();
  }
}

beforeEach(() => {
  directory = createTemporaryStoreDirectory();
  configure({ DD_STORE_PATH: directory });
});

afterEach(() => {
  db?.close();
  db = undefined;
  for (const key of configured.splice(0)) {
    delete ddEnvVars[key];
  }
  removeTemporaryStoreDirectory(directory);
});

describe('usage', () => {
  test('--help prints the usage and succeeds without touching a store', () => {
    for (const argv of [['--help'], ['-h'], ['remove', '--help']]) {
      const result = run(...argv);
      expect(result.code).toBe(0);
      expect(result.out).toContain('Usage: node dist/index.js totp <command> [options]');
      expect(result.out).toContain('--confirm');
      expect(result.err).toBe('');
    }
  });

  test.each([
    [[], 'Name a command'],
    [['enroll'], 'Unknown command: enroll'],
    [['status', '--force'], 'Unknown option: --force'],
    [['remove', '--username'], '--username needs a value'],
    [['remove', '--username', '--confirm'], '--username needs a value'],
    [['status', '--confirm'], '--confirm does not apply to status'],
    [['rewrap', '--username', 'eve'], '--username does not apply to rewrap'],
    [
      ['remove', '--username', 'eve', '--to-provider', 'basic.eve'],
      '--to-provider does not apply to remove',
    ],
    [['remove'], 'Name the factor with --subject, or --provider and --username'],
    [
      ['rebind', '--to-provider', 'basic.eve'],
      'Name the factor with --subject, or --provider and --username',
    ],
    [['rebind', '--username', 'eve'], 'Name the account that takes the factor with --to-provider'],
  ])('%j is refused with a reason and the usage', (argv, reason) => {
    const result = run(...(argv as string[]));

    expect(result.code).toBe(1);
    expect(result.err).toContain(`Error: ${reason}`);
    expect(result.err).toContain('Usage: node dist/index.js totp <command> [options]');
    expect(result.out).toBe('');
  });
});

describe('finding the store', () => {
  test('uses the configured store directory and the default database name', () => {
    seed(() => undefined);

    const result = run('status');

    expect(result.code).toBe(0);
    expect(result.out).toContain(`Store: ${path.join(directory, 'dd.sqlite')}`);
  });

  test('honours DD_STORE_DB_FILE', () => {
    createStoreFile(directory, 'custom.sqlite').close();
    configure({ DD_STORE_DB_FILE: 'custom.sqlite' });

    expect(run('status').out).toContain(`Store: ${path.join(directory, 'custom.sqlite')}`);
  });

  test('falls back to /store/dd.sqlite, the same defaults the running store uses', async () => {
    delete ddEnvVars.DD_STORE_PATH;
    const store = await import('../store/index.js');

    const result = run('status');

    expect(store.getConfiguration()).toMatchObject({ path: '/store', dbFile: 'dd.sqlite' });
    expect(result.code).toBe(1);
    expect(result.err).toContain('/store/dd.sqlite');
  });

  test('--db names another file, for a drill on a copy', () => {
    createStoreFile(directory, 'copy.sqlite').close();

    const result = run('status', '--db', path.join(directory, 'copy.sqlite'));

    expect(result.code).toBe(0);
    expect(result.out).toContain(`Store: ${path.join(directory, 'copy.sqlite')}`);
  });

  test('refuses a database file name that leaves the store directory', () => {
    configure({ DD_STORE_DB_FILE: '../elsewhere.sqlite' });

    const result = run('status');

    expect(result.code).toBe(1);
    expect(result.err).toContain('DD_STORE_DB_FILE');
  });

  test('says so when there is no store, and creates none', () => {
    const result = run('remove', '--username', 'eve', '--confirm');

    expect(result.code).toBe(1);
    expect(result.err).toContain(
      `No store database exists at ${path.join(directory, 'dd.sqlite')}`,
    );
  });

  test('says so when the file is not a database', () => {
    const garbage = path.join(directory, 'garbage.sqlite');
    fs.writeFileSync(garbage, 'not a database, whatever the name says '.repeat(60));

    const result = run('status', '--db', garbage);

    expect(result.code).toBe(1);
    expect(result.err).toContain(`${garbage} is not a readable SQLite database`);
  });

  test('refuses a store on another schema and says how to bring it up to date', () => {
    const behind = openDatabase(path.join(directory, 'dd.sqlite'));
    migrate(behind, MIGRATIONS.slice(0, -1));
    behind.close();

    const result = run('status');

    expect(result.code).toBe(1);
    expect(result.err).toContain('is not a Drydock store at the schema this version uses');
    expect(result.err).toContain('Start Drydock once on this version');
  });
});

describe('status', () => {
  test('an empty store with no key ring', () => {
    seed(() => undefined);

    const result = run('status');

    expect(result.code).toBe(0);
    expect(result.out).toContain('Key ring: not configured');
    expect(result.out).toContain('Factors: 0');
    expect(result.out).not.toContain('Keys:');
  });

  test('lists each factor with its subject, its key and whether the key ring still reads it', () => {
    let eve: EnrolledFactor | undefined;
    seed(() => {
      eve = enrollFactor('basic.eve', 'eve', oldRing);
      enrollFactor('basic.bob', 'bob', bothRing);
      enrollFactor('basic.kim', 'kim', keyringOf({ k0: OLD_KEY }, 'k0'));
    });
    configureKeyring({ k1: OLD_KEY, k2: NEW_KEY }, 'k2');
    configureAccount('eve', 'eve');
    configureAccount('bob', 'bob');
    configureAccount('kim', 'kim');

    const result = run('status');

    expect(result.code).toBe(0);
    expect(result.out).toContain('Key ring: active key "k2"; keys loaded: k1, k2');
    expect(result.out).toContain('Factors: 3');
    expect(result.out).toContain('basic.eve / "eve"');
    expect(result.out).toContain(`subject ${eve?.subjectId}`);
    expect(result.out).toContain('key k1: readable, not the active key');
    expect(result.out).toContain('key k2: readable');
    expect(result.out).toContain('key k0: NOT IN THE KEY RING');
    expect(result.out).toContain('10 recovery codes left');
    expect(result.out).not.toContain('ORPHANED');
  });

  test('says which keys are still needed and which cannot be found', () => {
    seed(() => {
      enrollFactor('basic.eve', 'eve', oldRing);
      enrollFactor('basic.kim', 'kim', keyringOf({ k0: OLD_KEY }, 'k0'));
      startPendingEnrollment('basic.lee', 'lee', oldRing);
    });
    configureKeyring({ k1: OLD_KEY, k2: NEW_KEY }, 'k2');

    const { out } = run('status');

    expect(out).toContain('k0: 1 factor, 0 pending enrollments - not in the key ring');
    expect(out).toContain('k1: 1 factor, 1 pending enrollment - retired, still in use');
    expect(out).toContain('k2: 0 factors, 0 pending enrollments - active');
    expect(out).toContain(
      'Still needed in the key ring until "rewrap" moves what they protect: k1',
    );
    expect(out).toContain('Not in the key ring, so what they protect cannot be read: k0');
    expect(out).not.toContain('can be removed');
  });

  test('says when every retired key can be removed', () => {
    seed(() => {
      enrollFactor('basic.eve', 'eve', bothRing);
    });
    configureKeyring({ k1: OLD_KEY, k2: NEW_KEY }, 'k2');

    const { out } = run('status');

    expect(out).toContain('k1: 0 factors, 0 pending enrollments - retired, unused');
    expect(out).toContain(
      'Everything is under the active key. Retired keys can be removed from the key ring.',
    );
  });

  test('a wrong key under the right id is reported, not trusted', () => {
    seed(() => {
      enrollFactor('basic.eve', 'eve', oldRing);
    });
    configureKeyring({ k1: NEW_KEY }, 'k1');

    expect(run('status').out).toContain('key k1: CANNOT BE DECRYPTED with the key of that id');
  });

  test('an unusable key ring is named by its error code and nothing is checked', () => {
    seed(() => {
      enrollFactor('basic.eve', 'eve', oldRing);
    });
    configure({ DD_AUTH_TOTP_KEYRING: '{not json', DD_AUTH_TOTP_ACTIVE_KEY_ID: 'k1' });

    const { out } = run('status');

    expect(out).toContain('Key ring: configured but unusable (KEYRING_INVALID)');
    expect(out).toContain('key k1: not checked, no usable key ring');
    expect(out).toContain('k1: 1 factor, 0 pending enrollments - no usable key ring');
    expect(out).not.toContain('{not json');
  });

  test('flags a factor whose account is no longer configured', () => {
    seed(() => {
      enrollFactor('basic.eve', 'eve', oldRing);
      enrollFactor('basic.gone', 'eve', oldRing);
    });
    configureKeyring({ k1: OLD_KEY }, 'k1');
    configureAccount('eve', 'eve');
    configure({ DD_AUTH_OIDC_SSO_CLIENTID: 'not-a-basic-account' });

    const { out } = run('status');

    expect(out).toContain(
      'basic.gone / "eve" - ORPHANED: no configured account has this provider and username',
    );
    expect(out).toContain('Orphaned factors: 1');
    expect(out.match(/ORPHANED/g)).toHaveLength(1);
  });

  test('ignores a Basic entry with no username when working out what is configured', () => {
    seed(() => {
      enrollFactor('basic.eve', 'eve', oldRing);
    });
    configure({ DD_AUTH_BASIC_EVE_HASH: 'hash-only' });

    expect(run('status').out).toContain('ORPHANED');
  });

  test('ignores a DD_AUTH_BASIC value that is not a set of accounts', () => {
    seed(() => {
      enrollFactor('basic.eve', 'eve', oldRing);
    });
    configure({ DD_AUTH_BASIC: 'nonsense' });

    expect(run('status').out).toContain('ORPHANED');
  });

  test('mentions operations the next start still has to record', () => {
    seed(() => {
      totpStore.recordOfflineOperation({
        operation: 'remove',
        subjectId: 's',
        factorId: 'f',
        at: NOW.toISOString(),
      });
    });

    expect(run('status').out).toContain(
      'Offline operations to be written to the audit log at the next start: 1',
    );
  });

  test('works while something else has the store open', () => {
    seed(() => {
      enrollFactor('basic.eve', 'eve', oldRing);
    });
    db = openDatabase(path.join(directory, 'dd.sqlite'));

    expect(run('status').code).toBe(0);
  });
});

describe('rewrap', () => {
  beforeEach(() => {
    seed(() => {
      enrollFactor('basic.eve', 'eve', oldRing);
      enrollFactor('basic.bob', 'bob', oldRing);
      startPendingEnrollment('basic.lee', 'lee', oldRing);
    });
  });

  test('without --confirm it reports what it would do and changes nothing', () => {
    configureKeyring({ k1: OLD_KEY, k2: NEW_KEY }, 'k2');

    const result = run('rewrap');

    expect(result.code).toBe(0);
    expect(result.out).toContain('Would re-encrypt 2 factors under the active key "k2"');
    expect(result.out).toContain('0 already there');
    expect(result.out).toContain('1 pending enrollment under another key would be discarded');
    expect(result.out).toContain(CHANGED_NOTHING);
    expect(inspect(() => totpStore.listKeyUsage())).toEqual([
      { keyId: 'k1', factors: 2, enrollments: 1 },
    ]);
  });

  test('with --confirm every factor moves to the active key and the old key is free to go', () => {
    configureKeyring({ k1: OLD_KEY, k2: NEW_KEY }, 'k2');

    const result = run('rewrap', '--confirm');

    expect(result.code).toBe(0);
    expect(result.out).toContain('Re-encrypted 2 factors under the active key "k2"');
    expect(result.out).toContain('Discarded 1 pending enrollment under another key');
    expect(result.out).toContain(
      'Everything is under the active key. Retired keys can be removed from the key ring.',
    );
    expect(result.out).not.toContain(CHANGED_NOTHING);
    expect(inspect(() => totpStore.listKeyUsage())).toEqual([
      { keyId: 'k2', factors: 2, enrollments: 0 },
    ]);
  });

  test('a second run changes nothing and says so', () => {
    configureKeyring({ k1: OLD_KEY, k2: NEW_KEY }, 'k2');
    run('rewrap', '--confirm');
    const before = inspect(() => totpStore.listFactors());

    const result = run('rewrap', '--confirm');

    expect(result.code).toBe(0);
    expect(result.out).toContain('Re-encrypted 0 factors under the active key "k2"');
    expect(result.out).toContain('2 already there');
    expect(inspect(() => totpStore.listFactors())).toEqual(before);
  });

  test('fails, and names the factors, when the key ring cannot read some of them', () => {
    configureKeyring({ k2: NEW_KEY }, 'k2');

    const result = run('rewrap', '--confirm');

    expect(result.code).toBe(1);
    expect(result.out).toContain('Re-encrypted 0 factors');
    expect(result.err).toContain('2 factors could not be read and stay under their old key');
    expect(result.err).toContain('basic.eve / "eve"');
    expect(result.err).toContain('key k1: NOT IN THE KEY RING');
    expect(result.err).toContain('Restore the key, or remove these factors with "remove"');
    expect(result.out).not.toContain('can be removed');
  });

  test.each([
    [{}, 'The key ring is not configured'],
    [
      { DD_AUTH_TOTP_KEYRING: '{not json', DD_AUTH_TOTP_ACTIVE_KEY_ID: 'k1' },
      'The key ring is configured but unusable (KEYRING_INVALID)',
    ],
  ])('needs a usable key ring', (settings, reason) => {
    configure(settings as Record<string, string>);

    const result = run('rewrap', '--confirm');

    expect(result.code).toBe(1);
    expect(result.err).toContain(reason);
    expect(inspect(() => totpStore.listKeyUsage())).toEqual([
      { keyId: 'k1', factors: 2, enrollments: 1 },
    ]);
  });

  test('refuses to change a store that is in use, and changes nothing', () => {
    configureKeyring({ k1: OLD_KEY, k2: NEW_KEY }, 'k2');
    db = openDatabase(path.join(directory, 'dd.sqlite'));

    const result = run('rewrap', '--confirm');

    expect(result.code).toBe(1);
    expect(result.err).toContain('is in use by another process');
    expect(result.err).toContain('Stop Drydock, then run the command again');
    db.close();
    db = undefined;
    expect(inspect(() => totpStore.listKeyUsage())).toEqual([
      { keyId: 'k1', factors: 2, enrollments: 1 },
    ]);
  });
});

describe('remove', () => {
  let eve: EnrolledFactor;
  let other: EnrolledFactor;

  beforeEach(() => {
    seed(() => {
      eve = enrollFactor('basic.eve', 'eve', oldRing);
      other = enrollFactor('basic.other', 'eve', oldRing);
      enrollFactor('basic.bob', 'bob', oldRing);
    });
  });

  test('without --confirm it names what it would remove and changes nothing', () => {
    const result = run('remove', '--provider', 'basic.eve', '--username', 'eve');

    expect(result.code).toBe(0);
    expect(result.out).toContain('Would remove the two-factor factor of basic.eve / "eve"');
    expect(result.out).toContain(`subject ${eve.subjectId}`);
    expect(result.out).toContain('10 unused recovery codes');
    expect(result.out).toContain(CHANGED_NOTHING);
    expect(inspect(() => totpStore.listFactors())).toHaveLength(3);
  });

  test('with --confirm it removes that factor alone, with no key ring configured', () => {
    const result = run('remove', '--provider', 'Basic.EVE', '--username', 'eve', '--confirm');

    expect(result.code).toBe(0);
    expect(result.out).toContain('Removed the two-factor factor of basic.eve / "eve"');
    expect(result.out).toContain('signs in with its password alone');
    expect(result.out).toContain('audit log when Drydock next starts');
    inspect(() => {
      expect(totpStore.getFactorBySubject(eve.subjectId)).toBeUndefined();
      expect(totpStore.getSubjectVersion(eve.subjectId)).toBe(2);
      expect(totpStore.getFactorBySubject(other.subjectId)).toBeDefined();
      expect(totpStore.getSubjectVersion(other.subjectId)).toBe(1);
      expect(totpStore.listFactors()).toHaveLength(2);
      expect(totpStore.countPendingOfflineOperations()).toBe(1);
    });
  });

  test('refuses a username that two providers share, and lists them', () => {
    const result = run('remove', '--username', 'eve', '--confirm');

    expect(result.code).toBe(1);
    expect(result.err).toContain('More than one factor matches');
    expect(result.err).toContain(`basic.eve / "eve" (subject ${eve.subjectId})`);
    expect(result.err).toContain(`basic.other / "eve" (subject ${other.subjectId})`);
    expect(inspect(() => totpStore.listFactors())).toHaveLength(3);
  });

  test('a subject id picks one of them', () => {
    const result = run('remove', '--subject', other.subjectId, '--confirm');

    expect(result.code).toBe(0);
    inspect(() => {
      expect(totpStore.getFactorBySubject(other.subjectId)).toBeUndefined();
      expect(totpStore.getFactorBySubject(eve.subjectId)).toBeDefined();
    });
  });

  test('a username only one factor has is enough', () => {
    expect(run('remove', '--username', 'bob', '--confirm').code).toBe(0);
  });

  test('says when nothing matches, and lists what is enrolled', () => {
    const result = run('remove', '--username', 'nobody', '--confirm');

    expect(result.code).toBe(1);
    expect(result.err).toContain('No factor matches');
    expect(result.err).toContain('basic.bob / "bob"');
    expect(inspect(() => totpStore.listFactors())).toHaveLength(3);
  });

  test('says when nothing is enrolled at all', () => {
    run('remove', '--username', 'bob', '--confirm');
    run('remove', '--subject', eve.subjectId, '--confirm');
    run('remove', '--subject', other.subjectId, '--confirm');

    const result = run('remove', '--username', 'bob', '--confirm');

    expect(result.code).toBe(1);
    expect(result.err).toContain('No factor matches');
    expect(result.err).toContain('No factors are enrolled');
  });

  test('refuses to change a store that is in use', () => {
    db = openDatabase(path.join(directory, 'dd.sqlite'));

    const result = run('remove', '--username', 'bob', '--confirm');

    expect(result.code).toBe(1);
    expect(result.err).toContain('is in use by another process');
    db.close();
    db = undefined;
    expect(inspect(() => totpStore.listFactors())).toHaveLength(3);
  });

  test('a store fault is reported by its code alone, and the command fails', () => {
    const raw = openDatabase(path.join(directory, 'dd.sqlite'));
    raw.exec(
      "CREATE TRIGGER refuse_marker BEFORE INSERT ON store_metadata BEGIN SELECT RAISE(ABORT, 'secret-looking detail'); END",
    );
    raw.close();

    const result = run('remove', '--username', 'bob', '--confirm');

    expect(result.code).toBe(1);
    expect(result.err).toContain('The command failed (SQLITE_CONSTRAINT_TRIGGER)');
    expect(result.err).not.toContain('secret-looking detail');
    expect(inspect(() => totpStore.listFactors())).toHaveLength(3);
  });

  test('a fault with no code is reported without its message', () => {
    const err: string[] = [];

    const code = runTotpCommand(['remove', '--username', 'bob', '--confirm'], {
      io: { out: () => undefined, err: (message) => err.push(message) },
      now: () => {
        throw new Error('detail that stays out of the output');
      },
      busyTimeoutMs: 50,
    });

    expect(code).toBe(1);
    expect(err.join('\n')).toContain('The command failed (unexpected error)');
    expect(err.join('\n')).not.toContain('detail that stays out');
    expect(inspect(() => totpStore.listFactors())).toHaveLength(3);
  });

  test('uses the real clock and the terminal when nothing is injected', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(runTotpCommand(['remove', '--username', 'bob', '--confirm'])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Removed the two-factor factor'));
    } finally {
      stdout.mockRestore();
    }
    const seen: totpStore.TotpOfflineOperation[] = [];
    inspect(() => totpStore.consumeOfflineOperations((operation) => seen.push(operation)));
    expect(Date.parse(seen[0].at)).toBeGreaterThan(NOW.getTime());
  });
});

describe('rebind', () => {
  let orphan: EnrolledFactor;
  const renamedSubject = deriveSubjectId('basic.evelyn', 'evelyn');

  beforeEach(() => {
    seed(() => {
      orphan = enrollFactor('basic.eve', 'eve', oldRing);
      enrollFactor('basic.bob', 'bob', oldRing);
    });
    configureKeyring({ k1: OLD_KEY }, 'k1');
    configureAccount('evelyn', 'evelyn');
    configureAccount('bob', 'bob');
  });

  test('without --confirm it names both ends and changes nothing', () => {
    const result = run('rebind', '--username', 'eve', '--to-provider', 'basic.evelyn');

    expect(result.code).toBe(0);
    expect(result.out).toContain(
      `Would move the two-factor factor of basic.eve / "eve" (subject ${orphan.subjectId}) to basic.evelyn / "evelyn" (subject ${renamedSubject})`,
    );
    expect(result.out).toContain(CHANGED_NOTHING);
    expect(inspect(() => totpStore.getFactorBySubject(orphan.subjectId))).toBeDefined();
  });

  test('with --confirm the factor belongs to the renamed account, and to nobody else', () => {
    const result = run('rebind', '--username', 'eve', '--to-provider', 'BASIC.Evelyn', '--confirm');

    expect(result.code).toBe(0);
    expect(result.out).toContain(
      `Moved the two-factor factor of basic.eve / "eve" (subject ${orphan.subjectId}) to basic.evelyn / "evelyn" (subject ${renamedSubject})`,
    );
    expect(result.out).toContain('audit log when Drydock next starts');
    inspect(() => {
      expect(totpStore.getFactorBySubject(orphan.subjectId)).toBeUndefined();
      expect(totpStore.getFactorBySubject(renamedSubject)).toMatchObject({
        factorId: orphan.factorId,
        providerId: 'basic.evelyn',
        username: 'evelyn',
      });
      expect(totpStore.listFactors()).toHaveLength(2);
      expect(totpStore.countPendingOfflineOperations()).toBe(1);
    });
  });

  test('refuses a target that is not a configured Basic provider, and lists the ones that are', () => {
    const result = run('rebind', '--username', 'eve', '--to-provider', 'basic.nobody', '--confirm');

    expect(result.code).toBe(1);
    expect(result.err).toContain('"basic.nobody" is not a configured Basic provider');
    expect(result.err).toContain('basic.evelyn / "evelyn"');
    expect(result.err).toContain('basic.bob / "bob"');
  });

  test('says so when no Basic provider is configured at all', () => {
    for (const key of configured.filter((name) => name.startsWith('DD_AUTH_BASIC_'))) {
      delete ddEnvVars[key];
    }

    const result = run('rebind', '--username', 'eve', '--to-provider', 'basic.evelyn');

    expect(result.code).toBe(1);
    expect(result.err).toContain('No Basic provider is configured');
  });

  test.each([
    [
      ['--username', 'bob', '--to-provider', 'basic.evelyn'],
      'basic.bob / "bob" is still a configured account',
    ],
    [
      ['--username', 'eve', '--to-provider', 'basic.bob'],
      'basic.bob / "bob" already has a factor of its own',
    ],
  ])('refuses %j', (argv, reason) => {
    const result = run('rebind', ...argv, '--confirm');

    expect(result.code).toBe(1);
    expect(result.err).toContain(reason);
    expect(inspect(() => totpStore.getFactorBySubject(orphan.subjectId))).toBeDefined();
  });

  test.each([
    [{}, 'no usable key ring'],
    [
      { DD_AUTH_TOTP_KEYRING: keyringJson({ k2: NEW_KEY }), DD_AUTH_TOTP_ACTIVE_KEY_ID: 'k2' },
      'key k1 is not in the key ring',
    ],
    [
      { DD_AUTH_TOTP_KEYRING: keyringJson({ k1: NEW_KEY }), DD_AUTH_TOTP_ACTIVE_KEY_ID: 'k1' },
      'key k1 in the key ring does not decrypt it',
    ],
  ])('cannot rebind what the key ring cannot read, and points at remove', (settings, reason) => {
    delete ddEnvVars.DD_AUTH_TOTP_KEYRING;
    delete ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID;
    configure(settings as Record<string, string>);

    const result = run('rebind', '--username', 'eve', '--to-provider', 'basic.evelyn', '--confirm');

    expect(result.code).toBe(1);
    expect(result.err).toContain(reason);
    expect(result.err).toContain('Remove it with "remove" and enroll again');
    expect(inspect(() => totpStore.getFactorBySubject(orphan.subjectId))).toBeDefined();
  });

  test('refuses an ambiguous source the same way remove does', () => {
    seed(() => {
      enrollFactor('basic.old', 'eve', oldRing);
    });

    const result = run('rebind', '--username', 'eve', '--to-provider', 'basic.evelyn', '--confirm');

    expect(result.code).toBe(1);
    expect(result.err).toContain('More than one factor matches');
  });
});
