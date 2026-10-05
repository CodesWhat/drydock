/**
 * A group policy saved while a scan is in flight (spec 7.3 slice 2a).
 *
 * Reports are built at store-write time and held until the batch emit, so the group
 * snapshot on a report can be older than the policy by the time a handler runs. The global
 * mode is read live at each gate and the group rule must be too. These tests use the real
 * container and group policy stores and write the policy between the store write that
 * produced the report and the handler.
 */
import * as event from '../../event/index.js';
import log from '../../log/index.js';
import type { Container } from '../../model/container.js';
import * as storeContainer from '../../store/container.js';
import * as groupPolicy from '../../store/group-policy.js';
import * as updateOperationStore from '../../store/update-operation.js';
import { createContainerFixture } from '../../test/helpers.js';
import { createMigratedMemoryDatabase } from '../../test/sqlite-db.js';
import Trigger from './Trigger.js';

const mockGetUpdateMode = vi.hoisted(() => vi.fn(() => 'auto' as const));

vi.mock('node-cron');
vi.mock('../../log');
vi.mock('../../event');
const registeredTriggers = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock('../../registry/index.js', () => ({
  getState: () => ({
    watcher: {},
    trigger: registeredTriggers,
    registry: {},
    authentication: {},
    agent: {},
  }),
}));
vi.mock('../../agent/manager.js', () => ({ getAgents: vi.fn(() => []) }));
vi.mock('../../store/audit.js', () => ({ insertAudit: vi.fn() }));
vi.mock('../../store/settings.js', () => ({ getUpdateMode: mockGetUpdateMode }));
vi.mock('../../store/notification.js', () => ({
  isTriggerEnabledForRule: vi.fn(() => true),
  getNotificationTemplate: vi.fn(() => undefined),
  getTriggerDispatchDecisionForRule: vi.fn(() => ({ enabled: true, reason: 'matched-allow-list' })),
}));
vi.mock('../../store/notification-history.js', () => {
  const byKey = new Map<string, unknown>();
  return {
    createCollections: vi.fn(),
    computeResultHash: vi.fn((container) => JSON.stringify(container?.result ?? {})),
    recordNotification: vi.fn((triggerId, containerId, eventKind, resultHash) => {
      byKey.set(`${triggerId}::${containerId}::${eventKind}`, resultHash);
    }),
    getLastNotifiedHash: vi.fn((triggerId, containerId, eventKind) =>
      byKey.get(`${triggerId}::${containerId}::${eventKind}`),
    ),
    clearNotificationsForContainer: vi.fn(),
    clearNotificationsForTrigger: vi.fn(),
    clearNotificationsForContainerAndEvent: vi.fn(),
    resetForTesting: vi.fn(() => byKey.clear()),
  };
});
vi.mock('../../store/notification-outbox.js', () => ({ enqueueOutboxEntry: vi.fn() }));
vi.mock('../../prometheus/trigger', () => ({ getTriggerCounter: () => ({ inc: vi.fn() }) }));
vi.mock('../../prometheus/watcher.js', () => ({
  init: vi.fn(),
  getWatchContainerGauge: vi.fn(),
  getMaintenanceSkipCounter: vi.fn(() => ({ labels: vi.fn(() => ({ inc: vi.fn() })) })),
  getMaintenanceDeferredUpdateCounter: vi.fn(() => ({ labels: vi.fn(() => ({ inc: vi.fn() })) })),
  getLoggerInitFailureCounter: vi.fn(),
}));

let db: ReturnType<typeof createMigratedMemoryDatabase>;

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of Object.keys(registeredTriggers)) {
    delete registeredTriggers[key];
  }
  mockGetUpdateMode.mockReturnValue('auto');
  vi.mocked(event.getHandlerTimeoutMs).mockReturnValue(30_000);
  storeContainer._resetContainerStoreStateForTests();
  db = createMigratedMemoryDatabase();
  storeContainer.createCollections(db);
  groupPolicy.createCollections(db);
  updateOperationStore.createCollections(db);
});

afterEach(() => {
  groupPolicy.clearCollectionForTesting();
  db.close();
});

/** An accepted update runs in the background, so let it reach the trigger. */
async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

function createTrigger(type: string, mode: string, name = 'update') {
  const created = new Trigger() as any;
  created.type = type;
  created.name = name;
  created.log = log;
  created.configuration = { threshold: 'all', once: true, mode, auto: true, order: 100 };
  registeredTriggers[`${type}.${name}`] = created;
  return created;
}

/** Store a member with an update and return the report exactly as a scan builds it. */
function scanReport(id: string, labels: Record<string, string> = {}) {
  storeContainer.insertContainer(
    createContainerFixture({
      id,
      name: id,
      watcher: 'local',
      labels: { 'com.docker.compose.project': 'payments', ...labels },
    }) as unknown as Container,
  );
  const stored = storeContainer.updateContainerFields(id, {
    result: { tag: '2.0' },
    updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0', semverDiff: 'minor' },
  } as Partial<Container>) as Container;
  return { changed: true, container: stored } as any;
}

/** The policy lands after the report was built and before the handler runs. */
function saveGroupPolicy(actions: object) {
  return groupPolicy.insertGroupPolicy('payments', { actions }, 'user:admin');
}

describe('a policy saved mid-scan reaches that scan automatic dispatch', () => {
  test('control: a member with no policy dispatches', async () => {
    const action = createTrigger('docker', 'simple');
    const run = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);

    await action.handleContainerReport(scanReport('c1'));
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('simple mode', async () => {
    const action = createTrigger('docker', 'simple');
    const run = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);
    const stale = scanReport('c1');
    expect(stale.container.groupPolicy).toBeUndefined();

    saveGroupPolicy({ updateMode: 'manual' });
    await action.handleContainerReport(stale);
    await settle();

    expect(run).not.toHaveBeenCalled();
  });

  test('simple mode with a group exclusion on a command trigger', async () => {
    const command = createTrigger('command', 'simple', 'hook');
    const run = vi.spyOn(command, 'trigger').mockResolvedValue(undefined);
    const stale = scanReport('c1');

    saveGroupPolicy({ exclude: ['command.hook'] });
    await command.handleContainerReport(stale);
    await settle();

    expect(run).not.toHaveBeenCalled();
  });

  test('batch mode', async () => {
    const action = createTrigger('docker', 'batch');
    const run = vi.spyOn(action, 'runAcceptedUpdateBatch');
    const stale = scanReport('c1');

    saveGroupPolicy({ updateMode: 'notify' });
    await action.handleContainerReports([stale]);

    expect(run).not.toHaveBeenCalled();
  });

  test('digest mode', async () => {
    const action = createTrigger('docker', 'digest');
    const stale = scanReport('c1');

    saveGroupPolicy({ updateMode: 'manual' });
    await action.handleContainerReportDigest(stale);

    expect(action.digestBuffer.size).toBe(0);
  });

  test('a policy deleted mid-scan stops holding the container back', async () => {
    const policy = saveGroupPolicy({ updateMode: 'manual' });
    const action = createTrigger('docker', 'simple');
    const run = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);
    const stale = scanReport('c1');
    expect(stale.container.groupPolicy).toBeDefined();

    groupPolicy.deleteGroupPolicy(policy.id, 1);
    await action.handleContainerReport(stale);
    await settle();

    expect(run).toHaveBeenCalledTimes(1);
  });

  test('a report that is already current is handled as before', async () => {
    saveGroupPolicy({ updateMode: 'manual' });
    const action = createTrigger('docker', 'simple');
    const run = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);

    await action.handleContainerReport(scanReport('c1'));
    await settle();

    expect(run).not.toHaveBeenCalled();
  });
});
