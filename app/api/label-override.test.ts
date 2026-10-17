import http from 'node:http';
import { createRequire } from 'node:module';
import express from 'express';
import { createContainerFixture } from '../test/helpers.js';

const { state, dockerode, fsWrite } = vi.hoisted(() => ({
  state: { trigger: {} as Record<string, unknown>, watcher: {} as Record<string, unknown> },
  dockerode: vi.fn(),
  fsWrite: vi.fn(),
}));
vi.mock('../registry/index.js', () => ({ getState: () => state }));
vi.mock('dockerode', () => ({ default: dockerode }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  writeFile: fsWrite,
}));

import type { Container } from '../model/container.js';
import { isAgentEnforcedWatcher, setAgentEnforcementResolver } from '../model/label-owned.js';
import * as auditStore from '../store/audit.js';
import * as storeContainer from '../store/container.js';
import type { Database } from '../store/db/driver.js';
import * as labelOverrideStore from '../store/label-override.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import * as labelOverrideRouter from './label-override.js';
import { openApiSchemas } from './openapi/schemas.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020.js') as typeof import('ajv/dist/2020.js').default;
const requestValidator = new Ajv2020({ strict: false, allowUnionTypes: true }).compile(
  openApiSchemas.LabelOverridePatchRequest,
);

const COMPOSE = { 'com.docker.compose.project': 'media', 'com.docker.compose.service': 'sonarr' };
const CONTAINER_PATH = '/api/v1/containers/{id}/label-overrides';
const ROW_PATH = '/api/v1/label-overrides/{overrideId}';

let db: Database;
let server: http.Server;
let port: number;
const triggerCalls = vi.fn();

interface Principal {
  kind: 'session' | 'api-key';
  username: string;
  keyId?: string;
  scopes?: string[];
}

const ADMIN_KEY: Principal = {
  kind: 'api-key',
  username: 'ci',
  keyId: 'abc123',
  scopes: ['admin'],
};

function trigger(id: string, type: string, extras: Record<string, unknown> = {}) {
  return {
    type,
    name: id.split('.').at(-1),
    getId: () => id,
    trigger: triggerCalls,
    triggerBatch: triggerCalls,
    configuration: {},
    ...extras,
  };
}

function watched(id: string, overrides: Record<string, unknown> = {}, name = 'web'): Container {
  return createContainerFixture({
    id,
    name,
    displayName: name,
    watcher: 'local',
    labels: {},
    ...overrides,
  }) as unknown as Container;
}

function sonarr(id: string, overrides: Record<string, unknown> = {}) {
  return watched(id, { labels: COMPOSE, ...overrides }, `media-sonarr-${id}`);
}

async function call(
  method: string,
  path: string,
  options: { body?: unknown; principal?: Principal } = {},
) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-test-principal': JSON.stringify(
        options.principal ?? { kind: 'session', username: 'admin' },
      ),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : undefined };
}

/** A save past revision 0 names the row it read, as the endpoint requires. */
const withRowId = (body: unknown) => {
  const candidate = body as { revision?: number; overrideId?: string };
  return typeof candidate?.revision === 'number' &&
    candidate.revision > 0 &&
    candidate.overrideId === undefined
    ? { ...candidate, overrideId: labelOverrideStore.getLabelOverrides().at(0)?.id }
    : body;
};
const patch = (id: string, body: unknown, principal?: Principal) =>
  call('PATCH', `/api/v1/containers/${id}/label-overrides`, {
    body: withRowId(body),
    principal,
  });
const get = (id: string, principal?: Principal) =>
  call('GET', `/api/v1/containers/${id}/label-overrides`, { principal });
const currentOverrideId = () => labelOverrideStore.getLabelOverrides().at(0)?.id;
const reset = (
  id: string,
  revision: unknown,
  principal?: Principal,
  overrideId: string | undefined = currentOverrideId(),
) =>
  call(
    'DELETE',
    `/api/v1/containers/${id}/label-overrides?revision=${revision}${
      overrideId === undefined ? '' : `&overrideId=${overrideId}`
    }`,
    { principal },
  );

function expectContract(path: string, method: string, status: number, payload: unknown) {
  expect(
    validateOpenApiJsonResponse({
      path,
      method: method as 'get',
      statusCode: String(status),
      payload,
    }),
  ).toEqual({ valid: true, errors: [] });
}

function set(field: string, value: unknown) {
  return { field, op: 'set', value };
}

/** A PATCH that must succeed, contract-checked on both sides. */
async function save(id: string, revision: number, ...changes: unknown[]) {
  const body = withRowId({ revision, changes });
  expect(requestValidator(body)).toBe(true);
  const result = await patch(id, body);
  expect(result.status).toBe(200);
  expectContract(CONTAINER_PATH, 'patch', 200, result.json);
  return result.json;
}

function audits(action?: string) {
  return auditStore
    .getAuditEntries({ limit: 100 })
    .entries.filter((entry) => action === undefined || entry.action === action);
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { principal: unknown }).principal = JSON.parse(
      String(req.headers['x-test-principal']),
    );
    next();
  });
  app.use('/api/v1/containers', labelOverrideRouter.init());
  app.use('/api/v1/label-overrides', labelOverrideRouter.initCollection());
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  setAgentEnforcementResolver((container) => isAgentEnforcedWatcher(container, state.watcher));
  vi.restoreAllMocks();
  vi.clearAllMocks();
  storeContainer._resetContainerStoreStateForTests();
  db = createMigratedMemoryDatabase();
  storeContainer.createCollections(db);
  labelOverrideStore.createCollections(db);
  auditStore.createCollections(db);
  state.trigger = {
    'docker.local': trigger('docker.local', 'docker', { configuration: { auto: 'onauto' } }),
    'dockercompose.stack': trigger('dockercompose.stack', 'dockercompose'),
    'slack.ops': trigger('slack.ops', 'slack'),
    'edge.docker.edge': trigger('edge.docker.edge', 'docker', { agent: 'edge' }),
  };
  state.watcher = {};
});

afterEach(() => {
  setAgentEnforcementResolver(undefined);
  labelOverrideStore.clearCollectionForTesting();
  db.close();
});

describe('GET /containers/:id/label-overrides', () => {
  test('shows every field with declared, override and effective values', async () => {
    storeContainer.insertContainer(
      sonarr('1', {
        displayName: 'Sonarr',
        labels: { ...COMPOSE, 'dd.display.name': 'Sonarr' },
        dependsOn: ['db'],
        dependsOnSource: 'compose',
        actionTriggerInclude: 'docker.local:major',
      }),
    );
    storeContainer.insertContainer(sonarr('2', { displayName: 'Sonarr' }));

    const { status, json } = await get('1');

    expect(status).toBe(200);
    expectContract(CONTAINER_PATH, 'get', 200, json);
    expect(json).toMatchObject({
      containerId: '1',
      scope: {
        kind: 'compose-service',
        agent: null,
        watcher: 'local',
        name: 'media/sonarr',
        appliesTo: [
          { id: '1', name: 'media-sonarr-1' },
          { id: '2', name: 'media-sonarr-2' },
        ],
      },
      overrideId: null,
      revision: 0,
      readOnlyReason: null,
      agentEnforcedActionRouting: false,
      warnings: [],
    });
    expect(Object.keys(json.fields)).toEqual([
      'displayName',
      'displayIcon',
      'dependsOn',
      'dependsOnAction',
      'notificationTriggerInclude',
      'notificationTriggerExclude',
      'actionTriggerInclude',
      'actionTriggerExclude',
      'actionTriggerAuto',
    ]);
    expect(json.fields.displayName).toEqual({
      labelKey: 'dd.display.name',
      label: 'Sonarr',
      declared: { value: 'Sonarr', source: 'label' },
      override: null,
      effective: { value: 'Sonarr', source: 'label' },
    });
    expect(json.fields.dependsOn.declared).toEqual({ value: ['db'], source: 'compose' });
    expect(json.fields.actionTriggerInclude.effective).toEqual({
      value: ['docker.local:major'],
      source: 'watcher',
    });
    expect(json.fields.actionTriggerAuto.effective).toEqual({ value: null, source: 'unset' });
  });

  test('reports an agent scope and a record the store has not captured yet', async () => {
    storeContainer.insertContainer(watched('1', { agent: 'edge', displayName: 'Shown' }, 'web'));
    db.prepare('UPDATE containers SET label_owned = NULL').run();

    const { json } = await get('1');

    expect(json.scope.agent).toBe('edge');
    expect(json.fields.displayName.effective).toEqual({ value: 'Shown', source: 'watcher' });
  });

  test('404s an unknown container and 409s one with no scope', async () => {
    expect((await get('nope')).status).toBe(404);
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue({ id: 'x', name: 'x' } as Container);
    const result = await get('x');
    expect(result.status).toBe(409);
    expectContract(CONTAINER_PATH, 'get', 409, result.json);
  });

  test('a rollback container reads, and says it is read-only', async () => {
    storeContainer.insertContainer(watched('1', {}, 'web-old-1760000000000'));
    const { status, json } = await get('1');
    expect(status).toBe(200);
    expect(json.readOnlyReason).toBe('rollback-container');
    expect(json.scope.name).toBe('web');
  });

  test('reports stored fields it could not read and refs whose trigger is gone', async () => {
    storeContainer.insertContainer(watched('1'));
    await save('1', 0, set('actionTriggerInclude', ['docker.local']));
    state.trigger = {};
    db.prepare(
      "UPDATE container_label_overrides SET fields = json_set(fields, '$.bogus', json('{}'))",
    ).run();
    labelOverrideStore.createCollections(db);

    const { json } = await get('1');

    expect(json.warnings).toEqual([
      { field: 'actionTriggerInclude', code: 'stale-trigger-reference', reference: 'docker.local' },
    ]);
    expect(json.invalidStoredOverride).toEqual([{ field: 'bogus', reason: 'unknown field' }]);
    expectContract(CONTAINER_PATH, 'get', 200, json);
  });

  test('a failure reading the scope is a sanitized 500', async () => {
    storeContainer.insertContainer(watched('1'));
    vi.spyOn(storeContainer, 'getContainers').mockImplementation(() => {
      throw new Error('boom');
    });
    const result = await get('1');
    expect(result.status).toBe(500);
    expectContract(CONTAINER_PATH, 'get', 500, result.json);
  });

  test('a read key may read and a key with no scope may not', async () => {
    storeContainer.insertContainer(watched('1'));
    const readKey = { kind: 'api-key', username: 'k', keyId: 'k1', scopes: ['read'] } as const;
    const noScope = { kind: 'api-key', username: 'k', keyId: 'k2', scopes: [] } as const;
    expect((await get('1', readKey)).status).toBe(200);
    expect((await get('1', noScope)).status).toBe(403);
  });
});

describe('PATCH /containers/:id/label-overrides', () => {
  test('sets a field: stored, applied to every replica, announced and audited once', async () => {
    storeContainer.insertContainer(sonarr('1', { displayName: 'Sonarr' }));
    storeContainer.insertContainer(sonarr('2', { displayName: 'Sonarr' }));

    const json = await save('1', 0, set('displayName', ' TV '), set('displayIcon', 'SH-Sonarr'));

    expect(json).toMatchObject({
      overrideId: expect.any(String),
      revision: 1,
      changed: ['displayName', 'displayIcon'],
      warnings: [],
    });
    expect(json.fields.displayName).toMatchObject({
      declared: { value: 'Sonarr', source: 'watcher' },
      override: { value: 'TV', updatedBy: 'user:admin' },
      effective: { value: 'TV', source: 'override' },
    });
    expect(json.fields.displayIcon.effective).toEqual({ value: 'sh:Sonarr', source: 'override' });
    expect(storeContainer.getContainer('2')).toMatchObject({
      displayName: 'TV',
      displayIcon: 'sh:Sonarr',
    });

    const entries = audits('label-override-set');
    expect(entries).toHaveLength(1);
    expect(audits('label-override-cleared')).toHaveLength(0);
    expect(entries[0]).toMatchObject({
      containerName: 'media-sonarr-1',
      containerIdentityKey: '::local::compose:media/sonarr',
      status: 'success',
    });
    expect(JSON.parse(entries[0].details as string)).toEqual({
      operation: 'patch',
      scope: { kind: 'compose-service', agent: null, watcher: 'local', name: 'media/sonarr' },
      fields: {
        displayName: {
          label: null,
          declared: 'Sonarr',
          before: null,
          after: 'TV',
          effectiveSource: 'override',
        },
        displayIcon: {
          label: null,
          declared: expect.any(String),
          before: null,
          after: 'sh:Sonarr',
          effectiveSource: 'override',
        },
      },
    });
  });

  test('an api key is recorded by key id, never by secret', async () => {
    storeContainer.insertContainer(watched('1'));
    const result = await patch('1', { revision: 0, changes: [set('displayName', 'x')] }, ADMIN_KEY);
    expect(result.json.fields.displayName.override.updatedBy).toBe('api-key:abc123');
  });

  test('a session with no username is recorded as unknown', async () => {
    storeContainer.insertContainer(watched('1'));
    const result = await call('PATCH', '/api/v1/containers/1/label-overrides', {
      body: { revision: 0, changes: [set('displayName', 'x')] },
      principal: { kind: 'session' } as never,
    });
    expect(result.json.fields.displayName.override.updatedBy).toBe('user:unknown');
  });

  test('truncates audited values to 256 characters', async () => {
    storeContainer.insertContainer(watched('1'));
    await save(
      '1',
      0,
      set(
        'dependsOn',
        Array.from({ length: 30 }, (_, index) => `c${'x'.repeat(20)}${index}`),
      ),
    );
    const details = JSON.parse(audits('label-override-set')[0].details as string);
    expect(details.fields.dependsOn.after).toHaveLength(256);
  });

  test('remove clears one field, and removing the last field deletes the row', async () => {
    storeContainer.insertContainer(watched('1', { displayName: 'Docker name' }));
    await save('1', 0, set('displayName', 'TV'), set('displayIcon', 'hl:x'));

    const partial = await save('1', 1, { field: 'displayName', op: 'remove' });
    expect(partial).toMatchObject({ revision: 2, changed: ['displayName'] });
    expect(partial.fields.displayName.effective.source).toBe('watcher');
    expect(storeContainer.getContainer('1')?.displayName).toBe('Docker name');

    const last = await save('1', 2, { field: 'displayIcon', op: 'remove' });
    expect(last).toMatchObject({ revision: 0, overrideId: null });
    expect(labelOverrideStore.getLabelOverrides()).toEqual([]);

    const cleared = audits('label-override-cleared');
    expect(cleared).toHaveLength(2);
    expect(JSON.parse(cleared[0].details as string).fields.displayIcon).toMatchObject({
      before: 'hl:x',
      after: null,
    });
  });

  test('a set and a remove together write one audit row of each kind', async () => {
    storeContainer.insertContainer(watched('1'));
    await save('1', 0, set('displayName', 'TV'));
    await save('1', 1, set('displayIcon', 'si:x'), { field: 'displayName', op: 'remove' });
    expect(audits('label-override-set')).toHaveLength(2);
    expect(audits('label-override-cleared')).toHaveLength(1);
  });

  test('saving what is already saved, or removing what is not there, changes nothing', async () => {
    storeContainer.insertContainer(watched('1'));
    await save('1', 0, set('displayName', 'TV'));
    const auditCount = audits().length;

    const same = await save('1', 1, set('displayName', 'TV'), {
      field: 'displayIcon',
      op: 'remove',
    });

    expect(same).toMatchObject({ revision: 1, changed: [] });
    expect(audits()).toHaveLength(auditCount);
    const bare = await save('1', 1, { field: 'actionTriggerAuto', op: 'remove' });
    expect(bare.changed).toEqual([]);
  });

  test('a stale revision writes nothing and hands back the current snapshot', async () => {
    storeContainer.insertContainer(watched('1'));
    await save('1', 0, set('displayName', 'TV'));
    const auditCount = audits().length;

    const result = await patch('1', { revision: 0, changes: [set('displayName', 'Other')] });

    expect(result.status).toBe(409);
    expectContract(CONTAINER_PATH, 'patch', 409, result.json);
    expect(result.json.snapshot.fields.displayName.override.value).toBe('TV');
    expect(storeContainer.getContainer('1')?.displayName).toBe('TV');
    expect(audits()).toHaveLength(auditCount);
  });

  test('a write that loses a race at the store is a 409 too', async () => {
    storeContainer.insertContainer(watched('1'));
    vi.spyOn(storeContainer, 'mutateLabelOverrides').mockReturnValue({
      record: undefined,
      applied: false,
      refreshed: 0,
    });
    const result = await patch('1', { revision: 0, changes: [set('displayName', 'x')] });
    expect(result.status).toBe(409);
    expect(result.json.snapshot).toBeDefined();
  });

  test.each([
    [{ revision: 0 }, [{ field: 'changes', code: 'invalid-changes' }]],
    [
      { revision: 0, changes: [set('displayName', '<b>')] },
      [{ field: 'displayName', code: 'display-name-invalid-characters' }],
    ],
    [
      { revision: 0, changes: [set('displayIcon', 'https://example.com/a.png')] },
      [{ field: 'displayIcon', code: 'invalid-icon' }],
    ],
    [
      { revision: 0, changes: [set('nope', 'x'), set('dependsOnAction', 'later')] },
      [
        { field: 'nope', code: 'unknown-field' },
        { field: 'dependsOnAction', code: 'invalid-action' },
      ],
    ],
  ])('rejects an invalid body %j', async (body, errors) => {
    storeContainer.insertContainer(watched('1'));
    const result = await patch('1', body);
    expect(result.status).toBe(400);
    expect(result.json.errors).toEqual(errors);
    expectContract(CONTAINER_PATH, 'patch', 400, result.json);
    expect(labelOverrideStore.getLabelOverrides()).toEqual([]);
  });

  test('404s an unknown container and 409s a rollback container', async () => {
    expect((await patch('nope', { revision: 0, changes: [set('displayName', 'x')] })).status).toBe(
      404,
    );
    storeContainer.insertContainer(watched('1', {}, 'web-old-1760000000000'));
    const result = await patch('1', { revision: 0, changes: [set('displayName', 'x')] });
    expect(result.status).toBe(409);
    expect(result.json.readOnlyReason).toBe('rollback-container');
    expectContract(CONTAINER_PATH, 'patch', 409, result.json);
  });

  test('a store validation failure is a 400, anything else a sanitized 500', async () => {
    storeContainer.insertContainer(watched('1'));
    vi.spyOn(storeContainer, 'mutateLabelOverrides').mockImplementationOnce(() => {
      throw new labelOverrideStore.LabelOverrideValidationError('displayName', 'bad');
    });
    const invalid = await patch('1', { revision: 0, changes: [set('displayName', 'x')] });
    expect(invalid.status).toBe(400);
    expect(invalid.json.errors).toEqual([{ field: 'displayName', code: 'invalid-value' }]);

    vi.spyOn(storeContainer, 'mutateLabelOverrides').mockImplementationOnce(() => {
      throw new Error('disk exploded');
    });
    const failed = await patch('1', { revision: 0, changes: [set('displayName', 'x')] });
    expect(failed.status).toBe(500);
    expectContract(CONTAINER_PATH, 'patch', 500, failed.json);
  });

  test('the audit row and the write commit together: a failed audit saves nothing', async () => {
    storeContainer.insertContainer(watched('1', { displayName: 'Docker name' }));
    vi.spyOn(auditStore, 'insertAudit').mockImplementationOnce(() => {
      throw new Error('audit failed');
    });

    const result = await patch('1', { revision: 0, changes: [set('displayName', 'TV')] });

    expect(result.status).toBe(500);
    expect(storeContainer.getContainer('1')?.displayName).toBe('Docker name');
    expect(labelOverrideStore.getLabelOverrides()).toEqual([]);
  });

  describe('scopes', () => {
    test('writes need admin: read and containers:update keys are refused, admin and a session pass', async () => {
      storeContainer.insertContainer(watched('1'));
      const body = { revision: 0, changes: [set('displayName', 'x')] };
      const key = (scopes: string[]): Principal => ({
        kind: 'api-key',
        username: 'k',
        keyId: 'k1',
        scopes,
      });
      expect((await patch('1', body, key(['read']))).status).toBe(403);
      expect((await patch('1', body, key(['containers:update']))).status).toBe(403);
      expect((await reset('1', 0, key(['containers:update']))).status).toBe(403);
      expect(labelOverrideStore.getLabelOverrides()).toEqual([]);
      expect((await patch('1', body, key(['admin']))).status).toBe(200);
      expect(
        (await patch('1', { ...body, revision: 1, changes: [set('displayName', 'y')] })).status,
      ).toBe(200);
    });
  });

  describe('routing', () => {
    test('accepts references that match a trigger of the field category', async () => {
      storeContainer.insertContainer(watched('1'));
      const json = await save(
        '1',
        0,
        set('actionTriggerInclude', ['docker.local:MAJOR']),
        set('notificationTriggerExclude', ['ops']),
        set('actionTriggerAuto', ['docker.local']),
      );
      expect(json.fields.actionTriggerInclude.override.value).toEqual(['docker.local:major']);
      expect(storeContainer.getContainer('1')).toMatchObject({
        actionTriggerInclude: 'docker.local:major',
        notificationTriggerExclude: 'ops',
      });
      expect(json.warnings).toEqual([]);
    });

    test('an empty list is an explicit none', async () => {
      storeContainer.insertContainer(watched('1', { actionTriggerExclude: 'docker.local' }));
      const json = await save('1', 0, set('actionTriggerExclude', []));
      expect(json.fields.actionTriggerExclude.effective).toEqual({ value: [], source: 'override' });
      expect(storeContainer.getContainer('1')?.actionTriggerExclude).toBeUndefined();
    });

    test('rejects unknown triggers and the wrong category', async () => {
      storeContainer.insertContainer(watched('1'));
      const result = await patch('1', {
        revision: 0,
        changes: [
          set('actionTriggerInclude', ['ghost', 'ops']),
          set('notificationTriggerInclude', ['docker.local']),
        ],
      });
      expect(result.status).toBe(400);
      expect(result.json.errors).toEqual([
        { field: 'actionTriggerInclude', code: 'unknown-trigger-reference', entries: ['ghost'] },
        { field: 'actionTriggerInclude', code: 'wrong-trigger-category', entries: ['ops'] },
        {
          field: 'notificationTriggerInclude',
          code: 'wrong-trigger-category',
          entries: ['docker.local'],
        },
      ]);
    });

    test('warns, without refusing, about another agent trigger and an inert auto reference', async () => {
      storeContainer.insertContainer(watched('1'));
      const json = await save(
        '1',
        0,
        set('actionTriggerInclude', ['docker.edge']),
        set('actionTriggerAuto', ['stack']),
      );
      expect(json.warnings).toEqual([
        { field: 'actionTriggerInclude', code: 'trigger-agent-mismatch', reference: 'docker.edge' },
        { field: 'actionTriggerAuto', code: 'auto-inert', reference: 'stack' },
      ]);
    });
  });

  describe('traditional agents', () => {
    beforeEach(() => {
      state.watcher = {
        'edge.docker.local': { type: 'docker', name: 'local', agent: 'edge', configuration: {} },
        'pw.docker.local': {
          type: 'docker',
          name: 'local',
          agent: 'pw',
          configuration: { transport: 'docker-api', execution: 'controller', events: 'portwing' },
        },
      };
      state.trigger['edge.docker.edge'] = trigger('edge.docker.edge', 'docker', { agent: 'edge' });
      state.trigger['pw.docker.pw'] = trigger('pw.docker.pw', 'docker', { agent: 'pw' });
    });

    test('flags the snapshot and refuses widening with the offending entries', async () => {
      storeContainer.insertContainer(
        watched('1', {
          agent: 'edge',
          actionTriggerInclude: 'docker.edge:major',
          actionTriggerExclude: 'docker.edge:minor',
        }),
      );
      expect((await get('1')).json.agentEnforcedActionRouting).toBe(true);

      const result = await patch('1', {
        revision: 0,
        changes: [
          set('actionTriggerInclude', ['docker.edge']),
          set('actionTriggerExclude', []),
          set('actionTriggerAuto', ['docker.edge']),
        ],
      });

      expect(result.status).toBe(400);
      expect(result.json.errors).toEqual([
        {
          field: 'actionTriggerInclude',
          code: 'agent-enforced-widening',
          entries: ['docker.edge:all'],
        },
        {
          field: 'actionTriggerExclude',
          code: 'agent-enforced-widening',
          entries: ['docker.edge:minor'],
        },
        {
          field: 'actionTriggerAuto',
          code: 'agent-enforced-widening',
          entries: ['docker.edge:all'],
        },
      ]);
    });

    test('accepts narrowing, and widening notification routing, which the controller owns', async () => {
      storeContainer.insertContainer(
        watched('1', {
          agent: 'edge',
          actionTriggerInclude: 'docker.edge',
          actionTriggerExclude: 'docker.edge:minor',
        }),
      );
      const json = await save(
        '1',
        0,
        set('actionTriggerInclude', ['docker.edge:major']),
        set('actionTriggerExclude', ['docker.edge:minor', 'docker.edge:major']),
        set('notificationTriggerInclude', ['ops']),
      );
      expect(json.changed).toHaveLength(3);
    });

    test('refuses an include on a container whose agent declares none', async () => {
      storeContainer.insertContainer(watched('1', { agent: 'edge' }));
      const result = await patch('1', {
        revision: 0,
        changes: [set('actionTriggerInclude', ['docker.edge'])],
      });
      expect(result.status).toBe(400);
      expect(result.json.errors).toEqual([
        {
          field: 'actionTriggerInclude',
          code: 'agent-enforced-widening',
          entries: ['docker.edge:all'],
        },
      ]);
    });

    test('shows the effective value composed with the agent labels after they change', async () => {
      storeContainer.insertContainer(
        watched('1', { agent: 'edge', actionTriggerExclude: 'docker.edge:minor' }),
      );
      await save('1', 0, set('actionTriggerExclude', ['docker.edge:minor', 'docker.edge:major']));
      storeContainer.updateContainer(
        watched('1', {
          agent: 'edge',
          actionTriggerExclude: 'docker.edge:minor,slack.ops',
        }),
        { labelOwned: 'declared' },
      );

      const { json } = await get('1');

      expect(json.fields.actionTriggerExclude.effective).toEqual({
        value: ['docker.edge:minor', 'slack.ops', 'docker.edge:major'],
        source: 'override',
      });
      expect(storeContainer.getContainer('1')?.actionTriggerExclude).toBe(
        'docker.edge:minor,slack.ops,docker.edge:major',
      );
    });

    test('a Portwing controller-transport container is unrestricted', async () => {
      storeContainer.insertContainer(
        watched('1', { agent: 'pw', actionTriggerInclude: 'docker.pw:major' }),
      );
      expect((await get('1')).json.agentEnforcedActionRouting).toBe(false);
      const json = await save('1', 0, set('actionTriggerInclude', []));
      expect(json.changed).toEqual(['actionTriggerInclude']);
    });
  });

  describe('dependencies', () => {
    test('accepts names with warnings for the unresolved and the cross-host', async () => {
      storeContainer.insertContainer(watched('1'));
      storeContainer.insertContainer(watched('2', {}, 'db'));
      storeContainer.insertContainer(watched('3', { agent: 'edge' }, 'queue'));

      const json = await save('1', 0, set('dependsOn', ['db', 'ghost', 'queue']));

      expect(json.warnings).toEqual([
        { field: 'dependsOn', code: 'unresolved-dependency', reference: 'ghost' },
        { field: 'dependsOn', code: 'cross-host-dependency', reference: 'queue' },
      ]);
      expect(storeContainer.getContainer('1')).toMatchObject({
        dependsOn: ['db', 'ghost', 'queue'],
        dependsOnSource: 'override',
      });
      expect(json.fields.dependsOn.effective.source).toBe('override');
    });

    test('refuses a container depending on itself or a replica of its own service', async () => {
      storeContainer.insertContainer(sonarr('1'));
      storeContainer.insertContainer(sonarr('2'));
      const result = await patch('1', {
        revision: 0,
        changes: [set('dependsOn', ['media-sonarr-2'])],
      });
      expect(result.status).toBe(400);
      expect(result.json.errors).toEqual([
        { field: 'dependsOn', code: 'depends-on-self', entries: ['media-sonarr-2'] },
      ]);
    });

    test('refuses a new cycle with 422 and the names in it', async () => {
      storeContainer.insertContainer(watched('1', {}, 'web'));
      storeContainer.insertContainer(
        watched('2', { dependsOn: ['web'], dependsOnSource: 'label' }, 'api'),
      );

      const result = await patch('1', { revision: 0, changes: [set('dependsOn', ['api'])] });

      expect(result.status).toBe(422);
      expect(result.json.cycle).toEqual(['api', 'web']);
      expectContract(CONTAINER_PATH, 'patch', 422, result.json);
      expect(labelOverrideStore.getLabelOverrides()).toEqual([]);
    });
  });

  test('saving never touches Docker, Compose files or triggers', async () => {
    storeContainer.insertContainer(sonarr('1'));
    await save('1', 0, set('displayName', 'TV'), set('actionTriggerAuto', ['docker.local']));
    await save('1', 1, { field: 'displayName', op: 'remove' });
    await reset('1', 2);
    await call('GET', '/api/v1/label-overrides');

    expect(dockerode).not.toHaveBeenCalled();
    expect(fsWrite).not.toHaveBeenCalled();
    expect(triggerCalls).not.toHaveBeenCalled();
  });
});

describe('PATCH overrideId', () => {
  test('a stale tab cannot write into a newer row that restarted at the same revision', async () => {
    storeContainer.insertContainer(watched('1'));
    await save('1', 0, set('displayName', 'First'));
    const staleId = labelOverrideStore.getLabelOverrides()[0].id;
    await save('1', 1, { field: 'displayName', op: 'remove' });
    await save('1', 0, set('displayName', 'Second'));
    const [fresh] = labelOverrideStore.getLabelOverrides();
    expect(fresh).toMatchObject({ revision: 1 });

    const stale = await patch('1', {
      revision: 1,
      overrideId: staleId,
      changes: [set('displayName', 'Stale write')],
    });

    expect(stale.status).toBe(409);
    expectContract(CONTAINER_PATH, 'patch', 409, stale.json);
    expect(stale.json.snapshot.overrideId).toBe(fresh.id);
    expect(storeContainer.getContainer('1')?.displayName).toBe('Second');
  });

  test('a save past revision 0 without the id is a 400, and revision 0 needs none', async () => {
    storeContainer.insertContainer(watched('1'));
    await save('1', 0, set('displayName', 'First'));
    for (const overrideId of [undefined, '', 7]) {
      const result = await call('PATCH', '/api/v1/containers/1/label-overrides', {
        body: { revision: 1, overrideId, changes: [set('displayName', 'x')] },
      });
      expect(result.status).toBe(400);
      expect(result.json.errors).toEqual([{ field: 'overrideId', code: 'invalid-override-id' }]);
      expectContract(CONTAINER_PATH, 'patch', 400, result.json);
    }
  });
});

describe('DELETE /containers/:id/label-overrides', () => {
  test('resets every field to its labels, announces it and audits it once', async () => {
    storeContainer.insertContainer(sonarr('1', { displayName: 'Sonarr' }));
    storeContainer.insertContainer(sonarr('2', { displayName: 'Sonarr' }));
    await save('1', 0, set('displayName', 'TV'), set('dependsOn', ['db']));

    const result = await reset('1', 1);

    expect(result.status).toBe(200);
    expectContract(CONTAINER_PATH, 'delete', 200, result.json);
    expect(result.json).toMatchObject({
      revision: 0,
      overrideId: null,
      changed: ['displayName', 'dependsOn'],
    });
    expect(storeContainer.getContainer('2')?.displayName).toBe('Sonarr');
    expect(storeContainer.getContainer('2')?.dependsOn).toBeUndefined();
    const entries = audits('label-override-cleared');
    expect(entries).toHaveLength(1);
    const details = JSON.parse(entries[0].details as string);
    expect(details.operation).toBe('reset-all');
    expect(Object.keys(details.fields)).toEqual(['displayName', 'dependsOn']);
  });

  test('an unknown revision, a stale one and a rollback container are refused', async () => {
    storeContainer.insertContainer(watched('1'));
    await save('1', 0, set('displayName', 'TV'));

    for (const revision of ['x', '-1', '1.5', '', '1e3']) {
      const invalid = await reset('1', revision);
      expect(invalid.status).toBe(400);
      expectContract(CONTAINER_PATH, 'delete', 400, invalid.json);
    }
    expect((await call('DELETE', '/api/v1/containers/1/label-overrides')).status).toBe(400);
    // A row at revision 1 or above can only be reset by naming it.
    const unnamed = await call('DELETE', '/api/v1/containers/1/label-overrides?revision=1');
    expect(unnamed.status).toBe(400);
    expect(unnamed.json.errors).toEqual([{ field: 'overrideId', code: 'invalid-override-id' }]);
    expectContract(CONTAINER_PATH, 'delete', 400, unnamed.json);
    const blank = await call(
      'DELETE',
      '/api/v1/containers/1/label-overrides?revision=1&overrideId=',
    );
    expect(blank.status).toBe(400);
    // A repeated key reads as its first value.
    const repeated = await call(
      'DELETE',
      `/api/v1/containers/1/label-overrides?revision=1&overrideId=nope&overrideId=${currentOverrideId()}`,
    );
    expect(repeated.status).toBe(409);

    const stale = await reset('1', 7);
    expect(stale.status).toBe(409);
    expectContract(CONTAINER_PATH, 'delete', 409, stale.json);
    expect(storeContainer.getContainer('1')?.displayName).toBe('TV');

    expect((await reset('nope', 1)).status).toBe(404);
    // A repeated query key reads as its first value.
    expect(
      (
        await call(
          'DELETE',
          `/api/v1/containers/1/label-overrides?revision=1&revision=2&overrideId=${currentOverrideId()}`,
        )
      ).status,
    ).toBe(200);
    storeContainer.insertContainer(watched('2', {}, 'web-old-1760000000000'));
    const rollback = await reset('2', 0);
    expect(rollback.status).toBe(409);
    expect(rollback.json.readOnlyReason).toBe('rollback-container');
  });

  test('with nothing stored, revision 0 is a no-op and any other revision is stale', async () => {
    storeContainer.insertContainer(watched('1'));
    const before = audits().length;
    const noop = await reset('1', 0);
    expect(noop.status).toBe(200);
    expect(noop.json.changed).toEqual([]);
    expect(audits()).toHaveLength(before);
    expect((await reset('1', 3, undefined, 'gone')).status).toBe(409);
  });

  test('a stale tab cannot wipe a newer row that restarted at the same revision', async () => {
    storeContainer.insertContainer(watched('1'));
    await save('1', 0, set('displayName', 'First'));
    const staleId = currentOverrideId();
    await save('1', 1, { field: 'displayName', op: 'remove' });
    expect(labelOverrideStore.getLabelOverrides()).toEqual([]);
    await save('1', 0, set('displayName', 'Second'));
    const [fresh] = labelOverrideStore.getLabelOverrides();
    expect(fresh).toMatchObject({ revision: 1 });
    expect(fresh.id).not.toBe(staleId);

    const stale = await reset('1', 1, undefined, staleId);

    expect(stale.status).toBe(409);
    expectContract(CONTAINER_PATH, 'delete', 409, stale.json);
    expect(stale.json.snapshot.overrideId).toBe(fresh.id);
    expect(storeContainer.getContainer('1')?.displayName).toBe('Second');
    expect((await reset('1', 1, undefined, fresh.id)).status).toBe(200);
  });

  test('a delete that loses a race at the store is a 409', async () => {
    storeContainer.insertContainer(watched('1'));
    await save('1', 0, set('displayName', 'TV'));
    vi.spyOn(storeContainer, 'deleteLabelOverrideAndRefresh').mockReturnValue({
      record: undefined,
      refreshed: 0,
    });
    expect((await reset('1', 1)).status).toBe(409);
  });

  test('the audit row and the reset commit together', async () => {
    storeContainer.insertContainer(watched('1', { displayName: 'Docker name' }));
    await save('1', 0, set('displayName', 'TV'));
    vi.spyOn(auditStore, 'insertAudit').mockImplementationOnce(() => {
      throw new Error('audit failed');
    });
    expect((await reset('1', 1)).status).toBe(500);
    expect(storeContainer.getContainer('1')?.displayName).toBe('TV');
    expect(labelOverrideStore.getLabelOverrides()).toHaveLength(1);
  });
});

describe('GET /label-overrides', () => {
  test('lists every row with the containers it matches, orphans with none', async () => {
    storeContainer.insertContainer(sonarr('1'));
    storeContainer.insertContainer(sonarr('2'));
    storeContainer.insertContainer(watched('3', {}, 'web-old-1760000000000'));
    await save('1', 0, set('displayName', 'TV'));
    labelOverrideStore.transaction(() =>
      labelOverrideStore.writeLabelOverrideChanges(
        {
          key: 'edge::local::gone',
          agent: 'edge',
          watcher: 'local',
          kind: 'container',
          name: 'gone',
        },
        [{ field: 'displayIcon', op: 'set', value: 'hl:x' }],
        'user:admin',
      ),
    );
    storeContainer.insertContainer(watched('4', {}, 'gone-orphan'));
    db.prepare(
      "UPDATE container_label_overrides SET fields = json_set(fields, '$.bogus', json('{}')) WHERE scope_name = 'gone'",
    ).run();
    labelOverrideStore.createCollections(db);

    const { status, json } = await call('GET', '/api/v1/label-overrides');

    expect(status).toBe(200);
    expectContract('/api/v1/label-overrides', 'get', 200, json);
    expect(json.total).toBe(2);
    const byName = Object.fromEntries(json.data.map((row) => [row.scope.name, row]));
    expect(byName['media/sonarr']).toMatchObject({
      scope: { kind: 'compose-service', agent: null },
      matchedContainerIds: ['1', '2'],
      fields: { displayName: { value: 'TV', updatedBy: 'user:admin' } },
    });
    expect(byName.gone).toMatchObject({
      scope: { agent: 'edge' },
      matchedContainerIds: [],
      invalidStoredOverride: [{ field: 'bogus', reason: 'unknown field' }],
    });
  });

  test('a read key may list', async () => {
    const key = { kind: 'api-key', username: 'k', keyId: 'k1', scopes: ['read'] } as const;
    expect((await call('GET', '/api/v1/label-overrides', { principal: key })).status).toBe(200);
  });

  test('a failure is a sanitized 500', async () => {
    vi.spyOn(labelOverrideStore, 'getLabelOverrides').mockImplementation(() => {
      throw new Error('boom');
    });
    expect((await call('GET', '/api/v1/label-overrides')).status).toBe(500);
  });
});

describe('DELETE /label-overrides/:overrideId', () => {
  const rowDelete = (id: string, revision: unknown, principal?: Principal) =>
    call('DELETE', `/api/v1/label-overrides/${id}?revision=${revision}`, { principal });

  test('deletes a row, refreshes its containers and audits it with the stored scope', async () => {
    storeContainer.insertContainer(
      sonarr('1', { displayName: 'Sonarr', labels: { ...COMPOSE, 'dd.display.name': 'Sonarr' } }),
    );
    const { overrideId } = await save('1', 0, set('displayName', 'TV'));

    const result = await rowDelete(overrideId, 1);

    expect(result.status).toBe(200);
    expectContract(ROW_PATH, 'delete', 200, result.json);
    expect(result.json).toMatchObject({
      refreshed: 1,
      deleted: { id: overrideId, matchedContainerIds: ['1'] },
    });
    expect(storeContainer.getContainer('1')?.displayName).toBe('Sonarr');
    const [entry] = audits('label-override-cleared');
    expect(entry).toMatchObject({
      containerName: 'media/sonarr',
      containerIdentityKey: '::local::compose:media/sonarr',
    });
    expect(JSON.parse(entry.details as string)).toMatchObject({
      operation: 'delete-row',
      scope: { kind: 'compose-service', name: 'media/sonarr' },
      fields: {
        displayName: {
          label: 'Sonarr',
          declared: 'Sonarr',
          before: 'TV',
          after: null,
          effectiveSource: 'label',
        },
      },
    });
  });

  test('deletes an orphan, with nothing to refresh and no container state to report', async () => {
    const written = labelOverrideStore.writeLabelOverrideChanges(
      {
        key: 'edge::local::gone',
        agent: 'edge',
        watcher: 'local',
        kind: 'container',
        name: 'gone',
      },
      [{ field: 'displayIcon', op: 'set', value: 'hl:x' }],
      'user:admin',
    );
    const row = written.record as labelOverrideStore.LabelOverrideRecord;

    const result = await rowDelete(row.id, row.revision);

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ refreshed: 0, deleted: { matchedContainerIds: [] } });
    const [entry] = audits('label-override-cleared');
    expect(entry.containerName).toBe('gone');
    expect(JSON.parse(entry.details as string)).toMatchObject({
      operation: 'delete-row',
      scope: { agent: 'edge', name: 'gone' },
      fields: {
        displayIcon: {
          label: null,
          declared: null,
          before: 'hl:x',
          after: null,
          effectiveSource: null,
        },
      },
    });
  });

  test('refuses a bad revision, an unknown row, a stale revision and a read key', async () => {
    storeContainer.insertContainer(watched('1'));
    const { overrideId } = await save('1', 0, set('displayName', 'TV'));

    expect((await rowDelete(overrideId, 0)).status).toBe(400);
    expect((await rowDelete(overrideId, 'x')).status).toBe(400);
    expect((await rowDelete('nope', 1)).status).toBe(404);
    const stale = await rowDelete(overrideId, 9);
    expect(stale.status).toBe(409);
    expectContract(ROW_PATH, 'delete', 409, stale.json);
    expect(stale.json.current.revision).toBe(1);
    const readKey = { kind: 'api-key', username: 'k', keyId: 'k1', scopes: ['read'] } as const;
    expect((await rowDelete(overrideId, 1, readKey)).status).toBe(403);
    expect(labelOverrideStore.getLabelOverrides()).toHaveLength(1);
  });

  test('a delete that loses a race at the store is a 409, with the row if it is still there', async () => {
    storeContainer.insertContainer(watched('1'));
    const { overrideId } = await save('1', 0, set('displayName', 'TV'));
    const real = storeContainer.deleteLabelOverrideAndRefresh;
    vi.spyOn(storeContainer, 'deleteLabelOverrideAndRefresh').mockReturnValueOnce({
      record: undefined,
      refreshed: 0,
    });
    const stillThere = await rowDelete(overrideId, 1);
    expect(stillThere.status).toBe(409);
    expect(stillThere.json.current.id).toBe(overrideId);

    vi.spyOn(storeContainer, 'deleteLabelOverrideAndRefresh').mockImplementationOnce(
      (id, revision) => {
        real(id, revision);
        return { record: undefined, refreshed: 0 };
      },
    );
    const gone = await rowDelete(overrideId, 1);
    expect(gone.status).toBe(409);
    expect(gone.json.current).toBeUndefined();
  });

  test('the audit row and the delete commit together', async () => {
    storeContainer.insertContainer(watched('1'));
    const { overrideId } = await save('1', 0, set('displayName', 'TV'));
    vi.spyOn(auditStore, 'insertAudit').mockImplementationOnce(() => {
      throw new Error('audit failed');
    });
    expect((await rowDelete(overrideId, 1)).status).toBe(500);
    expect(labelOverrideStore.getLabelOverrides()).toHaveLength(1);
  });
});
