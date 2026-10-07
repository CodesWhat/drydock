/**
 * The offline drills of spec 11.1.2 slice 6, rehearsed the way an operator
 * would: enroll factors in a real SQLite store, stop, copy the store file, run
 * the `totp` command against the copy, then start on the copy and prove the
 * outcome by signing in.
 *
 * "Start" here is the real thing minus the process: real express,
 * express-session and SessionStore on the copied database, the real Basic
 * provider, the real login routes and `requireAuthentication`, the real audit
 * and TOTP stores, and the same start-up call that records what an offline
 * command did.
 */
import { argon2Sync, randomBytes } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import express, { type Application, type Response as ExpressResponse, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';

const { logLines } = vi.hoisted(() => {
  // The drills sign in a handful of times each; keep the lockout budgets out of the way.
  process.env.DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS = '50';
  process.env.DD_AUTH_IP_LOCKOUT_MAX_ATTEMPTS = '1000';
  process.env.DD_AUTH_MAX_CONCURRENT_LOGIN_ATTEMPTS = '10';
  return { logLines: [] as unknown[][] };
});

vi.mock('../store/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../store/index.js')>();
  const os = await import('node:os');
  return {
    ...original,
    getConfiguration: () => ({ path: os.tmpdir(), file: 'drydock-totp-drill-test.json' }),
  };
});

vi.mock('../log/index.js', () => {
  const logger: object = new Proxy(
    {},
    {
      get: (_target, property) =>
        property === 'child'
          ? () => logger
          : (...args: unknown[]) => {
              logLines.push(args);
            },
    },
  );
  return { default: logger };
});

import Basic from '../authentications/providers/basic/Basic.js';
import { ddEnvVars } from '../configuration/index.js';
import * as auditStore from '../store/audit.js';
import { type Database, openDatabase } from '../store/db/driver.js';
import * as sessionModel from '../store/session.js';
import * as totpStore from '../store/totp.js';
import { createTemporaryStoreDirectory, removeTemporaryStoreDirectory } from '../test/sqlite-db.js';
import { registerLoginRoutes, requireAuthentication } from './auth.js';
import { resetLoginLockoutStateForTests } from './auth-lockout.js';
import { configureSessionLimits } from './auth-session.js';
import { clearAuthenticators, registerAuthenticator } from './authenticator-chain.js';
import { restoreSessionPrincipal, sessionAuthenticator } from './session-principal.js';
import { SessionStore } from './session-store.js';
import { resetLoginChallengesForTests } from './totp-challenge.js';
import { generateTotp } from './totp-crypto.js';
import { deriveSubjectId } from './totp-identity.js';
import {
  copyStoreFile,
  createStoreFile,
  type EnrolledFactor,
  enrollFactor,
  keyringJson,
  keyringOf,
  NEW_KEY,
  OLD_KEY,
} from './totp-offline.test.helpers.js';
import { recordOfflineTotpOperations } from './totp-offline-audit.js';
import { runTotpCommand } from './totp-offline-cli.js';
import { base32Encode } from './totp-provisioning.js';

const HTTPS_HEADERS = { 'X-Forwarded-Proto': 'https' };
const SESSION_SECRET = 'drill-secret'; // gitleaks:allow — fixed throwaway signing secret for a test-only session store
const oldRing = keyringOf({ k1: OLD_KEY }, 'k1');

interface Account {
  name: string;
  username: string;
  password: string;
  hash: string;
}

function createArgon2Hash(password: string): string {
  const salt = randomBytes(32);
  const derived = argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    memory: 19456,
    passes: 2,
    parallelism: 4,
    tagLength: 64,
  });
  return `argon2id$19456$2$4$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function account(name: string, username: string): Account {
  const password = `password-of-${name}`;
  return { name, username, password, hash: createArgon2Hash(password) };
}

const EVE = account('eve', 'eve');
const BOB = account('bob', 'bob');
// The same person as EVE after her provider was renamed: same username and password.
const EVELYN: Account = { ...EVE, name: 'evelyn' };
const OPS = account('ops', 'eve');
const GUEST = account('guest', 'guest');

const subjectOf = (who: Account) => deriveSubjectId(`basic.${who.name}`, who.username);

interface Running {
  db: Database;
  sessions: SessionStore;
  server: http.Server;
  port: number;
}

let directory: string;
let running: Running | undefined;
const configured: string[] = [];

function configure(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    ddEnvVars[key] = value;
    configured.push(key);
  }
}

function configureKeyring(keys: Record<string, string> | undefined, activeKeyId = 'k1'): void {
  delete ddEnvVars.DD_AUTH_TOTP_KEYRING;
  delete ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID;
  if (keys !== undefined) {
    configure({ DD_AUTH_TOTP_KEYRING: keyringJson(keys), DD_AUTH_TOTP_ACTIVE_KEY_ID: activeKeyId });
  }
}

/** What the operator's environment says the accounts are: read by the command and by start. */
function configureAccounts(accounts: readonly Account[]): void {
  for (const key of Object.keys(ddEnvVars).filter((name) => name.startsWith('DD_AUTH_BASIC_'))) {
    delete ddEnvVars[key];
  }
  for (const who of accounts) {
    configure({
      [`DD_AUTH_BASIC_${who.name.toUpperCase()}_USER`]: who.username,
      [`DD_AUTH_BASIC_${who.name.toUpperCase()}_HASH`]: who.hash,
    });
  }
}

/** Enroll in the live store, stop, and hand back a copy to drill on. */
function enrollThenCopy(enroll: () => void): string {
  const live = createStoreFile(directory);
  enroll();
  live.close();
  return copyStoreFile(directory);
}

function command(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runTotpCommand(argv, {
    io: { out: (message) => out.push(message), err: (message) => err.push(message) },
    busyTimeoutMs: 50,
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/** Start on a store file with the given accounts configured, the way a restart would. */
async function start(databasePath: string, accounts: readonly Account[]): Promise<Running> {
  const db = openDatabase(databasePath);
  sessionModel.createCollections(db);
  auditStore.createCollections(db);
  totpStore.createCollections(db);
  resetLoginLockoutStateForTests();
  resetLoginChallengesForTests();
  recordOfflineTotpOperations();

  clearAuthenticators();
  for (const who of accounts) {
    const basic = new Basic();
    await basic.register('authentication', 'basic', who.name, {
      user: who.username,
      hash: who.hash,
    });
    registerAuthenticator(basic.getAuthenticator());
  }
  registerAuthenticator(sessionAuthenticator);

  const sessions = new SessionStore({ ttlMs: 60_000 });
  const app: Application = express();
  app.set('trust proxy', 1);
  app.use(
    session({
      name: 'dd.sid.drill',
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: sessions,
      cookie: { httpOnly: true, secure: true },
    }),
  );
  app.use(restoreSessionPrincipal);
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10_000,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
    }),
  );
  const authRouter = express.Router();
  authRouter.use(express.json({ limit: '64kb' }));
  registerLoginRoutes(authRouter);
  app.use('/auth', authRouter);
  app.get('/protected', requireAuthentication, (_req: Request, res: ExpressResponse) => {
    res.status(200).json({ ok: true });
  });
  // The same answer the app's own error handler gives: the status the fault names, or 500.
  app.use((error: { status?: number }, _req: Request, res: ExpressResponse, _next: unknown) => {
    res.status(error.status || 500).json({ error: 'Internal server error' });
  });

  const server = http.createServer(app);
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
  running = { db, sessions, server, port };
  return running;
}

async function stop(): Promise<void> {
  if (running === undefined) {
    return;
  }
  const { server, sessions, db } = running;
  running = undefined;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  sessions.stop();
  db.close();
}

const url = (h: Running, route: string) => `http://127.0.0.1:${h.port}${route}`;
const cookieOf = (response: Awaited<ReturnType<typeof fetch>>) =>
  (response.headers.get('set-cookie') as string).split(';')[0];

function passwordLogin(h: Running, who: Account) {
  const credentials = Buffer.from(`${who.username}:${who.password}`).toString('base64');
  return fetch(url(h, '/auth/login'), {
    method: 'POST',
    headers: {
      ...HTTPS_HEADERS,
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: '{}',
  });
}

/** Password, then the challenge: returns the response to the code. */
async function loginWithCode(h: Running, who: Account, seed: Buffer) {
  const first = await passwordLogin(h, who);
  expect(first.status).toBe(202);
  const { challenge } = (await first.json()) as { challenge: { id: string } };
  return fetch(url(h, `/auth/login-challenges/${challenge.id}`), {
    method: 'PUT',
    headers: { ...HTTPS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: generateTotp(seed, Date.now()) }),
  });
}

const protectedStatus = async (h: Running, cookie: string) =>
  (await fetch(url(h, '/protected'), { headers: { ...HTTPS_HEADERS, Cookie: cookie } })).status;

const breakGlassDetails = () =>
  auditStore.getAuditEntries({ action: 'totp-break-glass' }).entries.map((entry) => entry.details);

/** Everything the command printed and everything that was logged, as one searchable text. */
function everythingSaid(...results: { out: string; err: string }[]): string {
  return [...results.flatMap((result) => [result.out, result.err]), JSON.stringify(logLines)].join(
    '\n',
  );
}

function expectNoSecretIn(text: string, factors: readonly EnrolledFactor[]): void {
  for (const factor of factors) {
    expect(text).not.toContain(factor.seed.toString('hex'));
    expect(text).not.toContain(factor.seed.toString('base64'));
    expect(text).not.toContain(base32Encode(factor.seed));
    for (const code of factor.recoveryCodes) {
      expect(text).not.toContain(code);
    }
  }
  expect(text).not.toContain(OLD_KEY);
  expect(text).not.toContain(NEW_KEY);
}

beforeEach(() => {
  logLines.length = 0;
  directory = createTemporaryStoreDirectory();
  configureSessionLimits({});
});

afterEach(async () => {
  await stop();
  clearAuthenticators();
  resetLoginLockoutStateForTests();
  resetLoginChallengesForTests();
  for (const key of configured.splice(0)) {
    delete ddEnvVars[key];
  }
  removeTemporaryStoreDirectory(directory);
});

describe('lost device and recovery codes', () => {
  test('the offline remove lets the account back in with its password, ends its sessions and is audited', async () => {
    let eve!: EnrolledFactor;
    let bob!: EnrolledFactor;
    const copy = enrollThenCopy(() => {
      eve = enrollFactor('basic.eve', 'eve', oldRing);
      bob = enrollFactor('basic.bob', 'bob', oldRing);
    });
    const accounts = [EVE, BOB];
    configureAccounts(accounts);
    configureKeyring({ k1: OLD_KEY });

    // Before: a password alone is only half a login, and a code completes it.
    let h = await start(copy, accounts);
    const halfLogin = await passwordLogin(h, EVE);
    expect(halfLogin.status).toBe(202);
    expect(halfLogin.headers.get('set-cookie')).toBeNull();
    const signedIn = await loginWithCode(h, EVE, eve.seed);
    expect(signedIn.status).toBe(200);
    const oldCookie = cookieOf(signedIn);
    expect(await protectedStatus(h, oldCookie)).toBe(200);

    // The command refuses a store that is in use.
    const whileRunning = command('remove', '--username', 'eve', '--db', copy, '--confirm');
    expect(whileRunning.code).toBe(1);
    expect(whileRunning.err).toContain('is in use by another process');
    await stop();

    // Stopped, and with no key ring at all: the removal needs none.
    configureKeyring(undefined);
    const preview = command('remove', '--username', 'eve', '--db', copy);
    expect(preview.code).toBe(0);
    expect(preview.out).toContain('Nothing was changed.');
    const removed = command('remove', '--username', 'eve', '--db', copy, '--confirm');
    expect(removed.code).toBe(0);
    expect(removed.err).toBe('');

    // After: the session from before is dead, the password alone signs in.
    configureKeyring({ k1: OLD_KEY });
    h = await start(copy, accounts);
    expect(await protectedStatus(h, oldCookie)).toBe(401);
    const afterwards = await passwordLogin(h, EVE);
    expect(afterwards.status).toBe(200);
    expect(await afterwards.json()).toEqual({ username: 'eve' });
    expect(await protectedStatus(h, cookieOf(afterwards))).toBe(200);

    // Nobody else's factor moved: bob still needs his code, and it still works.
    expect((await passwordLogin(h, BOB)).status).toBe(202);
    expect((await loginWithCode(h, BOB, bob.seed)).status).toBe(200);

    // The start recorded the break-glass, once, with ids only.
    expect(breakGlassDetails()).toEqual([
      expect.stringMatching(
        new RegExp(`^operation=remove subject=${eve.subjectId} factor=${eve.factorId} at=\\S+$`),
      ),
    ]);
    expectNoSecretIn(everythingSaid(whileRunning, preview, removed), [eve, bob]);

    // The store the copy was taken from was never touched.
    await stop();
    const live = openDatabase(path.join(directory, 'dd.sqlite'));
    totpStore.createCollections(live);
    expect(totpStore.getFactorBySubject(eve.subjectId)).toBeDefined();
    expect(totpStore.countPendingOfflineOperations()).toBe(0);
    live.close();
  });
});

describe('lost key ring', () => {
  test.each([
    ['gone', undefined],
    ['replaced by a different key under the same id', { k1: NEW_KEY }],
  ])(
    'with the key %s the factor fails closed, and the offline remove recovers the account',
    async (_label, keys) => {
      let eve!: EnrolledFactor;
      const copy = enrollThenCopy(() => {
        eve = enrollFactor('basic.eve', 'eve', oldRing);
      });
      configureAccounts([EVE]);
      configureKeyring(keys);

      // The factor is still required, and nothing can verify it: no way in.
      let h = await start(copy, [EVE]);
      const refused = await loginWithCode(h, EVE, eve.seed);
      expect(refused.status).toBe(503);
      expect(refused.headers.get('set-cookie')).toBeNull();
      await stop();

      const status = command('status', '--db', copy);
      expect(status.out).toContain(
        keys === undefined
          ? 'key k1: not checked, no usable key ring'
          : 'key k1: CANNOT BE DECRYPTED',
      );
      // Nothing about a lost key reads as "safe to tidy the key ring".
      const rewrap = command('rewrap', '--db', copy, '--confirm');
      expect(rewrap.code).toBe(1);
      expect(`${status.out}\n${rewrap.out}`).not.toContain('can be removed from the key ring');
      const removed = command('remove', '--subject', eve.subjectId, '--db', copy, '--confirm');
      expect(removed.code).toBe(0);

      h = await start(copy, [EVE]);
      const afterwards = await passwordLogin(h, EVE);
      expect(afterwards.status).toBe(200);
      expect(await protectedStatus(h, cookieOf(afterwards))).toBe(200);
      expect(breakGlassDetails()).toHaveLength(1);
      expectNoSecretIn(everythingSaid(status, rewrap, removed), [eve]);
    },
  );
});

describe('key rotation', () => {
  test('after rewrap the old key can leave the key ring and every factor still verifies', async () => {
    let eve!: EnrolledFactor;
    let bob!: EnrolledFactor;
    const copy = enrollThenCopy(() => {
      eve = enrollFactor('basic.eve', 'eve', oldRing);
      bob = enrollFactor('basic.bob', 'bob', oldRing);
    });
    const untouched = copyStoreFile(directory, 'dd.sqlite', 'not-rewrapped.sqlite');
    const accounts = [EVE, BOB];
    configureAccounts(accounts);

    // Both keys in the key ring, the new one active: rewrap, then ask what is left.
    configureKeyring({ k1: OLD_KEY, k2: NEW_KEY }, 'k2');
    const before = command('status', '--db', copy);
    expect(before.out).toContain(
      'Still needed in the key ring until "rewrap" moves what they protect: k1',
    );
    const rewrapped = command('rewrap', '--db', copy, '--confirm');
    expect(rewrapped.code).toBe(0);
    expect(rewrapped.out).toContain('Re-encrypted 2 factors under the active key "k2"');
    const after = command('status', '--db', copy);
    expect(after.out).toContain('k1: 0 factors, 0 pending enrollments - retired, unused');
    expect(after.out).toContain(
      'Everything is under the active key. Retired keys can be removed from the key ring.',
    );
    const again = command('rewrap', '--db', copy, '--confirm');
    expect(again.out).toContain('Re-encrypted 0 factors');

    // The old key is removed from the key ring. The same authenticators still sign in.
    configureKeyring({ k2: NEW_KEY }, 'k2');
    let h = await start(copy, accounts);
    const eveIn = await loginWithCode(h, EVE, eve.seed);
    expect(eveIn.status).toBe(200);
    expect(await protectedStatus(h, cookieOf(eveIn))).toBe(200);
    expect((await loginWithCode(h, BOB, bob.seed)).status).toBe(200);
    // A rotation is not a break-glass: it changes nobody's access and leaves no audit marker.
    expect(breakGlassDetails()).toEqual([]);
    await stop();

    // The control: the same store without the rewrap cannot lose the old key.
    h = await start(untouched, accounts);
    expect((await loginWithCode(h, EVE, eve.seed)).status).toBe(503);

    expectNoSecretIn(everythingSaid(before, rewrapped, after, again), [eve, bob]);
  });
});

describe('renamed account', () => {
  test('rebind restores the factor to the renamed account and to nobody else', async () => {
    let renamed!: EnrolledFactor;
    let deleted!: EnrolledFactor;
    let kept!: EnrolledFactor;
    const copy = enrollThenCopy(() => {
      renamed = enrollFactor('basic.eve', 'eve', oldRing);
      deleted = enrollFactor('basic.gone', 'eve', oldRing);
      kept = enrollFactor('basic.ops', 'eve', oldRing);
    });
    // Now: basic.eve was renamed to basic.evelyn, basic.gone was deleted,
    // basic.ops is as it was, and basic.guest never enrolled.
    const accounts = [EVELYN, OPS, GUEST];
    configureAccounts(accounts);
    configureKeyring({ k1: OLD_KEY });
    const deletedRowBefore = () => {
      const db = openDatabase(copy);
      totpStore.createCollections(db);
      const row = totpStore.getFactorBySubject(deleted.subjectId);
      db.close();
      return row;
    };
    const before = deletedRowBefore();

    // Until someone decides, the rename fails closed: the renamed account is
    // not let in on its password as though it had never enrolled, and neither
    // is any other account without a factor, since nothing tells them apart.
    // An account with its own factor is asked for it as always.
    let h = await start(copy, accounts);
    expect((await passwordLogin(h, EVELYN)).status).toBe(503);
    expect((await passwordLogin(h, GUEST)).status).toBe(503);
    expect((await passwordLogin(h, OPS)).status).toBe(202);
    await stop();

    const status = command('status', '--db', copy);
    expect(status.out).toContain('Orphaned factors: 2');

    // Three factors share the username, so the username alone names nobody.
    const ambiguous = command(
      'rebind',
      '--username',
      'eve',
      '--to-provider',
      'basic.evelyn',
      '--db',
      copy,
      '--confirm',
    );
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.err).toContain('More than one factor matches');

    const rebound = command(
      'rebind',
      '--provider',
      'basic.eve',
      '--username',
      'eve',
      '--to-provider',
      'basic.evelyn',
      '--db',
      copy,
      '--confirm',
    );
    expect(rebound.code).toBe(0);
    expect(rebound.err).toBe('');

    h = await start(copy, accounts);
    // The renamed account is asked for its factor, and the authenticator
    // enrolled under the old name is the one that satisfies it.
    const first = await passwordLogin(h, EVELYN);
    expect(first.status).toBe(202);
    const { challenge } = (await first.json()) as { challenge: { id: string } };
    const withAnotherFactor = await fetch(url(h, `/auth/login-challenges/${challenge.id}`), {
      method: 'PUT',
      headers: { ...HTTPS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: generateTotp(deleted.seed, Date.now()) }),
    });
    expect(withAnotherFactor.status).toBe(401);
    const restored = await loginWithCode(h, EVELYN, renamed.seed);
    expect(restored.status).toBe(200);
    expect(await protectedStatus(h, cookieOf(restored))).toBe(200);

    // The account that was never renamed still has its own factor, unchanged.
    expect((await loginWithCode(h, OPS, kept.seed)).status).toBe(200);

    // Only the chosen factor moved: the other orphan is exactly as it was.
    expect(totpStore.getFactorBySubject(renamed.subjectId)).toBeUndefined();
    expect(totpStore.getFactorBySubject(subjectOf(EVELYN))?.factorId).toBe(renamed.factorId);
    expect(totpStore.getFactorBySubject(deleted.subjectId)).toEqual(before);
    expect(totpStore.listFactors()).toHaveLength(3);
    expect(breakGlassDetails()).toEqual([
      expect.stringMatching(
        new RegExp(
          `^operation=rebind subject=${renamed.subjectId} factor=${renamed.factorId} to=${subjectOf(EVELYN)} at=\\S+$`,
        ),
      ),
    ]);

    // The deleted account's factor is still orphaned, so an account without a
    // factor stays out until that one is dealt with too.
    expect((await passwordLogin(h, GUEST)).status).toBe(503);
    await stop();
    const removed = command('remove', '--subject', deleted.subjectId, '--db', copy, '--confirm');
    expect(removed.code).toBe(0);
    h = await start(copy, accounts);
    expect((await passwordLogin(h, GUEST)).status).toBe(200);
    expect(breakGlassDetails()).toHaveLength(2);

    expectNoSecretIn(everythingSaid(status, ambiguous, rebound, removed), [renamed, deleted, kept]);
  });
});
