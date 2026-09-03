/**
 * Integration test for DR-7: a request that authenticates from a header must
 * never persist a session row, while a cookie login still does.
 *
 * Under passport this was a conditional at the call site — `passport.authenticate(ids,
 * { session: !headerAuth })` — and getting it wrong minted a 30-day session for
 * every Basic-authenticated API call. The authenticator chain makes it
 * structural instead: Basic declares `persistsSession: false`, and the chain has
 * no path that writes a session for an authenticator that declares it. This test
 * holds that guarantee against the real express-session + connect-loki store,
 * the real Basic provider with a real argon2id hash, and the real
 * `requireAuthentication`.
 */
import { argon2Sync, randomBytes } from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import ConnectLoki from 'connect-loki';
import express, { type Application, type Response as ExpressResponse, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import Basic from '../authentications/providers/basic/Basic.js';
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

const LokiStore = ConnectLoki(session);
const TEST_USER = 'wud-card';
const TEST_PASSWORD = 'correct-horse-battery-staple';
const BASIC_AUTH_HEADER = `Basic ${Buffer.from(`${TEST_USER}:${TEST_PASSWORD}`).toString('base64')}`;
const HTTPS_HEADERS = { 'X-Forwarded-Proto': 'https' };

type LokiSessionStore = InstanceType<typeof LokiStore>;

interface RunningServer {
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

function createStore(): LokiSessionStore {
  return new LokiStore({
    path: path.join(os.tmpdir(), `drydock-auth-session-test-${randomBytes(8).toString('hex')}.db`),
    autosave: false,
    ttl: 60,
  });
}

function waitForStoreReady(store: LokiSessionStore): Promise<void> {
  return new Promise((resolve) => {
    store.once('connect', resolve);
  });
}

function storeLength(store: LokiSessionStore): Promise<number> {
  return new Promise((resolve, reject) => {
    store.length((error: unknown, count?: number) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(count ?? 0);
    });
  });
}

async function createTestApp(store: LokiSessionStore): Promise<Application> {
  const basic = new Basic();
  await basic.register('authentication', 'basic', 'default', {
    user: TEST_USER,
    hash: createArgon2Hash(TEST_PASSWORD),
  });

  clearAuthenticators();
  registerAuthenticator({
    id: 'header-test',
    persistsSession: false,
    authenticate: (req: AuthRequest) =>
      Promise.resolve(
        req.headers?.authorization === 'Bearer header'
          ? { kind: 'basic', username: 'header-user' }
          : undefined,
      ),
  });
  registerAuthenticator(basic.getAuthenticator());
  registerAuthenticator(sessionAuthenticator);

  const app = express();
  app.set('trust proxy', 1);
  app.use(
    session({
      name: 'dd.sid.test',
      secret: 'test-secret',
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
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
    }),
  );

  app.get('/protected', requireAuthentication, (req: Request, res: ExpressResponse) => {
    res.status(200).json({ user: { username: (req as AuthRequest).principal?.username } });
  });

  // The shape of auth.ts's login route: authenticate, regenerate, then write the
  // identity into the session. This is the only path that is allowed to create one.
  app.post('/login', (req: Request, res: ExpressResponse) => {
    void authenticateRequest(req as AuthRequest).then((principal) => {
      if (principal === undefined) {
        res.status(401).json({ error: 'invalid credentials' });
        return;
      }
      req.session.regenerate((regenerateError: unknown) => {
        if (regenerateError) {
          res.status(500).json({ error: 'login failed' });
          return;
        }
        writeSessionPrincipal(req as AuthRequest, principal);
        res.status(200).json({ user: { username: principal.username } });
      });
    });
  });

  return app;
}

function startServer(app: Application): Promise<RunningServer> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// The argument is a fetch Response, not express's. They are unrelated types and
// only fetch's carries a Headers object, so annotating it with the express one
// would be wrong about the only property this reads.
function extractCookie(response: Awaited<ReturnType<typeof fetch>>): string | undefined {
  const setCookie = response.headers.get('set-cookie');
  return setCookie?.split(';')[0];
}

describe('DR-7: header-authenticated requests do not persist sessions', () => {
  const openServers: http.Server[] = [];

  beforeEach(() => {
    clearAuthenticators();
  });

  afterEach(async () => {
    await Promise.all(openServers.splice(0).map((server) => closeServer(server)));
    clearAuthenticators();
  });

  test('repeated Authorization: Basic requests to a protected route leave the session store empty', async () => {
    const store = createStore();
    await waitForStoreReady(store);
    const app = await createTestApp(store);
    const { server, port } = await startServer(app);
    openServers.push(server);

    for (let i = 0; i < 3; i += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/protected`, {
        headers: { ...HTTPS_HEADERS, Authorization: BASIC_AUTH_HEADER },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toBeNull();
    }

    await expect(storeLength(store)).resolves.toBe(0);
  });

  test('a cookie login persists exactly one session that later header-less requests reuse', async () => {
    const store = createStore();
    await waitForStoreReady(store);
    const app = await createTestApp(store);
    const { server, port } = await startServer(app);
    openServers.push(server);

    const loginResponse = await fetch(`http://127.0.0.1:${port}/login`, {
      method: 'POST',
      headers: { ...HTTPS_HEADERS, Authorization: BASIC_AUTH_HEADER },
    });
    expect(loginResponse.status).toBe(200);
    const cookie = extractCookie(loginResponse);
    expect(cookie).toBeDefined();

    await expect(storeLength(store)).resolves.toBe(1);

    const protectedResponse = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: { ...HTTPS_HEADERS, Cookie: cookie as string },
    });
    expect(protectedResponse.status).toBe(200);
    await expect(protectedResponse.json()).resolves.toEqual({ user: { username: TEST_USER } });

    await expect(storeLength(store)).resolves.toBe(1);
  });

  test('a higher-priority header identity wins over an eagerly restored cookie identity', async () => {
    const store = createStore();
    await waitForStoreReady(store);
    const app = await createTestApp(store);
    const { server, port } = await startServer(app);
    openServers.push(server);

    const loginResponse = await fetch(`http://127.0.0.1:${port}/login`, {
      method: 'POST',
      headers: { ...HTTPS_HEADERS, Authorization: BASIC_AUTH_HEADER },
    });
    const cookie = extractCookie(loginResponse);
    expect(cookie).toBeDefined();

    const response = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: {
        ...HTTPS_HEADERS,
        Cookie: cookie as string,
        Authorization: 'Bearer header',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ user: { username: 'header-user' } });
    await expect(storeLength(store)).resolves.toBe(1);
  });

  test('an invalid header does not displace a valid cookie session', async () => {
    const store = createStore();
    await waitForStoreReady(store);
    const app = await createTestApp(store);
    const { server, port } = await startServer(app);
    openServers.push(server);

    const loginResponse = await fetch(`http://127.0.0.1:${port}/login`, {
      method: 'POST',
      headers: { ...HTTPS_HEADERS, Authorization: BASIC_AUTH_HEADER },
    });
    const cookie = extractCookie(loginResponse);

    const response = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: {
        ...HTTPS_HEADERS,
        Cookie: cookie as string,
        Authorization: 'Bearer unrelated',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ user: { username: TEST_USER } });
  });

  test('a wrong password is rejected with a bare 401 and still writes nothing', async () => {
    const store = createStore();
    await waitForStoreReady(store);
    const app = await createTestApp(store);
    const { server, port } = await startServer(app);
    openServers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: {
        ...HTTPS_HEADERS,
        Authorization: `Basic ${Buffer.from(`${TEST_USER}:wrong`).toString('base64')}`,
      },
    });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe('Unauthorized');
    await expect(storeLength(store)).resolves.toBe(0);
  });

  test('a syntactically broken Authorization header is rejected with 400, as passport-http was', async () => {
    const store = createStore();
    await waitForStoreReady(store);
    const app = await createTestApp(store);
    const { server, port } = await startServer(app);
    openServers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: { ...HTTPS_HEADERS, Authorization: 'Basic' },
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe('Bad Request');
    await expect(storeLength(store)).resolves.toBe(0);
  });
});
