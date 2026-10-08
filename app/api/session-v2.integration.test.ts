/**
 * Integration test for TOTP slice 2 (spec 11.1.2): the v2 session shape and the
 * shared session validator, against real express-session + SessionStore on a
 * migrated SQLite database, the real Basic provider, the real
 * `requireAuthentication`, and a real WebSocket upgrade.
 *
 * With no TOTP rows every existing session must keep working, legacy ones
 * included. Once a subject has a version row, the sessions that predate it must
 * stop working on HTTP and on the upgrade alike, and stay stopped.
 */
import { argon2Sync, createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import express, { type Application, type Response as ExpressResponse, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import { WebSocket, WebSocketServer } from 'ws';
import Basic from '../authentications/providers/basic/Basic.js';
import * as sessionModel from '../store/session.js';
import * as totpStore from '../store/totp.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import { requireAuthentication } from './auth.js';
import type { AuthRequest } from './auth-types.js';
import {
  authenticateRequest,
  clearAuthenticators,
  registerAuthenticator,
} from './authenticator-chain.js';
import {
  restoreSessionPrincipal,
  sessionAuthenticator,
  writeSessionPrincipal,
} from './session-principal.js';
import { SessionStore } from './session-store.js';
import { closeStreamsOfEndedSessions, registerSessionStreamCloser } from './session-streams.js';
import {
  encryptTotpSeed,
  generateTotpSeed,
  parseTotpKeyring,
  type TotpSeedBinding,
  totpCounterAt,
} from './totp-crypto.js';
import { deriveSubjectId } from './totp-identity.js';
import { applySessionMiddleware, isAuthenticatedSession } from './ws-upgrade-utils.js';

const TEST_USER = 'wud-card';
const TEST_PASSWORD = 'correct-horse-battery-staple';
const BASIC_AUTH_HEADER = `Basic ${Buffer.from(`${TEST_USER}:${TEST_PASSWORD}`).toString('base64')}`;
const HTTPS_HEADERS = { 'X-Forwarded-Proto': 'https' };
const SESSION_SECRET = 'test-secret';
const SUBJECT_ID = deriveSubjectId('basic.default', TEST_USER);

type Database = ReturnType<typeof createMigratedMemoryDatabase>;

interface Harness {
  db: Database;
  store: SessionStore;
  server: http.Server;
  wsServer: WebSocketServer;
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

function cookieOf(response: Awaited<ReturnType<typeof fetch>>): string {
  return (response.headers.get('set-cookie') as string).split(';')[0];
}

/** The session id inside the signed cookie express-session set. */
function sidOf(cookie: string): string {
  return decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))
    .slice(2)
    .split('.')[0];
}

// Every session whose streams were closed, as the event stream's own closer hears it.
const closedStreams: string[] = [];
registerSessionStreamCloser((revoked) => {
  closedStreams.push(...revoked);
  return revoked.size;
});

/**
 * Ask the stream re-check about these sessions and answer the ones it closed.
 * Cleared first: signing in regenerates the session, which closes the streams
 * of the id it replaces through the same closer.
 */
function recheckStreamsOf(...cookies: string[]): string[] {
  closedStreams.length = 0;
  closeStreamsOfEndedSessions(cookies.map(sidOf));
  return [...closedStreams];
}

function storedUsers(db: Database): unknown[] {
  return db
    .prepare('SELECT data FROM sessions')
    .all()
    .map((row) => (JSON.parse(String(row.data)).passport ?? {}).user);
}

const keyring = parseTotpKeyring(
  JSON.stringify({ k1: Buffer.alloc(32, 1).toString('base64') }),
  'k1',
);
const ENROLLED_AT = new Date('2026-10-03T12:00:00.000Z');
let enrollmentSerial = 0;

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

/** Enroll a factor through the slice 1 store, moving the subject up one version. */
function activateFactor(
  subjectId: string,
  { username = TEST_USER, providerId = 'basic.default' } = {},
): void {
  enrollmentSerial += 1;
  const enrollmentId = `enrollment-${enrollmentSerial}`;
  const factorId = `factor-${enrollmentSerial}`;
  const seed = generateTotpSeed();
  const iso = ENROLLED_AT.toISOString();
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
      ...encryptTotpSeed(seed, bindingFor(subjectId, enrollmentId), keyring),
      createdAt: iso,
      expiresAt: new Date(ENROLLED_AT.getTime() + 600_000).toISOString(),
    },
    ENROLLED_AT,
  );
  totpStore.activateEnrollment({
    enrollmentId,
    acceptedCounter: totpCounterAt(ENROLLED_AT.getTime()) - 1,
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
      createdAt: iso,
      activatedAt: iso,
    },
    recoveryCodeDigests: [],
    now: ENROLLED_AT,
  });
}

/**
 * Enroll for real. Version 1 leaves an active factor; version 2 is the same
 * subject after the factor was removed (no factor row, version still moving).
 */
function enrollSubject(
  subjectId: string,
  version: 1 | 2 = 1,
  who?: { username?: string; providerId?: string },
): void {
  activateFactor(subjectId, who);
  if (version === 2) {
    totpStore.removeFactor({ subjectId, expectedFactorVersion: 1 });
  }
}

async function start(): Promise<Harness> {
  const db = createMigratedMemoryDatabase();
  sessionModel.createCollections(db);
  totpStore.createCollections(db);
  const store = new SessionStore({ ttlMs: 60_000 });

  const basic = new Basic();
  await basic.register('authentication', 'basic', 'default', {
    user: TEST_USER,
    hash: createArgon2Hash(TEST_PASSWORD),
  });
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
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
    }),
  );
  app.get('/protected', requireAuthentication, (req: Request, res: ExpressResponse) => {
    res.status(200).json({ user: { username: (req as AuthRequest).principal?.username } });
  });
  app.post('/login', (req: Request, res: ExpressResponse) => {
    void authenticateRequest(req as AuthRequest).then((principal) => {
      if (principal === undefined) {
        res.status(401).end();
        return;
      }
      req.session.regenerate(() => {
        writeSessionPrincipal(req as AuthRequest, principal);
        res.status(200).json({ user: { username: principal.username } });
      });
    });
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

function url(h: Harness, path: string): string {
  return `http://127.0.0.1:${h.port}${path}`;
}

async function login(h: Harness): Promise<string> {
  const response = await fetch(url(h, '/login'), {
    method: 'POST',
    headers: { ...HTTPS_HEADERS, Authorization: BASIC_AUTH_HEADER },
  });
  expect(response.status).toBe(200);
  return cookieOf(response);
}

/**
 * Plant an arbitrary stored user the way a session from another release (legacy)
 * or another provider (OIDC) would already be sitting in the store: write the
 * row through the store itself, then sign the cookie the way express-session does.
 */
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

/**
 * A password-assurance session at an already-enrolled version. A Basic login can
 * no longer mint one (it gets a challenge instead), so one is planted the way a
 * session from before the factor existed would be.
 */
function plantPasswordSession(h: Harness, factorVersion: number): Promise<string> {
  return plant(
    h,
    JSON.stringify({
      v: 2,
      kind: 'local',
      username: TEST_USER,
      subjectId: SUBJECT_ID,
      providerId: 'basic.default',
      assurance: 'password',
      factorVersion,
    }),
  );
}

async function protectedStatus(h: Harness, cookie: string): Promise<number> {
  const response = await fetch(url(h, '/protected'), {
    headers: { ...HTTPS_HEADERS, Cookie: cookie },
  });
  return response.status;
}

function upgradeOutcome(h: Harness, cookie: string): Promise<'open' | 'refused'> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${h.port}/ws`, {
      headers: { ...HTTPS_HEADERS, Cookie: cookie },
    });
    socket.on('open', () => resolve('open'));
    socket.on('unexpected-response', () => resolve('refused'));
    socket.on('error', () => resolve('refused'));
  });
}

describe('TOTP slice 2: v2 sessions and the shared validator', () => {
  const harnesses: Harness[] = [];

  async function boot(): Promise<Harness> {
    const h = await start();
    harnesses.push(h);
    return h;
  }

  afterEach(async () => {
    for (const h of harnesses.splice(0)) {
      h.wsServer.close();
      await new Promise<void>((resolve) => h.server.close(() => resolve()));
      h.store.stop();
    }
    clearAuthenticators();
  });

  describe('with no TOTP rows (behavior-preserving)', () => {
    test('a Basic login persists a v2 local session at version 0 and it is reused over HTTP and the upgrade', async () => {
      const h = await boot();
      const cookie = await login(h);

      const [stored] = storedUsers(h.db);
      const { issuedAt, ...stable } = JSON.parse(stored);
      expect(Math.abs(Date.now() - issuedAt)).toBeLessThan(60_000);
      expect(stable).toEqual({
        v: 2,
        kind: 'local',
        username: TEST_USER,
        subjectId: SUBJECT_ID,
        providerId: 'basic.default',
        assurance: 'password',
        factorVersion: 0,
      });
      expect(await protectedStatus(h, cookie)).toBe(200);
      await expect(upgradeOutcome(h, cookie)).resolves.toBe('open');
    });

    test('a legacy session written before the upgrade keeps working and stays legacy', async () => {
      const h = await boot();
      const legacy = JSON.stringify({ username: TEST_USER });
      const cookie = await plant(h, legacy);

      expect(await protectedStatus(h, cookie)).toBe(200);
      expect(await protectedStatus(h, cookie)).toBe(200);
      await expect(upgradeOutcome(h, cookie)).resolves.toBe('open');
      expect(storedUsers(h.db)).toEqual([legacy]);
    });

    test('a legacy session for a username no local provider owns keeps working', async () => {
      const h = await boot();
      const cookie = await plant(h, JSON.stringify({ username: 'someone@example.com' }));

      expect(await protectedStatus(h, cookie)).toBe(200);
      await expect(upgradeOutcome(h, cookie)).resolves.toBe('open');
    });

    test('a v2 OIDC session works over HTTP and the upgrade', async () => {
      const h = await boot();
      const cookie = await plant(h, '{"v":2,"kind":"oidc","username":"someone@example.com"}');

      expect(await protectedStatus(h, cookie)).toBe(200);
      await expect(upgradeOutcome(h, cookie)).resolves.toBe('open');
    });

    test('a malformed stored user is refused on HTTP and the upgrade as absent', async () => {
      const h = await boot();
      const cookie = await plant(h, '{"username":"x","extra":true}');

      expect(await protectedStatus(h, cookie)).toBe(401);
      await expect(upgradeOutcome(h, cookie)).resolves.toBe('refused');
    });
  });

  describe('once the subject has a factor version', () => {
    test('a v2 session minted at the old version is refused everywhere and dropped from the store', async () => {
      const h = await boot();
      const cookie = await login(h);
      enrollSubject(SUBJECT_ID, 1);

      await expect(upgradeOutcome(h, cookie)).resolves.toBe('refused');
      expect(await protectedStatus(h, cookie)).toBe(401);
      expect(storedUsers(h.db)).toEqual([undefined]);
    });

    test('a legacy session for that username is refused and cannot come back after removal', async () => {
      const h = await boot();
      const cookie = await plant(h, JSON.stringify({ username: TEST_USER }));
      enrollSubject(SUBJECT_ID, 1);

      await expect(upgradeOutcome(h, cookie)).resolves.toBe('refused');
      expect(await protectedStatus(h, cookie)).toBe(401);

      // Removal bumps the version; it never returns to 0, so nothing resurrects.
      totpStore.removeFactor({ subjectId: SUBJECT_ID, expectedFactorVersion: 1 });
      const another = await plant(h, JSON.stringify({ username: TEST_USER }));
      expect(await protectedStatus(h, another)).toBe(401);
      await expect(upgradeOutcome(h, another)).resolves.toBe('refused');
    });

    test('a fresh Basic login after the factor was removed carries the new version and works', async () => {
      const h = await boot();
      enrollSubject(SUBJECT_ID, 2);
      const cookie = await login(h);

      expect(storedUsers(h.db)[0]).toContain('"factorVersion":2');
      expect(await protectedStatus(h, cookie)).toBe(200);
      await expect(upgradeOutcome(h, cookie)).resolves.toBe('open');
    });

    test('a password session minted while a factor is active is stale at once', async () => {
      const h = await boot();
      enrollSubject(SUBJECT_ID, 1);
      const cookie = await plantPasswordSession(h, 1);

      expect(storedUsers(h.db)[0]).toContain('"factorVersion":1');
      expect(await protectedStatus(h, cookie)).toBe(401);
      await expect(upgradeOutcome(h, cookie)).resolves.toBe('refused');
      expect(storedUsers(h.db)).toEqual([undefined]);
    });

    test('a corrupt factor row refuses the session without destroying it', async () => {
      const h = await boot();
      enrollSubject(SUBJECT_ID, 1);
      const cookie = await plantPasswordSession(h, 1);
      h.db.exec('PRAGMA ignore_check_constraints = ON');
      h.db.exec('UPDATE totp_factors SET period_seconds = 31');
      h.db.exec('PRAGMA ignore_check_constraints = OFF');

      expect(await protectedStatus(h, cookie)).toBe(401);
      expect(storedUsers(h.db)).toHaveLength(1);
      expect(storedUsers(h.db)[0]).toContain('"kind":"local"');
    });

    test('a legacy session stays stale when the Basic provider was renamed', async () => {
      const h = await boot();
      const cookie = await plant(h, JSON.stringify({ username: TEST_USER }));
      enrollSubject(deriveSubjectId('basic.original', TEST_USER), 1, {
        providerId: 'basic.original',
      });

      expect(await protectedStatus(h, cookie)).toBe(401);
      await expect(upgradeOutcome(h, cookie)).resolves.toBe('refused');
    });

    test('a legacy session stays stale with no Basic provider registered (failed registration or shutdown)', async () => {
      const h = await boot();
      const cookie = await plant(h, JSON.stringify({ username: TEST_USER }));
      enrollSubject(SUBJECT_ID, 1);
      clearAuthenticators();
      registerAuthenticator(sessionAuthenticator);

      expect(await protectedStatus(h, cookie)).toBe(401);
      await expect(upgradeOutcome(h, cookie)).resolves.toBe('refused');
    });

    test('a legacy session stays stale for a subject row of unknown username', async () => {
      const h = await boot();
      const cookie = await plant(h, JSON.stringify({ username: TEST_USER }));
      h.db
        .prepare('INSERT INTO totp_subject_versions (subject_id, factor_version) VALUES (?, 1)')
        .run('unknown-owner');

      expect(await protectedStatus(h, cookie)).toBe(401);
    });

    test('an OIDC session sharing the username is unaffected', async () => {
      const h = await boot();
      const cookie = await plant(h, JSON.stringify({ v: 2, kind: 'oidc', username: TEST_USER }));
      enrollSubject(SUBJECT_ID, 1);

      expect(await protectedStatus(h, cookie)).toBe(200);
      await expect(upgradeOutcome(h, cookie)).resolves.toBe('open');
    });

    test('a session for a different subject is unaffected', async () => {
      const h = await boot();
      const cookie = await plant(h, JSON.stringify({ username: 'someone@example.com' }));
      enrollSubject(SUBJECT_ID, 1);

      expect(await protectedStatus(h, cookie)).toBe(200);
    });
  });

  describe('the stream re-check asks the same question of the same rows', () => {
    test('sessions HTTP still lets in keep their streams, whatever kind they are', async () => {
      const h = await boot();
      const local = await login(h);
      const legacy = await plant(h, JSON.stringify({ username: 'someone-else' }));
      const oidc = await plant(h, JSON.stringify({ v: 2, kind: 'oidc', username: TEST_USER }));

      expect(recheckStreamsOf(local, legacy, oidc)).toEqual([]);
    });

    test('a session the factor version left behind loses its streams, and no other', async () => {
      const h = await boot();
      const local = await login(h);
      const oidc = await plant(h, JSON.stringify({ v: 2, kind: 'oidc', username: TEST_USER }));
      enrollSubject(SUBJECT_ID, 1);

      expect(recheckStreamsOf(local, oidc)).toEqual([sidOf(local)]);
      expect(await protectedStatus(h, oidc)).toBe(200);
    });

    test('a session whose row was deleted behind the store loses its streams', async () => {
      const h = await boot();
      const gone = await login(h);
      const kept = await login(h);
      sessionModel.destroySession(sidOf(gone));

      expect(recheckStreamsOf(gone, kept)).toEqual([sidOf(gone)]);
      expect(await protectedStatus(h, kept)).toBe(200);
    });

    test('a session whose row has run out loses its streams before any sweep', async () => {
      const h = await boot();
      const cookie = await login(h);
      sessionModel.touchSession(sidOf(cookie), Date.now() - 1);

      expect(recheckStreamsOf(cookie)).toEqual([sidOf(cookie)]);
    });

    test('a session that was signed out in place loses its streams', async () => {
      const h = await boot();
      const cookie = await login(h);
      const row = sessionModel.getSession(sidOf(cookie));
      const { passport: _passport, ...signedOut } = JSON.parse(String(row?.data));
      sessionModel.setSession(sidOf(cookie), Date.now() + 60_000, JSON.stringify(signedOut));

      expect(recheckStreamsOf(cookie)).toEqual([sidOf(cookie)]);
      expect(await protectedStatus(h, cookie)).toBe(401);
    });
  });

  test('a store that cannot answer refuses a local session without destroying it', async () => {
    const h = await boot();
    const cookie = await login(h);
    h.db.exec('ALTER TABLE totp_subject_versions RENAME TO totp_subject_versions_away');

    expect(await protectedStatus(h, cookie)).toBe(401);
    expect(storedUsers(h.db)).toHaveLength(1);
    expect(storedUsers(h.db)[0]).toContain('"kind":"local"');

    h.db.exec('ALTER TABLE totp_subject_versions_away RENAME TO totp_subject_versions');
    expect(await protectedStatus(h, cookie)).toBe(200);
  });
});
