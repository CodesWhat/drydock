/**
 * Group policy action rules at every Trigger enforcement site (spec 7.3 slice 2a).
 *
 * A group's `actions.updateMode` is a ceiling composed with the global mode at exactly the
 * sites where the global mode is enforced today, and `actions.exclude` is a hard stop in the
 * same resolver `dd.action.exclude` uses. Nothing here may grant: notification triggers,
 * agent affinity and lifecycle dispatch behave as they did.
 */
import * as event from '../../event/index.js';
import log from '../../log/index.js';
import * as storeContainer from '../../store/container.js';
import * as notificationHistoryStore from '../../store/notification-history.js';
import Trigger from './Trigger.js';

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
vi.mock('../../log');
vi.mock('../../event');
vi.mock('../../registry/index.js', () => ({
  getState: (...args: any[]) => mockRegistryGetState(...(args as [])),
}));
vi.mock('../../agent/manager.js', () => ({
  getAgents: vi.fn(() => []),
}));
vi.mock('../../store/audit.js', () => ({
  insertAudit: vi.fn(),
}));
vi.mock('../../store/settings.js', () => ({
  getUpdateMode: mockGetUpdateMode,
}));
vi.mock('../../store/notification.js', () => ({
  isTriggerEnabledForRule: vi.fn(() => true),
  getNotificationTemplate: vi.fn(() => undefined),
  getTriggerDispatchDecisionForRule: vi.fn(() => ({
    enabled: true,
    reason: 'matched-allow-list',
  })),
}));
vi.mock('../../store/container.js', () => ({
  getContainers: vi.fn(() => []),
  getContainersRaw: vi.fn(() => []),
  cloneContainer: vi.fn((container) => structuredClone(container)),
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
vi.mock('../../store/notification-outbox.js', () => ({
  enqueueOutboxEntry: vi.fn(),
}));
vi.mock('../../prometheus/trigger', () => ({
  getTriggerCounter: () => ({ inc: vi.fn() }),
}));
vi.mock('../../prometheus/watcher.js', () => ({
  init: vi.fn(),
  getWatchContainerGauge: vi.fn(),
  getMaintenanceSkipCounter: vi.fn(() => ({ labels: vi.fn(() => ({ inc: vi.fn() })) })),
  getMaintenanceDeferredUpdateCounter: vi.fn(() => ({ labels: vi.fn(() => ({ inc: vi.fn() })) })),
  getLoggerInitFailureCounter: vi.fn(),
}));
vi.mock('../../store/update-operation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/update-operation.js')>();
  return { ...actual, listRecentSucceededOperations: vi.fn(() => []) };
});

type GroupActions = { updateMode?: 'manual' | 'notify'; exclude?: string[] };

function groupPolicy(actions: GroupActions) {
  return { id: 'policy-1', group: 'payments', revision: 1, updatePolicy: {}, actions };
}

function createContainer(id: string, actions?: GroupActions, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `app-${id}`,
    watcher: 'test',
    image: { name: 'library/app' },
    updateAvailable: true,
    updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0', semverDiff: 'minor' },
    ...(actions ? { groupPolicy: groupPolicy(actions) } : {}),
    ...extra,
  } as any;
}

function report(container: any) {
  return { changed: true, container } as any;
}

function createTrigger(type: string, mode: string, name = 'update') {
  const created = new Trigger() as any;
  created.type = type;
  created.name = name;
  created.log = log;
  created.configuration = { threshold: 'all', once: true, mode, auto: true, order: 100 };
  return created;
}

const CEILINGS: [string, GroupActions][] = [
  ['manual', { updateMode: 'manual' }],
  ['notify', { updateMode: 'notify' }],
];

beforeEach(() => {
  vi.resetAllMocks();
  mockRegistryGetState.mockReturnValue({
    watcher: {},
    trigger: {},
    registry: {},
    authentication: {},
    agent: {},
  });
  vi.mocked(storeContainer.getContainers).mockReturnValue([]);
  vi.mocked(storeContainer.getContainersRaw).mockReturnValue([]);
  vi.mocked(storeContainer.cloneContainer).mockImplementation((c: any) => structuredClone(c));
  vi.mocked(event.getHandlerTimeoutMs).mockReturnValue(30_000);
  mockGetUpdateMode.mockReturnValue('auto');
  (notificationHistoryStore.resetForTesting as any)();
});

describe('simple mode', () => {
  test.each(CEILINGS)(
    'a %s group stops an automatic action trigger and leaves other members dispatching',
    async (_name, actions) => {
      const action = createTrigger('docker', 'simple');
      const spy = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);

      await action.handleContainerReport(report(createContainer('c1', actions)));
      expect(spy).not.toHaveBeenCalled();

      const ungrouped = createContainer('c2');
      await action.handleContainerReport(report(ungrouped));
      expect(spy).toHaveBeenCalledWith(ungrouped, expect.anything());
    },
  );

  test.each(CEILINGS)(
    'a %s group stops an automatic command trigger too, as the global mode does',
    async (_name, actions) => {
      const command = createTrigger('command', 'simple', 'hook');
      const spy = vi.spyOn(command, 'trigger').mockResolvedValue(undefined);

      await command.handleContainerReport(report(createContainer('c1', actions)));

      expect(spy).not.toHaveBeenCalled();
    },
  );

  test.each(CEILINGS)(
    'a %s group does not suppress a notification trigger',
    async (_name, actions) => {
      const notification = createTrigger('slack', 'simple', 'ops');
      const spy = vi.spyOn(notification, 'trigger').mockResolvedValue(undefined);
      const container = createContainer('c1', actions);

      await notification.handleContainerReport(report(container));

      expect(spy).toHaveBeenCalledWith(container);
    },
  );

  test.each(CEILINGS)(
    'runUpdateAvailableSimpleTrigger rechecks the group ceiling before dispatching (%s)',
    async (_name, actions) => {
      const action = createTrigger('docker', 'simple');
      const spy = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);
      const debug = vi.fn();

      await action.runUpdateAvailableSimpleTrigger(createContainer('c1', actions), { debug });

      expect(spy).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith(
        'Group policy update mode does not allow automatic actions => ignore',
      );
    },
  );

  test.each(CEILINGS)(
    'handleContainerReport stops a %s group before it reserves a slot or evaluates the container',
    async (_name, actions) => {
      const action = createTrigger('docker', 'simple');
      const evaluate = vi.spyOn(action, 'runUpdateAvailableSimpleTrigger');
      const debug = vi.fn();
      action.log = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const container = createContainer('c1', actions);

      await action.handleContainerReport(report(container));

      expect(evaluate).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith(
        `Group policy update mode does not allow automatic actions for ${container.watcher}_${container.name} => ignore`,
      );
    },
  );

  test('a member include or auto label cannot lift the group ceiling', async () => {
    const action = createTrigger('docker', 'simple');
    const spy = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);

    await action.handleContainerReport(
      report(
        createContainer(
          'c1',
          { updateMode: 'manual' },
          { actionTriggerInclude: 'docker.update', actionTriggerAuto: 'docker.update' },
        ),
      ),
    );

    expect(spy).not.toHaveBeenCalled();
  });

  test('leaving the group restores automatic dispatch', async () => {
    const action = createTrigger('docker', 'simple');
    const spy = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);
    const container = createContainer('c1', { updateMode: 'manual' });

    await action.handleContainerReport(report(container));
    expect(spy).not.toHaveBeenCalled();

    const { groupPolicy: _left, ...left } = container;
    await action.handleContainerReport(report(left));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('a group exclude-only policy leaves the update mode to the global setting', async () => {
    const action = createTrigger('docker', 'simple');
    const spy = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);

    await action.handleContainerReport(
      report(createContainer('c1', { exclude: ['docker.other'] })),
    );

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('group exclusion', () => {
  test('an automatic update-action trigger is blocked by a matching group exclude', async () => {
    const action = createTrigger('docker', 'simple');
    const spy = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);
    const excluded = createContainer('c1', { exclude: ['docker.update'] });

    expect(action.mustTrigger(excluded)).toBe(false);
    await action.handleContainerReport(report(excluded));

    expect(spy).not.toHaveBeenCalled();
  });

  test('the threshold on a group entry is honored', () => {
    const action = createTrigger('docker', 'simple');

    expect(action.mustTrigger(createContainer('c1', { exclude: ['update:major-only'] }))).toBe(
      true,
    );
    expect(action.mustTrigger(createContainer('c1', { exclude: ['update:minor-only'] }))).toBe(
      false,
    );
  });

  test('a command trigger refuses a group-excluded container on the plain path and says why', () => {
    const command = createTrigger('command', 'simple', 'hook');
    const container = createContainer('c1', { exclude: ['command.hook:minor-only'] });

    expect(command.getMustTriggerDecision(container)).toEqual({
      allowed: false,
      reason:
        "group policy 'payments' excludes this trigger (command.hook:minor-only), triggerInclude=<none>",
    });
    expect(
      command.mustTrigger(createContainer('c2', { exclude: ['command.hook:major-only'] })),
    ).toBe(true);
    expect(command.mustTrigger(createContainer('c3', { exclude: ['other'] }))).toBe(true);
    expect(command.mustTrigger(createContainer('c4'))).toBe(true);
  });

  test('a group exclusion is checked even when the container label includes the trigger', () => {
    const command = createTrigger('command', 'simple', 'hook');

    expect(
      command.mustTrigger(
        createContainer(
          'c1',
          { exclude: ['hook'] },
          { actionTriggerInclude: 'command.hook', actionTriggerAuto: 'command.hook' },
        ),
      ),
    ).toBe(false);
  });

  test('a notification trigger ignores actions.exclude', () => {
    const notification = createTrigger('slack', 'simple', 'ops');

    expect(notification.mustTrigger(createContainer('c1', { exclude: ['slack.ops', 'ops'] }))).toBe(
      true,
    );
  });

  test('a group exclusion only restricts: it never makes a mismatched agent trigger eligible', () => {
    const action = createTrigger('docker', 'simple');
    action.agent = 'edge';

    expect(
      action.mustTrigger(createContainer('c1', { exclude: ['other'] }, { agent: 'other' })),
    ).toBe(false);
    expect(action.mustTrigger(createContainer('c2', undefined, { agent: 'other' }))).toBe(false);
  });
});

describe('batch mode', () => {
  test.each(CEILINGS)(
    'a %s group filters its report out of an automatic batch and records only the rest',
    async (_name, actions) => {
      const action = createTrigger('docker', 'batch');
      const run = vi
        .spyOn(action, 'runAcceptedUpdateBatch')
        .mockResolvedValue({ dispatched: true, deferredIds: new Set() });
      const blocked = createContainer('c1', actions);
      const open = createContainer('c2');

      await action.handleContainerReports([report(blocked), report(open)]);

      expect(run).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'c2' })],
        [expect.objectContaining({ id: 'c1' })],
      );
      const recorded = vi.mocked(notificationHistoryStore.recordNotification).mock.calls;
      expect(recorded.map((call) => call[1])).toEqual(['c2']);
    },
  );

  test('a batch holding only group-blocked reports sends and records nothing', async () => {
    const action = createTrigger('docker', 'batch');
    const run = vi.spyOn(action, 'runAcceptedUpdateBatch');

    await action.handleContainerReports([report(createContainer('c1', { updateMode: 'manual' }))]);

    expect(run).not.toHaveBeenCalled();
    expect(notificationHistoryStore.recordNotification).not.toHaveBeenCalled();
  });

  test('a command batch filters group-blocked reports the same way', async () => {
    const command = createTrigger('command', 'batch', 'hook');
    const send = vi.spyOn(command, 'triggerBatch').mockResolvedValue(undefined);

    await command.handleContainerReports([
      report(createContainer('c1', { updateMode: 'notify' })),
      report(createContainer('c2')),
    ]);

    expect(send).toHaveBeenCalledWith([expect.objectContaining({ id: 'c2' })]);
  });

  test('a notification batch includes group-blocked members', async () => {
    const notification = createTrigger('slack', 'batch', 'ops');
    const send = vi.spyOn(notification, 'triggerBatch').mockResolvedValue(undefined);

    await notification.handleContainerReports([
      report(createContainer('c1', { updateMode: 'notify' })),
    ]);

    expect(send).toHaveBeenCalledWith([expect.objectContaining({ id: 'c1' })]);
  });

  test('a retried entry whose current group blocks it is neither sent nor dropped', async () => {
    const action = createTrigger('docker', 'batch');
    const run = vi
      .spyOn(action, 'runAcceptedUpdateBatch')
      .mockResolvedValue({ dispatched: true, deferredIds: new Set() });
    const buffered = createContainer('c1');
    action.batchRetryBuffer.set('app-c1', buffered);
    const nowBlocked = createContainer('c1', { updateMode: 'manual' });
    vi.mocked(storeContainer.getContainersRaw).mockReturnValue([nowBlocked]);

    await action.handleContainerReports([]);

    expect(run).not.toHaveBeenCalled();
    expect(action.batchRetryBuffer.size).toBe(1);
  });

  test('runAcceptedUpdateBatch holds group-blocked containers back and enqueues the rest', async () => {
    const action = createTrigger('docker', 'batch');
    const trigger = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);
    const blocked = createContainer('c1', { updateMode: 'manual' });
    const open = createContainer('c2');

    const result = await action.runAcceptedUpdateBatch([blocked, open]);
    await Promise.resolve();
    await Promise.resolve();

    expect(result.dispatched).toBe(true);
    expect([...result.deferredIds]).toEqual(['c1']);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c2' }),
      expect.objectContaining({ operationId: expect.any(String) }),
    );
  });

  test('runAcceptedUpdateBatch with nothing but held containers enqueues nothing', async () => {
    const action = createTrigger('docker', 'batch');
    const trigger = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);

    const result = await action.runAcceptedUpdateBatch([
      createContainer('c1', { updateMode: 'notify' }),
    ]);

    expect(result.dispatched).toBe(true);
    expect(result.deferredIds.size).toBe(1);
    expect(trigger).not.toHaveBeenCalled();
  });
});

describe('digest mode', () => {
  test.each(CEILINGS)(
    'a %s group is not buffered for an automatic action digest',
    async (_name, actions) => {
      const action = createTrigger('docker', 'digest');

      await action.handleContainerReportDigest(report(createContainer('c1', actions)));
      expect(action.digestBuffer.size).toBe(0);

      await action.handleContainerReportDigest(report(createContainer('c2')));
      expect(action.digestBuffer.size).toBe(1);
    },
  );

  test('a notification digest still buffers a group-blocked member', async () => {
    const notification = createTrigger('slack', 'digest', 'ops');

    await notification.handleContainerReportDigest(
      report(createContainer('c1', { updateMode: 'notify' })),
    );

    expect(notification.digestBuffer.size).toBe(1);
  });

  test.each(CEILINGS)(
    'a flush evicts an entry whose current group is %s, as a re-check failure does',
    async (_name, actions) => {
      const action = createTrigger('docker', 'digest');
      const run = vi
        .spyOn(action, 'runAcceptedUpdateBatch')
        .mockResolvedValue({ dispatched: true, deferredIds: new Set() });
      const stale = createContainer('c1');
      const kept = createContainer('c2');
      action.digestBuffer.set('c1', stale);
      action.digestBuffer.set('c2', kept);
      vi.mocked(storeContainer.getContainersRaw).mockReturnValue([
        createContainer('c1', actions),
        kept,
      ]);

      await action.flushDigestBuffer();

      expect(run).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'c2' })],
        [expect.objectContaining({ id: 'c1' })],
      );
      expect(action.digestBuffer.size).toBe(0);
      expect(
        vi.mocked(notificationHistoryStore.recordNotification).mock.calls.map((call) => call[1]),
      ).toEqual(['c2']);
    },
  );

  test('a command digest evicts a buffered entry whose group now excludes the trigger', async () => {
    const command = createTrigger('command', 'digest', 'hook');
    const send = vi.spyOn(command, 'triggerBatch').mockResolvedValue(undefined);
    await command.handleContainerReportDigest(report(createContainer('c1')));
    expect(command.digestBuffer.size).toBe(1);
    vi.mocked(storeContainer.getContainersRaw).mockReturnValue([
      createContainer('c1', { exclude: ['command.hook'] }),
    ]);

    await command.flushDigestBuffer();

    expect(send).not.toHaveBeenCalled();
    expect(command.digestBuffer.size).toBe(0);
    expect(notificationHistoryStore.recordNotification).not.toHaveBeenCalled();
  });

  test('a command digest still flushes an entry whose group excludes another trigger', async () => {
    const command = createTrigger('command', 'digest', 'hook');
    const send = vi.spyOn(command, 'triggerBatch').mockResolvedValue(undefined);
    await command.handleContainerReportDigest(report(createContainer('c1')));
    vi.mocked(storeContainer.getContainersRaw).mockReturnValue([
      createContainer('c1', { exclude: ['command.other'] }),
    ]);

    await command.flushDigestBuffer();

    expect(send).toHaveBeenCalledTimes(1);
  });

  test('a flush with every entry group-blocked dispatches nothing', async () => {
    const action = createTrigger('docker', 'digest');
    const run = vi.spyOn(action, 'runAcceptedUpdateBatch');
    action.digestBuffer.set('c1', createContainer('c1'));
    vi.mocked(storeContainer.getContainersRaw).mockReturnValue([
      createContainer('c1', { updateMode: 'manual' }),
    ]);

    await action.flushDigestBuffer();

    expect(run).not.toHaveBeenCalled();
    expect(action.digestBuffer.size).toBe(0);
  });
});

describe('Trigger.withCurrentGroupPolicy', () => {
  test('hands back a report that carries no container as it is', () => {
    const empty = { changed: true } as any;

    expect(Trigger.withCurrentGroupPolicy(empty)).toBe(empty);
  });
});

describe('a group-held upstream defers its dependents', () => {
  const HELD: GroupActions = { updateMode: 'manual' };
  const db = () => createContainer('db', HELD);
  const api = () => createContainer('api', undefined, { dependsOn: ['app-db'] });
  const triggered = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((call) => (call[0] as { id: string }).id);

  test('a batch does not update a dependent while its upstream is held, then does once it is clear', async () => {
    const action = createTrigger('docker', 'batch');
    const trigger = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);

    await action.handleContainerReports([report(db()), report(api())]);
    await Promise.resolve();
    await Promise.resolve();

    expect(trigger).not.toHaveBeenCalled();
    expect(notificationHistoryStore.recordNotification).not.toHaveBeenCalled();

    // db was approved and updated, so the next scan reports only api.
    await action.handleContainerReports([report(api())]);
    await Promise.resolve();
    await Promise.resolve();

    expect(triggered(trigger)).toEqual(['api']);
  });

  test('a dependent of a held container that is itself held is simply held', async () => {
    const action = createTrigger('docker', 'batch');
    const trigger = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);
    const cache = createContainer('cache', HELD, { dependsOn: ['app-db'] });

    await action.handleContainerReports([report(db()), report(cache), report(api())]);
    await Promise.resolve();
    await Promise.resolve();

    expect(trigger).not.toHaveBeenCalled();
  });

  test('an independent container still updates beside a held upstream and its dependent', async () => {
    const action = createTrigger('docker', 'batch');
    const trigger = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);

    await action.handleContainerReports([
      report(db()),
      report(api()),
      report(createContainer('web')),
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(triggered(trigger)).toEqual(['web']);
    expect(
      vi.mocked(notificationHistoryStore.recordNotification).mock.calls.map((call) => call[1]),
    ).toEqual(['web']);
  });

  test('a command batch leaves a dependent of a held container unsent', async () => {
    const command = createTrigger('command', 'batch', 'hook');
    const send = vi.spyOn(command, 'triggerBatch').mockResolvedValue(undefined);

    await command.handleContainerReports([report(db()), report(api())]);

    expect(send).not.toHaveBeenCalled();
    expect(notificationHistoryStore.recordNotification).not.toHaveBeenCalled();
  });

  test('a digest flush holds a dependent back while its upstream is held', async () => {
    const action = createTrigger('docker', 'digest');
    const trigger = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);
    action.digestBuffer.set('app-db', createContainer('db'));
    action.digestBuffer.set('app-api', api());
    vi.mocked(storeContainer.getContainersRaw).mockReturnValue([db(), api()]);

    await action.flushDigestBuffer();
    await Promise.resolve();
    await Promise.resolve();

    expect(trigger).not.toHaveBeenCalled();
    expect(notificationHistoryStore.recordNotification).not.toHaveBeenCalled();
    expect(action.digestBuffer.has('app-api')).toBe(true);
    expect(action.digestBuffer.has('app-db')).toBe(false);
  });

  test('a command digest flush holds a dependent back while its upstream is held', async () => {
    const command = createTrigger('command', 'digest', 'hook');
    const send = vi.spyOn(command, 'triggerBatch').mockResolvedValue(undefined);
    command.digestBuffer.set('app-db', createContainer('db'));
    command.digestBuffer.set('app-api', api());
    vi.mocked(storeContainer.getContainersRaw).mockReturnValue([db(), api()]);

    await command.flushDigestBuffer();

    expect(send).not.toHaveBeenCalled();
    expect(command.digestBuffer.has('app-api')).toBe(true);
  });
});

describe('what a group never touches', () => {
  test.each(CEILINGS)(
    'lifecycle-event dispatch for a command trigger is not gated by a %s group update mode',
    async (_name, actions) => {
      const command = createTrigger('command', 'simple', 'hook');
      const spy = vi.spyOn(command, 'trigger').mockResolvedValue(undefined);
      const container = createContainer('c1', actions);

      const dispatched = await command.dispatchContainerForEvent('update-failed', container, {
        allowAllWhenNoTriggers: true,
        defaultWhenRuleMissing: true,
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(dispatched).toBe(true);
      expect(spy).toHaveBeenCalledWith(container);
    },
  );

  test('lifecycle-event dispatch for a command trigger still honors a group exclusion, like dd.action.exclude', async () => {
    const command = createTrigger('command', 'simple', 'hook');
    const spy = vi.spyOn(command, 'trigger').mockResolvedValue(undefined);

    const dispatched = await command.dispatchContainerForEvent(
      'update-failed',
      createContainer('c1', { exclude: ['command.hook'] }),
      { allowAllWhenNoTriggers: true, defaultWhenRuleMissing: true },
    );

    expect(dispatched).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  test('the global mode still wins when it is stricter than the group', async () => {
    mockGetUpdateMode.mockReturnValue('notify');
    const action = createTrigger('docker', 'simple');
    const spy = vi.spyOn(action, 'trigger').mockResolvedValue(undefined);

    await action.handleContainerReport(report(createContainer('c1', { updateMode: 'manual' })));
    await action.handleContainerReport(report(createContainer('c2')));

    expect(spy).not.toHaveBeenCalled();
  });
});
