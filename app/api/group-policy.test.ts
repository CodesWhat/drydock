/**
 * Group policy API (spec 7.3 slice 1b), exercised over real HTTP against a real express
 * pipeline, the real SQLite stores and the real container store. Every JSON response is
 * validated against the published OpenAPI document, so the contract and the router cannot
 * drift apart.
 */
import http from 'node:http';
import express, { type Application } from 'express';
import type { Container } from '../model/container.js';
import { applyDeclarativeUpdatePolicy } from '../model/update-policy.js';
import * as auditStore from '../store/audit.js';
import * as storeContainer from '../store/container.js';
import type { Database } from '../store/db/driver.js';
import * as groupPolicyStore from '../store/group-policy.js';
import { createContainerFixture } from '../test/helpers.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import * as groupPolicyRouter from './group-policy.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';

vi.mock('../event');
vi.mock('../store/container.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/container.js')>();
  return {
    ...actual,
    getContainers: vi.fn(actual.getContainers),
    reResolveGroupPolicyMembers: vi.fn(actual.reResolveGroupPolicyMembers),
  };
});

const COMPOSE_PAYMENTS = { 'com.docker.compose.project': 'payments' };

let db: Database;
let server: http.Server;
let port: number;

type TestPrincipal =
  | { kind: 'session'; username: string }
  | { kind: 'api-key'; username: string; keyId: string; scopes: string[]; parentKeyId: null };

const ADMIN_SESSION: TestPrincipal = { kind: 'session', username: 'ada' };

function apiKey(scopes: string[]): TestPrincipal {
  return { kind: 'api-key', username: 'ci', keyId: 'abcdef012345', scopes, parentKeyId: null };
}

function createTestApp(): Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.header('x-test-principal');
    if (header) {
      req.principal = JSON.parse(header);
    }
    next();
  });
  app.use('/api/v1/group-policies', groupPolicyRouter.init());
  return app;
}

interface CallResult {
  status: number;
  body: any;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  principal: TestPrincipal = ADMIN_SESSION,
): Promise<CallResult> {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/group-policies${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-test-principal': JSON.stringify(principal),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

/** Assert the response matches the published schema for this operation and status. */
function expectContract(
  result: CallResult,
  method: 'get' | 'post' | 'put' | 'delete',
  openApiPath: string,
) {
  expect(
    validateOpenApiJsonResponse({
      path: openApiPath,
      method,
      statusCode: String(result.status),
      payload: result.body,
    }),
  ).toEqual({ valid: true, errors: [] });
}

function watched(id: string, overrides: Record<string, unknown> = {}) {
  const built = createContainerFixture({
    id,
    name: id,
    watcher: 'local',
    labels: COMPOSE_PAYMENTS,
    ...overrides,
  }) as unknown as Container;
  return applyDeclarativeUpdatePolicy(built, { env: {}, label: {} });
}

/** Audit rows for an action in insertion order, as the store maps them. */
function auditRows(action: string) {
  return db
    .prepare('SELECT container_name, status, details FROM audit WHERE action = ? ORDER BY rowid')
    .all(action)
    .map((row) => ({
      action,
      containerName: row.container_name as string,
      status: row.status as string,
      details: row.details as string | null,
    }));
}

async function createPolicy(group = 'payments', body: Record<string, unknown> = {}) {
  const result = await call('POST', '', {
    group,
    updatePolicy: { maturityMode: 'mature' },
    ...body,
  });
  expect(result.status).toBe(201);
  return result.body.policy as { id: string; revision: number };
}

beforeAll(async () => {
  server = http.createServer(createTestApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  storeContainer._resetContainerStoreStateForTests();
  db = createMigratedMemoryDatabase();
  auditStore.createCollections(db);
  storeContainer.createCollections(db);
  groupPolicyStore.createCollections(db);
});

afterEach(() => {
  groupPolicyStore.clearCollectionForTesting();
  db.close();
});

describe('scopes', () => {
  test('a read key can list and fetch policies but not write them', async () => {
    const policy = await createPolicy();
    const readKey = apiKey(['read']);

    expect((await call('GET', '', undefined, readKey)).status).toBe(200);
    expect((await call('GET', `/${policy.id}`, undefined, readKey)).status).toBe(200);
    const writes = [
      await call('POST', '', { group: 'other', updatePolicy: { maturityMode: 'all' } }, readKey),
      await call(
        'PUT',
        `/${policy.id}`,
        { revision: 1, updatePolicy: { maturityMode: 'all' } },
        readKey,
      ),
      await call('DELETE', `/${policy.id}?revision=1`, undefined, readKey),
    ];
    expect(writes.map((write) => write.status)).toEqual([403, 403, 403]);
    expect(groupPolicyStore.getGroupPolicies()).toHaveLength(1);
  });

  test('a containers:update key cannot write group policies', async () => {
    const result = await call(
      'POST',
      '',
      { group: 'payments', updatePolicy: { maturityMode: 'all' } },
      apiKey(['containers:update']),
    );

    expect(result.status).toBe(403);
    expect(groupPolicyStore.getGroupPolicies()).toEqual([]);
  });

  test('an admin key and a session can write', async () => {
    const byKey = await call(
      'POST',
      '',
      { group: 'a', updatePolicy: { maturityMode: 'all' } },
      apiKey(['admin']),
    );
    const bySession = await call('POST', '', {
      group: 'b',
      updatePolicy: { maturityMode: 'all' },
    });

    expect([byKey.status, bySession.status]).toEqual([201, 201]);
    expect(byKey.body.policy.createdBy).toBe('api-key:abcdef012345'); // gitleaks:allow — an audit actor label, not a credential
    expect(bySession.body.policy.createdBy).toBe('user:ada');
  });

  test('a request with no principal is recorded as unknown', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/group-policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'a', updatePolicy: { maturityMode: 'all' } }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.policy.createdBy).toBe('user:unknown');
  });
});

describe('POST /group-policies', () => {
  test('creates a policy at revision 1, re-resolves members and audits it', async () => {
    storeContainer.insertContainer(watched('member'));
    storeContainer.insertContainer(watched('other', { labels: { 'dd.group': 'elsewhere' } }));

    const result = await call('POST', '', {
      group: 'payments',
      updatePolicy: { maturityMode: 'mature', skipTags: [' 1.0.0 '] },
    });

    expect(result.status).toBe(201);
    expectContract(result, 'post', '/api/v1/group-policies');
    expect(result.body).toEqual({
      policy: {
        id: expect.any(String),
        group: 'payments',
        revision: 1,
        updatePolicy: { maturityMode: 'mature', skipTags: ['1.0.0'] },
        actions: {},
        createdAt: expect.any(String),
        createdBy: 'user:ada',
        updatedAt: expect.any(String),
        updatedBy: 'user:ada',
      },
      applied: { members: 1 },
      warnings: [],
    });
    expect(storeContainer.getContainer('member')?.updatePolicySources).toEqual({
      maturityMode: 'group',
      skipTags: 'group',
    });
    expect(storeContainer.getContainer('other')?.groupPolicy).toBeUndefined();

    const [row] = auditRows('group-policy-set');
    expect(row).toMatchObject({
      action: 'group-policy-set',
      status: 'success',
      containerName: 'payments',
    });
    expect(JSON.parse(row.details as string)).toEqual({
      policyId: result.body.policy.id,
      group: 'payments',
      operation: 'created',
      revision: 1,
      by: 'user:ada',
      fields: {
        maturityMode: { before: null, after: 'mature' },
        skipTags: { before: null, after: ['1.0.0'] },
      },
      members: 1,
    });
  });

  test('warns when the group has no current members', async () => {
    const result = await call('POST', '', {
      group: 'future',
      updatePolicy: { maturityMinAgeDays: 3 },
    });

    expect(result.status).toBe(201);
    expectContract(result, 'post', '/api/v1/group-policies');
    expect(result.body.applied).toEqual({ members: 0 });
    expect(result.body.warnings).toEqual([
      'No current containers are in this group. The policy applies to future members.',
    ]);
  });

  test('keeps the group name exactly as sent', async () => {
    const result = await call('POST', '', {
      group: ' Pay"ments\\ ',
      updatePolicy: { maturityMode: 'all' },
    });

    expect(result.status).toBe(201);
    expect(result.body.policy.group).toBe(' Pay"ments\\ ');
    expect(auditRows('group-policy-set')[0].containerName).toBe(' Pay"ments\\ ');
    expect(JSON.parse(auditRows('group-policy-set')[0].details as string).group).toBe(
      ' Pay"ments\\ ',
    );
  });

  test('rejects a second policy for the same group with 409', async () => {
    await createPolicy();

    const result = await call('POST', '', {
      group: 'payments',
      updatePolicy: { maturityMode: 'all' },
    });

    expect(result.status).toBe(409);
    expectContract(result, 'post', '/api/v1/group-policies');
    expect(result.body.error).toBe("A policy for group 'payments' already exists");
    expect(auditRows('group-policy-set')).toHaveLength(1);
  });

  test('treats group names as case-sensitive', async () => {
    await createPolicy('payments');

    const result = await call('POST', '', {
      group: 'Payments',
      updatePolicy: { maturityMode: 'all' },
    });

    expect(result.status).toBe(201);
  });

  test('rejects a request with no body with 400', async () => {
    const result = await call('POST', '');

    expect(result.status).toBe(400);
    expectContract(result, 'post', '/api/v1/group-policies');
  });

  test.each([
    ['a missing group', { updatePolicy: { maturityMode: 'all' } }],
    ['a non-string group', { group: 7, updatePolicy: { maturityMode: 'all' } }],
    ['an empty group', { group: '', updatePolicy: { maturityMode: 'all' } }],
    ['a whitespace-only group', { group: '   ', updatePolicy: { maturityMode: 'all' } }],
    ['no policy fields', { group: 'g' }],
    ['an empty update policy', { group: 'g', updatePolicy: {} }],
    ['an empty body', {}],
    ['an unknown top-level field', { group: 'g', updatePolicy: { maturityMode: 'all' }, extra: 1 }],
    ['an unknown update-policy field', { group: 'g', updatePolicy: { snoozeUntil: 'x' } }],
    ['an invalid maturity mode', { group: 'g', updatePolicy: { maturityMode: 'nope' } }],
    ['a min age below 1', { group: 'g', updatePolicy: { maturityMinAgeDays: 0 } }],
    ['a min age above 365', { group: 'g', updatePolicy: { maturityMinAgeDays: 366 } }],
    ['a non-integer min age', { group: 'g', updatePolicy: { maturityMinAgeDays: 1.5 } }],
    ['a string min age', { group: 'g', updatePolicy: { maturityMinAgeDays: '3' } }],
    ['skip tags that are not a list', { group: 'g', updatePolicy: { skipTags: 'a' } }],
    ['actions, which no slice accepts yet', { group: 'g', actions: { updateMode: 'manual' } }],
    [
      'actions next to a valid update policy',
      { group: 'g', updatePolicy: { maturityMode: 'all' }, actions: { updateMode: 'auto' } },
    ],
  ])('rejects %s with 400 and writes nothing', async (_name, body) => {
    const result = await call('POST', '', body);

    expect(result.status).toBe(400);
    expectContract(result, 'post', '/api/v1/group-policies');
    expect(groupPolicyStore.getGroupPolicies()).toEqual([]);
    expect(auditRows('group-policy-set')).toEqual([]);
  });

  test('explains a policy that sets nothing and a bad group name', async () => {
    const empty = await call('POST', '', { group: 'g', updatePolicy: {} });
    const blank = await call('POST', '', { group: '  ', updatePolicy: { maturityMode: 'all' } });

    expect(empty.body.error).toBe('A group policy must set at least one field');
    expect(blank.body.error).toBe('A group name must be a non-empty string');
  });
});

describe('GET /group-policies', () => {
  test('lists every policy with its current members, controller and agents', async () => {
    const payments = await createPolicy('payments');
    await createPolicy('empty');
    storeContainer.insertContainer(watched('local-a'));
    storeContainer.insertContainer(watched('edge-a', { agent: 'edge1' }));
    storeContainer.insertContainer(watched('edge-b', { agent: 'edge1', name: 'edge-b' }));
    storeContainer.insertContainer(watched('edge2-a', { agent: 'edge2' }));
    storeContainer.insertContainer(watched('loose', { labels: {} }));

    const result = await call('GET', '');

    expect(result.status).toBe(200);
    expectContract(result, 'get', '/api/v1/group-policies');
    expect(result.body.total).toBe(2);
    expect(result.body.data.map((entry: any) => entry.group)).toEqual(['empty', 'payments']);
    expect(result.body.data[0].members).toEqual({ count: 0, agents: [] });
    expect(result.body.data[1]).toMatchObject({ id: payments.id, revision: 1 });
    expect(result.body.data[1].members).toEqual({ count: 4, agents: [null, 'edge1', 'edge2'] });
  });

  test('returns an empty list when there are no policies', async () => {
    const result = await call('GET', '');

    expect(result.body).toEqual({ data: [], total: 0 });
    expectContract(result, 'get', '/api/v1/group-policies');
  });
});

describe('GET /group-policies/:id', () => {
  test('returns one policy with its members', async () => {
    const policy = await createPolicy();
    storeContainer.insertContainer(watched('member'));

    const result = await call('GET', `/${policy.id}`);

    expect(result.status).toBe(200);
    expectContract(result, 'get', '/api/v1/group-policies/{id}');
    expect(result.body.members).toEqual({ count: 1, agents: [null] });
  });

  test('answers 404 for an unknown id', async () => {
    const result = await call('GET', '/missing');

    expect(result.status).toBe(404);
    expectContract(result, 'get', '/api/v1/group-policies/{id}');
    expect(result.body.error).toBe('Group policy not found');
  });
});

describe('PUT /group-policies/:id', () => {
  test('replaces the policy, bumps the revision, re-resolves members and audits changed fields', async () => {
    const policy = await createPolicy('payments', {
      updatePolicy: { maturityMode: 'mature', skipTags: ['a'] },
    });
    storeContainer.insertContainer(watched('member'));

    const result = await call('PUT', `/${policy.id}`, {
      revision: 1,
      updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 14 },
    });

    expect(result.status).toBe(200);
    expectContract(result, 'put', '/api/v1/group-policies/{id}');
    expect(result.body).toMatchObject({
      changed: true,
      policy: {
        id: policy.id,
        revision: 2,
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 14 },
        updatedBy: 'user:ada',
      },
      applied: { members: 1 },
      warnings: [],
    });
    expect(storeContainer.getContainer('member')?.groupPolicy?.revision).toBe(2);
    expect(storeContainer.getContainer('member')?.updatePolicy).toEqual({
      maturityMode: 'mature',
      maturityMinAgeDays: 14,
    });

    const rows = auditRows('group-policy-set');
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[1].details as string)).toEqual({
      policyId: policy.id,
      group: 'payments',
      operation: 'replaced',
      revision: 2,
      by: 'user:ada',
      fields: {
        maturityMinAgeDays: { before: null, after: 14 },
        skipTags: { before: ['a'], after: null },
      },
      members: 1,
    });
  });

  test('accepts the same group in the body', async () => {
    const policy = await createPolicy();

    const result = await call('PUT', `/${policy.id}`, {
      group: 'payments',
      revision: 1,
      updatePolicy: { maturityMode: 'all' },
    });

    expect(result.status).toBe(200);
    expect(result.body.changed).toBe(true);
  });

  test('rejects a different group with 400 because the group is immutable', async () => {
    const policy = await createPolicy();

    const result = await call('PUT', `/${policy.id}`, {
      group: 'other',
      revision: 1,
      updatePolicy: { maturityMode: 'all' },
    });

    expect(result.status).toBe(400);
    expectContract(result, 'put', '/api/v1/group-policies/{id}');
    expect(result.body.error).toBe(
      'The group of a policy cannot change. Delete the policy and create one for the new group',
    );
    expect(groupPolicyStore.getGroupPolicyById(policy.id)?.revision).toBe(1);
  });

  test('a no-op returns changed false with no write, no revision bump and no audit', async () => {
    const policy = await createPolicy();
    storeContainer.insertContainer(watched('member'));
    const before = groupPolicyStore.getGroupPolicyById(policy.id);

    const result = await call('PUT', `/${policy.id}`, {
      revision: 1,
      updatePolicy: { maturityMode: 'mature' },
    });

    expect(result.status).toBe(200);
    expectContract(result, 'put', '/api/v1/group-policies/{id}');
    expect(result.body).toEqual({
      changed: false,
      policy: before,
      applied: { members: 0 },
      warnings: [],
    });
    expect(auditRows('group-policy-set')).toHaveLength(1);
    expect(storeContainer.reResolveGroupPolicyMembers).toHaveBeenCalledTimes(1);
  });

  test('a no-op with a stale revision is still a 409', async () => {
    const policy = await createPolicy();
    await call('PUT', `/${policy.id}`, { revision: 1, updatePolicy: { maturityMode: 'all' } });

    const result = await call('PUT', `/${policy.id}`, {
      revision: 1,
      updatePolicy: { maturityMode: 'all' },
    });

    expect(result.status).toBe(409);
  });

  test('a stale revision is a 409 and writes nothing', async () => {
    const policy = await createPolicy();
    await call('PUT', `/${policy.id}`, { revision: 1, updatePolicy: { maturityMode: 'all' } });

    const result = await call('PUT', `/${policy.id}`, {
      revision: 1,
      updatePolicy: { skipTags: ['x'] },
    });

    expect(result.status).toBe(409);
    expectContract(result, 'put', '/api/v1/group-policies/{id}');
    expect(result.body.error).toBe(
      'Group policy was changed by someone else. Reload it and apply the change again',
    );
    expect(groupPolicyStore.getGroupPolicyById(policy.id)?.updatePolicy).toEqual({
      maturityMode: 'all',
    });
    expect(auditRows('group-policy-set')).toHaveLength(2);
  });

  test('rejects a request with no body with 400', async () => {
    const policy = await createPolicy();

    const result = await call('PUT', `/${policy.id}`);

    expect(result.status).toBe(400);
  });

  test('answers 404 for an unknown id', async () => {
    const result = await call('PUT', '/missing', {
      revision: 1,
      updatePolicy: { maturityMode: 'all' },
    });

    expect(result.status).toBe(404);
    expectContract(result, 'put', '/api/v1/group-policies/{id}');
  });

  test.each([
    ['a missing revision', { updatePolicy: { maturityMode: 'all' } }],
    ['a zero revision', { revision: 0, updatePolicy: { maturityMode: 'all' } }],
    ['a fractional revision', { revision: 1.5, updatePolicy: { maturityMode: 'all' } }],
    ['a string revision', { revision: '1', updatePolicy: { maturityMode: 'all' } }],
    ['no policy fields', { revision: 1 }],
    ['an unknown field', { revision: 1, updatePolicy: { maturityMode: 'all' }, extra: true }],
    ['actions', { revision: 1, actions: { updateMode: 'manual' } }],
    ['an invalid update policy', { revision: 1, updatePolicy: { maturityMinAgeDays: 0 } }],
  ])('rejects %s with 400', async (_name, body) => {
    const policy = await createPolicy();

    const result = await call('PUT', `/${policy.id}`, body);

    expect(result.status).toBe(400);
    expectContract(result, 'put', '/api/v1/group-policies/{id}');
    expect(groupPolicyStore.getGroupPolicyById(policy.id)?.revision).toBe(1);
  });
});

describe('DELETE /group-policies/:id', () => {
  test('deletes the policy, re-resolves members and audits it', async () => {
    const policy = await createPolicy();
    storeContainer.insertContainer(watched('member'));
    expect(storeContainer.getContainer('member')?.groupPolicy).toBeDefined();

    const result = await call('DELETE', `/${policy.id}?revision=1`);

    expect(result.status).toBe(200);
    expectContract(result, 'delete', '/api/v1/group-policies/{id}');
    expect(result.body).toMatchObject({
      changed: true,
      policy: { id: policy.id, group: 'payments' },
      applied: { members: 1 },
      warnings: [],
    });
    expect(groupPolicyStore.getGroupPolicies()).toEqual([]);
    expect(storeContainer.getContainer('member')?.groupPolicy).toBeUndefined();
    expect(storeContainer.getContainer('member')?.updatePolicySources).toEqual({});

    const [row] = auditRows('group-policy-cleared');
    expect(row).toMatchObject({ containerName: 'payments', status: 'success' });
    expect(JSON.parse(row.details as string)).toEqual({
      policyId: policy.id,
      group: 'payments',
      operation: 'deleted',
      revision: 1,
      by: 'user:ada',
      fields: { maturityMode: { before: 'mature', after: null } },
      members: 1,
    });
  });

  test('a deleted group can be created again', async () => {
    const policy = await createPolicy();
    await call('DELETE', `/${policy.id}?revision=1`);

    expect(
      (await call('POST', '', { group: 'payments', updatePolicy: { maturityMode: 'all' } })).status,
    ).toBe(201);
  });

  test('a stale revision is a 409 and keeps the policy', async () => {
    const policy = await createPolicy();

    const result = await call('DELETE', `/${policy.id}?revision=2`);

    expect(result.status).toBe(409);
    expectContract(result, 'delete', '/api/v1/group-policies/{id}');
    expect(groupPolicyStore.getGroupPolicies()).toHaveLength(1);
    expect(auditRows('group-policy-cleared')).toEqual([]);
  });

  test('answers 404 for an unknown id', async () => {
    const result = await call('DELETE', '/missing?revision=1');

    expect(result.status).toBe(404);
    expectContract(result, 'delete', '/api/v1/group-policies/{id}');
  });

  test.each([
    ['missing', ''],
    ['zero', '?revision=0'],
    ['fractional', '?revision=1.5'],
    ['not a number', '?revision=abc'],
    ['repeated', '?revision=1&revision=2'],
  ])('rejects a %s revision with 400', async (_name, query) => {
    const policy = await createPolicy();

    const result = await call('DELETE', `/${policy.id}${query}`);

    expect(result.status).toBe(400);
    expectContract(result, 'delete', '/api/v1/group-policies/{id}');
    expect(groupPolicyStore.getGroupPolicies()).toHaveLength(1);
  });
});

describe('failure handling', () => {
  test('an audit write that fails rolls the policy back', async () => {
    const insertAudit = vi.spyOn(auditStore, 'insertAudit').mockImplementation(() => {
      throw new Error('audit disk full');
    });

    const result = await call('POST', '', {
      group: 'payments',
      updatePolicy: { maturityMode: 'all' },
    });

    expect(result.status).toBe(500);
    expectContract(result, 'post', '/api/v1/group-policies');
    expect(result.body.error).not.toContain('audit disk full');
    expect(groupPolicyStore.getGroupPolicies()).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM group_policies').get()).toEqual({ n: 0 });
    insertAudit.mockRestore();
  });

  test('a failed audit on replace and delete leaves the stored policy untouched', async () => {
    const policy = await createPolicy();
    const insertAudit = vi.spyOn(auditStore, 'insertAudit').mockImplementation(() => {
      throw new Error('audit disk full');
    });

    const replaced = await call('PUT', `/${policy.id}`, {
      revision: 1,
      updatePolicy: { maturityMode: 'all' },
    });
    const deleted = await call('DELETE', `/${policy.id}?revision=1`);
    insertAudit.mockRestore();

    expect([replaced.status, deleted.status]).toEqual([500, 500]);
    expect(groupPolicyStore.getGroupPolicyById(policy.id)).toMatchObject({
      revision: 1,
      updatePolicy: { maturityMode: 'mature' },
    });
  });

  test('a member re-resolution failure after commit is reported as a warning, not a failure', async () => {
    vi.mocked(storeContainer.reResolveGroupPolicyMembers).mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const result = await call('POST', '', {
      group: 'payments',
      updatePolicy: { maturityMode: 'all' },
    });

    expect(result.status).toBe(201);
    expectContract(result, 'post', '/api/v1/group-policies');
    expect(result.body.applied).toEqual({ members: 0 });
    expect(result.body.warnings).toContain(
      'The policy was saved, but updating current members failed. They pick it up on their next write or at restart.',
    );
    expect(groupPolicyStore.getGroupPolicies()).toHaveLength(1);
  });

  test('an unexpected error while reading is a sanitized 500', async () => {
    await createPolicy();
    vi.mocked(storeContainer.getContainers).mockImplementationOnce(() => {
      throw new Error('store exploded');
    });

    const list = await call('GET', '');

    expect(list.status).toBe(500);
    expectContract(list, 'get', '/api/v1/group-policies');
    expect(list.body.error).not.toContain('store exploded');
  });

  test('an unexpected error while fetching one policy is a sanitized 500', async () => {
    const policy = await createPolicy();
    vi.mocked(storeContainer.getContainers).mockImplementationOnce(() => {
      throw new Error('store exploded');
    });

    const result = await call('GET', `/${policy.id}`);

    expect(result.status).toBe(500);
    expectContract(result, 'get', '/api/v1/group-policies/{id}');
  });

  test('an unexpected error while deleting is a sanitized 500', async () => {
    const policy = await createPolicy();
    vi.mocked(storeContainer.getContainers).mockImplementationOnce(() => {
      throw new Error('store exploded');
    });

    const result = await call('DELETE', `/${policy.id}?revision=1`);

    expect(result.status).toBe(500);
    expectContract(result, 'delete', '/api/v1/group-policies/{id}');
  });

  test('an unexpected error while creating is a sanitized 500', async () => {
    vi.mocked(storeContainer.getContainers).mockImplementationOnce(() => {
      throw new Error('store exploded');
    });

    const result = await call('POST', '', { group: 'g', updatePolicy: { maturityMode: 'all' } });

    expect(result.status).toBe(500);
    expect(groupPolicyStore.getGroupPolicies()).toEqual([]);
  });

  test('an unexpected error while writing is a sanitized 500', async () => {
    const policy = await createPolicy();
    vi.mocked(storeContainer.getContainers).mockImplementationOnce(() => {
      throw new Error('store exploded');
    });

    const result = await call('PUT', `/${policy.id}`, {
      revision: 1,
      updatePolicy: { maturityMode: 'all' },
    });

    expect(result.status).toBe(500);
    expect(result.body.error).not.toContain('store exploded');
  });
});
