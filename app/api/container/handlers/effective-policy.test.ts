/**
 * `GET /containers/:id/effective-policy` (spec 7.3 slice 2b), exercised over real HTTP
 * against the real container and group policy stores. Responses are validated against the
 * published OpenAPI document, and the update-policy values are compared with what the store
 * itself finalized onto the record, so the endpoint cannot drift from what dispatch reads.
 */
import http from 'node:http';
import express from 'express';
import rateLimit from 'express-rate-limit';
import type { ActionPolicyTrigger } from '../../../model/action-policy.js';
import type { Container } from '../../../model/container.js';
import { applyDeclarativeUpdatePolicy } from '../../../model/update-policy.js';
import * as storeContainer from '../../../store/container.js';
import type { Database } from '../../../store/db/driver.js';
import * as groupPolicyStore from '../../../store/group-policy.js';
import type { UpdateMode } from '../../../store/settings.js';
import { createContainerFixture } from '../../../test/helpers.js';
import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import { validateOpenApiJsonResponse } from '../../openapi-contract.js';
import { scoped } from '../../route-scopes.js';
import { toApiContainer } from '../shared.js';
import { createEffectivePolicyHandler } from './effective-policy.js';

vi.mock('../../../event');
vi.mock('../../../log/index.js', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    child: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  },
}));

const COMPOSE_PAYMENTS = { 'com.docker.compose.project': 'payments' };

let db: Database;
let server: http.Server;
let port: number;
let globalMode: UpdateMode = 'auto';
let triggers: Record<string, ActionPolicyTrigger> | undefined;

function trigger(id: string, auto: unknown = 'all'): ActionPolicyTrigger {
  return { type: id.split('.')[0], getId: () => id, configuration: { auto } } as never;
}

function createTestApp() {
  const app = express();
  app.use(
    rateLimit({ windowMs: 60_000, limit: 10_000, standardHeaders: true, legacyHeaders: false }),
  );
  app.use((req, _res, next) => {
    const header = req.header('x-test-principal');
    if (header) {
      req.principal = JSON.parse(header);
    }
    next();
  });
  const router = express.Router();
  router.get(
    '/:id/effective-policy',
    scoped(
      'read',
      createEffectivePolicyHandler({
        getContainer: storeContainer.getContainer,
        getTriggers: () => triggers,
        getUpdateMode: () => globalMode,
        withCurrentGroupPolicy: groupPolicyStore.withCurrentGroupPolicy,
        toApiContainer,
      }),
    ),
  );
  app.use('/api/v1/containers', router);
  return app;
}

async function get(id: string, principal?: unknown) {
  const response = await fetch(
    `http://127.0.0.1:${port}/api/v1/containers/${id}/effective-policy`,
    {
      headers: principal ? { 'x-test-principal': JSON.stringify(principal) } : {},
    },
  );
  return { status: response.status, body: (await response.json()) as any };
}

async function getContract(id: string) {
  const result = await get(id);
  expect(result.status).toBe(200);
  expect(
    validateOpenApiJsonResponse({
      path: '/api/v1/containers/{id}/effective-policy',
      method: 'get',
      statusCode: '200',
      payload: result.body,
    }),
  ).toEqual({ valid: true, errors: [] });
  return result.body;
}

function watched(
  id: string,
  overrides: Record<string, unknown> = {},
  declarative: Container['updatePolicyDeclarative'] = { env: {}, label: {} },
) {
  const built = createContainerFixture({
    id,
    name: id,
    watcher: 'local',
    labels: COMPOSE_PAYMENTS,
    ...overrides,
  }) as unknown as Container;
  return applyDeclarativeUpdatePolicy(built, declarative as NonNullable<typeof declarative>);
}

function policy(body: Record<string, unknown>, group = 'payments') {
  return groupPolicyStore.insertGroupPolicy(group, body, 'user:ada');
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
  globalMode = 'auto';
  triggers = { 'docker.local': trigger('docker.local') };
  storeContainer._resetContainerStoreStateForTests();
  db = createMigratedMemoryDatabase();
  storeContainer.createCollections(db);
  groupPolicyStore.createCollections(db);
});

afterEach(() => {
  groupPolicyStore.clearCollectionForTesting();
  db.close();
});

describe('GET /containers/:id/effective-policy', () => {
  test('is 404 for a container that does not exist', async () => {
    const result = await get('missing');
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Container not found' });
  });

  test('a read key can fetch it and a key without read cannot', async () => {
    storeContainer.insertContainer(watched('member'));
    const key = (scopes: string[]) => ({
      kind: 'api-key',
      username: 'ci',
      keyId: 'abcdef012345', // gitleaks:allow — an audit actor label, not a credential
      scopes,
      parentKeyId: null,
    });

    expect((await get('member', key(['read']))).status).toBe(200);
    expect((await get('member', key(['triggers:test']))).status).toBe(403);
  });

  test('reports an ungrouped container with no group', async () => {
    storeContainer.insertContainer(watched('solo', { labels: {} }));

    const body = await getContract('solo');

    expect(body.group).toBeNull();
    expect(body.actions.updateMode).toEqual({ value: 'auto', source: 'global', global: 'auto' });
  });

  test('agrees with the update policy the store finalized onto the record', async () => {
    policy({
      updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 14, skipTags: ['1.9.9'] },
    });
    storeContainer.insertContainer(
      watched('member', {}, { env: { maturityMode: 'all' }, label: { skipTags: ['2.0.0'] } }),
    );

    const stored = storeContainer.getContainer('member') as Container;
    const body = await getContract('member');

    for (const field of ['maturityMode', 'maturityMinAgeDays', 'skipTags'] as const) {
      expect(body.updatePolicy[field].value).toEqual(stored.updatePolicy?.[field]);
      expect(body.updatePolicy[field].source).toBe(stored.updatePolicySources?.[field]);
    }
    expect(body.updatePolicy.maturityMode).toEqual({
      value: 'mature',
      source: 'group',
      layers: { env: 'all', group: 'mature' },
    });
    expect(body.updatePolicy.skipTags.source).toBe('label');
    expect(body.group).toEqual({
      name: 'payments',
      label: 'com.docker.compose.project',
      policyId: stored.groupPolicy?.id,
      revision: 1,
    });
  });

  test('reads the group rule live when the stored snapshot is stale', async () => {
    storeContainer.insertContainer(watched('member'));
    expect((await getContract('member')).actions.updateMode.source).toBe('global');

    policy({ actions: { updateMode: 'manual' } });

    const body = await getContract('member');
    expect(body.actions.updateMode).toEqual({
      value: 'manual',
      source: 'group',
      global: 'auto',
      group: 'manual',
    });
    expect(body.actions.dispatch.automatic).toBe(false);
  });

  test('reads the global update mode live', async () => {
    storeContainer.insertContainer(watched('member'));
    globalMode = 'manual';

    const body = await getContract('member');

    expect(body.actions.updateMode).toEqual({
      value: 'manual',
      source: 'global',
      global: 'manual',
    });
    expect(body.actions.dispatch.automatic).toBe(false);
  });

  test('attributes a Drydock override of the container exclusion', async () => {
    storeContainer.insertContainer(
      watched('member', {
        actionTriggerExclude: 'docker.local',
        labelOwnedSources: { actionTriggerExclude: 'override' },
      }),
    );
    const stored = storeContainer.getContainer('member') as Container;
    expect(stored.actionTriggerExclude).toBe('docker.local');

    const body = await getContract('member');

    expect(body.actions.exclude.label).toBe('docker.local');
    expect(body.actions.dispatch.trigger).toMatchObject({ state: 'blocked', excludedBy: 'label' });
  });

  test('serves no runtime environment, whatever the container carries', async () => {
    storeContainer.insertContainer(
      watched('member', {
        details: { ports: [], volumes: [], env: [{ key: 'DB_PASSWORD', value: 'hunter2' }] }, // gitleaks:allow — fixture value
      }),
    );

    const result = await get('member');

    expect(JSON.stringify(result.body)).not.toContain('hunter2');
  });

  test('works with no registered triggers', async () => {
    triggers = undefined;
    storeContainer.insertContainer(watched('member'));

    const body = await getContract('member');

    expect(body.actions.dispatch).toEqual({
      automatic: false,
      trigger: null,
      manualUpdate: { allowed: false, blockedBy: 'no-trigger' },
    });
  });
});
