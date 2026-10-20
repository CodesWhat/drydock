/**
 * DR-85: every place a notification trigger skips a container records one of a small fixed set of
 * reason codes, keeps only the last one per trigger and container, and drops it once a
 * notification for that pair is actually sent.
 */
import * as event from '../../event/index.js';
import log from '../../log/index.js';
import * as storeContainer from '../../store/container.js';
import * as notificationStore from '../../store/notification.js';
import * as notificationHistoryStore from '../../store/notification-history.js';
import {
  getNotificationSkipsForContainer,
  getNotificationSkipsSnapshot,
  recordNotificationSkip,
  resetNotificationSkips,
} from '../notification-skips.js';
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

function createContainer(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `app-${id}`,
    watcher: 'test',
    image: { name: 'library/app' },
    result: { tag: '2.0' },
    updateAvailable: true,
    updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0', semverDiff: 'minor' },
    ...extra,
  } as any;
}

function report(container: any) {
  return { changed: true, container } as any;
}

function createTrigger(type: string, mode: string, configuration: Record<string, unknown> = {}) {
  const created = new Trigger() as any;
  created.type = type;
  created.name = 'ops';
  created.log = log;
  created.configuration = {
    threshold: 'all',
    once: true,
    mode,
    auto: true,
    order: 100,
    ...configuration,
  };
  return created;
}

function reasonFor(trigger: any, containerId: string) {
  return getNotificationSkipsSnapshot().find(
    (skip) => skip.trigger === trigger.getId() && skip.containerId === containerId,
  );
}

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
  vi.mocked(notificationStore.isTriggerEnabledForRule).mockReturnValue(true);
  vi.mocked(notificationStore.getTriggerDispatchDecisionForRule).mockReturnValue({
    enabled: true,
    reason: 'matched-allow-list',
  } as any);
  mockGetUpdateMode.mockReturnValue('auto');
  (notificationHistoryStore.resetForTesting as any)();
  resetNotificationSkips();
});

describe('simple mode', () => {
  test('threshold-not-met names the threshold', async () => {
    const trigger = createTrigger('slack', 'simple', { threshold: 'major-only' });
    vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

    await trigger.handleContainerReport(report(createContainer('c1')));

    expect(reasonFor(trigger, 'c1')).toMatchObject({
      reason: 'threshold-not-met',
      detail: 'threshold=major-only',
    });
    expect(trigger.trigger).not.toHaveBeenCalled();
  });

  test('trigger-excluded carries the include/exclude decision', async () => {
    const trigger = createTrigger('slack', 'simple');
    vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

    await trigger.handleContainerReport(
      report(createContainer('c1', { notificationTriggerExclude: trigger.getId() })),
    );

    expect(reasonFor(trigger, 'c1')).toMatchObject({ reason: 'trigger-excluded' });
    expect(reasonFor(trigger, 'c1')?.detail).toContain('excluded=true');
  });

  test('rule-disabled records the dispatch decision reason', async () => {
    vi.mocked(notificationStore.getTriggerDispatchDecisionForRule).mockReturnValue({
      enabled: false,
      reason: 'rule-disabled',
    } as any);
    const trigger = createTrigger('slack', 'simple');

    await trigger.handleContainerReport(report(createContainer('c1')));

    expect(reasonFor(trigger, 'c1')).toMatchObject({
      reason: 'rule-disabled',
      detail: 'rule-disabled',
    });
  });

  test('rule-disabled is not recorded for a container with no update', async () => {
    vi.mocked(notificationStore.getTriggerDispatchDecisionForRule).mockReturnValue({
      enabled: false,
      reason: 'rule-disabled',
    } as any);
    const trigger = createTrigger('slack', 'simple');

    await trigger.handleContainerReport(report(createContainer('c1', { updateAvailable: false })));

    expect(getNotificationSkipsSnapshot()).toEqual([]);
  });

  test('once-already-sent is recorded on the repeat and cleared by the next real send', async () => {
    const trigger = createTrigger('slack', 'simple');
    const spy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

    await trigger.handleContainerReport(report(createContainer('c1')));
    expect(getNotificationSkipsSnapshot()).toEqual([]);

    await trigger.handleContainerReport(report(createContainer('c1')));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(reasonFor(trigger, 'c1')).toMatchObject({ reason: 'once-already-sent' });

    await trigger.handleContainerReport(report(createContainer('c1', { result: { tag: '3.0' } })));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(reasonFor(trigger, 'c1')).toBeUndefined();
  });

  test('once-already-sent is recorded when the same result is already in flight', async () => {
    const trigger = createTrigger('slack', 'simple');
    let release: () => void = () => undefined;
    vi.spyOn(trigger, 'trigger').mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }) as any,
    );

    const first = trigger.handleContainerReport(report(createContainer('c1')));
    await trigger.handleContainerReport(report(createContainer('c1')));
    expect(reasonFor(trigger, 'c1')).toMatchObject({
      reason: 'once-already-sent',
      detail: 'in flight',
    });

    release();
    await first;
    expect(reasonFor(trigger, 'c1')).toBeUndefined();
  });

  test('recently-applied is recorded while the watcher has not confirmed the update', async () => {
    const trigger = createTrigger('slack', 'simple', { once: false });
    vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);
    const container = createContainer('c1');
    await trigger.handleContainerUpdateAppliedEvent({ containerName: 'test_app-c1', container });
    vi.mocked(trigger.trigger).mockClear();

    await trigger.handleContainerReport(report(container));

    expect(reasonFor(trigger, 'c1')).toMatchObject({ reason: 'recently-applied' });
    expect(trigger.trigger).not.toHaveBeenCalled();

    // The watcher confirming updateAvailable=false means there is nothing left to explain.
    await trigger.handleContainerReport(report(createContainer('c1', { updateAvailable: false })));
    expect(reasonFor(trigger, 'c1')).toBeUndefined();
  });

  test('update-applied drops a stale skip', async () => {
    const trigger = createTrigger('slack', 'simple', { threshold: 'major-only' });
    vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);
    const container = createContainer('c1');
    await trigger.handleContainerReport(report(container));
    expect(reasonFor(trigger, 'c1')).toBeDefined();

    await trigger.handleContainerUpdateAppliedEvent({ containerName: 'test_app-c1', container });

    expect(reasonFor(trigger, 'c1')).toBeUndefined();
  });

  test('a container with no id records nothing', async () => {
    const trigger = createTrigger('slack', 'simple', { threshold: 'major-only' });

    await trigger.handleContainerReport(report(createContainer('', { id: undefined })));

    expect(getNotificationSkipsSnapshot()).toEqual([]);
  });

  test('action triggers never record a skip', async () => {
    const trigger = createTrigger('docker', 'simple', { threshold: 'major-only' });
    vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

    await trigger.handleContainerReport(report(createContainer('c1')));

    expect(getNotificationSkipsSnapshot()).toEqual([]);
  });
});

describe('batch mode', () => {
  test('threshold-not-met, trigger-excluded and once-already-sent are recorded per container', async () => {
    const trigger = createTrigger('slack', 'batch', { threshold: 'major-only' });
    vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.handleContainerReports([report(createContainer('c1'))]);
    expect(reasonFor(trigger, 'c1')).toMatchObject({ reason: 'threshold-not-met' });

    const excluding = createTrigger('slack', 'batch');
    vi.spyOn(excluding, 'triggerBatch').mockResolvedValue(undefined);
    await excluding.handleContainerReports([
      report(createContainer('c2', { notificationTriggerExclude: excluding.getId() })),
    ]);
    expect(reasonFor(excluding, 'c2')).toMatchObject({ reason: 'trigger-excluded' });

    const once = createTrigger('slack', 'batch');
    const batchSpy = vi.spyOn(once, 'triggerBatch').mockResolvedValue(undefined);
    await once.handleContainerReports([report(createContainer('c3'))]);
    await once.handleContainerReports([report(createContainer('c3'))]);
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(reasonFor(once, 'c3')).toMatchObject({ reason: 'once-already-sent' });
  });

  test('rule-disabled is recorded only for containers with an update', async () => {
    vi.mocked(notificationStore.getTriggerDispatchDecisionForRule).mockReturnValue({
      enabled: false,
      reason: 'excluded-from-allow-list',
    } as any);
    const trigger = createTrigger('slack', 'batch');

    await trigger.handleContainerReports([
      report(createContainer('c1')),
      report(createContainer('c2', { updateAvailable: false })),
    ]);

    expect(getNotificationSkipsSnapshot().map((skip) => skip.containerId)).toEqual(['c1']);
    expect(reasonFor(trigger, 'c1')).toMatchObject({
      reason: 'rule-disabled',
      detail: 'excluded-from-allow-list',
    });
  });

  test('a report confirming no update clears the recorded skip', async () => {
    const trigger = createTrigger('slack', 'batch', { threshold: 'major-only' });
    vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.handleContainerReports([report(createContainer('c1'))]);
    expect(reasonFor(trigger, 'c1')).toBeDefined();

    await trigger.handleContainerReports([
      report(createContainer('c1', { updateAvailable: false })),
    ]);

    expect(reasonFor(trigger, 'c1')).toBeUndefined();
  });
});

describe('digest mode', () => {
  test('digest-buffered is recorded on buffering and cleared when the digest is sent', async () => {
    const trigger = createTrigger('slack', 'digest');
    const container = createContainer('c1');

    await trigger.handleContainerReportDigest(report(container));
    expect(reasonFor(trigger, 'c1')).toMatchObject({ reason: 'digest-buffered' });

    vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();

    expect(reasonFor(trigger, 'c1')).toBeUndefined();
  });

  test('threshold-not-met, trigger-excluded and rule-disabled are recorded', async () => {
    const thresholded = createTrigger('slack', 'digest', { threshold: 'major-only' });
    await thresholded.handleContainerReportDigest(report(createContainer('c1')));
    expect(reasonFor(thresholded, 'c1')).toMatchObject({ reason: 'threshold-not-met' });

    const excluding = createTrigger('slack', 'digest');
    await excluding.handleContainerReportDigest(
      report(createContainer('c2', { notificationTriggerExclude: excluding.getId() })),
    );
    expect(reasonFor(excluding, 'c2')).toMatchObject({ reason: 'trigger-excluded' });

    vi.mocked(notificationStore.getTriggerDispatchDecisionForRule).mockReturnValue({
      enabled: false,
      reason: 'rule-disabled',
    } as any);
    const disabled = createTrigger('slack', 'digest');
    await disabled.handleContainerReportDigest(report(createContainer('c3')));
    expect(reasonFor(disabled, 'c3')).toMatchObject({ reason: 'rule-disabled' });
  });

  test('once-already-sent is recorded for a repeat of a digested result', async () => {
    const trigger = createTrigger('slack', 'digest');
    vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.handleContainerReportDigest(report(createContainer('c1')));
    await trigger.flushDigestBuffer();

    await trigger.handleContainerReportDigest(report(createContainer('c1')));

    expect(reasonFor(trigger, 'c1')).toMatchObject({ reason: 'once-already-sent' });
  });

  test('a report confirming no update clears the recorded skip', async () => {
    const trigger = createTrigger('slack', 'digest');
    await trigger.handleContainerReportDigest(report(createContainer('c1')));

    await trigger.handleContainerReportDigest(
      report(createContainer('c1', { updateAvailable: false })),
    );

    expect(reasonFor(trigger, 'c1')).toBeUndefined();
  });
});

describe('event dispatch', () => {
  const payload = (container: any) =>
    ({ container, pendingSince: '2026-01-01', minAgeDays: 3, clockSource: 'detected' }) as any;

  test('rule-disabled, threshold-not-met and trigger-excluded are recorded for lifecycle events', async () => {
    vi.mocked(notificationStore.isTriggerEnabledForRule).mockReturnValue(false);
    const disabled = createTrigger('slack', 'simple');
    await disabled.handleMaturityGateClearedEvent(payload(createContainer('c1')));
    expect(reasonFor(disabled, 'c1')).toMatchObject({
      reason: 'rule-disabled',
      detail: 'maturity-cleared',
    });

    vi.mocked(notificationStore.isTriggerEnabledForRule).mockReturnValue(true);
    const thresholded = createTrigger('slack', 'simple', { threshold: 'major-only' });
    await thresholded.handleMaturityGateClearedEvent(payload(createContainer('c2')));
    expect(reasonFor(thresholded, 'c2')).toMatchObject({ reason: 'threshold-not-met' });

    const excluding = createTrigger('slack', 'simple');
    await excluding.handleMaturityGateClearedEvent(
      payload(createContainer('c3', { notificationTriggerExclude: excluding.getId() })),
    );
    expect(reasonFor(excluding, 'c3')).toMatchObject({ reason: 'trigger-excluded' });
  });

  test('a maturity-cleared notification for an already-notified update records once-already-sent', async () => {
    const trigger = createTrigger('slack', 'simple');
    vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);
    await trigger.handleContainerReport(report(createContainer('c1')));

    await trigger.handleMaturityGateClearedEvent(payload(createContainer('c1')));

    expect(reasonFor(trigger, 'c1')).toMatchObject({ reason: 'once-already-sent' });
  });

  test('a delivered lifecycle notification clears the skip', async () => {
    const trigger = createTrigger('slack', 'simple');
    vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);
    vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    const container = createContainer('c1');
    await trigger.handleContainerReport(report(container));
    await trigger.handleContainerReport(report(container));
    expect(reasonFor(trigger, 'c1')).toBeDefined();
    (notificationHistoryStore.resetForTesting as any)();

    await trigger.handleMaturityGateClearedEvent(payload(container));
    await vi.waitFor(() => expect(reasonFor(trigger, 'c1')).toBeUndefined());
  });
});

describe('skip lifecycle', () => {
  const failed = (container: any) => ({ containerName: container.name, error: 'boom', container });

  test('update-failed: disabled records a skip, re-enabled delivery clears it', async () => {
    const trigger = createTrigger('slack', 'simple');
    const sendSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);
    const container = createContainer('c1');

    vi.mocked(notificationStore.isTriggerEnabledForRule).mockReturnValue(false);
    await trigger.handleContainerUpdateFailedEvent(failed(container));
    expect(reasonFor(trigger, 'c1')).toMatchObject({ reason: 'rule-disabled' });

    vi.mocked(notificationStore.isTriggerEnabledForRule).mockReturnValue(true);
    await trigger.handleContainerUpdateFailedEvent(failed(container));
    await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(reasonFor(trigger, 'c1')).toBeUndefined());
  });

  test('update-failed in batch mode: a delivered flush clears the skip', async () => {
    const trigger = createTrigger('slack', 'batch');
    const batchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    const container = createContainer('c1');
    recordNotificationSkip(trigger.getId(), 'c1', 'rule-disabled', 'update-failed');

    await trigger.flushEventBatchDispatch('update-failed', [container]);

    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(reasonFor(trigger, 'c1')).toBeUndefined();
  });

  test('a failed lifecycle delivery keeps the skip', async () => {
    const trigger = createTrigger('slack', 'simple');
    vi.spyOn(trigger, 'trigger').mockRejectedValue(new Error('smtp down'));
    recordNotificationSkip(trigger.getId(), 'c1', 'rule-disabled', 'update-failed');

    await trigger.handleContainerUpdateFailedEvent(failed(createContainer('c1')));
    await new Promise((resolve) => setImmediate(resolve));

    expect(reasonFor(trigger, 'c1')).toBeDefined();
  });

  test('a successful outbox retry clears the skip', async () => {
    const trigger = createTrigger('slack', 'simple');
    vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);
    recordNotificationSkip(trigger.getId(), 'c1', 'rule-disabled', 'update-failed');

    await trigger.dispatchOutboxEntry({
      id: 'o1',
      payload: { container: createContainer('c1') },
    } as any);

    expect(reasonFor(trigger, 'c1')).toBeUndefined();
  });

  test('a failed outbox retry keeps the skip', async () => {
    const trigger = createTrigger('slack', 'simple');
    vi.spyOn(trigger, 'trigger').mockRejectedValue(new Error('still down'));
    recordNotificationSkip(trigger.getId(), 'c1', 'rule-disabled', 'update-failed');

    await expect(
      trigger.dispatchOutboxEntry({
        id: 'o1',
        payload: { container: createContainer('c1') },
      } as any),
    ).rejects.toThrow('still down');

    expect(reasonFor(trigger, 'c1')).toBeDefined();
  });

  test('batch mode: a disabled rule still clears the skip of a container with no update', async () => {
    const trigger = createTrigger('slack', 'batch');
    vi.mocked(notificationStore.getTriggerDispatchDecisionForRule).mockReturnValue({
      enabled: false,
      reason: 'excluded-from-allow-list',
    } as any);
    recordNotificationSkip(trigger.getId(), 'c2', 'threshold-not-met');

    await trigger.handleContainerReports([
      report(createContainer('c1')),
      report(createContainer('c2', { updateAvailable: false })),
    ]);

    expect(reasonFor(trigger, 'c2')).toBeUndefined();
    expect(reasonFor(trigger, 'c1')).toMatchObject({ reason: 'rule-disabled' });
  });

  test('deregistering a trigger drops its skips and refuses late ones, re-init allows them', async () => {
    const trigger = createTrigger('slack', 'simple', { auto: false });
    recordNotificationSkip(trigger.getId(), 'c1', 'rule-disabled');
    recordNotificationSkip('smtp.other', 'c1', 'rule-disabled');

    await trigger.deregisterComponent();
    recordNotificationSkip(trigger.getId(), 'c2', 'rule-disabled');
    expect(getNotificationSkipsSnapshot().map((skip) => skip.trigger)).toEqual(['smtp.other']);

    await trigger.init();
    recordNotificationSkip(trigger.getId(), 'c2', 'rule-disabled');
    expect(reasonFor(trigger, 'c2')).toBeDefined();
    await trigger.deregisterComponent();
  });

  test('removing a container drops its skips for this trigger', async () => {
    let onRemoved: ((container: any) => void) | undefined;
    const unregister = vi.fn();
    vi.mocked(event.registerContainerRemoved).mockImplementation(((handler: any) => {
      onRemoved = handler;
      return unregister;
    }) as any);
    const trigger = createTrigger('slack', 'simple', { auto: false });
    await trigger.init();
    recordNotificationSkip(trigger.getId(), 'c1', 'rule-disabled');
    recordNotificationSkip(trigger.getId(), 'c2', 'rule-disabled');

    onRemoved?.(createContainer('c1'));
    expect(getNotificationSkipsSnapshot().map((skip) => skip.containerId)).toEqual(['c2']);

    await trigger.deregisterComponent();
    expect(unregister).toHaveBeenCalledTimes(1);
  });
});

test('the container-scoped view lists one entry per trigger', async () => {
  const first = createTrigger('slack', 'simple', { threshold: 'major-only' });
  const second = createTrigger('smtp', 'simple', { threshold: 'major-only' });
  await first.handleContainerReport(report(createContainer('c1')));
  await second.handleContainerReport(report(createContainer('c1')));

  expect(getNotificationSkipsForContainer('c1').map((skip) => skip.trigger)).toEqual([
    first.getId(),
    second.getId(),
  ]);
});
