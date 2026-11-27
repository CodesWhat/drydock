/**
 * Integration test for Basic-user roles (`DD_AUTH_BASIC_<name>_ROLE`).
 *
 * Everything below the HTTP boundary is real: express-session over a real
 * SQLite-backed SessionStore, real Basic providers with real argon2id hashes,
 * the real authenticator chain and `requireAuthentication`, and routes
 * declared with the real `scoped()` at the scopes and floors the real routers
 * use. Both ways a Basic user reaches the API are driven: a header on every
 * request, and a session minted from one.
 */
import { argon2Sync, randomBytes } from 'node:crypto';
import http from 'node:http';
import express, { type Application, type Response as ExpressResponse, type Request } from 'express';
import session from 'express-session';

const { mockGetState } = vi.hoisted(() => ({ mockGetState: vi.fn() }));

vi.mock('./audit-events.js', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() })),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../registry/index.js', () => ({
  getState: mockGetState,
  getAuthenticationRegistrationErrors: vi.fn(() => []),
}));

import Basic from '../authentications/providers/basic/Basic.js';
import * as sessionModel from '../store/session.js';
import * as totpStore from '../store/totp.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import { requireAuthentication } from './auth.js';
import { registerAuthenticators } from './auth-strategies.js';
import type { AuthRequest } from './auth-types.js';
import { authenticateRequest } from './authenticator-chain.js';
import { ROLE_DENIED_MESSAGE, SESSION_ONLY, scoped } from './route-scopes.js';
import { restoreSessionPrincipal, writeSessionPrincipal } from './session-principal.js';
import { SessionStore } from './session-store.js';

const PASSWORD = 'correct-horse-battery-staple';

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

const HASH = createArgon2Hash(PASSWORD);

async function createBasic(name: string, role?: string): Promise<Basic> {
  const basic = new Basic();
  await basic.register('authentication', 'basic', name, {
    user: name,
    hash: HASH,
    ...(role === undefined ? {} : { role }),
  });
  return basic;
}

function basicHeader(username: string): string {
  return `Basic ${Buffer.from(`${username}:${PASSWORD}`).toString('base64')}`;
}

function ok(req: Request, res: ExpressResponse): void {
  res.status(200).json({ username: (req as AuthRequest).principal?.username });
}

function createTestApp(store: SessionStore): Application {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      name: 'dd.sid.test',
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      store,
    }),
  );
  app.use(restoreSessionPrincipal);
  app.post('/login', (req: Request, res: ExpressResponse) => {
    void authenticateRequest(req as AuthRequest).then((outcome) => {
      if (outcome === undefined || 'rejected' in outcome) {
        res.status(401).json({ error: 'invalid credentials' });
        return;
      }
      req.session.regenerate(() => {
        writeSessionPrincipal(req as AuthRequest, outcome);
        res.status(200).json({ username: outcome.username });
      });
    });
  });
  app.use(requireAuthentication);
  // The scopes and floors the real routers declare for these routes.
  app.get('/containers', scoped('read', ok));
  app.post('/containers/:id/update', scoped('containers:update', ok));
  app.post('/containers/:id/restart', scoped('containers:control', ok));
  app.patch('/settings', scoped('admin', ok));
  app.patch('/preferences', scoped('admin', ok, { role: 'viewer' }));
  app.get('/config', scoped(SESSION_ONLY, ok, { role: 'admin' }));
  return app;
}

describe('Basic-user roles through the real stack', () => {
  let server: http.Server;
  let baseUrl: string;
  let users: Record<string, Basic>;

  function useChain(basics: Basic[]): void {
    mockGetState.mockReturnValue({
      authentication: Object.fromEntries(basics.map((basic) => [basic.getId(), basic])),
    });
    registerAuthenticators({} as Application);
  }

  function call(method: string, path: string, headers: Record<string, string>) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: method === 'GET' ? undefined : '{}',
    });
  }

  async function loginCookie(username: string): Promise<string> {
    const response = await call('POST', '/login', { authorization: basicHeader(username) });
    expect(response.status).toBe(200);
    return response.headers.get('set-cookie')?.split(';')[0] ?? '';
  }

  beforeAll(async () => {
    const db = createMigratedMemoryDatabase();
    sessionModel.createCollections(db);
    totpStore.createCollections(db);
    const store = new SessionStore({ ttlMs: 60_000 });
    users = {
      viewer: await createBasic('vera', 'viewer'),
      operator: await createBasic('otto', 'Operator'),
      unset: await createBasic('ada'),
      admin: await createBasic('root', 'admin'),
    };
    server = http.createServer(createTestApp(store));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  beforeEach(() => {
    useChain([users.viewer, users.operator, users.unset]);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('a viewer reads but gets 403 on an update, with the role it needed', async () => {
    const headers = { authorization: basicHeader('vera') };

    expect((await call('GET', '/containers', headers)).status).toBe(200);
    const denied = await call('POST', '/containers/c1/update', headers);
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toStrictEqual({
      error: ROLE_DENIED_MESSAGE,
      details: { requiredScope: 'containers:update', requiredRole: 'operator' },
    });
  });

  test('a viewer can still save their own preferences', async () => {
    const headers = { authorization: basicHeader('vera') };
    expect((await call('PATCH', '/preferences', headers)).status).toBe(200);
  });

  test('an operator updates and restarts but cannot change settings or read config', async () => {
    const headers = { authorization: basicHeader('otto') };

    expect((await call('POST', '/containers/c1/update', headers)).status).toBe(200);
    expect((await call('POST', '/containers/c1/restart', headers)).status).toBe(200);
    expect((await call('PATCH', '/settings', headers)).status).toBe(403);
    expect((await call('GET', '/config', headers)).status).toBe(403);
  });

  test('a user with no role configured is admin, exactly as before', async () => {
    const headers = { authorization: basicHeader('ada') };

    expect((await call('PATCH', '/settings', headers)).status).toBe(200);
    expect((await call('GET', '/config', headers)).status).toBe(200);
  });

  test('a session minted by a viewer carries the viewer role', async () => {
    const cookie = await loginCookie('vera');

    expect((await call('GET', '/containers', { cookie })).status).toBe(200);
    expect((await call('POST', '/containers/c1/update', { cookie })).status).toBe(403);
  });

  test('a demotion applies to a live session on the next request', async () => {
    const cookie = await loginCookie('ada');
    expect((await call('PATCH', '/settings', { cookie })).status).toBe(200);

    // Same account, now configured as a viewer: the restart re-registers the chain.
    const demoted = await createBasic('ada', 'viewer');
    useChain([users.viewer, users.operator, users.admin, demoted]);

    expect((await call('PATCH', '/settings', { cookie })).status).toBe(403);
  });

  test('a session whose account was removed loses admin once roles are in use', async () => {
    const cookie = await loginCookie('ada');
    useChain([users.viewer, users.operator, users.admin]);

    expect((await call('GET', '/containers', { cookie })).status).toBe(200);
    expect((await call('PATCH', '/settings', { cookie })).status).toBe(403);
  });

  test('a configuration where nobody is admin fails fast, naming the fix', () => {
    expect(() => useChain([users.viewer, users.unset])).not.toThrow();
    expect(() => useChain([users.viewer, users.operator])).toThrow(
      'No authentication grants the admin role, so nobody could manage this instance. Set DD_AUTH_BASIC_<name>_ROLE=admin',
    );
  });
});
