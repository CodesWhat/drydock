/**
 * Spec 7.3 group policies on agent ingest. Agents never hold policies: they report env and
 * label layers, AgentClient and agent inventory resolve overrides provisionally, and the
 * controller's store adds the group layer at the write. This drives both ingest paths into
 * the real store/container.js and store/group-policy.js against an in-memory database.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Container } from '../model/container.js';
import { applyUpdatePolicyOverrides } from '../model/update-policy.js';
import type { Database } from '../store/db/driver.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';

vi.mock('axios');

const mockLogChild = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));
vi.mock('../log/index.js', () => ({
  default: { child: () => mockLogChild },
}));

// See AgentClient.container-reconcile.test.ts: the import graph reaches store/index.ts,
// which validates DD_STORE_* at import time.
vi.mock('../store/index.js', () => ({
  getConfiguration: vi.fn(() => ({ path: '/validated/store', file: 'dd.json' })),
}));

vi.mock('../event/index.js', () => ({
  emitAgentConnected: vi.fn().mockResolvedValue(undefined),
  emitAgentDisconnected: vi.fn().mockResolvedValue(undefined),
  emitAgentStatsChanged: vi.fn().mockResolvedValue(undefined),
  emitBatchUpdateCompleted: vi.fn().mockResolvedValue(undefined),
  emitContainerReport: vi.fn().mockResolvedValue(undefined),
  emitContainerReports: vi.fn().mockResolvedValue(undefined),
  emitContainerUpdateApplied: vi.fn().mockResolvedValue(undefined),
  emitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
  emitSecurityAlert: vi.fn().mockResolvedValue(undefined),
  emitSecurityScanCycleComplete: vi.fn().mockResolvedValue(undefined),
  emitUpdateOperationChanged: vi.fn().mockResolvedValue(undefined),
  emitContainerAdded: vi.fn(),
  emitContainerUpdated: vi.fn(),
  emitContainerRemoved: vi.fn(),
  emitContainerHealthTransition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../maturity/gate-watch.js', () => ({
  maybeEmitMaturityGateCleared: vi.fn().mockResolvedValue(false),
}));

vi.mock('../registry/index.js', () => ({
  deregisterAgentComponents: vi.fn().mockResolvedValue(undefined),
  registerComponent: vi.fn().mockResolvedValue(undefined),
  getState: vi.fn(() => ({
    trigger: {},
    watcher: {},
    registry: {},
    authentication: {},
    agent: {},
  })),
}));

import * as storeContainer from '../store/container.js';
import * as groupPolicy from '../store/group-policy.js';
import { createContainerFixture } from '../test/helpers.js';
import { AgentClient } from './AgentClient.js';
import { AgentInventoryRefresh } from './agent-inventory.js';

const AGENT_NAME = 'edge1';
const PAYMENTS = { 'com.docker.compose.project': 'payments' };

/** A container as an agent reports it: its own env and label layers, no group. */
function reported(overrides: Record<string, unknown> = {}) {
  return createContainerFixture({
    id: 'edge-member',
    name: 'web',
    watcher: 'local',
    labels: PAYMENTS,
    updatePolicy: { skipTags: ['9.9.9'] },
    updatePolicyDeclarative: { env: {}, label: { skipTags: ['9.9.9'] } },
    updatePolicyOverrides: {},
    updatePolicySources: { skipTags: 'label' },
    ...overrides,
  }) as unknown as Container;
}

function setOverride(id: string, overrides: Record<string, unknown>) {
  const current = storeContainer.getContainerRaw(id) as Container;
  applyUpdatePolicyOverrides(current, overrides);
  storeContainer.updateContainer(current, { authoritativeEmptyOverrides: true });
}

let db: Database;

beforeEach(() => {
  vi.clearAllMocks();
  storeContainer._resetContainerStoreStateForTests();
  db = createMigratedMemoryDatabase();
  storeContainer.createCollections(db);
  groupPolicy.createCollections(db);
  groupPolicy.insertGroupPolicy(
    'payments',
    { updatePolicy: { maturityMode: 'mature', skipTags: ['group'] } },
    'user:admin',
  );
});

afterEach(() => {
  groupPolicy.clearCollectionForTesting();
  db.close();
});

describe('AgentClient ingest', () => {
  let client: AgentClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new AgentClient(AGENT_NAME, { host: 'localhost', port: 3001, secret: '' });
  });

  afterEach(() => {
    client.stop();
    vi.useRealTimers();
  });

  test('the controller adds the group layer to an agent-reported member and keeps its overrides', async () => {
    await client.processContainer(reported());

    expect(storeContainer.getContainerRaw('edge-member')).toMatchObject({
      agent: AGENT_NAME,
      updatePolicy: { maturityMode: 'mature', skipTags: ['9.9.9'] },
      updatePolicySources: { maturityMode: 'group', skipTags: 'label' },
      groupPolicy: { group: 'payments', revision: 1 },
    });

    setOverride('edge-member', { maturityMode: 'all' });
    await client.processContainer(reported());

    expect(storeContainer.getContainerRaw('edge-member')).toMatchObject({
      updatePolicy: { maturityMode: 'all', skipTags: ['9.9.9'] },
      updatePolicyOverrides: { maturityMode: 'all' },
      updatePolicySources: { maturityMode: 'override', skipTags: 'label' },
      groupPolicy: { group: 'payments' },
    });
  });

  test('a member the agent reports under another group drops the layer and keeps the override', async () => {
    await client.processContainer(reported());
    setOverride('edge-member', { maturityMinAgeDays: 3 });

    await client.processContainer(reported({ labels: { 'dd.group': 'elsewhere' } }));

    const stored = storeContainer.getContainerRaw('edge-member');
    expect(stored).not.toHaveProperty('groupPolicy');
    expect(stored?.updatePolicy).toEqual({ skipTags: ['9.9.9'], maturityMinAgeDays: 3 });
  });
});

describe('agent inventory ingest', () => {
  let inventory: AgentInventoryRefresh;
  let respond: (value: unknown) => void;
  let operationId: string | undefined;

  beforeEach(() => {
    inventory = new AgentInventoryRefresh({
      agent: AGENT_NAME,
      isConnected: () => true,
      request: vi.fn((_type, _name, options) => {
        operationId = options.operationId;
        return new Promise((resolve) => {
          respond = resolve;
        });
      }),
    });
  });

  afterEach(() => {
    inventory.invalidate();
  });

  async function refreshWith(containers: Container[]) {
    const pending = inventory.refresh('docker', 'local');
    respond({
      context: {
        origin: 'inventory',
        operationId,
        source: { type: 'docker', name: 'local' },
      },
      containers,
      removedIds: [],
      errors: [],
      authoritative: true,
    });
    return pending;
  }

  test('an inventory insert gets the group layer, and a label patch moves it in and out', async () => {
    await refreshWith([reported({ agent: undefined })]);
    expect(storeContainer.getContainerRaw('edge-member')).toMatchObject({
      agent: AGENT_NAME,
      updatePolicy: { maturityMode: 'mature', skipTags: ['9.9.9'] },
      groupPolicy: { group: 'payments' },
    });

    await refreshWith([reported({ agent: undefined, labels: { 'dd.group': 'elsewhere' } })]);
    expect(storeContainer.getContainerRaw('edge-member')).not.toHaveProperty('groupPolicy');
    expect(storeContainer.getContainerRaw('edge-member')?.updatePolicy).toEqual({
      skipTags: ['9.9.9'],
    });

    await refreshWith([reported({ agent: undefined })]);
    expect(storeContainer.getContainerRaw('edge-member')?.updatePolicySources).toEqual({
      maturityMode: 'group',
      skipTags: 'label',
    });
  });

  test('a declarative patch keeps the group layer under the new label layer', async () => {
    await refreshWith([reported({ agent: undefined })]);

    await refreshWith([
      reported({
        agent: undefined,
        updatePolicyDeclarative: { env: {}, label: { maturityMode: 'all' } },
      }),
    ]);

    expect(storeContainer.getContainerRaw('edge-member')).toMatchObject({
      updatePolicy: { maturityMode: 'all', skipTags: ['group'] },
      updatePolicySources: { maturityMode: 'label', skipTags: 'group' },
      groupPolicy: { group: 'payments' },
    });
  });
});
