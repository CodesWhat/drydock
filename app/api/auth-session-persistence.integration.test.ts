/**
 * Integration test for SR-6: header-authenticated (Authorization: Basic)
 * requests must never persist a session row, while a cookie login still
 * does. Uses the real express-session + connect-loki store, the real
 * passport singleton, and the real drydock BasicStrategy — only the
 * strategy-id lookup (`auth-strategies.getAllIds`) is stubbed, since wiring
 * the full env-var-driven registry is unrelated to the behavior under test.
 */
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import ConnectLoki from 'connect-loki';
import express, { type Application } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import passport from 'passport';
import { afterEach, describe, expect, test, vi } from 'vitest';
import BasicStrategy from '../authentications/providers/basic/BasicStrategy.js';

vi.mock('./auth-strategies.js', async () => {
  const actual =
    await vi.importActual<typeof import('./auth-strategies.js')>('./auth-strategies.js');
  return {
    ...actual,
    getAllIds: () => ['basic'],
  };
});

const { requireAuthentication } = await import('./auth.js');

const LokiStore = ConnectLoki(session);
const TEST_USER = 'wud-card';
const TEST_PASSWORD = 'correct-horse-battery-staple';
const BASIC_AUTH_HEADER = `Basic ${Buffer.from(`${TEST_USER}:${TEST_PASSWORD}`).toString('base64')}`;

type LokiSessionStore = InstanceType<typeof LokiStore>;

interface RunningServer {
  server: http.Server;
  port: number;
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

function createTestApp(store: LokiSessionStore): Application {
  passport.use(
    'basic',
    new BasicStrategy((username: string, password: string, done) => {
      if (username === TEST_USER && password === TEST_PASSWORD) {
        done(null, { username });
        return;
      }
      done(null, false);
    }),
  );
  passport.serializeUser((user: unknown, done) => done(null, JSON.stringify(user)));
  passport.deserializeUser((raw: unknown, done) => {
    try {
      done(null, JSON.parse(raw as string));
    } catch (error: unknown) {
      done(error);
    }
  });

  const app = express();
  // Mirror the production middleware stack: the real app terminates TLS behind
  // a proxy, so the session cookie is secure and every authorizing route sits
  // behind a limiter. Requests below send `X-Forwarded-Proto: https` so
  // `req.secure` is true and the cookie is issued over the loopback listener.
  app.set('trust proxy', 1);
  app.use(
    session({
      name: 'dd.sid.test',
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      store,
      cookie: { httpOnly: true, secure: true, sameSite: 'lax' },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false, xForwardedForHeader: false },
  });

  app.get('/protected', limiter, requireAuthentication, (req, res) => {
    res.status(200).json({ user: req.user });
  });

  app.post('/login', limiter, (req, res, next) => {
    passport.authenticate('basic', { session: false }, (error: unknown, user: unknown) => {
      if (error || !user) {
        res.status(401).json({ error: 'invalid credentials' });
        return;
      }
      req.login(user as Express.User, (loginError: unknown) => {
        if (loginError) {
          res.status(500).json({ error: 'login failed' });
          return;
        }
        res.status(200).json({ user });
      });
    })(req, res, next);
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

function extractCookie(response: Response): string | undefined {
  const setCookie = response.headers.get('set-cookie');
  return setCookie?.split(';')[0];
}

describe('SR-6: header-authenticated requests do not persist sessions', () => {
  const openServers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(openServers.splice(0).map((server) => closeServer(server)));
    vi.restoreAllMocks();
  });

  test('repeated Authorization: Basic requests to a protected route leave the session store empty', async () => {
    const store = createStore();
    await waitForStoreReady(store);
    const app = createTestApp(store);
    const { server, port } = await startServer(app);
    openServers.push(server);

    for (let i = 0; i < 3; i += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/protected`, {
        headers: { Authorization: BASIC_AUTH_HEADER, 'X-Forwarded-Proto': 'https' },
      });
      expect(response.status).toBe(200);
    }

    await expect(storeLength(store)).resolves.toBe(0);
  });

  test('a cookie login persists exactly one session that later header-less requests reuse', async () => {
    const store = createStore();
    await waitForStoreReady(store);
    const app = createTestApp(store);
    const { server, port } = await startServer(app);
    openServers.push(server);

    const loginResponse = await fetch(`http://127.0.0.1:${port}/login`, {
      method: 'POST',
      headers: { Authorization: BASIC_AUTH_HEADER, 'X-Forwarded-Proto': 'https' },
    });
    expect(loginResponse.status).toBe(200);
    const cookie = extractCookie(loginResponse);
    expect(cookie).toBeDefined();

    await expect(storeLength(store)).resolves.toBe(1);

    const protectedResponse = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: { Cookie: cookie as string, 'X-Forwarded-Proto': 'https' },
    });
    expect(protectedResponse.status).toBe(200);

    await expect(storeLength(store)).resolves.toBe(1);
  });
});
