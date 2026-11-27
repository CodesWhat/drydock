/**
 * Per-role API test with the audit trail and the denial metric live.
 *
 * One viewer, one operator and one admin (Basic users with
 * `DD_AUTH_BASIC_<name>_ROLE`) drive the real authenticator chain,
 * `requireAuthentication`, `bindAuditActor`, `scoped()` and the real audit store
 * over an in-memory SQLite database. It proves what each role may do, that a
 * refusal writes one `auth-denied` row naming actor, role and route, that a
 * repeat inside the window does not flood the log, that rows written for a
 * person carry the role they held, and that the denial counter moves.
 */
import { argon2Sync, randomBytes } from 'node:crypto';
import http from 'node:http';
import express, { type Application, type Response as ExpressResponse, type Request } from 'express';
import session from 'express-session';

const { mockGetState } = vi.hoisted(() => ({ mockGetState: vi.fn() }));

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
import * as authMetrics from '../prometheus/auth.js';
import * as auditStore from '../store/audit.js';
import * as sessionModel from '../store/session.js';
import * as totpStore from '../store/totp.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import { bindAuditActor } from './audit-actor.js';
import { recordAuditEvent } from './audit-events.js';
import { requireAuthentication } from './auth.js';
import { registerAuthenticators } from './auth-strategies.js';
import { _resetAuthzDenialStateForTests } from './authz-denial.js';
import { scoped } from './route-scopes.js';
import { restoreSessionPrincipal } from './session-principal.js';
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

async function createBasic(name: string, role: string): Promise<Basic> {
  const basic = new Basic();
  await basic.register('authentication', 'basic', name, { user: name, hash: HASH, role });
  return basic;
}

function basicHeader(username: string): string {
  return `Basic ${Buffer.from(`${username}:${PASSWORD}`).toString('base64')}`;
}

/** A handler that does what an update does as far as the log is concerned: it writes an audit row. */
function updateContainer(_req: Request, res: ExpressResponse): void {
  recordAuditEvent({ action: 'container-update', status: 'success', containerName: 'web' });
  res.status(200).json({ ok: true });
}

function ok(_req: Request, res: ExpressResponse): void {
  res.status(200).json({ ok: true });
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
  app.use(requireAuthentication);
  app.use(bindAuditActor);
  // The scopes the real routers declare for these routes.
  app.get('/containers', scoped('read', ok));
  app.post('/containers/:id/update', scoped('containers:update', updateContainer));
  app.post('/containers/:id/restart', scoped('containers:control', ok));
  app.patch('/settings', scoped('admin', ok));
  return app;
}

describe('roles with the audit trail live', () => {
  let server: http.Server;
  let baseUrl: string;

  function call(method: string, path: string, username: string) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: basicHeader(username) },
      body: method === 'GET' ? undefined : '{}',
    });
  }

  const denials = () =>
    auditStore.getAuditEntries({ action: 'auth-denied' }).entries.map((entry) => ({
      actor: entry.actor,
      actorRole: entry.actorRole,
      status: entry.status,
      details: entry.details,
    }));

  beforeAll(async () => {
    const users = [
      await createBasic('vera', 'viewer'),
      await createBasic('otto', 'operator'),
      await createBasic('root', 'admin'),
    ];
    mockGetState.mockReturnValue({
      authentication: Object.fromEntries(users.map((basic) => [basic.getId(), basic])),
    });
    registerAuthenticators({} as Application);
    const db = createMigratedMemoryDatabase();
    sessionModel.createCollections(db);
    totpStore.createCollections(db);
    server = http.createServer(createTestApp(new SessionStore({ ttlMs: 60_000 })));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  beforeEach(() => {
    auditStore.createCollections(createMigratedMemoryDatabase());
    authMetrics._resetAuthPrometheusStateForTests();
    authMetrics.init();
    _resetAuthzDenialStateForTests();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('a viewer reads and is refused everything else', async () => {
    expect((await call('GET', '/containers', 'vera')).status).toBe(200);
    expect((await call('POST', '/containers/c1/update', 'vera')).status).toBe(403);
    expect((await call('POST', '/containers/c1/restart', 'vera')).status).toBe(403);
    expect((await call('PATCH', '/settings', 'vera')).status).toBe(403);
  });

  test('an operator updates and restarts but is refused settings', async () => {
    expect((await call('GET', '/containers', 'otto')).status).toBe(200);
    expect((await call('POST', '/containers/c1/update', 'otto')).status).toBe(200);
    expect((await call('POST', '/containers/c1/restart', 'otto')).status).toBe(200);
    expect((await call('PATCH', '/settings', 'otto')).status).toBe(403);
  });

  test('an admin reaches everything and is never audited as denied', async () => {
    expect((await call('GET', '/containers', 'root')).status).toBe(200);
    expect((await call('POST', '/containers/c1/update', 'root')).status).toBe(200);
    expect((await call('POST', '/containers/c1/restart', 'root')).status).toBe(200);
    expect((await call('PATCH', '/settings', 'root')).status).toBe(200);
    expect(denials()).toEqual([]);
  });

  test('a refusal writes one auth-denied row with actor, role and route', async () => {
    await call('POST', '/containers/c1/update', 'vera');

    expect(denials()).toEqual([
      {
        actor: 'vera',
        actorRole: 'viewer',
        status: 'error',
        details:
          'POST /containers/:id/update; scope=containers:update; role=viewer; requiredRole=operator',
      },
    ]);
  });

  test('repeating the refused call inside the window audits once but counts every time', async () => {
    for (let i = 0; i < 3; i += 1) {
      await call('PATCH', '/settings', 'otto');
    }

    expect(denials()).toHaveLength(1);
    const values = (await authMetrics.getAuthzDeniedCounter()?.get())?.values;
    expect(values).toEqual([
      expect.objectContaining({ labels: { scope: 'admin', role: 'operator' }, value: 3 }),
    ]);
  });

  test('other routes and other people are audited separately', async () => {
    await call('PATCH', '/settings', 'vera');
    await call('POST', '/containers/c1/restart', 'vera');
    await call('PATCH', '/settings', 'otto');

    expect(denials()).toHaveLength(3);
  });

  test('rows written on behalf of a person carry the role they held', async () => {
    await call('POST', '/containers/c1/update', 'otto');
    await call('POST', '/containers/c1/update', 'root');

    const rows = auditStore
      .getAuditEntries({ action: 'container-update' })
      .entries.map((entry) => [entry.actor, entry.actorRole])
      .sort();
    expect(rows).toEqual([
      ['otto', 'operator'],
      ['root', 'admin'],
    ]);
  });
});
