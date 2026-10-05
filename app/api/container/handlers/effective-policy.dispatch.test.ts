/**
 * The worked examples of the group policy spec (7.3), each run through BOTH the
 * effective-policy endpoint and the real dispatch decision, which must agree.
 *
 * The endpoint is served over real HTTP and validated against the OpenAPI document. The
 * dispatch side is the code that actually decides: the Trigger paths (what fires on its
 * own), manual admission (`requestContainerUpdate`), approval classification, update
 * eligibility, and the update policy the store's finalizer resolved onto the record. Group
 * policies come from the real group policy store, and both sides read the live rule.
 */
import http from 'node:http';
import express from 'express';
import rateLimit from 'express-rate-limit';
import * as event from '../../../event/index.js';
import log from '../../../log/index.js';
import { classifyApprovalCandidate } from '../../../model/approval.js';
import type { Container } from '../../../model/container.js';
import { toContainerGroupPolicySnapshot } from '../../../model/group-policy.js';
import {
  computeUpdateEligibility,
  type UpdateEligibilityContext,
} from '../../../model/update-eligibility.js';
import { applyGroupUpdatePolicyLayer } from '../../../model/update-policy.js';
import type { Database } from '../../../store/db/driver.js';
import * as groupPolicyStore from '../../../store/group-policy.js';
import * as notificationHistoryStore from '../../../store/notification-history.js';
import type { UpdateMode } from '../../../store/settings.js';
import { createContainerFixture } from '../../../test/helpers.js';
import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import Trigger from '../../../triggers/providers/Trigger.js';
import { requestContainerUpdate } from '../../../updates/request-update.js';
import { validateOpenApiJsonResponse } from '../../openapi-contract.js';
import { scoped } from '../../route-scopes.js';
import { toApiContainer } from '../shared.js';
import { createEffectivePolicyHandler } from './effective-policy.js';

const mockGetUpdateMode = vi.hoisted(() => vi.fn(() => 'auto' as const));
const mockRegistryGetState = vi.hoisted(() =>
  vi.fn(() => ({
    watcher: {} as Record<string, unknown>,
    trigger: {} as Record<string, unknown>,
    registry: {},
    authentication: {},
    agent: {},
  })),
);

vi.mock('node-cron');
vi.mock('../../../log');
vi.mock('../../../event');
vi.mock('../../../registry/index.js', () => ({
  getState: (...args: any[]) => mockRegistryGetState(...(args as [])),
}));
vi.mock('../../../agent/manager.js', () => ({
  getAgents: vi.fn(() => []),
  getAgent: vi.fn(() => undefined),
}));
vi.mock('../../../store/audit.js', () => ({
  insertAudit: vi.fn(),
}));
vi.mock('../../../store/settings.js', () => ({
  getUpdateMode: mockGetUpdateMode,
}));
vi.mock('../../../store/notification.js', () => ({
  isTriggerEnabledForRule: vi.fn(() => true),
  getNotificationTemplate: vi.fn(() => undefined),
  getTriggerDispatchDecisionForRule: vi.fn(() => ({
    enabled: true,
    reason: 'matched-allow-list',
  })),
}));
vi.mock('../../../store/container.js', () => ({
  getContainers: vi.fn(() => []),
  getContainersRaw: vi.fn(() => []),
  cloneContainer: vi.fn((container) => structuredClone(container)),
}));
vi.mock('../../../store/notification-history.js', () => {
  const byKey = new Map<string, unknown>();
  return {
    createCollections: vi.fn(),
    computeResultHash: vi.fn((container) => JSON.stringify(container?.result ?? {})),
    recordNotification: vi.fn(),
    getLastNotifiedHash: vi.fn((triggerId, containerId, eventKind) =>
      byKey.get(`${triggerId}::${containerId}::${eventKind}`),
    ),
    clearNotificationsForContainer: vi.fn(),
    clearNotificationsForTrigger: vi.fn(),
    clearNotificationsForContainerAndEvent: vi.fn(),
    resetForTesting: vi.fn(() => byKey.clear()),
  };
});
vi.mock('../../../store/notification-outbox.js', () => ({
  enqueueOutboxEntry: vi.fn(),
}));
vi.mock('../../../prometheus/trigger', () => ({
  getTriggerCounter: () => ({ inc: vi.fn() }),
}));
vi.mock('../../../prometheus/watcher.js', () => ({
  init: vi.fn(),
  getWatchContainerGauge: vi.fn(),
  getMaintenanceSkipCounter: vi.fn(() => ({ labels: vi.fn(() => ({ inc: vi.fn() })) })),
  getMaintenanceDeferredUpdateCounter: vi.fn(() => ({ labels: vi.fn(() => ({ inc: vi.fn() })) })),
  getLoggerInitFailureCounter: vi.fn(),
}));
vi.mock('../../../store/update-operation.js', () => ({
  getOperationById: vi.fn(() => undefined),
  getActiveOperationByContainerId: vi.fn(() => undefined),
  getActiveOperationByContainerIdentity: vi.fn(() => undefined),
  getRecentTerminalSucceededOperationByContainerIdentity: vi.fn(() => undefined),
  hasOtherActiveOperationByContainerIdentity: vi.fn(() => false),
  listRecentSucceededOperations: vi.fn(() => []),
  insertOperation: vi.fn(),
  markOperationTerminal: vi.fn(),
}));

const COMPOSE_PAYMENTS = { 'com.docker.compose.project': 'payments' };

type GroupBody = {
  updatePolicy?: Record<string, unknown>;
  actions?: { updateMode?: 'manual' | 'notify'; exclude?: string[] };
};

interface TriggerSpec {
  type: string;
  name: string;
  agent?: string;
  auto?: unknown;
}

interface WorkedExample {
  name: string;
  global: UpdateMode;
  group: GroupBody;
  triggers: TriggerSpec[];
  labels?: Record<string, string>;
  container?: Record<string, unknown>;
  declarative?: Container['updatePolicyDeclarative'];
  overrides?: Container['updatePolicyOverrides'];
  /** A snapshot recorded while the container was a member, now stale. */
  staleSnapshot?: boolean;
  /** The spec's stated result, as a subset of the endpoint response. */
  expected: Record<string, unknown>;
  /** What the real dispatch must do. */
  dispatch: {
    fires: string | null;
    admission: 'accepted' | number;
    verdict: 'auto-dispatch' | 'queue' | 'blocked';
    blockers: string[];
  };
}

const DOCKER_LOCAL: TriggerSpec = { type: 'docker', name: 'local', auto: 'all' };

const EXAMPLES: WorkedExample[] = [
  {
    name: 'watcher env mature, group all: all, source group',
    global: 'auto',
    group: { updatePolicy: { maturityMode: 'all' } },
    triggers: [DOCKER_LOCAL],
    declarative: { env: { maturityMode: 'mature' }, label: {} },
    expected: {
      updatePolicy: {
        maturityMode: {
          value: 'all',
          source: 'group',
          layers: { env: 'mature', group: 'all' },
        },
      },
    },
    dispatch: {
      fires: 'docker.local',
      admission: 'accepted',
      verdict: 'auto-dispatch',
      blockers: [],
    },
  },
  {
    name: 'group mature, label dd.updatePolicy.maturityMode=all: all, source label',
    global: 'auto',
    group: { updatePolicy: { maturityMode: 'mature' } },
    triggers: [DOCKER_LOCAL],
    declarative: { env: {}, label: { maturityMode: 'all' } },
    expected: {
      updatePolicy: {
        maturityMode: {
          value: 'all',
          source: 'label',
          layers: { group: 'mature', label: 'all' },
        },
      },
    },
    dispatch: {
      fires: 'docker.local',
      admission: 'accepted',
      verdict: 'auto-dispatch',
      blockers: [],
    },
  },
  {
    name: 'group skipTags [a], override skipTags []: [], source override',
    global: 'auto',
    group: { updatePolicy: { skipTags: ['a'] } },
    triggers: [DOCKER_LOCAL],
    overrides: { skipTags: [] },
    expected: {
      updatePolicy: {
        skipTags: { value: [], source: 'override', layers: { group: ['a'], override: [] } },
      },
    },
    dispatch: {
      fires: 'docker.local',
      admission: 'accepted',
      verdict: 'auto-dispatch',
      blockers: [],
    },
  },
  {
    name: 'global auto, group manual, member has dd.action.auto: manual only, queued, Update enabled',
    global: 'auto',
    group: { actions: { updateMode: 'manual' } },
    triggers: [{ type: 'docker', name: 'local', auto: 'onauto' }],
    container: { actionTriggerInclude: 'docker.local', actionTriggerAuto: 'docker.local' },
    expected: {
      actions: {
        updateMode: { value: 'manual', source: 'group', global: 'auto', group: 'manual' },
        dispatch: {
          automatic: false,
          trigger: { id: 'docker.local', state: 'auto' },
          manualUpdate: { allowed: true },
        },
      },
    },
    dispatch: { fires: null, admission: 'accepted', verdict: 'queue', blockers: [] },
  },
  {
    name: 'global manual, group notify: notify from group, group-notify-only blocker',
    global: 'manual',
    group: { actions: { updateMode: 'notify' } },
    triggers: [DOCKER_LOCAL],
    expected: {
      actions: {
        updateMode: { value: 'notify', source: 'group', global: 'manual', group: 'notify' },
        dispatch: {
          automatic: false,
          manualUpdate: { allowed: false, blockedBy: 'group-notify-only' },
        },
      },
    },
    dispatch: { fires: null, admission: 409, verdict: 'blocked', blockers: ['group-notify-only'] },
  },
  {
    name: 'global notify, group manual: notify from global',
    global: 'notify',
    group: { actions: { updateMode: 'manual' } },
    triggers: [DOCKER_LOCAL],
    expected: {
      actions: {
        updateMode: { value: 'notify', source: 'global', global: 'notify', group: 'manual' },
        dispatch: {
          automatic: false,
          manualUpdate: { allowed: false, blockedBy: 'global-notify' },
        },
      },
    },
    dispatch: { fires: null, admission: 409, verdict: 'queue', blockers: [] },
  },
  {
    name: 'group exclude of a compose trigger the member includes: blocked by group, no fall-through to docker',
    global: 'auto',
    group: { actions: { exclude: ['dockercompose.stack'] } },
    triggers: [{ type: 'dockercompose', name: 'stack', auto: 'all' }, DOCKER_LOCAL],
    container: { actionTriggerInclude: 'dockercompose.stack' },
    expected: {
      actions: {
        exclude: { group: ['dockercompose.stack'] },
        dispatch: {
          automatic: false,
          trigger: {
            id: 'dockercompose.stack',
            state: 'blocked',
            reason: 'excluded',
            excludedBy: 'group',
          },
          manualUpdate: { allowed: false, blockedBy: 'trigger-excluded' },
        },
      },
    },
    dispatch: { fires: null, admission: 409, verdict: 'blocked', blockers: ['trigger-excluded'] },
  },
  {
    name: 'agent edge1 member, group exclude docker.local: only a trigger compatible with edge1 can match',
    global: 'auto',
    group: { actions: { exclude: ['docker.local'] } },
    triggers: [DOCKER_LOCAL, { type: 'docker', name: 'main', agent: 'edge1', auto: 'all' }],
    container: { agent: 'edge1' },
    expected: {
      actions: {
        dispatch: {
          automatic: true,
          trigger: { id: 'edge1.docker.main', state: 'auto' },
          manualUpdate: { allowed: true },
        },
      },
    },
    dispatch: {
      fires: 'edge1.docker.main',
      admission: 'accepted',
      verdict: 'auto-dispatch',
      blockers: [],
    },
  },
  {
    name: 'member sets dd.group to empty: no group policy applies',
    global: 'auto',
    group: { actions: { updateMode: 'notify' }, updatePolicy: { maturityMode: 'mature' } },
    triggers: [DOCKER_LOCAL],
    labels: { ...COMPOSE_PAYMENTS, 'dd.group': '' },
    staleSnapshot: true,
    expected: {
      group: { name: '', label: 'dd.group', policyId: null, revision: null },
      updatePolicy: { maturityMode: { value: 'all', source: 'default', layers: {} } },
      actions: {
        updateMode: { value: 'auto', source: 'global', global: 'auto' },
        exclude: { group: [] },
      },
    },
    dispatch: {
      fires: 'docker.local',
      admission: 'accepted',
      verdict: 'auto-dispatch',
      blockers: [],
    },
  },
];

let db: Database;
let server: http.Server;
let port: number;
const served = new Map<string, Container>();

function createTestApp() {
  const app = express();
  app.use(
    rateLimit({ windowMs: 60_000, limit: 10_000, standardHeaders: true, legacyHeaders: false }),
  );
  const router = express.Router();
  router.get(
    '/:id/effective-policy',
    scoped(
      'read',
      createEffectivePolicyHandler({
        getContainer: (id) => served.get(id),
        getTriggers: () => mockRegistryGetState().trigger,
        getUpdateMode: () => mockGetUpdateMode(),
        withCurrentGroupPolicy: groupPolicyStore.withCurrentGroupPolicy,
        toApiContainer,
      }),
    ),
  );
  app.use('/api/v1/containers', router);
  return app;
}

function createTrigger(spec: TriggerSpec) {
  const created = new Trigger() as any;
  created.type = spec.type;
  created.name = spec.name;
  created.agent = spec.agent;
  created.log = log;
  created.configuration = {
    threshold: 'all',
    once: true,
    mode: 'simple',
    auto: spec.auto ?? 'all',
    order: 100,
  };
  return created;
}

function buildContainer(example: WorkedExample, snapshot: Container['groupPolicy']): Container {
  const base = createContainerFixture({
    id: 'member',
    name: 'member',
    watcher: 'local',
    labels: example.labels ?? COMPOSE_PAYMENTS,
    result: { tag: 'newer' },
    updateAvailable: true,
    updateKind: { kind: 'tag', localValue: 'version', remoteValue: 'newer', semverDiff: 'minor' },
    ...example.container,
    updatePolicyDeclarative: example.declarative ?? { env: {}, label: {} },
    updatePolicyOverrides: example.overrides ?? {},
  }) as unknown as Container;
  return applyGroupUpdatePolicyLayer(base, snapshot);
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
  served.clear();
  mockRegistryGetState.mockReturnValue({
    watcher: {},
    trigger: {},
    registry: {},
    authentication: {},
    agent: {},
  });
  vi.mocked(event.getHandlerTimeoutMs).mockReturnValue(30_000);
  (notificationHistoryStore.resetForTesting as any)();
  db = createMigratedMemoryDatabase();
  groupPolicyStore.createCollections(db);
});

afterEach(() => {
  groupPolicyStore.clearCollectionForTesting();
  db.close();
});

async function endpoint(container: Container) {
  served.set(container.id, container);
  const response = await fetch(
    `http://127.0.0.1:${port}/api/v1/containers/${container.id}/effective-policy`,
  );
  const body = (await response.json()) as any;
  expect(response.status).toBe(200);
  expect(
    validateOpenApiJsonResponse({
      path: '/api/v1/containers/{id}/effective-policy',
      method: 'get',
      statusCode: '200',
      payload: body,
    }),
  ).toEqual({ valid: true, errors: [] });
  return body;
}

test('every worked example in the spec is covered', () => {
  expect(EXAMPLES).toHaveLength(9);
});

describe.each(EXAMPLES)('$name', (example) => {
  test('the endpoint and the real dispatch decision agree', async () => {
    const policy = groupPolicyStore.insertGroupPolicy('payments', example.group, 'user:ada');
    const snapshot = toContainerGroupPolicySnapshot(policy);
    const container = buildContainer(example, snapshot);
    if (!example.staleSnapshot && example.labels === undefined) {
      expect(container.groupPolicy).toBeDefined();
    }

    const instances = example.triggers.map((spec) => createTrigger(spec));
    const registered = Object.fromEntries(instances.map((t) => [t.getId(), t]));
    mockRegistryGetState.mockReturnValue({
      watcher: {},
      trigger: registered,
      registry: {},
      authentication: {},
      agent: {},
    });
    mockGetUpdateMode.mockReturnValue(example.global as never);

    const body = await endpoint(container);

    // The spec's stated result.
    expect(body).toMatchObject(example.expected);

    // What fires on its own: every registered trigger sees the report, as in production.
    const spies = instances.map((t) => ({
      id: t.getId() as string,
      spy: vi.spyOn(t, 'trigger').mockResolvedValue(undefined),
    }));
    for (const t of instances) {
      await t.handleContainerReport({ changed: true, container: structuredClone(container) });
    }
    await vi.waitFor(() => undefined);
    const fired = spies.filter(({ spy }) => spy.mock.calls.length > 0).map(({ id }) => id);
    expect(fired).toEqual(example.dispatch.fires === null ? [] : [example.dispatch.fires]);
    expect(body.actions.dispatch.automatic).toBe(fired.length > 0);
    if (fired.length > 0) {
      expect(body.actions.dispatch.trigger.id).toBe(fired[0]);
    }

    // The live group rule, as every gate reads it.
    const live = groupPolicyStore.withCurrentGroupPolicy(container);

    // Manual admission.
    const admission = await requestContainerUpdate(live).then(
      () => 'accepted' as const,
      (error: { statusCode: number }) => error.statusCode,
    );
    expect(admission).toBe(example.dispatch.admission);
    expect(body.actions.dispatch.manualUpdate.allowed).toBe(admission === 'accepted');

    // Approval classification and the eligibility blockers.
    const triggers = registered as never;
    expect(classifyApprovalCandidate(live, triggers, example.global)).toBe(
      example.dispatch.verdict,
    );
    const eligibility = computeUpdateEligibility(live, {
      triggers: triggers as UpdateEligibilityContext['triggers'],
      getActiveOperation: () => undefined,
      updateMode: example.global,
    });
    const hardReasons = eligibility.blockers
      .filter((blocker) => blocker.severity === 'hard')
      .map((blocker) => blocker.reason);
    expect(hardReasons).toEqual(example.dispatch.blockers);
    expect(eligibility.updateMode).toMatchObject({
      value: body.actions.updateMode.value,
      source: body.actions.updateMode.source,
    });

    // The update policy the store's finalizer resolves for the live group. A snapshot taken
    // while the container was still a member is re-finalized by the next store write, which
    // is applied here.
    const finalized = applyGroupUpdatePolicyLayer(structuredClone(live), live.groupPolicy);
    for (const field of [
      'maturityMode',
      'maturityMinAgeDays',
      'skipTags',
      'skipDigests',
    ] as const) {
      const stored = finalized.updatePolicy?.[field];
      if (stored !== undefined) {
        expect(body.updatePolicy[field].value).toEqual(stored);
        expect(body.updatePolicy[field].source).toBe(finalized.updatePolicySources?.[field]);
      } else {
        expect(body.updatePolicy[field].source).toBe('default');
      }
    }
  });
});
