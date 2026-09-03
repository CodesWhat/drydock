/**
 * Integration test for API key authentication and scope enforcement.
 *
 * Everything below the HTTP boundary is real: the express-session +
 * connect-loki store, the real Basic provider with a real argon2id hash, the
 * real api-keys LokiJS collection with real SHA-256 digests, the real
 * authenticator chain, the real `requireAuthentication`, and routes declared
 * with the real `scoped()`.
 *
 * Three of the phase's Done-when points are proven here rather than in a unit
 * test, because each one is a claim about the whole stack:
 *   - key traffic persists no session (the DR-7 regression),
 *   - a key reaches exactly the routes its scopes declare, and
 *   - mounting the key authenticator leaves Basic and the session untouched.
 */
import { argon2Sync, randomBytes } from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import ConnectLoki from 'connect-loki';
import express, { type Application, type Response as ExpressResponse, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import Loki from 'lokijs';

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

import Basic from '../authentications/providers/basic/Basic.js';
import * as apiKeyStore from '../store/api-key.js';
import { apiKeyAuthenticator } from './api-key-auth.js';
import { requireAuthentication } from './auth.js';
import type { AuthRequest } from './auth-types.js';
import {
  authenticateRequest,
  clearAuthenticators,
  registerAuthenticator,
} from './authenticator-chain.js';
import { createOuterApiRateLimitKeyGenerator } from './outer-api-rate-limit-key.js';
import { DYNAMIC_SCOPE, enforceApiKeyScope, SESSION_ONLY, scoped } from './route-scopes.js';
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
const IDP_CREDENTIAL = 'idp-issued-access-credential';
const WEBHOOK_CREDENTIAL = 'webhook-issued-bearer-secret';

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
    path: path.join(os.tmpdir(), `drydock-api-key-test-${randomBytes(8).toString('hex')}.db`),
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

function ok(req: Request, res: ExpressResponse): void {
  res.status(200).json({ username: (req as AuthRequest).principal?.username });
}

async function createTestApp(store: LokiSessionStore): Promise<Application> {
  const basic = new Basic();
  await basic.register('authentication', 'basic', 'default', {
    user: TEST_USER,
    hash: createArgon2Hash(TEST_PASSWORD),
  });

  // Registration order is the contract: the key authenticator fronts the
  // chain, so a request carrying both a cookie and a key resolves as the key.
  clearAuthenticators();
  registerAuthenticator(apiKeyAuthenticator);
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

  app.post('/login', (req: Request, res: ExpressResponse) => {
    void authenticateRequest(req as AuthRequest).then((outcome) => {
      if (outcome === undefined || 'rejected' in outcome) {
        res.status(401).json({ error: 'invalid credentials' });
        return;
      }
      req.session.regenerate((regenerateError: unknown) => {
        if (regenerateError) {
          res.status(500).json({ error: 'login failed' });
          return;
        }
        writeSessionPrincipal(req as AuthRequest, outcome);
        res.status(200).json({ username: outcome.username });
      });
    });
  });

  // Mirrors the real mount order in api.ts: the webhook router carries its own
  // bearer scheme and is mounted ahead of `requireAuthentication`, so the
  // authenticator chain never sees a webhook credential and the API key
  // authenticator cannot consume, reject or rewrite one.
  app.post('/webhook/watch', (req: Request, res: ExpressResponse) => {
    if (req.headers.authorization !== `Bearer ${WEBHOOK_CREDENTIAL}`) {
      res.status(401).json({ error: 'invalid webhook credential' });
      return;
    }
    res.status(200).json({ username: 'webhook' });
  });

  app.use(requireAuthentication);

  // One route per declared scope, plus the two markers, mirroring how the real
  // routers register theirs.
  app.get('/read', scoped('read', ok));
  app.post('/watch', scoped('containers:watch', ok));
  app.post('/update', scoped('containers:update', ok));
  app.post('/notify', scoped('triggers:test', ok));
  app.patch('/settings', scoped('admin', ok));
  app.get('/api-keys', scoped('api-keys:manage', ok));
  app.get('/debug-dump', scoped(SESSION_ONLY, ok));
  app.post(
    '/containers/:id/triggers/:triggerType',
    scoped(DYNAMIC_SCOPE, (req: Request, res: ExpressResponse) => {
      const required = req.params.triggerType === 'docker' ? 'containers:update' : 'triggers:test';
      if (!enforceApiKeyScope(req, res, required)) {
        return;
      }
      ok(req, res);
    }),
  );

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

function extractCookie(response: Awaited<ReturnType<typeof fetch>>): string | undefined {
  return response.headers.get('set-cookie')?.split(';')[0];
}

function mintKey(name: string, scopes: string[]): string {
  return apiKeyStore.createApiKey({
    name,
    scopes,
    createdBy: { kind: 'user', username: 'scott' },
  }).apiKey;
}

describe('API key enforcement', () => {
  const openServers: http.Server[] = [];
  let sessionStore: LokiSessionStore;
  let port: number;

  beforeEach(async () => {
    clearAuthenticators();
    apiKeyStore.createCollections(new Loki('api-key-enforcement.test.db') as never);
    sessionStore = createStore();
    await waitForStoreReady(sessionStore);
    const app = await createTestApp(sessionStore);
    const running = await startServer(app);
    openServers.push(running.server);
    port = running.port;
  });

  afterEach(async () => {
    await Promise.all(openServers.splice(0).map((server) => closeServer(server)));
    clearAuthenticators();
  });

  function call(
    keyOrHeaders: string | Record<string, string>,
    routePath: string,
    method = 'GET',
  ): Promise<Awaited<ReturnType<typeof fetch>>> {
    const headers =
      typeof keyOrHeaders === 'string'
        ? { ...HTTPS_HEADERS, Authorization: `Bearer ${keyOrHeaders}` }
        : { ...HTTPS_HEADERS, ...keyOrHeaders };
    return fetch(`http://127.0.0.1:${port}${routePath}`, { method, headers });
  }

  describe('session-free proof (DR-7 regression, and the #469 use case)', () => {
    test('50 key-authenticated requests produce zero Set-Cookie and zero session rows', async () => {
      const key = mintKey('wud-card', ['read']);

      for (let attempt = 0; attempt < 50; attempt += 1) {
        const response = await call(key, '/read');
        expect(response.status).toBe(200);
        expect(response.headers.get('set-cookie')).toBeNull();
      }

      await expect(storeLength(sessionStore)).resolves.toBe(0);
    });

    test('a rejected key also writes nothing', async () => {
      const response = await call(`ddk_${'0'.repeat(12)}_${'A'.repeat(43)}`, '/read');

      expect(response.status).toBe(401);
      expect(response.headers.get('set-cookie')).toBeNull();
      await expect(storeLength(sessionStore)).resolves.toBe(0);
    });
  });

  describe('scope matrix', () => {
    test.each([
      ['/read', 'GET'],
      ['/watch', 'POST'],
      ['/update', 'POST'],
      ['/notify', 'POST'],
      ['/settings', 'PATCH'],
    ])('an admin key reaches %s', async (routePath, method) => {
      const response = await call(mintKey('ops', ['admin']), routePath, method);
      expect(response.status).toBe(200);
    });

    test.each([
      ['/watch', 'POST'],
      ['/update', 'POST'],
      ['/notify', 'POST'],
      ['/settings', 'PATCH'],
    ])('a read-only key gets 403 on the mutating route %s', async (routePath, method) => {
      const response = await call(mintKey('dashboard', ['read']), routePath, method);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: 'API key is missing the required scope',
      });
    });

    test('a read-only key still reaches the read route', async () => {
      await expect(call(mintKey('dashboard', ['read']), '/read')).resolves.toMatchObject({
        status: 200,
      });
    });

    test('a scoped key reaches only its own scope', async () => {
      const key = mintKey('updater', ['containers:update']);

      await expect(call(key, '/update', 'POST')).resolves.toMatchObject({ status: 200 });
      await expect(call(key, '/notify', 'POST')).resolves.toMatchObject({ status: 403 });
      await expect(call(key, '/read')).resolves.toMatchObject({ status: 403 });
    });
  });

  describe('deny list', () => {
    test('an admin key gets 403 on a session-only route', async () => {
      const response = await call(mintKey('ops', ['admin']), '/debug-dump');

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: 'This route is not reachable with an API key',
      });
    });

    test('an admin key gets 403 on key management, which admin never implies', async () => {
      await expect(call(mintKey('ops', ['admin']), '/api-keys')).resolves.toMatchObject({
        status: 403,
      });
    });

    test('a key holding api-keys:manage reaches key management', async () => {
      await expect(
        call(mintKey('bootstrap', ['api-keys:manage']), '/api-keys'),
      ).resolves.toMatchObject({ status: 200 });
    });

    test('a session reaches the same session-only route', async () => {
      const login = await fetch(`http://127.0.0.1:${port}/login`, {
        method: 'POST',
        headers: { ...HTTPS_HEADERS, Authorization: BASIC_AUTH_HEADER },
      });
      const cookie = extractCookie(login) as string;

      await expect(call({ Cookie: cookie }, '/debug-dump')).resolves.toMatchObject({ status: 200 });
    });
  });

  describe('the one route whose scope depends on a path parameter', () => {
    test('a docker trigger needs containers:update', async () => {
      await expect(
        call(mintKey('u', ['containers:update']), '/containers/abc/triggers/docker', 'POST'),
      ).resolves.toMatchObject({ status: 200 });
      await expect(
        call(mintKey('n', ['triggers:test']), '/containers/abc/triggers/docker', 'POST'),
      ).resolves.toMatchObject({ status: 403 });
    });

    test('a notification trigger needs triggers:test', async () => {
      await expect(
        call(mintKey('n', ['triggers:test']), '/containers/abc/triggers/slack', 'POST'),
      ).resolves.toMatchObject({ status: 200 });
      await expect(
        call(mintKey('u', ['containers:update']), '/containers/abc/triggers/slack', 'POST'),
      ).resolves.toMatchObject({ status: 403 });
    });
  });

  describe('coexistence', () => {
    test('Basic still authenticates with the key authenticator mounted', async () => {
      const response = await call({ Authorization: BASIC_AUTH_HEADER }, '/read');

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ username: TEST_USER });
    });

    test('a session still authenticates', async () => {
      const login = await fetch(`http://127.0.0.1:${port}/login`, {
        method: 'POST',
        headers: { ...HTTPS_HEADERS, Authorization: BASIC_AUTH_HEADER },
      });

      await expect(
        call({ Cookie: extractCookie(login) as string }, '/read'),
      ).resolves.toMatchObject({ status: 200 });
    });

    test('a cookie plus a key resolves as the key, not as the browser session', async () => {
      // A background integration must not silently inherit a browser session's
      // identity or its permissions.
      const login = await fetch(`http://127.0.0.1:${port}/login`, {
        method: 'POST',
        headers: { ...HTTPS_HEADERS, Authorization: BASIC_AUTH_HEADER },
      });
      const cookie = extractCookie(login) as string;

      const response = await call(
        { Cookie: cookie, Authorization: `Bearer ${mintKey('integration', ['read'])}` },
        '/read',
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ username: 'integration' });
    });

    test('a revoked key is not rescued by a valid cookie riding along', async () => {
      // The terminal rejection exists for this: falling through would let a
      // revoked key keep working for as long as the browser session lives.
      const login = await fetch(`http://127.0.0.1:${port}/login`, {
        method: 'POST',
        headers: { ...HTTPS_HEADERS, Authorization: BASIC_AUTH_HEADER },
      });
      const cookie = extractCookie(login) as string;
      const created = apiKeyStore.createApiKey({
        name: 'leaked',
        scopes: ['read'],
        createdBy: { kind: 'user', username: 'scott' },
      });
      apiKeyStore.revokeApiKey(created.record.keyId, { revokedBy: 'user:scott' });

      const response = await call(
        { Cookie: cookie, Authorization: `Bearer ${created.apiKey}` },
        '/read',
      );

      expect(response.status).toBe(401);
    });

    test('a non-ddk bearer falls through to Basic rather than being consumed', async () => {
      // The key authenticator must not touch a credential that is not its own.
      const response = await call({ Authorization: 'Bearer not-a-drydock-key' }, '/read');

      expect(response.status).toBe(401);
    });

    test('a bearer authenticator behind the key one still receives its own credential', async () => {
      // Stands in for OIDC, which authenticates a bearer credential from the
      // same header. Registered after the key authenticator, so if the key
      // authenticator consumed or terminated every bearer this would 401.
      clearAuthenticators();
      registerAuthenticator(apiKeyAuthenticator);
      registerAuthenticator({
        id: 'bearer-idp',
        persistsSession: false,
        authenticate: async (request) =>
          request.headers?.authorization === `Bearer ${IDP_CREDENTIAL}`
            ? { kind: 'oidc' as const, username: 'idp-user' }
            : undefined,
      });
      registerAuthenticator(sessionAuthenticator);

      const response = await call({ Authorization: `Bearer ${IDP_CREDENTIAL}` }, '/read');

      expect(response.status).toBe(200);
      expect(await response.json()).toStrictEqual({ username: 'idp-user' });
    });

    test('the webhook bearer still authenticates with the key authenticator mounted', async () => {
      const response = await call(
        { Authorization: `Bearer ${WEBHOOK_CREDENTIAL}` },
        '/webhook/watch',
        'POST',
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toStrictEqual({ username: 'webhook' });
    });

    test('a valid API key is not accepted as a webhook credential', async () => {
      // The webhook scheme is separate, not a weaker spelling of the key one:
      // an admin key reaching the webhook endpoint is refused by the webhook's
      // own comparison, so a key can never stand in for a webhook secret.
      const key = mintKey('admin', ['admin']);

      const response = await call(key, '/webhook/watch', 'POST');

      expect(response.status).toBe(401);
      expect(await response.json()).toStrictEqual({ error: 'invalid webhook credential' });
    });

    test('a ddk_ credential is still terminal with a bearer authenticator behind it', async () => {
      // The other half of the same contract: owning the prefix means a bad key
      // is not offered to the identity provider sitting behind it.
      clearAuthenticators();
      registerAuthenticator(apiKeyAuthenticator);
      registerAuthenticator({
        id: 'bearer-idp',
        persistsSession: false,
        authenticate: async () => ({ kind: 'oidc' as const, username: 'idp-user' }),
      });

      const response = await call(`ddk_${'0'.repeat(12)}_${'A'.repeat(43)}`, '/read');

      expect(response.status).toBe(401);
    });
  });
});

/**
 * The pre-authentication limiter must not answer "does this key id exist?".
 *
 * It is the very first middleware on /api/v1, so it emits RateLimit headers on
 * every request, including ones that never reach the authenticator at all —
 * /webhook carries its own bearer scheme and is mounted ahead of
 * `requireAuthentication`. The authenticator's per-address failure budget
 * therefore cannot bound probing here: it runs later, and on that path it
 * never runs. The bucket has to be indistinguishable on its own.
 */
describe('the pre-authentication limiter is not an existence oracle', () => {
  const OUTER_LIMIT = 3;
  const openServers: http.Server[] = [];

  function buildLimiterApp(): Application {
    const app = express();
    app.set('trust proxy', 1);
    app.use(
      rateLimit({
        windowMs: 60 * 1000,
        max: OUTER_LIMIT,
        standardHeaders: true,
        legacyHeaders: false,
        validate: { xForwardedForHeader: false },
        keyGenerator: createOuterApiRateLimitKeyGenerator(false),
      }),
    );
    // Mirrors api.ts: the webhook router is mounted before
    // `requireAuthentication`, so a ddk_ credential aimed here is charged a
    // bucket and never authenticated.
    app.post('/webhook/watch', (_req: Request, res: ExpressResponse) => {
      res.status(401).json({ error: 'invalid webhook credential' });
    });
    return app;
  }

  async function startLimiterServer(): Promise<number> {
    const running = await startServer(buildLimiterApp());
    openServers.push(running.server);
    return running.port;
  }

  function probe(limiterPort: number, credential: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${limiterPort}/webhook/watch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}` },
    });
  }

  function rateLimitHeaders(response: Response): Record<string, string> {
    const collected: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      if (name.toLowerCase().startsWith('ratelimit')) {
        collected[name.toLowerCase()] = value;
      }
    });
    return collected;
  }

  let knownKeyId: string;
  let validCredential: string;
  let wrongSecretCredential: string;
  const unknownIdCredential = `ddk_${'f'.repeat(12)}_${'A'.repeat(43)}`;
  const otherUnknownIdCredential = `ddk_${'e'.repeat(12)}_${'A'.repeat(43)}`;

  beforeEach(() => {
    apiKeyStore.createCollections(new Loki('api-key-oracle.test.db') as never);
    validCredential = mintKey('probe-target', ['read']);
    knownKeyId = validCredential.slice('ddk_'.length, 'ddk_'.length + 12);
    wrongSecretCredential = `ddk_${knownKeyId}_${'B'.repeat(43)}`;
  });

  afterEach(async () => {
    await Promise.all(openServers.splice(0).map((server) => closeServer(server)));
  });

  test('an unknown id and a known id with a wrong secret get identical RateLimit headers', async () => {
    // Two fresh limiters, each primed with one credential-free request so the
    // address bucket has already been charged. The headers on the first
    // request of a fresh window are identical whatever bucket it lands in, so
    // priming is what makes the comparison mean anything: a probe that keeps
    // the address bucket reads one lower than a probe handed its own.
    async function probeAfterPriming(credential: string): Promise<Record<string, string>> {
      const limiterPort = await startLimiterServer();
      await fetch(`http://127.0.0.1:${limiterPort}/webhook/watch`, { method: 'POST' });
      return rateLimitHeaders(await probe(limiterPort, credential));
    }

    const unknownHeaders = await probeAfterPriming(unknownIdCredential);
    const wrongSecretHeaders = await probeAfterPriming(wrongSecretCredential);

    expect(Object.keys(unknownHeaders).length).toBeGreaterThan(0);
    expect(wrongSecretHeaders).toStrictEqual(unknownHeaders);
  });

  test('every failing credential is charged to one bucket, so probing cannot mint budgets', async () => {
    const limiterPort = await startLimiterServer();

    const first = await probe(limiterPort, unknownIdCredential);
    const second = await probe(limiterPort, wrongSecretCredential);
    const third = await probe(limiterPort, otherUnknownIdCredential);
    const fourth = await probe(limiterPort, `ddk_${knownKeyId}_${'C'.repeat(43)}`);

    // Three shared the address budget, so the fourth is refused by the
    // limiter rather than reaching the route.
    expect([first.status, second.status, third.status]).toStrictEqual([401, 401, 401]);
    expect(fourth.status).toBe(429);
  });

  test('a credential that actually verifies still gets its own bucket', async () => {
    const limiterPort = await startLimiterServer();

    await probe(limiterPort, unknownIdCredential);
    await probe(limiterPort, wrongSecretCredential);
    await probe(limiterPort, otherUnknownIdCredential);

    // The address bucket is spent. A caller holding the real secret is
    // unaffected, which is the whole point of splitting the bucket.
    expect((await probe(limiterPort, validCredential)).status).toBe(401);
    expect((await probe(limiterPort, unknownIdCredential)).status).toBe(429);
  });
});
