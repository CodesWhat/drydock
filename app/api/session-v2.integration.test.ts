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
import { argon2Sync, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import express, { type Application, type Response as ExpressResponse, type Request } from 'express';
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
import { clearLocalSubjects, deriveSubjectId } from './totp-identity.js';
import { applySessionMiddleware, isAuthenticatedSession } from './ws-upgrade-utils.js';

const TEST_USER = 'wud-card';
const TEST_PASSWORD = 'correct-horse-battery-staple';
const BASIC_AUTH_HEADER = `Basic ${Buffer.from(`${TEST_USER}:${TEST_PASSWORD}`).toString('base64')}`;
const HTTPS_HEADERS = { 'X-Forwarded-Proto': 'https' };
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

function storedUsers(db: Database): unknown[] {
  return db
    .prepare('SELECT data FROM sessions')
    .all()
    .map((row) => (JSON.parse(String(row.data)).passport ?? {}).user);
}

/** Pretend a factor was enrolled for the subject: only the version row matters here. */
function enrollSubject(db: Database, subjectId: string, version = 1): void {
  db.prepare(
    `INSERT INTO totp_subject_versions (subject_id, factor_version) VALUES (?, ?)
     ON CONFLICT(subject_id) DO UPDATE SET factor_version = excluded.factor_version`,
  ).run(subjectId, version);
}

async function start(): Promise<Harness> {
  const db = createMigratedMemoryDatabase();
  sessionModel.createCollections(db);
  totpStore.createCollections(db);
  const store = new SessionStore({ ttlMs: 60_000 });

  clearLocalSubjects();
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
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    store,
    cookie: { httpOnly: true, secure: true },
  });

  const app: Application = express();
  app.set('trust proxy', 1);
  app.use(sessionMiddleware);
  app.use(restoreSessionPrincipal);
  app.get('/protected', requireAuthentication, (req: Request, res: ExpressResponse) => {
    res.status(200).json({ user: { username: (req as AuthRequest).principal?.username } });
  });
  // Plant an arbitrary stored user, the way a session from another release
  // (legacy) or another provider (OIDC) would already be sitting in the store.
  app.post('/plant', (req: Request, res: ExpressResponse) => {
    (req.session as unknown as Record<string, unknown>).passport = { user: req.query.user };
    res.status(204).end();
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

async function plant(h: Harness, user: string): Promise<string> {
  const response = await fetch(url(h, `/plant?user=${encodeURIComponent(user)}`), {
    method: 'POST',
    headers: HTTPS_HEADERS,
  });
  expect(response.status).toBe(204);
  return cookieOf(response);
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
    clearLocalSubjects();
  });

  describe('with no TOTP rows (behavior-preserving)', () => {
    test('a Basic login persists a v2 local session at version 0 and it is reused over HTTP and the upgrade', async () => {
      const h = await boot();
      const cookie = await login(h);

      expect(storedUsers(h.db)).toEqual([
        JSON.stringify({
          v: 2,
          kind: 'local',
          username: TEST_USER,
          subjectId: SUBJECT_ID,
          providerId: 'basic.default',
          assurance: 'password',
          factorVersion: 0,
        }),
      ]);
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
      enrollSubject(h.db, SUBJECT_ID, 1);

      await expect(upgradeOutcome(h, cookie)).resolves.toBe('refused');
      expect(await protectedStatus(h, cookie)).toBe(401);
      expect(storedUsers(h.db)).toEqual([undefined]);
    });

    test('a legacy session for that username is refused and cannot come back after removal', async () => {
      const h = await boot();
      const cookie = await plant(h, JSON.stringify({ username: TEST_USER }));
      enrollSubject(h.db, SUBJECT_ID, 1);

      await expect(upgradeOutcome(h, cookie)).resolves.toBe('refused');
      expect(await protectedStatus(h, cookie)).toBe(401);

      // Removal bumps the version; it never returns to 0, so nothing resurrects.
      enrollSubject(h.db, SUBJECT_ID, 2);
      const another = await plant(h, JSON.stringify({ username: TEST_USER }));
      expect(await protectedStatus(h, another)).toBe(401);
      await expect(upgradeOutcome(h, another)).resolves.toBe('refused');
    });

    test('a fresh Basic login after enrollment carries the new version and works', async () => {
      const h = await boot();
      enrollSubject(h.db, SUBJECT_ID, 3);
      const cookie = await login(h);

      expect(storedUsers(h.db)[0]).toContain('"factorVersion":3');
      expect(await protectedStatus(h, cookie)).toBe(200);
      await expect(upgradeOutcome(h, cookie)).resolves.toBe('open');
    });

    test('an OIDC session sharing the username is unaffected', async () => {
      const h = await boot();
      const cookie = await plant(h, JSON.stringify({ v: 2, kind: 'oidc', username: TEST_USER }));
      enrollSubject(h.db, SUBJECT_ID, 1);

      expect(await protectedStatus(h, cookie)).toBe(200);
      await expect(upgradeOutcome(h, cookie)).resolves.toBe('open');
    });

    test('a session for a different subject is unaffected', async () => {
      const h = await boot();
      const cookie = await plant(h, JSON.stringify({ username: 'someone@example.com' }));
      enrollSubject(h.db, SUBJECT_ID, 1);

      expect(await protectedStatus(h, cookie)).toBe(200);
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
