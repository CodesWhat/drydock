/**
 * Integration test for TOTP slice 4 (spec 11.1.2): the factor-management API.
 *
 * Everything below the HTTP boundary is real: express + express-session on the
 * SQLite SessionStore, a migrated SQLite database for the TOTP store, the real
 * Basic providers with real argon2id hashes, the real authenticator chain, the
 * real login routes (`registerLoginRoutes`), the real `requireAuthentication`
 * and `requireSameOriginForMutations`, the real API key store, and the real
 * factor router mounted the way api.ts mounts it.
 *
 * The fixture app holds no route that writes a session from request input:
 * sessions come from the real login routes, from factor management itself, or
 * are planted through the session store the way a session from another release
 * would already sit there.
 */
import { argon2Sync, createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import express, { type Application, type Response as ExpressResponse, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';

const { auditEvents, logLines } = vi.hoisted(() => ({
  auditEvents: [] as Array<Record<string, unknown>>,
  logLines: [] as unknown[][],
}));

vi.mock('./audit-events.js', () => ({
  recordAuditEvent: (event: Record<string, unknown>) => {
    auditEvents.push(event);
  },
}));

vi.mock('../store/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../store/index.js')>();
  const os = await import('node:os');
  return {
    ...original,
    getConfiguration: () => ({ path: os.tmpdir(), file: 'drydock-totp-factor-test.json' }),
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
import * as registry from '../registry/index.js';
import * as apiKeyStore from '../store/api-key.js';
import * as sessionModel from '../store/session.js';
import * as totpStore from '../store/totp.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import { apiKeyAuthenticator } from './api-key-auth.js';
import { registerLoginRoutes, requireAuthentication } from './auth.js';
import { resetLoginLockoutStateForTests } from './auth-lockout.js';
import { configureSessionLimits } from './auth-session.js';
import type { AuthRequest } from './auth-types.js';
import { clearAuthenticators, registerAuthenticator } from './authenticator-chain.js';
import { requireSameOriginForMutations } from './csrf.js';
import { requireJsonContentTypeForMutations, shouldParseJsonBody } from './json-content-type.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';
import { restoreSessionPrincipal, sessionAuthenticator } from './session-principal.js';
import { SessionStore } from './session-store.js';
import { registerSessionStreamCloser } from './session-streams.js';
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
import * as totpFactorRouter from './totp-factor.js';
import { deriveSubjectId } from './totp-identity.js';

const TEST_USER = 'wud-card';
const TEST_PASSWORD = 'correct-horse-battery-staple';
const OTHER_PASSWORD = 'a-different-provider-password';
const PROVIDER = 'basic.default';
const OTHER_PROVIDER = 'basic.other';
const SESSION_SECRET = 'test-secret'; // gitleaks:allow — fixed throwaway signing secret for a test-only session store
const SUBJECT_ID = deriveSubjectId(PROVIDER, TEST_USER);
const OTHER_SUBJECT_ID = deriveSubjectId(OTHER_PROVIDER, TEST_USER);
const basicHeader = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

const keyringJson = JSON.stringify({ k1: Buffer.alloc(32, 1).toString('base64') });
const keyring = parseTotpKeyring(keyringJson, 'k1');
const ENROLLED_AT = new Date('2026-10-03T12:00:00.000Z');
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

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
const OTHER_HASH = createArgon2Hash(OTHER_PASSWORD);

function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of text) {
    value = (value << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

const closedStreams: string[][] = [];
registerSessionStreamCloser((sids) => {
  closedStreams.push([...sids]);
  return sids.size;
});

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

interface Enrolled {
  seed: Buffer;
  recoveryCodes: string[];
  factorId: string;
}

let serial = 0;

/** Enroll through the store, the way an earlier release of this slice would have. */
function enroll(
  subjectId = SUBJECT_ID,
  providerId = PROVIDER,
  { recoveryCount = 10 } = {},
): Enrolled {
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
      providerId,
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
      providerId,
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
  apiKeyStore.createCollections(db);
  const store = new SessionStore({ ttlMs: 3_600_000 });

  const basic = new Basic();
  await basic.register('authentication', 'basic', 'default', { user: TEST_USER, hash: HASH });
  const other = new Basic();
  await other.register('authentication', 'basic', 'other', { user: TEST_USER, hash: OTHER_HASH });
  (registry.getState() as { authentication: Record<string, unknown> }).authentication = {
    [PROVIDER]: basic,
    [OTHER_PROVIDER]: other,
  };
  clearAuthenticators();
  registerAuthenticator(apiKeyAuthenticator);
  registerAuthenticator(basic.getAuthenticator());
  registerAuthenticator(other.getAuthenticator());
  registerAuthenticator(sessionAuthenticator);

  const sessionMiddleware = session({
    name: 'dd.sid.test',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store,
    cookie: { httpOnly: true, secure: 'auto' },
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

  // The API router, in the order api.ts builds it: the JSON gate and parser,
  // then the authentication guard, then CSRF, then the mounted router.
  const api = express.Router();
  const parser = express.json({ limit: '256kb' });
  api.use(requireJsonContentTypeForMutations);
  api.use((req, res, next) => (shouldParseJsonBody(req.method) ? parser(req, res, next) : next()));
  api.use(requireAuthentication);
  api.use(requireSameOriginForMutations);
  api.use('/auth', totpFactorRouter.init());
  api.get('/protected', (req: Request, res: ExpressResponse) => {
    res.status(200).json({ user: { username: (req as AuthRequest).principal?.username } });
  });
  app.use('/api/v1', api);

  const server = http.createServer(app);
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
  return { db, store, server, port };
}

const url = (h: Harness, path: string) => `http://127.0.0.1:${h.port}${path}`;
const originOf = (h: Harness) => `https://127.0.0.1:${h.port}`;
const cookieOf = (response: Awaited<ReturnType<typeof fetch>>) =>
  (response.headers.get('set-cookie') as string).split(';')[0];

async function loginPassword(h: Harness, user = TEST_USER, password = TEST_PASSWORD) {
  const response = await fetch(url(h, '/auth/login'), {
    method: 'POST',
    headers: {
      'X-Forwarded-Proto': 'https',
      'Content-Type': 'application/json',
      Authorization: basicHeader(user, password),
    },
    body: '{}',
  });
  return response;
}

async function sessionCookie(h: Harness, user = TEST_USER, password = TEST_PASSWORD) {
  const response = await loginPassword(h, user, password);
  expect(response.status).toBe(200);
  return cookieOf(response);
}

interface CallOptions {
  cookie?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  https?: boolean;
  sameOrigin?: boolean;
}

function call(h: Harness, method: string, path: string, options: CallOptions = {}) {
  const { cookie, body, rawBody, headers = {}, https = true, sameOrigin = true } = options;
  const mutating = method !== 'GET';
  return fetch(url(h, `/api/v1/auth${path}`), {
    method,
    headers: {
      ...(https ? { 'X-Forwarded-Proto': 'https' } : {}),
      ...(mutating && sameOrigin
        ? { Origin: https ? originOf(h) : `http://127.0.0.1:${h.port}` }
        : {}),
      ...(mutating ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(rawBody !== undefined
      ? { body: rawBody }
      : body !== undefined && mutating
        ? { body: JSON.stringify(body) }
        : {}),
  });
}

const code = (seed: Buffer, offsetSteps = 0) =>
  generateTotp(seed, Date.now() + offsetSteps * 30_000);

/** A code no window near now accepts, so a "wrong code" is never right by accident. */
function wrongCode(seed: Buffer): string {
  const accepted = new Set([-2, -1, 0, 1, 2].map((offset) => code(seed, offset)));
  return ['000000', '111111', '222222', '333333', '444444', '555555'].find(
    (candidate) => !accepted.has(candidate),
  ) as string;
}

interface PasswordVerifier {
  verifyPasswordForUser(username: string, password: string): Promise<boolean>;
}

const providerOf = (providerId: string) =>
  (registry.getState() as unknown as { authentication: Record<string, PasswordVerifier> })
    .authentication[providerId];

/** Released after every test, so a failed assertion never leaves a request hanging. */
const heldPasswordChecks: Array<() => void> = [];

/**
 * Hold the provider's next password check open until released, the way a slow
 * hash does, so a test can act while a re-authentication is in flight.
 */
function holdNextPasswordCheck(providerId = PROVIDER) {
  const provider = providerOf(providerId);
  const verify = provider.verifyPasswordForUser.bind(provider);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    reached = resolve;
  });
  heldPasswordChecks.push(release);
  const spy = vi
    .spyOn(provider, 'verifyPasswordForUser')
    .mockImplementationOnce(async (username, password) => {
      reached();
      await gate;
      return verify(username, password);
    });
  return { arrived, release, spy };
}

interface EnrollmentReveal {
  id: string;
  secret: string;
  otpauthUri: string;
  expiresAt: string;
  replacesFactor: boolean;
}

async function startEnrollment(h: Harness, cookie: string, extra: Record<string, unknown> = {}) {
  const response = await call(h, 'POST', '/totp-enrollments', {
    cookie,
    body: { password: TEST_PASSWORD, ...extra },
  });
  return response;
}

async function revealEnrollment(h: Harness, cookie: string, extra: Record<string, unknown> = {}) {
  const response = await startEnrollment(h, cookie, extra);
  expect(response.status).toBe(201);
  return (await response.json()) as EnrollmentReveal;
}

interface Activated {
  status: string;
  activatedAt: string;
  recoveryCodesRemaining: number;
  recoveryCodes: string[];
}

/** Enroll through the API from a password session; returns what the person sees once. */
async function enrollThroughApi(h: Harness, cookie: string, offsetSteps = 0) {
  const reveal = await revealEnrollment(h, cookie);
  const seed = base32Decode(reveal.secret);
  const response = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
    cookie,
    body: { code: code(seed, offsetSteps) },
  });
  expect(response.status).toBe(201);
  const activated = (await response.json()) as Activated;
  return { reveal, seed, activated, cookie: cookieOf(response) };
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

const sidOf = (cookie: string) => decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0];

/** The stored user of a v2 session of the test subject, minted a moment ago. */
const localSessionUser = (assurance: 'password' | 'totp', factorVersion: number) =>
  JSON.stringify({
    v: 2,
    kind: 'local',
    username: TEST_USER,
    subjectId: SUBJECT_ID,
    providerId: PROVIDER,
    assurance,
    factorVersion,
    issuedAt: Date.now() - 1_000,
  });

async function protectedStatus(h: Harness, cookie: string) {
  const response = await fetch(url(h, '/api/v1/protected'), {
    headers: { 'X-Forwarded-Proto': 'https', Cookie: cookie },
  });
  return response.status;
}

async function factorStatus(h: Harness, cookie: string) {
  const response = await call(h, 'GET', '/totp-factor', { cookie });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function mintKey(scopes: string[]): string {
  return apiKeyStore.createApiKey({
    name: 'integration',
    scopes,
    createdBy: { kind: 'user', username: 'scott' },
  }).apiKey;
}

/** Every value in every table, as text: where a plaintext secret would show. */
function dumpDatabase(db: Database): string {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => String(row.name));
  return tables
    .map((name) => JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all()))
    .join('\n');
}

const managementAudit = () =>
  auditEvents.filter((event) => String(event.action).startsWith('totp-'));
function expectContract(
  path: string,
  method: 'get' | 'post' | 'put' | 'delete',
  statusCode: string,
  payload: unknown,
): void {
  const result = validateOpenApiJsonResponse({ path, method, statusCode, payload });
  expect(result.errors).toStrictEqual([]);
  expect(result.valid).toBe(true);
}

const auditActions = () => managementAudit().map((event) => event.action);
const recoveryUsedAudit = () =>
  auditEvents.filter((event) => event.action === 'totp-recovery-used');

describe('TOTP slice 4: factor-management API', () => {
  const harnesses: Harness[] = [];

  async function boot(): Promise<Harness> {
    const h = await start();
    harnesses.push(h);
    return h;
  }

  beforeEach(() => {
    auditEvents.length = 0;
    logLines.length = 0;
    closedStreams.length = 0;
    ddEnvVars.DD_AUTH_TOTP_KEYRING = keyringJson;
    ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID = 'k1';
    configureSessionLimits({});
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const release of heldPasswordChecks.splice(0)) {
      release();
    }
    vi.restoreAllMocks();
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

  describe('status', () => {
    test('an unenrolled subject reads as unenrolled with nothing to show', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const response = await call(h, 'GET', '/totp-factor', { cookie });

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await response.json();
      expect(body).toEqual({ status: 'unenrolled', recoveryCodesRemaining: 0 });
      expectContract('/api/v1/auth/totp-factor', 'get', '200', body);
    });

    test('an active factor reports when it was activated and how many codes are left, and nothing secret', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const done = await enrollThroughApi(h, cookie);
      const { body } = await factorStatus(h, done.cookie);

      expect(Object.keys(body).sort()).toEqual(['activatedAt', 'recoveryCodesRemaining', 'status']);
      expect(body.status).toBe('active');
      expect(body.recoveryCodesRemaining).toBe(10);
      expect(Number.isNaN(Date.parse(body.activatedAt as string))).toBe(false);
    });

    test('a pending enrollment is reported by id and expiry only, never its secret', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const reveal = await revealEnrollment(h, cookie);
      const { body } = await factorStatus(h, cookie);

      expect(body.status).toBe('unenrolled');
      expect(body.pendingEnrollment).toEqual({
        id: reveal.id,
        expiresAt: reveal.expiresAt,
        replacesFactor: false,
      });
      expect(JSON.stringify(body)).not.toContain(reveal.secret);
    });

    test('over plain HTTP it still answers, because reading changes nothing', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const response = await call(h, 'GET', '/totp-factor', {
        cookie,
        https: false,
        headers: { 'X-Forwarded-For': '203.0.113.9' },
      });
      expect(response.status).toBe(200);
    });
  });

  describe('who may call it', () => {
    test('with no session every route is a 401', async () => {
      const h = await boot();
      for (const [method, path] of [
        ['GET', '/totp-factor'],
        ['POST', '/totp-enrollments'],
        ['PUT', '/totp-enrollments/abc'],
        ['DELETE', '/totp-enrollments/abc'],
        ['DELETE', '/totp-factor'],
        ['POST', '/totp-recovery-code-sets'],
      ] as const) {
        const response = await call(h, method, path, { body: {} });
        expect(response.status, `${method} ${path}`).toBe(401);
      }
    });

    test.each([['read'], ['admin'], ['api-keys:manage']])(
      'an API key holding %s gets 403 on every route and changes nothing',
      async (scope) => {
        const h = await boot();
        const key = mintKey([scope]);
        for (const [method, path] of [
          ['GET', '/totp-factor'],
          ['POST', '/totp-enrollments'],
          ['PUT', '/totp-enrollments/abc'],
          ['DELETE', '/totp-enrollments/abc'],
          ['DELETE', '/totp-factor'],
          ['POST', '/totp-recovery-code-sets'],
        ] as const) {
          const response = await call(h, method, path, {
            headers: { Authorization: `Bearer ${key}` },
            body: { password: TEST_PASSWORD },
          });
          expect(response.status, `${method} ${path}`).toBe(403);
          expect(await response.json()).toEqual({
            error: 'This route is not reachable with an API key',
          });
        }
        expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
      },
    );

    test('Basic header auth is refused even with the right password, and a cookie riding along does not rescue it', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      for (const withCookie of [false, true]) {
        const response = await call(h, 'POST', '/totp-enrollments', {
          ...(withCookie ? { cookie } : {}),
          headers: { Authorization: basicHeader(TEST_USER, TEST_PASSWORD) },
          body: { password: TEST_PASSWORD },
          sameOrigin: true,
        });
        expect(response.status).toBe(403);
      }
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
    });

    test('an OIDC session is refused with a plain explanation', async () => {
      const h = await boot();
      const cookie = await plant(
        h,
        JSON.stringify({ v: 2, kind: 'oidc', username: 'a@example.com' }),
      );
      for (const [method, path] of [
        ['GET', '/totp-factor'],
        ['POST', '/totp-enrollments'],
      ] as const) {
        const response = await call(h, method, path, { cookie, body: { password: 'x' } });
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
          error: 'Two-factor authentication is only available for local accounts',
        });
      }
    });

    test('a session from before two-factor support is told to sign in again', async () => {
      const h = await boot();
      const cookie = await plant(h, JSON.stringify({ username: TEST_USER }));
      const response = await call(h, 'GET', '/totp-factor', { cookie });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'This session predates two-factor support. Sign out and sign in again.',
      });
    });

    test('anonymous access is refused', async () => {
      const h = await boot();
      clearAuthenticators();
      registerAuthenticator({
        id: 'anonymous',
        persistsSession: false,
        authenticate: () => Promise.resolve({ kind: 'anonymous', username: 'anonymous' }),
      });
      const response = await call(h, 'GET', '/totp-factor');
      expect(response.status).toBe(403);
    });
  });

  describe('CSRF, JSON and HTTPS gates', () => {
    test('a cross-origin or origin-less mutation is refused before anything is read', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const crossOrigin = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        headers: { Origin: 'https://evil.example' },
        body: { password: TEST_PASSWORD },
      });
      expect(crossOrigin.status).toBe(403);
      expect(await crossOrigin.json()).toEqual({ error: 'CSRF validation failed' });

      const noOrigin = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        sameOrigin: false,
        body: { password: TEST_PASSWORD },
      });
      expect(noOrigin.status).toBe(403);

      const crossSite = await call(h, 'DELETE', '/totp-factor', {
        cookie,
        headers: { 'Sec-Fetch-Site': 'cross-site' },
        body: { password: TEST_PASSWORD },
      });
      expect(crossSite.status).toBe(403);
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
    });

    test('a JSON body is required on mutations', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const response = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        headers: { 'Content-Type': 'text/plain' },
        rawBody: JSON.stringify({ password: TEST_PASSWORD }),
      });
      expect(response.status).toBe(415);

      const deleteResponse = await call(h, 'DELETE', '/totp-factor', {
        cookie,
        headers: { 'Content-Type': 'text/plain' },
        rawBody: JSON.stringify({ password: TEST_PASSWORD }),
      });
      expect(deleteResponse.status).toBe(415);
    });

    test('plain HTTP from a non-loopback client is refused for every mutation, and a loopback client may use it', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const remote = { 'X-Forwarded-For': '203.0.113.9' };
      for (const [method, path] of [
        ['POST', '/totp-enrollments'],
        ['PUT', '/totp-enrollments/abc'],
        ['DELETE', '/totp-enrollments/abc'],
        ['DELETE', '/totp-factor'],
        ['POST', '/totp-recovery-code-sets'],
      ] as const) {
        const response = await call(h, method, path, {
          cookie,
          https: false,
          headers: remote,
          body: { password: TEST_PASSWORD },
        });
        expect(response.status, `${method} ${path}`).toBe(403);
        expect(await response.json()).toEqual({
          error: 'Two-factor management requires HTTPS',
          details: { reason: 'https-required' },
        });
      }
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });

      const loopback = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        https: false,
        body: { password: TEST_PASSWORD },
      });
      expect(loopback.status).toBe(201);
    });

    test.each([
      ['X-Forwarded-Host', 'drydock.example.com'],
      ['Forwarded', 'for=203.0.113.9'],
      ['X-Real-IP', '203.0.113.9'],
      ['X-Forwarded-Proto', 'http'],
    ])(
      'a proxy header (%s) on a loopback connection means it is not a local client',
      async (name, value) => {
        const h = await boot();
        const cookie = await sessionCookie(h);
        const response = await call(h, 'POST', '/totp-enrollments', {
          cookie,
          https: false,
          headers: { [name]: value },
          body: { password: TEST_PASSWORD },
        });
        expect(response.status).toBe(403);
      },
    );

    test('a loopback socket reached under a public Host name is not local either', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const status = await new Promise<number>((resolve, reject) => {
        const request = http.request(
          {
            host: '127.0.0.1',
            port: h.port,
            method: 'POST',
            path: '/api/v1/auth/totp-enrollments',
            headers: {
              Host: 'drydock.example.com',
              Origin: 'http://drydock.example.com',
              Cookie: cookie,
              'Content-Type': 'application/json',
            },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode as number);
          },
        );
        request.on('error', reject);
        request.end(JSON.stringify({ password: TEST_PASSWORD }));
      });
      expect(status).toBe(403);
    });

    test.each([['localhost'], ['[::1]'], ['127.0.0.1']])(
      'a loopback client reached as %s may use plain HTTP',
      async (host) => {
        const h = await boot();
        const cookie = await sessionCookie(h);
        const status = await new Promise<number>((resolve, reject) => {
          const request = http.request(
            {
              host: '127.0.0.1',
              port: h.port,
              method: 'POST',
              path: '/api/v1/auth/totp-enrollments',
              headers: {
                Host: `${host}:${h.port}`,
                Origin: `http://${host}:${h.port}`,
                Cookie: cookie,
                'Content-Type': 'application/json',
              },
            },
            (response) => {
              response.resume();
              resolve(response.statusCode as number);
            },
          );
          request.on('error', reject);
          request.end(JSON.stringify({ password: TEST_PASSWORD }));
        });
        expect(status).toBe(201);
      },
    );
  });

  describe('re-authentication is per request, with the password', () => {
    test('a valid session without the password cannot start an enrollment, and one accepted password does not carry to the next call', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);

      const missing = await call(h, 'POST', '/totp-enrollments', { cookie, body: {} });
      expect(missing.status).toBe(400);

      const first = await startEnrollment(h, cookie);
      expect(first.status).toBe(201);
      await call(
        h,
        'DELETE',
        `/totp-enrollments/${((await first.json()) as EnrollmentReveal).id}`,
        {
          cookie,
        },
      );

      const again = await call(h, 'POST', '/totp-enrollments', { cookie, body: {} });
      expect(again.status).toBe(400);
    });

    test('a wrong password is 403, not a logout, and draws on the shared lockout budget until 423', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);

      const statuses: number[] = [];
      let lastResponse: Awaited<ReturnType<typeof call>> | undefined;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        lastResponse = await call(h, 'POST', '/totp-enrollments', {
          cookie,
          body: { password: 'nope' },
        });
        statuses.push(lastResponse.status);
      }

      expect(statuses.slice(0, 4)).toEqual([403, 403, 403, 403]);
      expect(statuses[4]).toBe(423);
      expect(Number(lastResponse?.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });

      // Still locked, even for the right password.
      const locked = await startEnrollment(h, cookie);
      expect(locked.status).toBe(423);
    });

    test('a parallel burst of wrong passwords is hashed one at a time and cannot outrun the lockout budget', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const verify = vi.spyOn(providerOf(PROVIDER), 'verifyPasswordForUser');
      const wrong = () =>
        call(h, 'POST', '/totp-enrollments', { cookie, body: { password: 'nope' } });

      const statuses = (await Promise.all(Array.from({ length: 20 }, wrong))).map(
        (response) => response.status,
      );
      expect(verify.mock.calls.length).toBeLessThanOrEqual(5);
      for (let attempt = 0; attempt < 5 && !statuses.includes(423); attempt += 1) {
        statuses.push((await wrong()).status);
      }

      // However the attempts were sent, exactly the budget was ever hashed.
      expect(verify).toHaveBeenCalledTimes(5);
      expect(statuses.filter((status) => status === 403)).toHaveLength(4);
      expect(statuses.every((status) => [403, 423, 429].includes(status))).toBe(true);

      // The right password, sent last, meets the lock rather than a hash.
      const right = await startEnrollment(h, cookie);
      expect(right.status).toBe(423);
      expect(verify).toHaveBeenCalledTimes(5);
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
    });

    test('a parallel burst of wrong second-factor codes cannot outrun the factor budget', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      const wrong = () =>
        call(h, 'POST', '/totp-enrollments', {
          cookie,
          body: { password: TEST_PASSWORD, code: wrongCode(enrolled.seed) },
        });

      const statuses = (await Promise.all(Array.from({ length: 20 }, wrong))).map(
        (response) => response.status,
      );
      expect(totpStore.getFactorFailureState(SUBJECT_ID).failures).toBeLessThanOrEqual(5);
      for (let attempt = 0; attempt < 5 && !statuses.includes(423); attempt += 1) {
        statuses.push((await wrong()).status);
      }

      expect(totpStore.getFactorFailureState(SUBJECT_ID).failures).toBe(5);
      expect(statuses.every((status) => [403, 423, 429].includes(status))).toBe(true);

      // The right code, sent last, is not looked at.
      const right = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        body: { password: TEST_PASSWORD, code: code(enrolled.seed, 1) },
      });
      expect(right.status).toBe(423);
      expect(totpStore.getFactorFailureState(SUBJECT_ID).failures).toBe(5);
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
    });

    test('a subject re-authenticates one call at a time: a second is a 429 that costs no budget, and another subject is not held up', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const second = await sessionCookie(h);
      const elsewhere = await sessionCookie(h, TEST_USER, OTHER_PASSWORD);
      const held = holdNextPasswordCheck();

      const first = startEnrollment(h, cookie);
      await held.arrived;

      const refused = await call(h, 'POST', '/totp-enrollments', {
        cookie: second,
        body: { password: 'nope' },
      });
      expect(refused.status).toBe(429);
      expect(refused.headers.get('retry-after')).toBe('1');
      const body = await refused.json();
      expect(body).toEqual({ error: 'Too many concurrent reauthentication attempts' });
      expectContract('/api/v1/auth/totp-enrollments', 'post', '429', body);
      expect(held.spy).toHaveBeenCalledTimes(1);

      const other = await call(h, 'POST', '/totp-enrollments', {
        cookie: elsewhere,
        body: { password: OTHER_PASSWORD },
      });
      expect(other.status).toBe(201);

      held.release();
      expect((await first).status).toBe(201);

      // The slot is free again: this call gets as far as the pending enrollment.
      const after = await startEnrollment(h, second);
      expect(after.status).toBe(409);
    });

    test('a password check that throws gives the slot back', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      vi.spyOn(providerOf(PROVIDER), 'verifyPasswordForUser').mockRejectedValueOnce(
        new Error('hash failed'),
      );

      expect((await startEnrollment(h, cookie)).status).toBe(503);
      expect((await startEnrollment(h, cookie)).status).toBe(201);
    });

    test('an account locked while the password was being checked is refused even when the password is right', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const held = holdNextPasswordCheck();

      const pending = startEnrollment(h, cookie);
      await held.arrived;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await loginPassword(h, TEST_USER, 'nope');
      }
      held.release();

      const response = await pending;
      expect(response.status).toBe(423);
      expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
    });

    test('a second factor locked while the password was being checked is refused before the proof is looked at', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      const proof = code(enrolled.seed, 1);
      const prove = () =>
        call(h, 'POST', '/totp-enrollments', {
          cookie,
          body: { password: TEST_PASSWORD, code: proof },
        });
      const held = holdNextPasswordCheck();

      const pending = prove();
      await held.arrived;
      totpStore.recordFactorFailure({
        subjectId: SUBJECT_ID,
        username: TEST_USER,
        now: Date.now(),
        threshold: 1,
        baseLockMs: 60_000,
        maxLockMs: 60_000,
      });
      held.release();
      expect((await pending).status).toBe(423);

      // The code was never spent: with the lock lifted it still proves the call.
      totpStore.clearFactorFailures(SUBJECT_ID);
      expect((await prove()).status).toBe(201);
    });

    test('the wrong password answer says nothing about which part failed', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const response = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        body: { password: 'nope' },
      });
      const body = await response.json();
      expect(body).toEqual({ error: 'Reauthentication failed' });
      expectContract('/api/v1/auth/totp-enrollments', 'post', '403', body);
    });

    test.each([
      ['no body keys', {}],
      ['a non-string password', { password: 12345 }],
      ['an unknown key', { password: TEST_PASSWORD, extra: true }],
      ['an over-long password', { password: 'x'.repeat(2000) }],
      ['a code with no factor active', { password: TEST_PASSWORD, code: '123456' }],
      ['a numeric code', { password: TEST_PASSWORD, code: 123456 }],
      ['an over-long recovery code', { password: TEST_PASSWORD, recoveryCode: 'f'.repeat(65) }],
    ])('rejects %s as a 400 and changes nothing', async (_name, body) => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const response = await call(h, 'POST', '/totp-enrollments', { cookie, body });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid request body' });
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
    });

    test.each([
      ['an array', '[]'],
      ['null', 'null'],
      ['a string', '"password"'],
    ])('rejects %s as the body', async (_name, rawBody) => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const reveal = await revealEnrollment(h, cookie);
      for (const [method, path] of [
        ['POST', '/totp-enrollments'],
        ['PUT', `/totp-enrollments/${reveal.id}`],
      ] as const) {
        const response = await call(h, method, path, { cookie, rawBody });
        expect(response.status, `${method} ${path}`).toBe(400);
      }
    });

    test('with a factor active, the password alone is not enough: a current code or recovery code is required too', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);

      const noProof = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        body: { password: TEST_PASSWORD },
      });
      expect(noProof.status).toBe(400);

      const both = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        body: { password: TEST_PASSWORD, code: '123456', recoveryCode: 'x' },
      });
      expect(both.status).toBe(400);

      const wrongCode = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        body: { password: TEST_PASSWORD, code: '000000' },
      });
      expect(wrongCode.status).toBe(403);
      expect(totpStore.getFactorFailureState(SUBJECT_ID).failures).toBe(1);

      const wrongRecovery = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        body: { password: TEST_PASSWORD, recoveryCode: 'f'.repeat(32) },
      });
      expect(wrongRecovery.status).toBe(403);
      expect(totpStore.getFactorFailureState(SUBJECT_ID).failures).toBe(2);
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
    });

    test('a locked second factor refuses management before the proof is looked at', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      totpStore.recordFactorFailure({
        subjectId: SUBJECT_ID,
        username: TEST_USER,
        now: Date.now(),
        threshold: 1,
        baseLockMs: 60_000,
        maxLockMs: 60_000,
      });

      const response = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        body: { password: TEST_PASSWORD, code: code(enrolled.seed, 1) },
      });
      expect(response.status).toBe(423);
    });

    test('a TOTP code used to prove management cannot be used again', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      const proof = code(enrolled.seed, 1);

      const first = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        body: { password: TEST_PASSWORD, code: proof },
      });
      expect(first.status).toBe(201);
      await call(
        h,
        'DELETE',
        `/totp-enrollments/${((await first.json()) as EnrollmentReveal).id}`,
        {
          cookie,
        },
      );

      const replay = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        body: { password: TEST_PASSWORD, code: proof },
      });
      expect(replay.status).toBe(403);
    });

    test('the provider the session came from is gone: 503, nothing changes', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      (registry.getState() as { authentication: Record<string, unknown> }).authentication = {};
      const response = await startEnrollment(h, cookie);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'Two-factor management is unavailable' });
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
    });
  });

  /** A session minted by the real login routes for an already-enrolled subject. */
  async function loginCookieWithCode(
    h: Harness,
    enrolled: Enrolled,
    offsetSteps = 0,
  ): Promise<string> {
    const response = await loginPassword(h);
    expect(response.status).toBe(202);
    const { challenge } = (await response.json()) as { challenge: { id: string } };
    const completed = await completeChallenge(h, challenge.id, {
      code: code(enrolled.seed, offsetSteps),
    });
    expect(completed.status).toBe(200);
    return cookieOf(completed);
  }

  function completeChallenge(h: Harness, id: string, body: unknown, cookie?: string) {
    return fetch(url(h, `/auth/login-challenges/${id}`), {
      method: 'PUT',
      headers: {
        'X-Forwarded-Proto': 'https',
        Origin: originOf(h),
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  describe('starting an enrollment', () => {
    test('reveals the seed once, in the shape an authenticator app needs', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const before = Date.now();
      const response = await startEnrollment(h, cookie);
      const body = (await response.json()) as EnrollmentReveal;

      expect(response.status).toBe(201);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('location')).toBe(`/api/v1/auth/totp-enrollments/${body.id}`);
      expectContract('/api/v1/auth/totp-enrollments', 'post', '201', body);
      expect(Object.keys(body).sort()).toEqual([
        'expiresAt',
        'id',
        'otpauthUri',
        'replacesFactor',
        'secret',
      ]);
      expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(base32Decode(body.secret)).toHaveLength(20);
      expect(body.replacesFactor).toBe(false);
      const expiresAt = Date.parse(body.expiresAt);
      expect(expiresAt).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000);

      const uri = new URL(body.otpauthUri);
      expect(uri.protocol).toBe('otpauth:');
      expect(uri.searchParams.get('secret')).toBe(body.secret);
      expect(uri.searchParams.get('issuer')).toBe('Drydock');
      expect(decodeURIComponent(uri.pathname)).toMatch(new RegExp(`^/Drydock:${TEST_USER}@.+`));
      expect(managementAudit()).toEqual([
        {
          action: 'totp-enrollment-started',
          status: 'success',
          containerName: 'authentication',
          details: `subject=${SUBJECT_ID} enrollment=${body.id}`,
        },
      ]);
    });

    test('the label uses the configured public host when there is one', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      ddEnvVars.DD_PUBLIC_URL = 'https://drydock.example.com:8443';
      try {
        const body = await revealEnrollment(h, cookie);
        expect(decodeURIComponent(new URL(body.otpauthUri).pathname)).toBe(
          `/Drydock:${TEST_USER}@drydock.example.com:8443`,
        );
      } finally {
        delete ddEnvVars.DD_PUBLIC_URL;
      }
    });

    test('stores the seed encrypted: no plaintext of it is anywhere in the database', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const body = await revealEnrollment(h, cookie);
      const seed = base32Decode(body.secret);

      const dump = dumpDatabase(h.db);
      for (const needle of [
        body.secret,
        seed.toString('hex'),
        seed.toString('base64'),
        TEST_PASSWORD,
      ]) {
        expect(dump).not.toContain(needle);
      }
      const row = h.db.prepare('SELECT * FROM totp_enrollments').get() as Record<string, unknown>;
      expect(row.encryption_key_id).toBe('k1');
      expect(row.subject_id).toBe(SUBJECT_ID);
      expect(row.provider_id).toBe(PROVIDER);
    });

    test('a second start while one is pending is a 409 and the first stays', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const first = await revealEnrollment(h, cookie);
      const second = await startEnrollment(h, cookie);
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ error: 'A two-factor enrollment is already pending' });
      expect(totpStore.getEnrollmentBySubject(SUBJECT_ID)?.enrollmentId).toBe(first.id);
    });

    test('an expired pending enrollment does not block a new one', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      await revealEnrollment(h, cookie);
      h.db.prepare('UPDATE totp_enrollments SET expires_at = ?').run('2020-01-01T00:00:00.000Z');
      const again = await startEnrollment(h, cookie);
      expect(again.status).toBe(201);
    });

    test.each([
      ['missing', undefined, undefined],
      ['an unusable key ring', '{"k1":"not-a-key"}', 'k1'],
      ['a key ring without its active key', keyringJson, 'k2'],
    ])('with the key ring %s it is 503 and nothing changes', async (_name, ring, active) => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      if (ring === undefined) {
        delete ddEnvVars.DD_AUTH_TOTP_KEYRING;
        delete ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID;
      } else {
        ddEnvVars.DD_AUTH_TOTP_KEYRING = ring;
        ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID = active;
      }
      const response = await startEnrollment(h, cookie);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'Two-factor management is unavailable' });
      expect(dumpDatabase(h.db)).not.toContain('totp-enrollment');
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
      expect(auditActions()).toEqual([]);
      // The password was never spent against the lockout budget either.
      expect(totpStore.getFactorFailureState(SUBJECT_ID).failures).toBe(0);
    });

    test('the label falls back to the server name when the public URL is not usable', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      ddEnvVars.DD_PUBLIC_URL = 'not a url';
      ddEnvVars.DD_SERVER_NAME = 'dock-one';
      try {
        const body = await revealEnrollment(h, cookie);
        expect(decodeURIComponent(new URL(body.otpauthUri).pathname)).toBe(
          `/Drydock:${TEST_USER}@dock-one`,
        );
      } finally {
        delete ddEnvVars.DD_PUBLIC_URL;
        delete ddEnvVars.DD_SERVER_NAME;
      }
    });

    test('a factor that changes while the proof is being checked is a 409 and gives the recovery code back', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      h.db.exec(
        `CREATE TRIGGER bump_on_spend AFTER UPDATE OF used_at ON totp_recovery_codes
         BEGIN UPDATE totp_subject_versions SET factor_version = factor_version + 1; END;`,
      );
      const response = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        body: { password: TEST_PASSWORD, recoveryCode: enrolled.recoveryCodes[0] },
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'Two-factor state changed. Try again.' });
      expect(totpStore.countUnusedRecoveryCodes(enrolled.factorId)).toBe(10);
    });

    test('a store fault is a 503 that leaks nothing', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      h.db.exec('DROP TABLE totp_enrollments');
      const response = await startEnrollment(h, cookie);
      expect(response.status).toBe(503);
      expect(JSON.stringify(await response.json())).not.toMatch(/sqlite|totp_enrollments/i);
    });
  });

  describe('confirming an enrollment', () => {
    test('activates atomically, bumps the version and returns ten recovery codes exactly once', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const reveal = await revealEnrollment(h, cookie);
      const seed = base32Decode(reveal.secret);

      const response = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
        cookie,
        body: { code: code(seed) },
      });
      const body = (await response.json()) as Activated;

      expect(response.status).toBe(201);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(Object.keys(body).sort()).toEqual([
        'activatedAt',
        'recoveryCodes',
        'recoveryCodesRemaining',
        'status',
      ]);
      expectContract('/api/v1/auth/totp-enrollments/{id}', 'put', '201', body);
      expect(body.status).toBe('active');
      expect(body.recoveryCodesRemaining).toBe(10);
      expect(body.recoveryCodes).toHaveLength(10);
      expect(new Set(body.recoveryCodes).size).toBe(10);
      expect(totpStore.getSubjectVersion(SUBJECT_ID)).toBe(1);
      expect(totpStore.getEnrollmentBySubject(SUBJECT_ID)).toBeUndefined();
      expect(auditEvents).toContainEqual({
        action: 'totp-enabled',
        status: 'success',
        containerName: 'authentication',
        details: expect.stringContaining(`subject=${SUBJECT_ID}`),
      });

      // Show-once: nothing readable afterwards carries a code, the seed or a digest.
      const newCookie = cookieOf(response);
      const status = JSON.stringify(await factorStatus(h, newCookie));
      for (const secret of [...body.recoveryCodes, reveal.secret]) {
        expect(status).not.toContain(secret);
        expect(status).not.toContain(secret.replaceAll('-', ''));
      }
      const dump = dumpDatabase(h.db);
      for (const secret of [
        ...body.recoveryCodes,
        ...body.recoveryCodes.map((c) => c.replaceAll('-', '')),
        reveal.secret,
        seed.toString('hex'),
        seed.toString('base64'),
      ]) {
        expect(dump).not.toContain(secret);
      }
      const digests = body.recoveryCodes.map(digestRecoveryCode);
      for (const digest of digests) {
        expect(dump).toContain(digest);
      }
    });

    test('the current browser stays signed in as factor-assured; every other session and its streams die', async () => {
      const h = await boot();
      // In the store before the first login builds the username index.
      const preExisting = await plant(h, localSessionUser('password', 0));
      const cookie = await sessionCookie(h);
      const other = await sessionCookie(h);
      // Planted after the index was built: only a fresh read of the store finds it.
      const legacy = await plant(h, JSON.stringify({ username: TEST_USER }));
      const elsewhere = await sessionCookie(h, TEST_USER, OTHER_PASSWORD);
      expect(await protectedStatus(h, other)).toBe(200);
      expect(await protectedStatus(h, preExisting)).toBe(200);
      expect(await protectedStatus(h, legacy)).toBe(200);

      const reveal = await revealEnrollment(h, cookie);
      closedStreams.length = 0;
      const response = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
        cookie,
        body: { code: code(base32Decode(reveal.secret)) },
      });
      expect(response.status).toBe(201);
      const fresh = cookieOf(response);

      expect(fresh).not.toBe(cookie);
      expect(await protectedStatus(h, fresh)).toBe(200);
      expect(await protectedStatus(h, cookie)).toBe(401);
      expect(await protectedStatus(h, other)).toBe(401);
      expect(await protectedStatus(h, legacy)).toBe(401);
      expect(await protectedStatus(h, preExisting)).toBe(401);
      // The same username under another provider is another subject: untouched.
      expect(await protectedStatus(h, elsewhere)).toBe(200);

      // A stream holds whichever id it connected with: another session's, a
      // legacy one's, or the caller's own old id, which a copied cookie shares.
      const closed = closedStreams.flat();
      expect(closed).toContain(sidOf(other));
      expect(closed).toContain(sidOf(preExisting));
      expect(closed).toContain(sidOf(legacy));
      expect(closed).toContain(sidOf(cookie));
      expect(closed).not.toContain(sidOf(fresh));
      expect(closed).not.toContain(sidOf(elsewhere));
      expect(
        h.db
          .prepare('SELECT sid FROM sessions')
          .all()
          .map((row) => String(row.sid))
          .sort(),
      ).toEqual([sidOf(fresh), sidOf(elsewhere)].sort());
      const stored = h.db
        .prepare('SELECT data FROM sessions')
        .all()
        .map((row) => String((JSON.parse(String(row.data)).passport ?? {}).user));
      expect(stored.filter((user) => user.includes('"assurance":"totp"'))).toHaveLength(1);
    });

    test('a password-only login now answers 202, and the confirmation code cannot be replayed to finish it', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const reveal = await revealEnrollment(h, cookie);
      const seed = base32Decode(reveal.secret);
      const confirmation = code(seed);
      await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
        cookie,
        body: { code: confirmation },
      });

      const login = await loginPassword(h);
      expect(login.status).toBe(202);
      const { challenge } = (await login.json()) as { challenge: { id: string } };
      const complete = (body: unknown) =>
        fetch(url(h, `/auth/login-challenges/${challenge.id}`), {
          method: 'PUT',
          headers: {
            'X-Forwarded-Proto': 'https',
            Origin: originOf(h),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

      const replay = await complete({ code: confirmation });
      expect(replay.status).toBe(401);
      const next = await complete({ code: code(seed, 1) });
      expect(next.status).toBe(200);
    });

    test('a wrong code is 422 and the enrollment survives for another try', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const reveal = await revealEnrollment(h, cookie);
      const seed = base32Decode(reveal.secret);
      const wrong = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
        cookie,
        body: { code: code(seed) === '000000' ? '111111' : '000000' },
      });
      expect(wrong.status).toBe(422);
      expect(await wrong.json()).toEqual({ error: 'Invalid code' });
      expect(totpStore.getSubjectVersion(SUBJECT_ID)).toBe(0);

      const right = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
        cookie,
        body: { code: code(seed) },
      });
      expect(right.status).toBe(201);
    });

    test('five wrong codes use the enrollment up: the right code is then a 404, and starting again works', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const reveal = await revealEnrollment(h, cookie);
      const seed = base32Decode(reveal.secret);
      const confirm = (value: string) =>
        call(h, 'PUT', `/totp-enrollments/${reveal.id}`, { cookie, body: { code: value } });

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const wrong = await confirm(wrongCode(seed));
        expect(wrong.status).toBe(422);
        expect(await wrong.json()).toEqual({ error: 'Invalid code' });
      }

      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
      const right = await confirm(code(seed));
      expect(right.status).toBe(404);
      expect(totpStore.getSubjectVersion(SUBJECT_ID)).toBe(0);
      expect(totpStore.getFactorBySubject(SUBJECT_ID)).toBeUndefined();
      expect(auditActions()).toEqual(['totp-enrollment-started']);

      // Nothing is locked: the person starts over with a new seed.
      const again = await enrollThroughApi(h, cookie);
      expect(again.activated.status).toBe('active');
    });

    test('a parallel burst of wrong codes gets five guesses at the seed, not one each', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const reveal = await revealEnrollment(h, cookie);
      const seed = base32Decode(reveal.secret);

      const statuses = (
        await Promise.all(
          Array.from({ length: 20 }, () =>
            call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
              cookie,
              body: { code: wrongCode(seed) },
            }),
          ),
        )
      ).map((response) => response.status);

      expect(statuses.filter((status) => status === 422)).toHaveLength(5);
      expect(statuses.filter((status) => status === 404)).toHaveLength(15);
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
    });

    test('wrong codes use up a pending replacement and leave the active factor alone', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      const reveal = await revealEnrollment(h, cookie, { code: code(enrolled.seed, 1) });
      const newSeed = base32Decode(reveal.secret);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const wrong = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
          cookie,
          body: { code: wrongCode(newSeed) },
        });
        expect(wrong.status).toBe(422);
      }

      expect((await factorStatus(h, cookie)).body.pendingEnrollment).toBeUndefined();
      expect(totpStore.getFactorBySubject(SUBJECT_ID)?.factorId).toBe(enrolled.factorId);
      expect(totpStore.getSubjectVersion(SUBJECT_ID)).toBe(1);
      expect(await protectedStatus(h, cookie)).toBe(200);
      // Confirmation guesses are not second-factor failures: nothing locks.
      expect(totpStore.getFactorFailureState(SUBJECT_ID).failures).toBe(0);
    });

    test.each([
      ['no code', {}],
      ['a recovery code instead', { recoveryCode: 'x' }],
      ['an extra key', { code: '123456', password: 'x' }],
      ['a numeric code', { code: 123456 }],
    ])('rejects %s as a 400', async (_name, body) => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const reveal = await revealEnrollment(h, cookie);
      const response = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, { cookie, body });
      expect(response.status).toBe(400);
    });

    test('an unknown id and another subject’s enrollment are both 404', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const unknown = await call(h, 'PUT', `/totp-enrollments/${crypto.randomUUID()}`, {
        cookie,
        body: { code: '123456' },
      });
      expect(unknown.status).toBe(404);
      const malformed = await call(h, 'PUT', '/totp-enrollments/not-an-id', {
        cookie,
        body: { code: '123456' },
      });
      expect(malformed.status).toBe(404);

      const elsewhere = await sessionCookie(h, TEST_USER, OTHER_PASSWORD);
      const theirs = await revealEnrollment(h, elsewhere, { password: OTHER_PASSWORD });
      expect(OTHER_SUBJECT_ID).not.toBe(SUBJECT_ID);
      const crossed = await call(h, 'PUT', `/totp-enrollments/${theirs.id}`, {
        cookie,
        body: { code: code(base32Decode(theirs.secret)) },
      });
      expect(crossed.status).toBe(404);
      expect(totpStore.getEnrollmentBySubject(OTHER_SUBJECT_ID)?.enrollmentId).toBe(theirs.id);
    });

    test('an expired enrollment is 410 and is deleted', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const reveal = await revealEnrollment(h, cookie);
      h.db.prepare('UPDATE totp_enrollments SET expires_at = ?').run('2020-01-01T00:00:00.000Z');
      const response = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
        cookie,
        body: { code: code(base32Decode(reveal.secret)) },
      });
      expect(response.status).toBe(410);
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_enrollments').get()).toEqual({ n: 0 });
    });

    test('losing the key ring between start and confirm is a 503 that changes nothing', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const reveal = await revealEnrollment(h, cookie);
      delete ddEnvVars.DD_AUTH_TOTP_KEYRING;
      delete ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID;
      const response = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
        cookie,
        body: { code: '123456' },
      });
      expect(response.status).toBe(503);
      expect(totpStore.getEnrollmentBySubject(SUBJECT_ID)?.enrollmentId).toBe(reveal.id);
      expect(totpStore.getSubjectVersion(SUBJECT_ID)).toBe(0);
    });

    test('an enrollment whose seed cannot be decrypted is a 503, not a wrong code', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const reveal = await revealEnrollment(h, cookie);
      h.db.prepare('UPDATE totp_enrollments SET secret_ciphertext = ?').run('AAAA');
      const response = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
        cookie,
        body: { code: '123456' },
      });
      expect(response.status).toBe(503);
    });

    test('concurrent confirmations with the same code have one winner and one factor', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const reveal = await revealEnrollment(h, cookie);
      const confirmation = code(base32Decode(reveal.secret));
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
            cookie,
            body: { code: confirmation },
          }),
        ),
      );
      expect(results.map((r) => r.status).filter((s) => s === 201)).toHaveLength(1);
      // The losers either find the enrollment gone or find their session already replaced.
      for (const status of results.map((r) => r.status).filter((s) => s !== 201)) {
        expect([401, 404]).toContain(status);
      }
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_factors').get()).toEqual({ n: 1 });
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM totp_recovery_codes').get()).toEqual({
        n: 10,
      });
    });

    test('an enrollment started against an older version is a 409 and activates nothing', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const reveal = await revealEnrollment(h, cookie);
      h.db.prepare('UPDATE totp_enrollments SET expected_factor_version = 9').run();
      const response = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
        cookie,
        body: { code: code(base32Decode(reveal.secret)) },
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'Two-factor state changed. Try again.' });
      expect(totpStore.getFactorBySubject(SUBJECT_ID)).toBeUndefined();
    });

    test('a session that cannot be replaced still hands over the codes of a factor that is now live', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const reveal = await revealEnrollment(h, cookie);
      vi.spyOn(h.store, 'destroy').mockImplementationOnce((_sid, done) => {
        done?.(new Error('session store down'));
      });
      const response = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
        cookie,
        body: { code: code(base32Decode(reveal.secret)) },
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as Activated;
      expect(body.recoveryCodes).toHaveLength(10);
      expect(totpStore.getSubjectVersion(SUBJECT_ID)).toBe(1);
      expect(await protectedStatus(h, cookie)).toBe(401);
    });
  });

  describe('cancelling an enrollment', () => {
    test('is an idempotent 204 that deletes only the caller’s own pending enrollment', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const elsewhere = await sessionCookie(h, TEST_USER, OTHER_PASSWORD);
      const mine = await revealEnrollment(h, cookie);
      const theirs = await revealEnrollment(h, elsewhere, { password: OTHER_PASSWORD });

      const crossed = await call(h, 'DELETE', `/totp-enrollments/${theirs.id}`, { cookie });
      expect(crossed.status).toBe(204);
      expect(totpStore.getEnrollmentBySubject(OTHER_SUBJECT_ID)?.enrollmentId).toBe(theirs.id);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await call(h, 'DELETE', `/totp-enrollments/${mine.id}`, { cookie });
        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
      }
      expect(totpStore.getEnrollmentBySubject(SUBJECT_ID)).toBeUndefined();
      const unknown = await call(h, 'DELETE', '/totp-enrollments/not-an-id', { cookie });
      expect(unknown.status).toBe(204);
    });
  });

  describe('replacing an active factor', () => {
    test('the old factor stays mandatory until the new one is confirmed, then only the new one works', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);

      const reveal = await revealEnrollment(h, cookie, { code: code(enrolled.seed, 1) });
      expect(reveal.replacesFactor).toBe(true);
      expect((await factorStatus(h, cookie)).body.pendingEnrollment).toMatchObject({
        id: reveal.id,
        replacesFactor: true,
      });

      // Mid-replacement the old seed still logs in.
      const midway = await loginPassword(h);
      expect(midway.status).toBe(202);

      const newSeed = base32Decode(reveal.secret);
      const confirm = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
        cookie,
        body: { code: code(newSeed) },
      });
      expect(confirm.status).toBe(201);
      expect(auditActions()).toContain('totp-replaced');
      expect(totpStore.getSubjectVersion(SUBJECT_ID)).toBe(2);
      expect(await protectedStatus(h, cookie)).toBe(401);
      expect(await protectedStatus(h, cookieOf(confirm))).toBe(200);

      const login = await loginPassword(h);
      const { challenge } = (await login.json()) as { challenge: { id: string } };
      const attempt = (codeValue: string) =>
        fetch(url(h, `/auth/login-challenges/${challenge.id}`), {
          method: 'PUT',
          headers: {
            'X-Forwarded-Proto': 'https',
            Origin: originOf(h),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code: codeValue }),
        });
      expect((await attempt(code(enrolled.seed, 2))).status).toBe(401);
      expect((await attempt(code(newSeed, 1))).status).toBe(200);
    });

    test('an abandoned replacement leaves the old factor, its sessions and its codes alone', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      const reveal = await revealEnrollment(h, cookie, { code: code(enrolled.seed, 1) });
      h.db.prepare('UPDATE totp_enrollments SET expires_at = ?').run('2020-01-01T00:00:00.000Z');

      const expired = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
        cookie,
        body: { code: code(base32Decode(reveal.secret)) },
      });
      expect(expired.status).toBe(410);
      expect(await protectedStatus(h, cookie)).toBe(200);
      expect(totpStore.getFactorBySubject(SUBJECT_ID)?.factorId).toBe(enrolled.factorId);
      expect(totpStore.countUnusedRecoveryCodes(enrolled.factorId)).toBe(10);
    });

    test('cancelling a replacement keeps the old factor', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      const reveal = await revealEnrollment(h, cookie, { recoveryCode: enrolled.recoveryCodes[0] });
      expect((await call(h, 'DELETE', `/totp-enrollments/${reveal.id}`, { cookie })).status).toBe(
        204,
      );
      expect(totpStore.getFactorBySubject(SUBJECT_ID)?.factorId).toBe(enrolled.factorId);
      // The recovery code that proved the start is spent.
      expect(totpStore.countUnusedRecoveryCodes(enrolled.factorId)).toBe(9);
    });

    test('a recovery code that proved a start which then conflicted is handed back', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      await revealEnrollment(h, cookie, { recoveryCode: enrolled.recoveryCodes[0] });
      const conflict = await call(h, 'POST', '/totp-enrollments', {
        cookie,
        body: { password: TEST_PASSWORD, recoveryCode: enrolled.recoveryCodes[1] },
      });
      expect(conflict.status).toBe(409);
      expect(totpStore.countUnusedRecoveryCodes(enrolled.factorId)).toBe(9);
      // Only the code that stayed spent is on the record; the one handed back is not.
      expect(recoveryUsedAudit()).toHaveLength(1);
    });

    test('a recovery code spent to prove a management call is audited, whichever call it proved', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      const used = {
        action: 'totp-recovery-used',
        status: 'success',
        containerName: 'authentication',
        details: `subject=${SUBJECT_ID}`,
      };
      expect(recoveryUsedAudit()).toEqual([]);

      const replaced = await call(h, 'POST', '/totp-recovery-code-sets', {
        cookie,
        body: { password: TEST_PASSWORD, recoveryCode: enrolled.recoveryCodes[0] },
      });
      expect(replaced.status).toBe(201);
      const { recoveryCodes } = (await replaced.json()) as { recoveryCodes: string[] };
      expect(recoveryUsedAudit()).toEqual([used]);

      const reveal = await revealEnrollment(h, cookie, { recoveryCode: recoveryCodes[0] });
      expect(recoveryUsedAudit()).toEqual([used, used]);
      await call(h, 'DELETE', `/totp-enrollments/${reveal.id}`, { cookie });

      const removed = await call(h, 'DELETE', '/totp-factor', {
        cookie,
        body: { password: TEST_PASSWORD, recoveryCode: recoveryCodes[1] },
      });
      expect(removed.status).toBe(204);
      expect(recoveryUsedAudit()).toEqual([used, used, used]);
      expect(auditActions()).toEqual([
        'totp-recovery-codes-replaced',
        'totp-recovery-used',
        'totp-enrollment-started',
        'totp-recovery-used',
        'totp-disabled',
        'totp-recovery-used',
      ]);
      // The code itself is nowhere in what was recorded.
      const recorded = JSON.stringify(auditEvents);
      for (const secret of [enrolled.recoveryCodes[0], recoveryCodes[0], recoveryCodes[1]]) {
        expect(recorded).not.toContain(secret);
        expect(recorded).not.toContain(secret.replaceAll('-', ''));
      }
    });

    test('a wrong recovery code and a TOTP proof record no recovery use', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);

      const wrong = await call(h, 'POST', '/totp-recovery-code-sets', {
        cookie,
        body: { password: TEST_PASSWORD, recoveryCode: 'f'.repeat(32) },
      });
      expect(wrong.status).toBe(403);
      const viaCode = await call(h, 'POST', '/totp-recovery-code-sets', {
        cookie,
        body: { password: TEST_PASSWORD, code: code(enrolled.seed, 1) },
      });
      expect(viaCode.status).toBe(201);

      expect(recoveryUsedAudit()).toEqual([]);
    });
  });

  describe('replacing the recovery codes', () => {
    test('needs the password and a current proof, shows ten new codes once and kills the old ones', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      const other = await loginCookieWithCode(h, enrolled).catch(() => undefined);

      const noPassword = await call(h, 'POST', '/totp-recovery-code-sets', {
        cookie,
        body: { code: code(enrolled.seed, 1) },
      });
      expect(noPassword.status).toBe(400);

      const response = await call(h, 'POST', '/totp-recovery-code-sets', {
        cookie,
        body: { password: TEST_PASSWORD, code: code(enrolled.seed, 1) },
      });
      const body = (await response.json()) as {
        recoveryCodes: string[];
        recoveryCodesRemaining: number;
      };

      expect(response.status).toBe(201);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expectContract('/api/v1/auth/totp-recovery-code-sets', 'post', '201', body);
      expect(Object.keys(body).sort()).toEqual(['recoveryCodes', 'recoveryCodesRemaining']);
      expect(body.recoveryCodes).toHaveLength(10);
      expect(body.recoveryCodesRemaining).toBe(10);
      expect(body.recoveryCodes.some((c) => enrolled.recoveryCodes.includes(c))).toBe(false);
      expect(totpStore.getFactorBySubject(SUBJECT_ID)?.recoveryGeneration).toBe(2);
      expect(auditEvents).toContainEqual({
        action: 'totp-recovery-codes-replaced',
        status: 'success',
        containerName: 'authentication',
        details: expect.stringContaining(`subject=${SUBJECT_ID}`),
      });

      // The factor version is unchanged, so no session was invalidated.
      expect(totpStore.getSubjectVersion(SUBJECT_ID)).toBe(1);
      expect(await protectedStatus(h, cookie)).toBe(200);
      if (other !== undefined) {
        expect(await protectedStatus(h, other)).toBe(200);
      }

      const dump = dumpDatabase(h.db);
      for (const secret of [...body.recoveryCodes, ...enrolled.recoveryCodes]) {
        expect(dump).not.toContain(secret);
      }
      // An old code no longer proves anything; a new one does.
      const oldCode = await call(h, 'POST', '/totp-recovery-code-sets', {
        cookie,
        body: { password: TEST_PASSWORD, recoveryCode: enrolled.recoveryCodes[3] },
      });
      expect(oldCode.status).toBe(403);
      const newCode = await call(h, 'POST', '/totp-recovery-code-sets', {
        cookie,
        body: { password: TEST_PASSWORD, recoveryCode: body.recoveryCodes[0] },
      });
      expect(newCode.status).toBe(201);
    });

    test('is 404 with no factor, and the password is still required first', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const response = await call(h, 'POST', '/totp-recovery-code-sets', {
        cookie,
        body: { password: TEST_PASSWORD },
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'No two-factor factor is active' });
    });

    test('a generation that moved under the request is a 409', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      h.db.exec(
        `CREATE TRIGGER bump_generation BEFORE UPDATE OF last_accepted_counter ON totp_factors
         BEGIN UPDATE totp_factors SET recovery_generation = recovery_generation + 1; END;`,
      );
      const response = await call(h, 'POST', '/totp-recovery-code-sets', {
        cookie,
        body: { password: TEST_PASSWORD, code: code(enrolled.seed, 1) },
      });
      expect(response.status).toBe(409);
    });

    test('a key ring that is gone refuses a TOTP proof with 503 but a recovery code still proves', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      delete ddEnvVars.DD_AUTH_TOTP_KEYRING;
      delete ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID;

      const viaCode = await call(h, 'POST', '/totp-recovery-code-sets', {
        cookie,
        body: { password: TEST_PASSWORD, code: code(enrolled.seed, 1) },
      });
      expect(viaCode.status).toBe(503);

      const viaRecovery = await call(h, 'POST', '/totp-recovery-code-sets', {
        cookie,
        body: { password: TEST_PASSWORD, recoveryCode: enrolled.recoveryCodes[0] },
      });
      expect(viaRecovery.status).toBe(201);
    });
  });

  describe('removing the factor', () => {
    test('needs the password and a current proof, then the factor and codes are gone and old factor sessions are dead', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      const other = await loginCookieWithCode(h, enrolled).catch(() => undefined);
      closedStreams.length = 0;

      const noProof = await call(h, 'DELETE', '/totp-factor', {
        cookie,
        body: { password: TEST_PASSWORD },
      });
      expect(noProof.status).toBe(400);
      const wrongPassword = await call(h, 'DELETE', '/totp-factor', {
        cookie,
        body: { password: 'nope', code: code(enrolled.seed, 1) },
      });
      expect(wrongPassword.status).toBe(403);
      expect(totpStore.getFactorBySubject(SUBJECT_ID)).toBeDefined();

      const response = await call(h, 'DELETE', '/totp-factor', {
        cookie,
        body: { password: TEST_PASSWORD, code: code(enrolled.seed, 1) },
      });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      expect(totpStore.getFactorBySubject(SUBJECT_ID)).toBeUndefined();
      expect(totpStore.countUnusedRecoveryCodes(enrolled.factorId)).toBe(0);
      expect(totpStore.getSubjectVersion(SUBJECT_ID)).toBe(2);
      expect(auditEvents).toContainEqual({
        action: 'totp-disabled',
        status: 'success',
        containerName: 'authentication',
        details: expect.stringContaining(`subject=${SUBJECT_ID}`),
      });

      // Old factor-era sessions are dead, the one that proved the removal lives on.
      expect(await protectedStatus(h, cookie)).toBe(401);
      if (other !== undefined) {
        expect(await protectedStatus(h, other)).toBe(401);
        expect(closedStreams.flat()).toContain(sidOf(other));
      }
      const fresh = cookieOf(response);
      expect(await protectedStatus(h, fresh)).toBe(200);
      expect((await factorStatus(h, fresh)).body).toEqual({
        status: 'unenrolled',
        recoveryCodesRemaining: 0,
      });

      // A legacy session is not resurrected by removal, and password login is back.
      const legacy = await plant(h, JSON.stringify({ username: TEST_USER }));
      expect(await protectedStatus(h, legacy)).toBe(401);
      const login = await loginPassword(h);
      expect(login.status).toBe(200);
    });

    test('removal closes the streams of every session it ends, the caller’s old id and legacy ones included', async () => {
      const h = await boot();
      const enrolled = enroll();
      // In the store before the first login builds the username index.
      const preExisting = await plant(h, localSessionUser('totp', 1));
      const cookie = await loginCookieWithCode(h, enrolled);
      const other = await loginCookieWithCode(h, enrolled, 1);
      const legacy = await plant(h, JSON.stringify({ username: TEST_USER }));
      expect(await protectedStatus(h, preExisting)).toBe(200);
      expect(await protectedStatus(h, other)).toBe(200);
      closedStreams.length = 0;

      const response = await call(h, 'DELETE', '/totp-factor', {
        cookie,
        body: { password: TEST_PASSWORD, recoveryCode: enrolled.recoveryCodes[0] },
      });
      expect(response.status).toBe(204);
      const fresh = cookieOf(response);

      const closed = closedStreams.flat();
      for (const ended of [preExisting, other, legacy, cookie]) {
        expect(closed).toContain(sidOf(ended));
        expect(await protectedStatus(h, ended)).toBe(401);
      }
      expect(closed).not.toContain(sidOf(fresh));
      expect(
        h.db
          .prepare('SELECT sid FROM sessions')
          .all()
          .map((row) => String(row.sid)),
      ).toEqual([sidOf(fresh)]);
    });

    test('a recovery code is an accepted proof, with no key ring needed', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      delete ddEnvVars.DD_AUTH_TOTP_KEYRING;
      delete ddEnvVars.DD_AUTH_TOTP_ACTIVE_KEY_ID;
      const response = await call(h, 'DELETE', '/totp-factor', {
        cookie,
        body: { password: TEST_PASSWORD, recoveryCode: enrolled.recoveryCodes[0].toUpperCase() },
      });
      expect(response.status).toBe(204);
    });

    test('is 404 when nothing is active', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const response = await call(h, 'DELETE', '/totp-factor', {
        cookie,
        body: { password: TEST_PASSWORD },
      });
      expect(response.status).toBe(404);
    });

    test('a version that moved under the request is a 409 and keeps the factor', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      h.db.exec(
        `CREATE TRIGGER bump_on_spend AFTER UPDATE OF used_at ON totp_recovery_codes
         BEGIN UPDATE totp_subject_versions SET factor_version = factor_version + 1; END;`,
      );
      const response = await call(h, 'DELETE', '/totp-factor', {
        cookie,
        body: { password: TEST_PASSWORD, recoveryCode: enrolled.recoveryCodes[0] },
      });
      expect(response.status).toBe(409);
      expect(totpStore.getFactorBySubject(SUBJECT_ID)).toBeDefined();
    });

    test('concurrent removals with different recovery codes remove once', async () => {
      const h = await boot();
      const enrolled = enroll();
      const cookie = await loginCookieWithCode(h, enrolled);
      const results = await Promise.all(
        [0, 1, 2].map((index) =>
          call(h, 'DELETE', '/totp-factor', {
            cookie,
            body: { password: TEST_PASSWORD, recoveryCode: enrolled.recoveryCodes[index] },
          }),
        ),
      );
      expect(results.filter((r) => r.status === 204)).toHaveLength(1);
      expect(totpStore.getFactorBySubject(SUBJECT_ID)).toBeUndefined();
    });
  });

  describe('a recovery login', () => {
    test('closes the streams of every session it ends, the browser’s old id and legacy ones included', async () => {
      const h = await boot();
      const enrolled = enroll();
      // In the store before the first login builds the username index.
      const preExisting = await plant(h, localSessionUser('totp', 1));
      const browser = await loginCookieWithCode(h, enrolled);
      const other = await loginCookieWithCode(h, enrolled, 1);
      const legacy = await plant(h, JSON.stringify({ username: TEST_USER }));
      const elsewhere = await sessionCookie(h, TEST_USER, OTHER_PASSWORD);
      expect(await protectedStatus(h, preExisting)).toBe(200);
      closedStreams.length = 0;

      const login = await loginPassword(h);
      expect(login.status).toBe(202);
      const { challenge } = (await login.json()) as { challenge: { id: string } };
      // The browser still carries its old cookie, the one a thief would share.
      const completed = await completeChallenge(
        h,
        challenge.id,
        { recoveryCode: enrolled.recoveryCodes[0] },
        browser,
      );
      expect(completed.status).toBe(200);
      const fresh = cookieOf(completed);

      const closed = closedStreams.flat();
      for (const ended of [preExisting, other, legacy, browser]) {
        expect(closed).toContain(sidOf(ended));
        expect(await protectedStatus(h, ended)).toBe(401);
      }
      expect(closed).not.toContain(sidOf(fresh));
      expect(closed).not.toContain(sidOf(elsewhere));
      expect(await protectedStatus(h, fresh)).toBe(200);
      expect(await protectedStatus(h, elsewhere)).toBe(200);
    });
  });

  describe('the same username under another provider', () => {
    test('is a different subject: its factor, sessions and enrollment never cross', async () => {
      const h = await boot();
      const mine = await sessionCookie(h);
      const theirs = await sessionCookie(h, TEST_USER, OTHER_PASSWORD);

      const done = await enrollThroughApi(h, mine);
      expect(done.activated.status).toBe('active');

      // The other provider's subject is untouched: still unenrolled, still 200.
      expect((await factorStatus(h, theirs)).body).toEqual({
        status: 'unenrolled',
        recoveryCodesRemaining: 0,
      });
      expect(await protectedStatus(h, theirs)).toBe(200);
      expect((await loginPassword(h, TEST_USER, OTHER_PASSWORD)).status).toBe(200);
      expect((await loginPassword(h)).status).toBe(202);

      // Its management calls reauthenticate against its own provider's password.
      const crossPassword = await call(h, 'POST', '/totp-enrollments', {
        cookie: theirs,
        body: { password: TEST_PASSWORD },
      });
      expect(crossPassword.status).toBe(403);
      const own = await call(h, 'POST', '/totp-enrollments', {
        cookie: theirs,
        body: { password: OTHER_PASSWORD },
      });
      expect(own.status).toBe(201);
      expect(totpStore.getEnrollmentBySubject(OTHER_SUBJECT_ID)?.providerId).toBe(OTHER_PROVIDER);
    });
  });

  describe('rate limiting', () => {
    test('management is session-keyed and answers 429 once the budget is spent', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const other = await sessionCookie(h);
      let limited: Awaited<ReturnType<typeof call>> | undefined;
      for (let attempt = 0; attempt < 70 && limited === undefined; attempt += 1) {
        const response = await call(h, 'GET', '/totp-factor', { cookie });
        if (response.status === 429) {
          limited = response;
        }
      }
      expect(limited?.status).toBe(429);
      expect(limited?.headers.get('retry-after')).toBeTruthy();
      // A different session has its own bucket.
      expect((await call(h, 'GET', '/totp-factor', { cookie: other })).status).toBe(200);
    });
  });

  describe('end to end', () => {
    test('enroll, confirm, other sessions die, login needs a code, recover, regenerate, remove, password works again', async () => {
      const h = await boot();
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
      const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

      const browser = await sessionCookie(h);
      const phone = await sessionCookie(h);
      const reveal = await revealEnrollment(h, browser);
      const seed = base32Decode(reveal.secret);
      closedStreams.length = 0;
      const confirm = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
        cookie: browser,
        body: { code: code(seed) },
      });
      expect(confirm.status).toBe(201);
      const activated = (await confirm.json()) as Activated;
      const factorBrowser = cookieOf(confirm);
      expect(await protectedStatus(h, phone)).toBe(401);
      expect(await protectedStatus(h, browser)).toBe(401);
      expect(closedStreams.flat()).toContain(sidOf(phone));
      expect(await protectedStatus(h, factorBrowser)).toBe(200);

      // Login now returns 202, and a code finishes it.
      advance(30_000);
      const challengeResponse = await loginPassword(h);
      expect(challengeResponse.status).toBe(202);
      const { challenge } = (await challengeResponse.json()) as { challenge: { id: string } };
      const finish = await fetch(url(h, `/auth/login-challenges/${challenge.id}`), {
        method: 'PUT',
        headers: {
          'X-Forwarded-Proto': 'https',
          Origin: originOf(h),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: code(seed) }),
      });
      expect(finish.status).toBe(200);
      const second = cookieOf(finish);

      // Regenerate recovery codes with a fresh code, then remove with a new code.
      advance(30_000);
      const regenerate = await call(h, 'POST', '/totp-recovery-code-sets', {
        cookie: second,
        body: { password: TEST_PASSWORD, code: code(seed) },
      });
      expect(regenerate.status).toBe(201);
      const regenerated = (await regenerate.json()) as { recoveryCodes: string[] };
      expect(regenerated.recoveryCodes.some((c) => activated.recoveryCodes.includes(c))).toBe(
        false,
      );

      advance(30_000);
      const remove = await call(h, 'DELETE', '/totp-factor', {
        cookie: second,
        body: { password: TEST_PASSWORD, code: code(seed) },
      });
      expect(remove.status).toBe(204);
      expect(await protectedStatus(h, factorBrowser)).toBe(401);
      expect(await protectedStatus(h, second)).toBe(401);
      expect(await protectedStatus(h, cookieOf(remove))).toBe(200);

      const back = await loginPassword(h);
      expect(back.status).toBe(200);
      expect(auditActions()).toEqual([
        'totp-enrollment-started',
        'totp-enabled',
        'totp-recovery-codes-replaced',
        'totp-disabled',
      ]);
    });
  });

  describe('nothing secret leaks', () => {
    test('no seed, code, password or key appears in logs, audit, errors or any response but the one-time reveals', async () => {
      const h = await boot();
      const cookie = await sessionCookie(h);
      const seen: string[] = [];
      const record = async (response: Awaited<ReturnType<typeof call>>, isReveal = false) => {
        const text = await response.clone().text();
        if (!isReveal) {
          seen.push(text);
        }
        return response;
      };

      await record(
        await call(h, 'POST', '/totp-enrollments', { cookie, body: { password: 'nope' } }),
      );
      const startResponse = await startEnrollment(h, cookie);
      const reveal = (await startResponse.clone().json()) as EnrollmentReveal;
      await record(startResponse, true);
      await record(await startEnrollment(h, cookie));
      await record(
        await factorStatus(h, cookie).then(() => call(h, 'GET', '/totp-factor', { cookie })),
      );
      const seed = base32Decode(reveal.secret);
      const wrongCode = await record(
        await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
          cookie,
          body: { code: code(seed) === '000000' ? '111111' : '000000' },
        }),
      );
      expect(wrongCode.status).toBe(422);
      const confirmCode = code(seed);
      const confirm = await call(h, 'PUT', `/totp-enrollments/${reveal.id}`, {
        cookie,
        body: { code: confirmCode },
      });
      const activated = (await confirm.clone().json()) as Activated;
      await record(confirm, true);
      await record(
        await call(h, 'POST', '/totp-recovery-code-sets', {
          cookie: cookieOf(confirm),
          body: { password: 'nope', code: code(seed, 1) },
        }),
      );
      delete ddEnvVars.DD_AUTH_TOTP_KEYRING;
      await record(
        await call(h, 'DELETE', '/totp-factor', {
          cookie: cookieOf(confirm),
          body: { password: TEST_PASSWORD, code: code(seed, 1) },
        }),
      );

      const secrets = [
        reveal.secret,
        seed.toString('hex'),
        seed.toString('base64'),
        ...activated.recoveryCodes,
        ...activated.recoveryCodes.map((c) => c.replaceAll('-', '')),
        confirmCode,
        TEST_PASSWORD,
        keyring.keys.get('k1')?.toString('base64') as string,
      ];
      const logged = JSON.stringify([logLines, auditEvents]);
      for (const secret of secrets) {
        expect(logged).not.toContain(secret);
        expect(seen.join('\n')).not.toContain(secret);
      }
    });
  });
});
