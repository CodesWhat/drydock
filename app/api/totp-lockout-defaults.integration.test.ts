/**
 * Lockout identity and the second-factor budget at the DEFAULT thresholds
 * (5 per account, 25 per IP), against the real login routes, Basic providers,
 * express-session and SQLite. The sibling login-challenge integration test
 * raises the limits so it can run long flows; this one leaves them alone,
 * because a lockout that only holds at raised limits proves nothing.
 */
import { argon2Sync, randomBytes } from 'node:crypto';
import http from 'node:http';
import express, { type Application } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';

vi.mock('./audit-events.js', () => ({ recordAuditEvent: vi.fn() }));

vi.mock('../store/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../store/index.js')>();
  const os = await import('node:os');
  return {
    ...original,
    getConfiguration: () => ({ path: os.tmpdir(), file: 'drydock-totp-lockout-test.json' }),
  };
});

vi.mock('../log/index.js', () => {
  const logger: object = new Proxy(
    {},
    { get: (_t, p) => (p === 'child' ? () => logger : () => {}) },
  );
  return { default: logger };
});

import Basic from '../authentications/providers/basic/Basic.js';
import { ddEnvVars } from '../configuration/index.js';
import * as sessionModel from '../store/session.js';
import * as totpStore from '../store/totp.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import { registerLoginRoutes } from './auth.js';
import { resetLoginLockoutStateForTests } from './auth-lockout.js';
import { configureSessionLimits } from './auth-session.js';
import { clearAuthenticators, registerAuthenticator } from './authenticator-chain.js';
import { restoreSessionPrincipal, sessionAuthenticator } from './session-principal.js';
import { SessionStore } from './session-store.js';
import { resetLoginChallengesForTests } from './totp-challenge.js';
import {
  digestRecoveryCode,
  encryptTotpSeed,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSeed,
  parseTotpKeyring,
  type TotpSeedBinding,
  totpCounterAt,
} from './totp-crypto.js';
import { deriveSubjectId } from './totp-identity.js';

const TEST_USER = 'wud-card';
const OTHER_USER = 'plain-user';
const TEST_PASSWORD = 'correct-horse-battery-staple';
const basicHeader = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const VICTIM = basicHeader(TEST_USER, TEST_PASSWORD);
const OTHER = basicHeader(OTHER_USER, TEST_PASSWORD);
const HTTPS_HEADERS = { 'X-Forwarded-Proto': 'https' };
const SUBJECT_ID = deriveSubjectId('basic.default', TEST_USER);

const keyringJson = JSON.stringify({ k1: Buffer.alloc(32, 1).toString('base64') });
const keyring = parseTotpKeyring(keyringJson, 'k1');
const ENROLLED_AT = new Date('2026-10-03T12:00:00.000Z');

type Database = ReturnType<typeof createMigratedMemoryDatabase>;

interface Harness {
  db: Database;
  store: SessionStore;
  server: http.Server;
  port: number;
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

const HASH = createArgon2Hash(TEST_PASSWORD);

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

let serial = 0;

/** Enroll a factor through the slice 1 store, moving the subject up one version. */
function enroll(subjectId = SUBJECT_ID, { recoveryCount = 10 } = {}): Enrolled {
  serial += 1;
  const enrollmentId = `enrollment-${serial}`;
  const factorId = `factor-${serial}`;
  const seed = generateTotpSeed();
  const recoveryCodes = recoveryCount > 0 ? generateRecoveryCodes(recoveryCount) : [];
  const iso = ENROLLED_AT.toISOString();
  const active = totpStore.getFactorBySubject(subjectId);
  totpStore.createEnrollment(
    {
      schemaVersion: 1,
      enrollmentId,
      subjectId,
      providerId: 'basic.default',
      username: TEST_USER,
      expectedFactorVersion: totpStore.getSubjectVersion(subjectId),
      replacesFactorId: active?.factorId ?? null,
      ...encryptTotpSeed(seed, bindingFor(subjectId, enrollmentId), keyring),
      createdAt: iso,
      expiresAt: new Date(ENROLLED_AT.getTime() + 600_000).toISOString(),
    },
    ENROLLED_AT,
  );
  totpStore.activateEnrollment({
    enrollmentId,
    acceptedCounter: totpCounterAt(Date.now()) - 5,
    factor: {
      schemaVersion: 1,
      factorId,
      subjectId,
      providerId: 'basic.default',
      username: TEST_USER,
      ...encryptTotpSeed(seed, bindingFor(subjectId, factorId), keyring),
      algorithm: 'SHA1',
      digits: 6,
      periodSeconds: 30,
      allowedSkewSteps: 1,
      createdAt: iso,
      activatedAt: iso,
    },
    recoveryCodeDigests: recoveryCodes.map(digestRecoveryCode),
    now: ENROLLED_AT,
  });
  return { seed, recoveryCodes, factorId };
}

async function start(): Promise<Harness> {
  const db = createMigratedMemoryDatabase();
  sessionModel.createCollections(db);
  totpStore.createCollections(db);
  const store = new SessionStore({ ttlMs: 60_000 });

  const victim = new Basic();
  await victim.register('authentication', 'basic', 'default', { user: TEST_USER, hash: HASH });
  const other = new Basic();
  await other.register('authentication', 'basic', 'other', { user: OTHER_USER, hash: HASH });
  clearAuthenticators();
  registerAuthenticator(victim.getAuthenticator());
  registerAuthenticator(other.getAuthenticator());
  registerAuthenticator(sessionAuthenticator);

  const app: Application = express();
  app.set('trust proxy', 1);
  app.use(
    session({
      name: 'dd.sid.test',
      secret: 'test-secret', // gitleaks:allow — fixed throwaway signing secret for a test-only session store
      resave: false,
      saveUninitialized: false,
      store,
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

  const server = http.createServer(app);
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
  return { db, store, server, port };
}

const url = (h: Harness, path: string) => `http://127.0.0.1:${h.port}${path}`;

function login(h: Harness, authorization: string, body: unknown = {}) {
  return fetch(url(h, '/auth/login'), {
    method: 'POST',
    headers: { ...HTTPS_HEADERS, 'Content-Type': 'application/json', Authorization: authorization },
    body: JSON.stringify(body),
  });
}

function prove(h: Harness, id: string, code: string) {
  return fetch(url(h, `/auth/login-challenges/${id}`), {
    method: 'PUT',
    headers: { ...HTTPS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

function proveRecovery(h: Harness, id: string, recoveryCode: string) {
  return fetch(url(h, `/auth/login-challenges/${id}`), {
    method: 'PUT',
    headers: { ...HTTPS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recoveryCode }),
  });
}

/** A fresh challenge, a wrong code, and the status it got. */
async function guessWrong(h: Harness): Promise<number> {
  return (await prove(h, await challengeFor(h), '000000')).status;
}

const MINUTE = 60_000;
const failuresOf = (h: Harness) =>
  h.db
    .prepare('SELECT factor_failures AS failures FROM totp_subject_versions WHERE subject_id = ?')
    .get(SUBJECT_ID)?.failures;

async function challengeFor(h: Harness): Promise<string> {
  const response = await login(h, VICTIM);
  expect(response.status).toBe(202);
  return ((await response.json()) as { challenge: { id: string } }).challenge.id;
}

describe('lockout identity at the default thresholds', () => {
  const harnesses: Harness[] = [];

  beforeEach(() => {
    ddEnvVars.DD_AUTH_TOTP_KEYRING = keyringJson;
    ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID = 'k1';
    configureSessionLimits({});
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const h of harnesses.splice(0)) {
      await new Promise<void>((resolve) => h.server.close(() => resolve()));
      h.store.stop();
    }
    clearAuthenticators();
    resetLoginLockoutStateForTests();
    resetLoginChallengesForTests();
    delete ddEnvVars.DD_AUTH_TOTP_KEYRING;
    delete ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID;
  });

  async function boot() {
    const h = await start();
    harnesses.push(h);
    return h;
  }

  test('five wrong codes lock the account even when another user logs in between them, naming it in the body', async () => {
    const h = await boot();
    enroll();
    const challenge = await challengeFor(h);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      statuses.push((await prove(h, challenge, '000000')).status);
      // A different, unenrolled user succeeds and names the victim in the body.
      if (attempt < 4) {
        expect((await login(h, OTHER, { username: TEST_USER })).status).toBe(200);
      }
    }

    expect(statuses).toEqual([401, 401, 401, 401, 423]);
  });

  test('a locked account cannot get a 202 by putting another username in the body', async () => {
    const h = await boot();
    enroll();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(h, basicHeader(TEST_USER, 'wrong'));
    }
    expect((await login(h, VICTIM)).status).toBe(423);

    const decoy = await login(h, VICTIM, { username: OTHER_USER });

    expect(decoy.status).toBe(423);
    expect(decoy.headers.get('retry-after')).not.toBeNull();
  });

  test('wrong passwords count against the Basic header user, not a username in the body', async () => {
    const h = await boot();
    enroll();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(h, basicHeader(TEST_USER, 'wrong'), { username: `decoy-${attempt}` });
    }

    expect((await login(h, VICTIM)).status).toBe(423);
  });

  test('a locked account does not block another user who names it in the body', async () => {
    const h = await boot();
    enroll();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(h, basicHeader(TEST_USER, 'wrong'));
    }

    expect((await login(h, OTHER, { username: TEST_USER })).status).toBe(200);
  });

  describe('code guessing is capped, not rate-limited', () => {
    test('after the first lock lapses each further wrong code earns a longer one, never a fresh batch of five', async () => {
      const h = await boot();
      enroll();
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = Date.now();

      const first = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        first.push(await guessWrong(h));
      }
      expect(first).toEqual([401, 401, 401, 401, 423]);

      for (const [elapsed, lockMinutes] of [
        [16, 30],
        [47, 60],
        [108, 120],
      ] as const) {
        vi.setSystemTime(start + elapsed * MINUTE);
        const response = await prove(h, await challengeFor(h), '000000');
        expect(response.status).toBe(423);
        expect(Number(response.headers.get('retry-after'))).toBe(lockMinutes * 60);
        // Still inside that lock: nothing, not even a right code, gets through.
        vi.setSystemTime(start + (elapsed + 1) * MINUTE);
        expect((await prove(h, await challengeFor(h), '000000')).status).toBe(423);
      }
    });

    test('a locked subject is refused even a correct code, and the lock survives a restart', async () => {
      const h = await boot();
      const enrolled = enroll();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await guessWrong(h);
      }

      // A restart drops everything held in memory: budgets and challenges.
      resetLoginLockoutStateForTests();
      resetLoginChallengesForTests();

      const challenge = await challengeFor(h);
      const refused = await prove(h, challenge, generateTotp(enrolled.seed, Date.now()));
      expect(refused.status).toBe(423);
      expect(refused.headers.get('set-cookie')).toBeNull();
      expect(failuresOf(h)).toBe(5);
    });

    test('a successful code starts the count over', async () => {
      const h = await boot();
      const enrolled = enroll();
      for (let attempt = 0; attempt < 4; attempt += 1) {
        expect(await guessWrong(h)).toBe(401);
        resetLoginLockoutStateForTests();
      }
      expect(failuresOf(h)).toBe(4);

      const ok = await prove(h, await challengeFor(h), generateTotp(enrolled.seed, Date.now()));
      expect(ok.status).toBe(200);
      expect(failuresOf(h)).toBe(0);

      const again = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        again.push(await guessWrong(h));
        resetLoginLockoutStateForTests();
      }
      expect(again).toEqual([401, 401, 401, 401]);
    });

    test('a recovery code is a successful proof too', async () => {
      const h = await boot();
      const enrolled = enroll();
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await guessWrong(h);
        resetLoginLockoutStateForTests();
      }

      const ok = await proveRecovery(h, await challengeFor(h), enrolled.recoveryCodes[0]);
      expect(ok.status).toBe(200);
      expect(failuresOf(h)).toBe(0);
    });

    test('wrong passwords never touch the persisted count', async () => {
      const h = await boot();
      enroll();
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await login(h, basicHeader(TEST_USER, 'wrong'));
      }
      expect(failuresOf(h)).toBe(0);
    });

    test('another subject is untouched by the lock', async () => {
      const h = await boot();
      enroll();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await guessWrong(h);
      }
      expect((await login(h, OTHER)).status).toBe(200);
    });
  });
});
