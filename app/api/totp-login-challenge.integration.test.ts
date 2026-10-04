/**
 * Integration test for TOTP slice 3 (spec 11.1.2): the login challenge and the
 * closed enrolled-subject Basic bypass, against real express + express-session
 * + SessionStore on a migrated SQLite database, the real Basic provider, the
 * real login routes (`registerLoginRoutes`), the real `requireAuthentication`,
 * and a real WebSocket upgrade.
 *
 * Two promises are held here. With no TOTP rows nothing a client can observe
 * changes. With a factor, a password alone buys a 202 challenge and never a
 * principal, a cookie or a stored session, and only a valid, non-replayed
 * proof turns the challenge into one.
 *
 * The fixture app holds no route that writes a session from request input:
 * sessions are made by the real login routes or planted through the session
 * store, the way a session from another release would already sit there.
 */
import { argon2Sync, createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import express, { type Application, type Response as ExpressResponse, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import { WebSocket, WebSocketServer } from 'ws';

const { auditEvents, logLines } = vi.hoisted(() => {
  // Account lockout is the budget under test in one place, so keep it out of the
  // way everywhere else: a single address makes every request one IP.
  process.env.DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS = '50';
  process.env.DD_AUTH_IP_LOCKOUT_MAX_ATTEMPTS = '1000';
  process.env.DD_AUTH_MAX_CONCURRENT_LOGIN_ATTEMPTS = '10';
  return { auditEvents: [] as unknown[], logLines: [] as unknown[][] };
});

vi.mock('./audit-events.js', () => ({
  recordAuditEvent: (event: unknown) => {
    auditEvents.push(event);
  },
}));

vi.mock('../store/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../store/index.js')>();
  const os = await import('node:os');
  return {
    ...original,
    getConfiguration: () => ({ path: os.tmpdir(), file: 'drydock-totp-login-test.json' }),
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
import * as sessionModel from '../store/session.js';
import * as totpStore from '../store/totp.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import { registerLoginRoutes, requireAuthentication } from './auth.js';
import { resetLoginLockoutStateForTests, testable_accountLockoutPolicy } from './auth-lockout.js';
import { configureSessionLimits } from './auth-session.js';
import type { AuthRequest } from './auth-types.js';
import { clearAuthenticators, registerAuthenticator } from './authenticator-chain.js';
import { restoreSessionPrincipal, sessionAuthenticator } from './session-principal.js';
import { SessionStore } from './session-store.js';
import { registerSessionStreamCloser } from './session-streams.js';
import {
  getLoginChallengeCountForTests,
  LOGIN_CHALLENGE_MAX_ENTRIES,
  LOGIN_CHALLENGE_TTL_MS,
  resetLoginChallengesForTests,
} from './totp-challenge.js';
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
import { applySessionMiddleware, isAuthenticatedSession } from './ws-upgrade-utils.js';

const TEST_USER = 'wud-card';
const TEST_PASSWORD = 'correct-horse-battery-staple';
const basicHeader = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const BASIC_AUTH_HEADER = basicHeader(TEST_USER, TEST_PASSWORD);
const HTTPS_HEADERS = { 'X-Forwarded-Proto': 'https' };
const SESSION_SECRET = 'test-secret'; // gitleaks:allow — fixed throwaway signing secret for a test-only session store
const SUBJECT_ID = deriveSubjectId('basic.default', TEST_USER);
const UNAUTHORIZED = JSON.stringify({ error: 'Unauthorized' });

const keyringJson = JSON.stringify({ k1: Buffer.alloc(32, 1).toString('base64') });
const keyring = parseTotpKeyring(keyringJson, 'k1');
const ENROLLED_AT = new Date('2026-10-03T12:00:00.000Z');

type Database = ReturnType<typeof createMigratedMemoryDatabase>;

interface Harness {
  db: Database;
  store: SessionStore;
  server: http.Server;
  wsServer: WebSocketServer;
  port: number;
}

interface Enrolled {
  seed: Buffer;
  recoveryCodes: string[];
  factorId: string;
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

  const basic = new Basic();
  await basic.register('authentication', 'basic', 'default', { user: TEST_USER, hash: HASH });
  clearAuthenticators();
  registerAuthenticator(basic.getAuthenticator());
  registerAuthenticator(sessionAuthenticator);

  const sessionMiddleware = session({
    name: 'dd.sid.test',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store,
    cookie: { httpOnly: true, secure: true },
  });

  const app: Application = express();
  app.set('trust proxy', 1);
  app.use(sessionMiddleware);
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

  app.get('/protected', requireAuthentication, (req: Request, res: ExpressResponse) => {
    res.status(200).json({ user: { username: (req as AuthRequest).principal?.username } });
  });
  // Holds a request open between reading the session and finishing it, the way
  // a slow handler does. What it writes is server-derived, never request input.
  app.get('/slow-touch', requireAuthentication, async (req: Request, res: ExpressResponse) => {
    inFlight.reached();
    await inFlight.gate;
    (req as AuthRequest).session.touchedAt = Date.now();
    res.status(200).json({ ok: true });
  });
  app.get('/events', requireAuthentication, (_req: Request, res: ExpressResponse) => {
    res.status(200).set('Content-Type', 'text/event-stream').end('data: ok\n\n');
  });

  const wsServer = new WebSocketServer({ noServer: true });
  const server = http.createServer(app);
  server.on('upgrade', (request, socket: Duplex, head) => {
    void applySessionMiddleware(sessionMiddleware, request).then(() => {
      if (!isAuthenticatedSession(request as never)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wsServer.handleUpgrade(request, socket, head, (webSocket) => webSocket.close());
    });
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
  return { db, store, server, wsServer, port };
}

const inFlight = {
  gate: Promise.resolve(),
  reached: () => {},
  release: () => {},
  arm(): Promise<void> {
    let reached: () => void = () => {};
    const arrived = new Promise<void>((resolve) => {
      reached = resolve;
    });
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
    this.reached = reached;
    return arrived;
  },
};

const url = (h: Harness, path: string) => `http://127.0.0.1:${h.port}${path}`;

function post(h: Harness, headers: Record<string, string>, body?: unknown) {
  return fetch(url(h, '/auth/login'), {
    method: 'POST',
    headers: { ...HTTPS_HEADERS, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });
}

interface ChallengeBody {
  challenge: { id: string; expiresAt: string; methods: string[] };
}

/** Password step for the enrolled subject; asserts the 202 and returns the challenge. */
async function startChallenge(h: Harness, body: unknown = {}): Promise<ChallengeBody['challenge']> {
  const response = await post(h, { Authorization: BASIC_AUTH_HEADER }, body);
  expect(response.status).toBe(202);
  return ((await response.json()) as ChallengeBody).challenge;
}

function put(h: Harness, id: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url(h, `/auth/login-challenges/${id}`), {
    method: 'PUT',
    headers: { ...HTTPS_HEADERS, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const cookieOf = (response: Awaited<ReturnType<typeof fetch>>) =>
  (response.headers.get('set-cookie') as string).split(';')[0];

const totpNow = (seed: Buffer, offsetMs = 0) => generateTotp(seed, Date.now() + offsetMs);

/** Complete a fresh challenge with a TOTP code; returns the session cookie. */
async function loginWithCode(h: Harness, enrolled: Enrolled, offsetMs = 0): Promise<string> {
  const challenge = await startChallenge(h);
  const response = await put(h, challenge.id, { code: totpNow(enrolled.seed, offsetMs) });
  expect(response.status).toBe(200);
  return cookieOf(response);
}

function storedUsers(db: Database): string[] {
  return db
    .prepare('SELECT data FROM sessions')
    .all()
    .map((row) => (JSON.parse(String(row.data)).passport ?? {}).user as string);
}

/** The stored user of a session minted a minute before the one given. */
function oldSessionUser(user: string): string {
  const parsed = JSON.parse(user);
  return JSON.stringify({ ...parsed, issuedAt: parsed.issuedAt - 60_000 });
}

async function plant(h: Harness, user: string): Promise<string> {
  const sid = randomBytes(18).toString('base64url');
  const data = {
    cookie: { originalMaxAge: null, httpOnly: true, secure: true },
    passport: { user },
  } as unknown as session.SessionData;
  await new Promise<void>((resolve, reject) => {
    h.store.set(sid, data, (error) => (error ? reject(error) : resolve()));
  });
  const signature = createHmac('sha256', SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `dd.sid.test=${encodeURIComponent(`s:${sid}.${signature}`)}`;
}

async function status(h: Harness, path: string, headers: Record<string, string>) {
  const response = await fetch(url(h, path), { headers: { ...HTTPS_HEADERS, ...headers } });
  return response.status;
}

const protectedStatus = (h: Harness, cookie: string) => status(h, '/protected', { Cookie: cookie });

function upgradeOutcome(h: Harness, headers: Record<string, string>): Promise<'open' | 'refused'> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${h.port}/ws`, {
      headers: { ...HTTPS_HEADERS, ...headers },
    });
    socket.on('open', () => resolve('open'));
    socket.on('unexpected-response', () => resolve('refused'));
    socket.on('error', () => resolve('refused'));
  });
}

describe('TOTP slice 3: login challenge and the closed Basic bypass', () => {
  const harnesses: Harness[] = [];

  async function boot(): Promise<Harness> {
    const h = await start();
    harnesses.push(h);
    return h;
  }

  beforeEach(() => {
    auditEvents.length = 0;
    logLines.length = 0;
    ddEnvVars.DD_AUTH_TOTP_KEYRING = keyringJson;
    ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID = 'k1';
    configureSessionLimits({});
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const h of harnesses.splice(0)) {
      h.wsServer.close();
      await new Promise<void>((resolve) => h.server.close(() => resolve()));
      h.store.stop();
    }
    clearAuthenticators();
    resetLoginLockoutStateForTests();
    resetLoginChallengesForTests();
    delete ddEnvVars.DD_AUTH_TOTP_KEYRING;
    delete ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID;
  });

  describe('with no TOTP rows every existing client sees what it saw before', () => {
    test('login answers 200 with exactly the old body and headers, a session cookie, and no challenge', async () => {
      const h = await boot();
      const response = await post(h, { Authorization: BASIC_AUTH_HEADER }, { remember: false });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(JSON.stringify({ username: TEST_USER }));
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe(
        'private, no-cache, no-store, must-revalidate',
      );
      expect(response.headers.get('pragma')).toBe('no-cache');
      expect(response.headers.get('expires')).toBe('0');
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('set-cookie')).toMatch(/^dd\.sid\.test=/);
      expect(getLoginChallengeCountForTests()).toBe(0);
      expect(storedUsers(h.db)).toHaveLength(1);
    });

    test('the new session works over HTTP, SSE and the upgrade', async () => {
      const h = await boot();
      const cookie = cookieOf(await post(h, { Authorization: BASIC_AUTH_HEADER }));

      expect(await protectedStatus(h, cookie)).toBe(200);
      expect(await status(h, '/events', { Cookie: cookie })).toBe(200);
      await expect(upgradeOutcome(h, { Cookie: cookie })).resolves.toBe('open');
    });

    test('a wrong password and an unknown user are the same bare 401 they always were', async () => {
      const h = await boot();
      const wrong = await post(h, { Authorization: basicHeader(TEST_USER, 'nope') });
      const unknown = await post(h, { Authorization: basicHeader('nobody', TEST_PASSWORD) });

      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(await wrong.text()).toBe(UNAUTHORIZED);
      expect(await unknown.text()).toBe(UNAUTHORIZED);
    });

    test('direct Basic on a protected route and SSE still works and persists no session', async () => {
      const h = await boot();

      expect(await status(h, '/protected', { Authorization: BASIC_AUTH_HEADER })).toBe(200);
      expect(await status(h, '/events', { Authorization: BASIC_AUTH_HEADER })).toBe(200);
      expect(storedUsers(h.db)).toEqual([]);
    });

    test('legacy and OIDC sessions keep working', async () => {
      const h = await boot();
      const legacy = await plant(h, JSON.stringify({ username: TEST_USER }));
      const oidc = await plant(
        h,
        JSON.stringify({ v: 2, kind: 'oidc', username: 'a@example.com' }),
      );

      expect(await protectedStatus(h, legacy)).toBe(200);
      expect(await protectedStatus(h, oidc)).toBe(200);
    });

    test('the challenge routes do nothing for a challenge that was never issued', async () => {
      const h = await boot();
      const response = await put(h, randomBytes(32).toString('base64url'), { code: '123456' });

      expect(response.status).toBe(401);
      expect(await response.text()).toBe(UNAUTHORIZED);
    });
  });

  describe('a correct password for an enrolled subject', () => {
    test('answers 202 with a typed challenge, Location, no cookie, no principal and no stored session', async () => {
      const h = await boot();
      enroll();
      const before = Date.now();
      const response = await post(h, { Authorization: BASIC_AUTH_HEADER });
      const body = (await response.json()) as ChallengeBody;

      expect(response.status).toBe(202);
      expect(Object.keys(body)).toEqual(['challenge']);
      expect(Object.keys(body.challenge)).toEqual(['id', 'expiresAt', 'methods']);
      expect(body.challenge.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(body.challenge.methods).toEqual(['totp', 'recovery']);
      const expiresAt = Date.parse(body.challenge.expiresAt);
      expect(expiresAt).toBeGreaterThanOrEqual(before + LOGIN_CHALLENGE_TTL_MS);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + LOGIN_CHALLENGE_TTL_MS);
      expect(response.headers.get('location')).toBe(`/auth/login-challenges/${body.challenge.id}`);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(storedUsers(h.db)).toEqual([]);
    });

    test('offers recovery only while unused codes remain', async () => {
      const h = await boot();
      enroll(SUBJECT_ID, { recoveryCount: 0 });

      expect((await startChallenge(h)).methods).toEqual(['totp']);
    });

    test('a wrong password for the enrolled subject is the ordinary 401 and reveals no challenge', async () => {
      const h = await boot();
      enroll();
      const response = await post(h, { Authorization: basicHeader(TEST_USER, 'nope') });

      expect(response.status).toBe(401);
      expect(await response.text()).toBe(UNAUTHORIZED);
      expect(getLoginChallengeCountForTests()).toBe(0);
    });

    test('keeps at most five live challenges per subject, replacing the oldest', async () => {
      const h = await boot();
      const enrolled = enroll();
      const challenges = [];
      for (let index = 0; index < 6; index += 1) {
        challenges.push(await startChallenge(h));
      }

      expect((await put(h, challenges[0].id, { code: totpNow(enrolled.seed) })).status).toBe(401);
      expect((await put(h, challenges[5].id, { code: totpNow(enrolled.seed) })).status).toBe(200);
    });

    test('is refused with 429 once 5,000 live challenges exist, and nothing is evicted', async () => {
      const h = await boot();
      const enrolled = enroll();
      const first = await startChallenge(h);
      const { createLoginChallenge } = await import('./totp-challenge.js');
      for (let index = 1; index < LOGIN_CHALLENGE_MAX_ENTRIES; index += 1) {
        createLoginChallenge({
          subjectId: `x-${index}`,
          providerId: 'basic.default',
          username: 'x',
          factorVersion: 1,
          remember: false,
        });
      }

      const refused = await post(h, { Authorization: BASIC_AUTH_HEADER });
      expect(refused.status).toBe(429);
      expect(refused.headers.get('retry-after')).toBe('1');
      expect(refused.headers.get('set-cookie')).toBeNull();
      expect(getLoginChallengeCountForTests()).toBe(LOGIN_CHALLENGE_MAX_ENTRIES);

      const completed = await put(h, first.id, { code: totpNow(enrolled.seed) });
      expect(completed.status).toBe(200);
    });
  });

  describe('completing the challenge', () => {
    test('a valid code mints a TOTP-assured v2 session that works on HTTP, SSE and the upgrade', async () => {
      const h = await boot();
      const enrolled = enroll();
      const challenge = await startChallenge(h);
      const response = await put(h, challenge.id, { code: totpNow(enrolled.seed) });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(JSON.stringify({ username: TEST_USER }));
      expect(response.headers.get('cache-control')).toBe(
        'private, no-cache, no-store, must-revalidate',
      );
      const cookie = cookieOf(response);
      const [stored] = storedUsers(h.db);
      const { issuedAt, ...stable } = JSON.parse(stored);
      expect(Math.abs(Date.now() - issuedAt)).toBeLessThan(60_000);
      expect(stable).toEqual({
        v: 2,
        kind: 'local',
        username: TEST_USER,
        subjectId: SUBJECT_ID,
        providerId: 'basic.default',
        assurance: 'totp',
        factorVersion: 1,
      });
      expect(await protectedStatus(h, cookie)).toBe(200);
      expect(await status(h, '/events', { Cookie: cookie })).toBe(200);
      await expect(upgradeOutcome(h, { Cookie: cookie })).resolves.toBe('open');
    });

    test('a recovery code mints a recovery-assured session, is single-use, and revokes the subject’s other sessions only', async () => {
      const h = await boot();
      const enrolled = enroll();
      const earlier = await loginWithCode(h, enrolled);
      const oidc = await plant(h, JSON.stringify({ v: 2, kind: 'oidc', username: TEST_USER }));
      const challenge = await startChallenge(h);
      const recoveryCode = enrolled.recoveryCodes[0].toUpperCase();

      const response = await put(h, challenge.id, { recoveryCode });
      expect(response.status).toBe(200);
      const cookie = cookieOf(response);

      expect(
        storedUsers(h.db).filter((user) => user?.includes('"assurance":"recovery"')),
      ).toHaveLength(1);
      expect(await protectedStatus(h, cookie)).toBe(200);
      expect(await protectedStatus(h, earlier)).toBe(401);
      expect(await protectedStatus(h, oidc)).toBe(200);
      expect(auditEvents).toContainEqual({
        action: 'totp-recovery-used',
        status: 'success',
        containerName: 'authentication',
        details: `subject=${SUBJECT_ID}`,
      });

      const again = await startChallenge(h);
      expect(again.methods).toEqual(['totp', 'recovery']);
      const reused = await put(h, again.id, { recoveryCode: enrolled.recoveryCodes[0] });
      expect(reused.status).toBe(401);
      expect(await reused.text()).toBe(UNAUTHORIZED);
    });

    test('using the last recovery code leaves TOTP login available', async () => {
      const h = await boot();
      const enrolled = enroll(SUBJECT_ID, { recoveryCount: 1 });
      const challenge = await startChallenge(h);
      expect((await put(h, challenge.id, { recoveryCode: enrolled.recoveryCodes[0] })).status).toBe(
        200,
      );

      const next = await startChallenge(h);
      expect(next.methods).toEqual(['totp']);
      expect((await put(h, next.id, { code: totpNow(enrolled.seed) })).status).toBe(200);
    });

    test('replaying an accepted code on a fresh challenge fails, and the next window still works', async () => {
      const h = await boot();
      const enrolled = enroll();
      const code = totpNow(enrolled.seed);
      const first = await startChallenge(h);
      expect((await put(h, first.id, { code })).status).toBe(200);

      const second = await startChallenge(h);
      const replay = await put(h, second.id, { code });
      expect(replay.status).toBe(401);
      expect(await replay.text()).toBe(UNAUTHORIZED);

      const third = await startChallenge(h);
      expect((await put(h, third.id, { code: totpNow(enrolled.seed, 30_000) })).status).toBe(200);
    });

    test('concurrent completion with the same challenge and code mints exactly one session', async () => {
      const h = await boot();
      const enrolled = enroll();
      const challenge = await startChallenge(h);
      const code = totpNow(enrolled.seed);

      const results = await Promise.all(
        Array.from({ length: 6 }, () => put(h, challenge.id, { code })),
      );

      expect(results.map((r) => r.status).sort()).toEqual([200, 401, 401, 401, 401, 401]);
      expect(storedUsers(h.db)).toHaveLength(1);
    });

    test('concurrent use of one recovery code on separate challenges has one winner', async () => {
      const h = await boot();
      const enrolled = enroll();
      const challenges = [
        await startChallenge(h),
        await startChallenge(h),
        await startChallenge(h),
      ];

      const results = await Promise.all(
        challenges.map((c) => put(h, c.id, { recoveryCode: enrolled.recoveryCodes[3] })),
      );

      expect(results.map((r) => r.status).sort()).toEqual([200, 401, 401]);
    });

    test('a completed challenge cannot be completed again', async () => {
      const h = await boot();
      const enrolled = enroll();
      const challenge = await startChallenge(h);
      expect((await put(h, challenge.id, { code: totpNow(enrolled.seed) })).status).toBe(200);

      const again = await put(h, challenge.id, { code: totpNow(enrolled.seed, 30_000) });
      expect(again.status).toBe(401);
    });

    test('remember is carried by the challenge and may be overridden by the completion', async () => {
      const h = await boot();
      const enrolled = enroll();
      // Each accepted code must be newer than the last, so walk the skew window forward.
      const remembered = await startChallenge(h, { remember: true });
      const kept = await put(h, remembered.id, { code: totpNow(enrolled.seed, -30_000) });
      expect(kept.headers.get('set-cookie')).toMatch(/Expires=/);

      const forgotten = await startChallenge(h, { remember: true });
      const dropped = await put(h, forgotten.id, { code: totpNow(enrolled.seed), remember: false });
      expect(dropped.status).toBe(200);
      expect(dropped.headers.get('set-cookie')).not.toMatch(/Max-Age|Expires/);

      const plain = await startChallenge(h);
      const overridden = await put(h, plain.id, {
        code: totpNow(enrolled.seed, 30_000),
        remember: true,
      });
      expect(overridden.headers.get('set-cookie')).toMatch(/Expires=/);
    });

    test('enforces the concurrent-session limit like any other login', async () => {
      const h = await boot();
      configureSessionLimits({ session: { maxconcurrentsessions: 1 } });
      const enrolled = enroll();
      const first = await loginWithCode(h, enrolled);
      const second = await loginWithCode(h, enrolled, 30_000);

      expect(await protectedStatus(h, second)).toBe(200);
      expect(await protectedStatus(h, first)).toBe(401);
    });

    test('a completion for another origin is refused when it carries a session cookie', async () => {
      const h = await boot();
      const enrolled = enroll();
      const challenge = await startChallenge(h);
      const response = await put(
        h,
        challenge.id,
        { code: totpNow(enrolled.seed) },
        { Cookie: 'dd.sid.test=anything', Origin: 'https://evil.example' },
      );

      expect(response.status).toBe(403);
      expect(storedUsers(h.db)).toEqual([]);
    });

    test('a store or key fault is a 503 that spends nothing and counts nothing', async () => {
      const h = await boot();
      const enrolled = enroll();
      const challenge = await startChallenge(h);
      delete ddEnvVars.DD_AUTH_TOTP_KEYRING;
      delete ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID;

      const down = await put(h, challenge.id, { code: totpNow(enrolled.seed) });
      expect(down.status).toBe(503);
      expect(down.headers.get('set-cookie')).toBeNull();

      ddEnvVars.DD_AUTH_TOTP_KEYRING = keyringJson;
      ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID = 'k1';
      expect((await put(h, challenge.id, { code: totpNow(enrolled.seed) })).status).toBe(200);
    });
  });

  describe('every invalid proof state is the same 401', () => {
    async function expectUnauthorized(response: Awaited<ReturnType<typeof fetch>>) {
      expect(response.status).toBe(401);
      expect(await response.text()).toBe(UNAUTHORIZED);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('retry-after')).toBeNull();
    }

    test('unknown, malformed, wrong, expired, used, replayed and stale challenges match', async () => {
      const h = await boot();
      const enrolled = enroll();
      const code = totpNow(enrolled.seed);

      await expectUnauthorized(
        await put(h, randomBytes(32).toString('base64url'), { code: totpNow(enrolled.seed) }),
      );
      await expectUnauthorized(await put(h, 'short', { code }));
      await expectUnauthorized(await put(h, 'a'.repeat(200), { code }));

      const wrong = await startChallenge(h);
      await expectUnauthorized(
        await put(h, wrong.id, { code: code === '000000' ? '000001' : '000000' }),
      );
      await expectUnauthorized(await put(h, wrong.id, { recoveryCode: 'f'.repeat(32) }));
      await expectUnauthorized(await put(h, wrong.id, { recoveryCode: 'not a recovery code' }));

      const used = await startChallenge(h);
      expect((await put(h, used.id, { code })).status).toBe(200);
      await expectUnauthorized(await put(h, used.id, { code }));

      const replayed = await startChallenge(h);
      await expectUnauthorized(await put(h, replayed.id, { code }));

      const stale = await startChallenge(h);
      totpStore.removeFactor({ subjectId: SUBJECT_ID, expectedFactorVersion: 1 });
      await expectUnauthorized(await put(h, stale.id, { code: totpNow(enrolled.seed, 30_000) }));
    });

    test('a challenge outlives neither its five minutes nor a replaced factor', async () => {
      const h = await boot();
      const enrolled = enroll();
      const expiring = await startChallenge(h);
      const replaced = await startChallenge(h);
      const replacement = enroll();

      await expectUnauthorized(await put(h, replaced.id, { code: totpNow(replacement.seed) }));

      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + LOGIN_CHALLENGE_TTL_MS + 1000 });
      await expectUnauthorized(await put(h, expiring.id, { code: totpNow(enrolled.seed) }));
      vi.useRealTimers();
    });

    test('a challenge still works just before it expires', async () => {
      const h = await boot();
      const enrolled = enroll();
      const challenge = await startChallenge(h);

      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + LOGIN_CHALLENGE_TTL_MS - 1000 });
      const response = await put(h, challenge.id, { code: totpNow(enrolled.seed) });
      vi.useRealTimers();

      expect(response.status).toBe(200);
    });

    test('five wrong proofs destroy the challenge, so a correct code afterwards fails too', async () => {
      const h = await boot();
      const enrolled = enroll();
      const challenge = await startChallenge(h);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expectUnauthorized(await put(h, challenge.id, { code: '000000' }));
      }

      await expectUnauthorized(await put(h, challenge.id, { code: totpNow(enrolled.seed) }));
      expect(getLoginChallengeCountForTests()).toBe(0);
    });

    test('malformed bodies are 400 and cost the challenge nothing', async () => {
      const h = await boot();
      const enrolled = enroll();
      const challenge = await startChallenge(h);
      const code = totpNow(enrolled.seed);
      const bad: unknown[] = [
        {},
        [],
        { code, recoveryCode: enrolled.recoveryCodes[0] },
        { code: 123456 },
        { code, extra: true },
        { code, remember: 'yes' },
        { recoveryCode: ['x'] },
        { code: 'x'.repeat(65) },
      ];
      for (const body of bad) {
        const response = await put(h, challenge.id, body);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Invalid request body' });
      }

      expect((await put(h, challenge.id, { code })).status).toBe(200);
    });
  });

  describe('recovery-login revocation holds against an in-flight request', () => {
    test('a request that read the session before the revocation cannot write it back to life', async () => {
      const h = await boot();
      const enrolled = enroll();
      const earlier = await loginWithCode(h, enrolled);
      expect(await protectedStatus(h, earlier)).toBe(200);

      const arrived = inFlight.arm();
      const pending = fetch(url(h, '/slow-touch'), {
        headers: { ...HTTPS_HEADERS, Cookie: earlier },
      });
      await arrived;

      const challenge = await startChallenge(h);
      const recovered = await put(h, challenge.id, { recoveryCode: enrolled.recoveryCodes[0] });
      expect(recovered.status).toBe(200);
      expect(await protectedStatus(h, earlier)).toBe(401);

      inFlight.release();
      await pending;

      expect(await protectedStatus(h, earlier)).toBe(401);
      expect(
        storedUsers(h.db).filter((user) => user?.includes('"assurance":"recovery"')),
      ).toHaveLength(1);
      expect(storedUsers(h.db)).toHaveLength(1);
    });

    test('a recovery login closes the open streams of the sessions it revokes and no others', async () => {
      const closed: string[][] = [];
      registerSessionStreamCloser((revoked) => {
        closed.push([...revoked]);
        return 0;
      });
      const h = await boot();
      const enrolled = enroll();
      const earlier = await loginWithCode(h, enrolled);
      const earlierSid = decodeURIComponent(earlier.split('=')[1]).slice(2).split('.')[0];

      const challenge = await startChallenge(h);
      await put(h, challenge.id, { recoveryCode: enrolled.recoveryCodes[0] });

      // Every id it closed streams for is a session that no longer exists.
      const live = h.db
        .prepare('SELECT sid FROM sessions')
        .all()
        .map((row) => String(row.sid));
      expect(live).toHaveLength(1);
      expect(closed.flat()).toContain(earlierSid);
      expect(closed.flat().filter((sid) => live.includes(sid))).toEqual([]);
    });

    test('a recovery login that cannot record the revocation mints no session', async () => {
      const h = await boot();
      const enrolled = enroll();
      const earlier = await loginWithCode(h, enrolled);
      h.db.exec(
        `CREATE TRIGGER refuse_marker BEFORE UPDATE OF sessions_not_before ON totp_subject_versions
         BEGIN SELECT RAISE(ABORT, 'store down'); END;`,
      );

      const challenge = await startChallenge(h);
      const refused = await put(h, challenge.id, { recoveryCode: enrolled.recoveryCodes[0] });
      expect(refused.status).toBe(503);
      expect(refused.headers.get('set-cookie')).toBeNull();
      expect(storedUsers(h.db)).toHaveLength(1);
      expect(await protectedStatus(h, earlier)).toBe(200);
      expect(
        auditEvents.filter((e) => (e as { action: string }).action === 'totp-recovery-used'),
      ).toEqual([]);

      // The refused login did not burn the code: it works once the store is back.
      h.db.exec('DROP TRIGGER refuse_marker');
      const retry = await startChallenge(h);
      const recovered = await put(h, retry.id, { recoveryCode: enrolled.recoveryCodes[0] });
      expect(recovered.status).toBe(200);
    });

    test('a recovery login whose session cannot be established does not spend the code', async () => {
      const h = await boot();
      const enrolled = enroll();
      const challenge = await startChallenge(h);
      const destroy = vi.spyOn(h.store, 'destroy').mockImplementationOnce((_sid, done) => {
        done?.(new Error('session store down'));
      });

      const failed = await put(h, challenge.id, { recoveryCode: enrolled.recoveryCodes[2] });
      expect(failed.status).toBe(500);
      expect(storedUsers(h.db).filter(Boolean)).toHaveLength(0);
      expect(
        auditEvents.filter((e) => (e as { action: string }).action === 'totp-recovery-used'),
      ).toEqual([]);
      destroy.mockRestore();

      const retry = await startChallenge(h);
      const recovered = await put(h, retry.id, { recoveryCode: enrolled.recoveryCodes[2] });
      expect(recovered.status).toBe(200);
      expect(
        auditEvents.filter((e) => (e as { action: string }).action === 'totp-recovery-used'),
      ).toHaveLength(1);
    });

    test('a code login whose session cannot be established fails with 500 and mints nothing', async () => {
      const h = await boot();
      const enrolled = enroll();
      const challenge = await startChallenge(h);
      const destroy = vi.spyOn(h.store, 'destroy').mockImplementationOnce((_sid, done) => {
        done?.(new Error('session store down'));
      });
      const failed = await put(h, challenge.id, { code: totpNow(enrolled.seed) });
      expect(failed.status).toBe(500);
      expect(storedUsers(h.db).filter(Boolean)).toHaveLength(0);
      destroy.mockRestore();
    });

    test('the marker alone refuses an older session even when its row is planted back', async () => {
      const h = await boot();
      const enrolled = enroll();
      const earlier = await loginWithCode(h, enrolled);
      const challenge = await startChallenge(h);
      const recovered = await put(h, challenge.id, { recoveryCode: enrolled.recoveryCodes[0] });
      const fresh = cookieOf(recovered);

      const row = h.db.prepare('SELECT sid, data FROM sessions').all();
      expect(row).toHaveLength(1);
      const sid = decodeURIComponent(earlier.split('=')[1]).slice(2).split('.')[0];
      const data = JSON.parse(String(row[0].data));
      const oldSession = { ...data, passport: { user: oldSessionUser(data.passport.user) } };
      h.db
        .prepare('INSERT INTO sessions (sid, expires_at, data) VALUES (?, ?, ?)')
        .run(sid, Date.now() + 60_000, JSON.stringify(oldSession));

      expect(await protectedStatus(h, earlier)).toBe(401);
      expect(await protectedStatus(h, fresh)).toBe(200);
    });
  });

  describe('failures share one budget with password failures', () => {
    test('password and factor failures together lock the account with Retry-After, and success forgives', async () => {
      const h = await boot();
      const enrolled = enroll();
      const original = testable_accountLockoutPolicy.maxAttempts;
      testable_accountLockoutPolicy.maxAttempts = 4;
      try {
        await post(h, { Authorization: basicHeader(TEST_USER, 'nope') });
        await post(h, { Authorization: basicHeader(TEST_USER, 'nope') });
        const challenge = await startChallenge(h);
        expect((await put(h, challenge.id, { code: '000000' })).status).toBe(401);
        const locking = await put(h, challenge.id, { code: '000000' });
        expect(locking.status).toBe(423);
        expect(Number(locking.headers.get('retry-after'))).toBeGreaterThan(0);

        const blockedPassword = await post(h, { Authorization: BASIC_AUTH_HEADER });
        expect(blockedPassword.status).toBe(423);
        const blockedProof = await put(h, challenge.id, { code: totpNow(enrolled.seed) });
        expect(blockedProof.status).toBe(423);
        expect(storedUsers(h.db)).toEqual([]);
      } finally {
        testable_accountLockoutPolicy.maxAttempts = original;
      }
    });

    test('a half-login does not reset the failure counter, but a finished one does', async () => {
      const h = await boot();
      const enrolled = enroll();
      const original = testable_accountLockoutPolicy.maxAttempts;
      testable_accountLockoutPolicy.maxAttempts = 3;
      try {
        await post(h, { Authorization: basicHeader(TEST_USER, 'nope') });
        await post(h, { Authorization: basicHeader(TEST_USER, 'nope') });
        const challenge = await startChallenge(h);
        // Two failures on the books: one wrong code reaches the limit.
        expect((await put(h, challenge.id, { code: '000000' })).status).toBe(423);

        resetLoginLockoutStateForTests();
        await post(h, { Authorization: basicHeader(TEST_USER, 'nope') });
        await post(h, { Authorization: basicHeader(TEST_USER, 'nope') });
        const finished = await startChallenge(h);
        expect((await put(h, finished.id, { code: totpNow(enrolled.seed) })).status).toBe(200);

        // Forgiven: two more wrong passwords are tolerated again.
        expect((await post(h, { Authorization: basicHeader(TEST_USER, 'nope') })).status).toBe(401);
        expect((await post(h, { Authorization: basicHeader(TEST_USER, 'nope') })).status).toBe(401);
      } finally {
        testable_accountLockoutPolicy.maxAttempts = original;
      }
    });
  });

  describe('DELETE cancels a challenge', () => {
    test('a cross-origin cancel carrying a session cookie is refused and cancels nothing', async () => {
      const h = await boot();
      const enrolled = enroll();
      const challenge = await startChallenge(h);

      const refused = await fetch(url(h, `/auth/login-challenges/${challenge.id}`), {
        method: 'DELETE',
        headers: {
          ...HTTPS_HEADERS,
          Cookie: 'dd.sid.test=anything',
          Origin: 'https://evil.example',
        },
      });

      expect(refused.status).toBe(403);
      expect((await put(h, challenge.id, { code: totpNow(enrolled.seed) })).status).toBe(200);
    });

    test('is idempotent 204, and the cancelled challenge accepts nothing', async () => {
      const h = await boot();
      const enrolled = enroll();
      const challenge = await startChallenge(h);
      const del = () =>
        fetch(url(h, `/auth/login-challenges/${challenge.id}`), {
          method: 'DELETE',
          headers: HTTPS_HEADERS,
        });

      expect((await del()).status).toBe(204);
      expect((await del()).status).toBe(204);
      expect((await put(h, challenge.id, { code: totpNow(enrolled.seed) })).status).toBe(401);
      const unknown = await fetch(url(h, '/auth/login-challenges/nope'), {
        method: 'DELETE',
        headers: HTTPS_HEADERS,
      });
      expect(unknown.status).toBe(204);
    });
  });

  describe('the enrolled-subject Basic bypass is closed everywhere', () => {
    test('direct Basic on a protected route, SSE and the upgrade fails for an enrolled subject', async () => {
      const h = await boot();
      enroll();
      const header = { Authorization: BASIC_AUTH_HEADER };

      expect(await status(h, '/protected', header)).toBe(401);
      expect(await status(h, '/events', header)).toBe(401);
      await expect(upgradeOutcome(h, header)).resolves.toBe('refused');
      expect(storedUsers(h.db)).toEqual([]);
    });

    test('a wrong password and a right one are indistinguishable on those routes', async () => {
      const h = await boot();
      enroll();
      const right = await fetch(url(h, '/protected'), {
        headers: { ...HTTPS_HEADERS, Authorization: BASIC_AUTH_HEADER },
      });
      const wrong = await fetch(url(h, '/protected'), {
        headers: { ...HTTPS_HEADERS, Authorization: basicHeader(TEST_USER, 'nope') },
      });

      expect(right.status).toBe(wrong.status);
      expect(await right.text()).toBe(await wrong.text());
    });

    test('a Basic header riding along with a valid session cookie does not borrow the session’s standing', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginWithCode(h, enrolled);

      expect(await protectedStatus(h, cookie)).toBe(200);
      expect(await status(h, '/protected', { Authorization: BASIC_AUTH_HEADER })).toBe(401);
    });

    test('legacy, stale and password-assured cookies fail on HTTP, SSE and the upgrade', async () => {
      const h = await boot();
      const beforeEnrolment = cookieOf(await post(h, { Authorization: BASIC_AUTH_HEADER }));
      const legacy = await plant(h, JSON.stringify({ username: TEST_USER }));
      enroll();
      const passwordAssured = await plant(
        h,
        JSON.stringify({
          v: 2,
          kind: 'local',
          username: TEST_USER,
          subjectId: SUBJECT_ID,
          providerId: 'basic.default',
          assurance: 'password',
          factorVersion: 1,
        }),
      );

      for (const cookie of [beforeEnrolment, legacy, passwordAssured]) {
        expect(await protectedStatus(h, cookie)).toBe(401);
        expect(await status(h, '/events', { Cookie: cookie })).toBe(401);
        await expect(upgradeOutcome(h, { Cookie: cookie })).resolves.toBe('refused');
      }
    });

    test('a challenge id is not accepted as a credential in a query string, header or cookie', async () => {
      const h = await boot();
      enroll();
      const challenge = await startChallenge(h);

      expect(await status(h, `/protected?challenge=${challenge.id}`, {})).toBe(401);
      expect(await status(h, '/protected', { Authorization: `Bearer ${challenge.id}` })).toBe(401);
      expect(await status(h, '/protected', { Cookie: `challenge=${challenge.id}` })).toBe(401);
      await expect(upgradeOutcome(h, { 'Sec-WebSocket-Protocol': challenge.id })).resolves.toBe(
        'refused',
      );
    });

    test('another subject, and an unenrolled one on the same username, stay on password access', async () => {
      const h = await boot();
      enroll(deriveSubjectId('basic.other', TEST_USER));

      expect(await status(h, '/protected', { Authorization: BASIC_AUTH_HEADER })).toBe(200);
    });

    test('a factor that was removed releases the subject back to password access at a new version', async () => {
      const h = await boot();
      enroll();
      totpStore.removeFactor({ subjectId: SUBJECT_ID, expectedFactorVersion: 1 });

      const response = await post(h, { Authorization: BASIC_AUTH_HEADER });
      expect(response.status).toBe(200);
      expect(storedUsers(h.db)[0]).toContain('"factorVersion":2');
    });
  });

  describe('no secret, code or seed leaves the process through logs, audit or responses', () => {
    test('a full enrolled login with TOTP, recovery, failures and a fault touches none of them', async () => {
      const h = await boot();
      const enrolled = enroll();
      const seenResponses: string[] = [];
      const record = async (response: Awaited<ReturnType<typeof fetch>>) => {
        seenResponses.push(JSON.stringify([...response.headers.entries()]), await response.text());
        return response;
      };

      const challenge = await (async () => {
        const response = await post(h, { Authorization: BASIC_AUTH_HEADER });
        const text = await response.text();
        seenResponses.push(JSON.stringify([...response.headers.entries()]));
        return (JSON.parse(text) as ChallengeBody).challenge;
      })();
      const goodCode = totpNow(enrolled.seed);
      await record(await put(h, challenge.id, { code: '000000' }));
      await record(await put(h, challenge.id, { recoveryCode: enrolled.recoveryCodes[1] }));
      const second = await startChallenge(h);
      await record(await put(h, second.id, { code: goodCode }));
      delete ddEnvVars.DD_AUTH_TOTP_KEYRING;
      const third = await startChallenge(h);
      await record(await put(h, third.id, { code: totpNow(enrolled.seed, 30_000) }));

      const secrets = [
        enrolled.seed.toString('hex'),
        enrolled.seed.toString('base64'),
        enrolled.seed.toString('base64url'),
        goodCode,
        ...enrolled.recoveryCodes,
        ...enrolled.recoveryCodes.map((c) => c.replaceAll('-', '')),
        challenge.id,
        second.id,
        third.id,
        keyring.keys.get('k1')?.toString('base64') as string,
        TEST_PASSWORD,
      ];
      const logged = JSON.stringify([logLines, auditEvents]);
      for (const secret of secrets) {
        expect(logged).not.toContain(secret);
      }
      for (const secret of secrets.filter(
        (s) => s !== challenge.id && s !== second.id && s !== third.id,
      )) {
        expect(seenResponses.join('\n')).not.toContain(secret);
      }
    });
  });

  describe('a session cookie is not a credential for POST /auth/login', () => {
    test('a valid factor-assured cookie cannot mint a second session, so a copy cannot outlive the owner', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginWithCode(h, enrolled);
      expect(storedUsers(h.db)).toHaveLength(1);

      const attempt = await fetch(url(h, '/auth/login'), {
        method: 'POST',
        headers: { ...HTTPS_HEADERS, 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ remember: true }),
      });

      expect(attempt.status).toBe(401);
      expect(attempt.headers.get('set-cookie')).toBeNull();
      expect(storedUsers(h.db)).toHaveLength(1);
      expect(await protectedStatus(h, cookie)).toBe(200);
    });

    test('a legacy cookie on an unenrolled install is refused the same way', async () => {
      const h = await boot();
      const legacy = await plant(h, JSON.stringify({ username: TEST_USER }));
      expect(await protectedStatus(h, legacy)).toBe(200);

      const attempt = await fetch(url(h, '/auth/login'), {
        method: 'POST',
        headers: { ...HTTPS_HEADERS, 'Content-Type': 'application/json', Cookie: legacy },
        body: '{}',
      });

      expect(attempt.status).toBe(401);
      expect(attempt.headers.get('set-cookie')).toBeNull();
    });
  });
});
