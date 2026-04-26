import joi from 'joi';
import mockCron from 'node-cron';
import * as configuration from '../../configuration/index.js';
import * as event from '../../event/index.js';
import log from '../../log/index.js';
import * as auditStore from '../../store/audit.js';
import * as storeContainer from '../../store/container.js';
import * as notificationStore from '../../store/notification.js';
import * as notificationHistoryStore from '../../store/notification-history.js';
import { UpdateRequestError } from '../../updates/request-update.js';
import Trigger, {
  buildLiteralTemplateExpression,
  getNotificationEvent,
  resolveNotificationTemplate,
} from './Trigger.js';

const mockTriggerCounterInc = vi.hoisted(() => vi.fn());
const mockGetAgents = vi.hoisted(() => vi.fn(() => []));
const mockGetServerName = vi.hoisted(() => vi.fn(() => 'controller-host'));
const forceRejectedUpdateBatch = vi.hoisted(() => ({ enabled: false }));

vi.mock('node-cron');
vi.mock('../../log');
vi.mock('../../event');
vi.mock('../../agent/manager.js', () => ({
  getAgents: mockGetAgents,
}));
vi.mock('../../configuration/index.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...(original as Record<string, unknown>),
    getServerName: mockGetServerName,
  };
});
vi.mock('../../store/audit.js', () => ({
  insertAudit: vi.fn(),
}));
vi.mock('../../store/notification.js', () => ({
  isTriggerEnabledForRule: vi.fn(() => true),
  getTriggerDispatchDecisionForRule: vi.fn(() => ({
    enabled: true,
    reason: 'matched-allow-list',
  })),
}));
vi.mock('../../store/container.js', () => ({
  getContainers: vi.fn(() => []),
  getContainersRaw: vi.fn(() => []),
}));
vi.mock('../../store/notification-history.js', () => {
  const notificationHistoryByKey = new Map();
  const buildKey = (triggerId, containerId, eventKind) =>
    `${triggerId}::${containerId}::${eventKind}`;
  return {
    createCollections: vi.fn(),
    computeResultHash: vi.fn((container) => {
      const result = container?.result ?? {};
      const updateKind = container?.updateKind ?? {};
      return JSON.stringify({
        tag: result.tag ?? null,
        suggestedTag: result.suggestedTag ?? null,
        digest: result.digest ?? null,
        created: result.created ?? null,
        kind: updateKind.kind ?? null,
        remoteValue: updateKind.remoteValue ?? null,
      });
    }),
    recordNotification: vi.fn((triggerId, containerId, eventKind, resultHash, notifiedAt) => {
      notificationHistoryByKey.set(buildKey(triggerId, containerId, eventKind), {
        triggerId,
        containerId,
        eventKind,
        resultHash,
        notifiedAt: notifiedAt ?? new Date().toISOString(),
      });
    }),
    getLastNotifiedHash: vi.fn((triggerId, containerId, eventKind) => {
      const entry = notificationHistoryByKey.get(buildKey(triggerId, containerId, eventKind));
      return entry?.resultHash;
    }),
    clearNotificationsForContainer: vi.fn((containerId) => {
      let cleared = 0;
      for (const [key, entry] of notificationHistoryByKey.entries()) {
        if (entry.containerId === containerId) {
          notificationHistoryByKey.delete(key);
          cleared += 1;
        }
      }
      return cleared;
    }),
    clearNotificationsForTrigger: vi.fn((triggerId) => {
      let cleared = 0;
      for (const [key, entry] of notificationHistoryByKey.entries()) {
        if (entry.triggerId === triggerId) {
          notificationHistoryByKey.delete(key);
          cleared += 1;
        }
      }
      return cleared;
    }),
    clearNotificationsForContainerAndEvent: vi.fn((containerId, eventKind) => {
      let cleared = 0;
      for (const [key, entry] of notificationHistoryByKey.entries()) {
        if (entry.containerId === containerId && entry.eventKind === eventKind) {
          notificationHistoryByKey.delete(key);
          cleared += 1;
        }
      }
      return cleared;
    }),
    getAllForTesting: vi.fn(() => Array.from(notificationHistoryByKey.values())),
    resetForTesting: vi.fn(() => notificationHistoryByKey.clear()),
  };
});
vi.mock('../../updates/request-update.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../updates/request-update.js')>();
  return {
    ...original,
    enqueueContainerUpdates: vi.fn(
      async (...args: Parameters<typeof original.enqueueContainerUpdates>) => {
        if (forceRejectedUpdateBatch.enabled) {
          const useNotificationKey = Array.isArray(args[0]) && args[0][0]?.id === 'with-key';
          return {
            accepted: [],
            rejected: [
              {
                container: useNotificationKey
                  ? ({ id: 'c1', name: 'app', watcher: 'test' } as any)
                  : ({} as any),
                message: 'rejected',
              },
            ],
          };
        }
        return original.enqueueContainerUpdates(...args);
      },
    ),
  };
});
vi.mock('../../prometheus/trigger', () => ({
  getTriggerCounter: () => ({
    inc: mockTriggerCounterInc,
  }),
}));

let trigger;

const configurationValid = {
  threshold: 'all',
  once: true,
  mode: 'simple',
  auto: true,
  order: 100,
  simpletitle:
    '${isDigestUpdate ? "New image available for container " + container.name + container.notificationWatcherSuffix + " (tag " + currentTag + ")" : "New " + container.updateKind.kind + " found for container " + container.name + container.notificationWatcherSuffix}',

  simplebody:
    '${isDigestUpdate ? "Container " + container.name + container.notificationWatcherSuffix + " running tag " + currentTag + " has a newer image available" : "Container " + container.name + container.notificationWatcherSuffix + " running with " + container.updateKind.kind + " " + container.updateKind.localValue + " can be updated to " + container.updateKind.kind + " " + container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

  batchtitle: '${containers.length} updates available',
  resolvenotifications: false,
};

beforeEach(async () => {
  vi.resetAllMocks();
  mockTriggerCounterInc.mockReset();
  notificationStore.isTriggerEnabledForRule.mockReturnValue(true);
  notificationStore.getTriggerDispatchDecisionForRule.mockReturnValue({
    enabled: true,
    reason: 'matched-allow-list',
  });
  storeContainer.getContainers.mockReturnValue([]);
  storeContainer.getContainersRaw.mockImplementation((query, pagination) =>
    storeContainer.getContainers(query, pagination),
  );
  notificationHistoryStore.resetForTesting();
  trigger = new Trigger();
  trigger.log = log;
  trigger.configuration = { ...configurationValid };
});

test('validateConfiguration should return validated configuration when valid', async () => {
  const validatedConfiguration = trigger.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual({
    ...configurationValid,
    auto: 'all',
    digestcron: '0 8 * * *',
    securitymode: 'simple',
  });
});

test('validateConfiguration should normalize auto=true to all', () => {
  const validatedConfiguration = trigger.validateConfiguration({
    ...configurationValid,
    auto: true,
  });
  expect(validatedConfiguration.auto).toBe('all');
});

test('validateConfiguration should normalize auto=false to none', () => {
  const validatedConfiguration = trigger.validateConfiguration({
    ...configurationValid,
    auto: false,
  });
  expect(validatedConfiguration.auto).toBe('none');
});

test('validateConfiguration should accept and normalize auto all/none/oninclude values', () => {
  expect(
    trigger.validateConfiguration({
      ...configurationValid,
      auto: 'all',
    }).auto,
  ).toBe('all');

  expect(
    trigger.validateConfiguration({
      ...configurationValid,
      auto: 'none',
    }).auto,
  ).toBe('none');

  expect(
    trigger.validateConfiguration({
      ...configurationValid,
      auto: 'oninclude',
    }).auto,
  ).toBe('oninclude');
});

test('validateConfiguration should normalize mixed-case auto value', () => {
  const validatedConfiguration = trigger.validateConfiguration({
    ...configurationValid,
    auto: 'OnInclude',
  });
  expect(validatedConfiguration.auto).toBe('oninclude');
});

test('validateConfiguration should default auto to all for notification triggers', () => {
  trigger.type = 'slack';
  const { auto, ...configurationWithoutAuto } = configurationValid;
  const validatedConfiguration = trigger.validateConfiguration(configurationWithoutAuto);
  expect(validatedConfiguration.auto).toBe('all');
});

test('validateConfiguration should default auto to oninclude for action triggers', () => {
  trigger.type = 'docker';
  const { auto, ...configurationWithoutAuto } = configurationValid;
  const validatedConfiguration = trigger.validateConfiguration(configurationWithoutAuto);
  expect(validatedConfiguration.auto).toBe('oninclude');
});

test('validateConfiguration should respect explicit auto=true on action triggers', () => {
  trigger.type = 'docker';
  const validatedConfiguration = trigger.validateConfiguration({
    ...configurationValid,
    auto: true,
  });
  expect(validatedConfiguration.auto).toBe('all');
});

test('validateConfiguration should default auto to oninclude for dockercompose triggers', () => {
  trigger.type = 'dockercompose';
  const { auto, ...configurationWithoutAuto } = configurationValid;
  const validatedConfiguration = trigger.validateConfiguration(configurationWithoutAuto);
  expect(validatedConfiguration.auto).toBe('oninclude');
});

test('validateConfiguration should default auto to oninclude for command triggers', () => {
  trigger.type = 'command';
  const { auto, ...configurationWithoutAuto } = configurationValid;
  const validatedConfiguration = trigger.validateConfiguration(configurationWithoutAuto);
  expect(validatedConfiguration.auto).toBe('oninclude');
});

test('validateConfiguration should accept digest and non-digest thresholds', async () => {
  expect(
    trigger.validateConfiguration({
      ...configurationValid,
      threshold: 'digest',
    }).threshold,
  ).toStrictEqual('digest');
  expect(
    trigger.validateConfiguration({
      ...configurationValid,
      threshold: 'patch-no-digest',
    }).threshold,
  ).toStrictEqual('patch-no-digest');
});

test('validateConfiguration should throw error when invalid', async () => {
  const configuration = {
    url: 'git://xxx.com',
  };
  expect(() => {
    trigger.validateConfiguration(configuration);
  }).toThrowError(joi.ValidationError);
});

test('getMetadata should include trigger category for action types', () => {
  trigger.type = 'docker';
  trigger.name = 'update';

  expect(trigger.getMetadata()).toEqual({
    category: 'action',
    usesLegacyPrefix: false,
  });
});

test('getMetadata should include trigger category and legacy prefix usage for notification types', () => {
  configuration.ddEnvVars.DD_TRIGGER_SLACK_NOTIFY_CHANNEL = 'ops';
  configuration.getTriggerConfigurations();

  trigger.type = 'slack';
  trigger.name = 'notify';

  expect(trigger.getMetadata()).toEqual({
    category: 'notification',
    usesLegacyPrefix: true,
  });

  delete configuration.ddEnvVars.DD_TRIGGER_SLACK_NOTIFY_CHANNEL;
});

test('init should register to container report when simple mode enabled', async () => {
  const spy = vi.spyOn(event, 'registerContainerReport');
  await trigger.init();
  expect(spy).toHaveBeenCalled();
});

test('init should register to container reports when batch mode enabled', async () => {
  const spy = vi.spyOn(event, 'registerContainerReports');
  trigger.configuration.mode = 'batch';
  await trigger.init();
  expect(spy).toHaveBeenCalled();
});

test('mode capability helpers should treat batch+digest as both batch and digest capable', () => {
  expect((Trigger as any).isBatchCapableMode('batch')).toBe(true);
  expect((Trigger as any).isBatchCapableMode('batch+digest')).toBe(true);
  expect((Trigger as any).isBatchCapableMode('digest')).toBe(false);
  expect((Trigger as any).isBatchCapableMode(undefined)).toBe(false);

  expect((Trigger as any).isDigestCapableMode('digest')).toBe(true);
  expect((Trigger as any).isDigestCapableMode('batch+digest')).toBe(true);
  expect((Trigger as any).isDigestCapableMode('batch')).toBe(false);
  expect((Trigger as any).isDigestCapableMode(undefined)).toBe(false);
});

test('init should register handlers with trigger id and order', async () => {
  const spy = vi.spyOn(event, 'registerContainerReport');
  trigger.type = 'docker';
  trigger.name = 'update';
  trigger.configuration.order = 42;
  await trigger.init();
  expect(spy).toHaveBeenCalledWith(expect.any(Function), {
    id: 'docker.update',
    order: 42,
  });
});

test('init should not register auto listeners when auto is none', async () => {
  const reportSpy = vi.spyOn(event, 'registerContainerReport');
  const reportsSpy = vi.spyOn(event, 'registerContainerReports');
  const updateAppliedSpy = vi.spyOn(event, 'registerContainerUpdateApplied');
  const updateFailedSpy = vi.spyOn(event, 'registerContainerUpdateFailed');
  const securityAlertSpy = vi.spyOn(event, 'registerSecurityAlert');
  const agentDisconnectedSpy = vi.spyOn(event, 'registerAgentDisconnected');
  trigger.configuration = trigger.validateConfiguration({
    ...configurationValid,
    auto: 'none',
  });

  await trigger.init();

  expect(reportSpy).not.toHaveBeenCalled();
  expect(reportsSpy).not.toHaveBeenCalled();
  expect(updateAppliedSpy).not.toHaveBeenCalled();
  expect(updateFailedSpy).not.toHaveBeenCalled();
  expect(securityAlertSpy).not.toHaveBeenCalled();
  expect(agentDisconnectedSpy).not.toHaveBeenCalled();
});

test('init should not register auto listeners when auto is false', async () => {
  const reportSpy = vi.spyOn(event, 'registerContainerReport');
  const reportsSpy = vi.spyOn(event, 'registerContainerReports');
  const updateAppliedSpy = vi.spyOn(event, 'registerContainerUpdateApplied');
  const updateFailedSpy = vi.spyOn(event, 'registerContainerUpdateFailed');
  const securityAlertSpy = vi.spyOn(event, 'registerSecurityAlert');
  const agentDisconnectedSpy = vi.spyOn(event, 'registerAgentDisconnected');
  trigger.configuration = trigger.validateConfiguration({
    ...configurationValid,
    auto: false,
  });

  await trigger.init();

  expect(reportSpy).not.toHaveBeenCalled();
  expect(reportsSpy).not.toHaveBeenCalled();
  expect(updateAppliedSpy).not.toHaveBeenCalled();
  expect(updateFailedSpy).not.toHaveBeenCalled();
  expect(securityAlertSpy).not.toHaveBeenCalled();
  expect(agentDisconnectedSpy).not.toHaveBeenCalled();
});

test('init should register auto listeners when auto is oninclude', async () => {
  const reportSpy = vi.spyOn(event, 'registerContainerReport');
  const updateAppliedSpy = vi.spyOn(event, 'registerContainerUpdateApplied');
  const updateFailedSpy = vi.spyOn(event, 'registerContainerUpdateFailed');
  const securityAlertSpy = vi.spyOn(event, 'registerSecurityAlert');
  const agentDisconnectedSpy = vi.spyOn(event, 'registerAgentDisconnected');
  trigger.configuration = trigger.validateConfiguration({
    ...configurationValid,
    auto: 'oninclude',
    mode: 'simple',
  });

  await trigger.init();

  expect(reportSpy).toHaveBeenCalled();
  expect(updateAppliedSpy).toHaveBeenCalled();
  expect(updateFailedSpy).toHaveBeenCalled();
  expect(securityAlertSpy).toHaveBeenCalled();
  expect(agentDisconnectedSpy).toHaveBeenCalled();
});

test('deregister should unregister container report handler', async () => {
  const unregisterHandler = vi.fn();
  vi.spyOn(event, 'registerContainerReport').mockReturnValue(unregisterHandler);

  await trigger.init();
  await trigger.deregister();

  expect(unregisterHandler).toHaveBeenCalled();
});

const handleContainerReportTestCases = [
  {
    shouldTrigger: true,
    threshold: 'all',
    once: true,
    changed: true,
    updateAvailable: true,
    kind: 'tag',
    semverDiff: 'major',
  },
  {
    shouldTrigger: true,
    threshold: 'all',
    once: false,
    changed: false,
    updateAvailable: true,
    kind: 'tag',
    semverDiff: 'major',
  },
  {
    shouldTrigger: true,
    threshold: 'all',
    once: true,
    changed: true,
    updateAvailable: true,
    kind: 'unknown',
    semverDiff: undefined,
  },
  {
    shouldTrigger: false,
    threshold: 'minor',
    once: true,
    changed: true,
    updateAvailable: true,
    kind: 'tag',
    semverDiff: 'major',
  },
  {
    shouldTrigger: false,
    threshold: 'minor',
    once: false,
    changed: false,
    updateAvailable: true,
    kind: 'tag',
    semverDiff: 'major',
  },
  {
    shouldTrigger: false,
    threshold: 'minor',
    once: false,
    changed: true,
    updateAvailable: false,
    kind: 'tag',
    semverDiff: 'major',
  },
];

test.each(
  handleContainerReportTestCases,
)('handleContainerReport should call trigger? ($shouldTrigger) when changed=$changed and updateAvailable=$updateAvailable and threshold=$threshold', async (item) => {
  trigger.configuration = {
    threshold: item.threshold,
    once: item.once,
    mode: 'simple',
  };
  await trigger.init();

  const spy = vi.spyOn(trigger, 'trigger');
  await trigger.handleContainerReport({
    changed: item.changed,
    container: {
      name: 'container1',
      updateAvailable: item.updateAvailable,
      updateKind: {
        kind: item.kind,
        semverDiff: item.semverDiff,
      },
    },
  });
  if (item.shouldTrigger) {
    expect(spy).toHaveBeenCalledWith({
      name: 'container1',
      updateAvailable: item.updateAvailable,
      updateKind: {
        kind: item.kind,
        semverDiff: item.semverDiff,
      },
    });
  } else {
    expect(spy).not.toHaveBeenCalled();
  }
});

test('handleContainerReport should warn when trigger method of the trigger fails', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'simple',
  };
  trigger.trigger = () => {
    throw new Error('Fail!!!');
  };
  await trigger.init();
  const spyLog = vi.spyOn(log, 'warn');
  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      updateAvailable: true,
    },
  });
  expect(spyLog).toHaveBeenCalledWith('Error (Fail!!!)');
});

test('handleContainerReport should stringify non-Error failures', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'simple',
  };
  trigger.trigger = () => {
    throw 'string failure';
  };
  await trigger.init();
  const spyLog = vi.spyOn(log, 'warn');

  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      updateAvailable: true,
    },
  });

  expect(spyLog).toHaveBeenCalledWith('Error (string failure)');
});

test('handleContainerReport should stringify symbol failures', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'simple',
  };
  const symbolFailure = Symbol('symbol failure');
  trigger.trigger = () => {
    throw symbolFailure;
  };
  await trigger.init();
  const spyLog = vi.spyOn(log, 'warn');

  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      updateAvailable: true,
    },
  });

  expect(spyLog).toHaveBeenCalledWith(`Error (${String(symbolFailure)})`);
});

test('handleContainerReport should suppress repeated identical errors during a short burst', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'simple',
  };
  trigger.trigger = () => {
    throw new Error('Fail!!!');
  };
  await trigger.init();

  const warnSpy = vi.spyOn(log, 'warn');
  let now = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);

  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      watcher: 'local',
      updateAvailable: true,
      updateKind: {
        kind: 'tag',
        semverDiff: 'major',
      },
    },
  });
  now = 1_500;
  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container2',
      watcher: 'local',
      updateAvailable: true,
      updateKind: {
        kind: 'tag',
        semverDiff: 'major',
      },
    },
  });

  expect(warnSpy).toHaveBeenCalledTimes(1);
  expect(warnSpy).toHaveBeenCalledWith('Error (Fail!!!)');
});

test('handleContainerReport should log repeated errors again after suppression window expires', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'simple',
  };
  trigger.trigger = () => {
    throw new Error('Fail!!!');
  };
  await trigger.init();

  const warnSpy = vi.spyOn(log, 'warn');
  let now = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);

  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      watcher: 'local',
      updateAvailable: true,
      updateKind: {
        kind: 'tag',
        semverDiff: 'major',
      },
    },
  });
  now = 60_000;
  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container2',
      watcher: 'local',
      updateAvailable: true,
      updateKind: {
        kind: 'tag',
        semverDiff: 'major',
      },
    },
  });

  expect(warnSpy).toHaveBeenCalledTimes(2);
  expect(warnSpy).toHaveBeenNthCalledWith(1, 'Error (Fail!!!)');
  expect(warnSpy).toHaveBeenNthCalledWith(2, 'Error (Fail!!!)');
});

const handleContainerReportsTestCases = [
  {
    shouldTrigger: true,
    threshold: 'all',
    once: true,
    changed: true,
    updateAvailable: true,
    semverDiff: 'major',
  },
  {
    shouldTrigger: true,
    threshold: 'all',
    once: false,
    changed: false,
    updateAvailable: true,
    semverDiff: 'major',
  },
  {
    shouldTrigger: false,
    threshold: 'minor',
    once: true,
    changed: true,
    updateAvailable: true,
    semverDiff: 'major',
  },
  {
    shouldTrigger: false,
    threshold: 'minor',
    once: false,
    changed: false,
    updateAvailable: true,
    semverDiff: 'major',
  },
  {
    shouldTrigger: false,
    threshold: 'minor',
    once: false,
    changed: true,
    updateAvailable: false,
    semverDiff: 'major',
  },
];

test.each(
  handleContainerReportsTestCases,
)('handleContainerReports should call triggerBatch? ($shouldTrigger) when changed=$changed and updateAvailable=$updateAvailable and threshold=$threshold', async (item) => {
  trigger.configuration = {
    threshold: item.threshold,
    once: item.once,
    mode: 'simple',
  };
  await trigger.init();

  const spy = vi.spyOn(trigger, 'triggerBatch');
  await trigger.handleContainerReports([
    {
      changed: item.changed,
      container: {
        name: 'container1',
        updateAvailable: item.updateAvailable,
        updateKind: {
          kind: 'tag',
          semverDiff: item.semverDiff,
        },
      },
    },
  ]);
  if (item.shouldTrigger) {
    expect(spy).toHaveBeenCalledWith([
      {
        name: 'container1',
        updateAvailable: item.updateAvailable,
        updateKind: {
          kind: 'tag',
          semverDiff: item.semverDiff,
        },
      },
    ]);
  } else {
    expect(spy).not.toHaveBeenCalled();
  }
});

const isThresholdReachedTestCases = [
  {
    result: true,
    threshold: 'all',
    change: undefined,
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'major',
    change: 'major',
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'major',
    change: 'minor',
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'major',
    change: 'patch',
    kind: 'tag',
  },
  {
    result: false,
    threshold: 'minor',
    change: 'major',
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'minor',
    change: 'minor',
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'minor',
    change: 'patch',
    kind: 'tag',
  },
  {
    result: false,
    threshold: 'patch',
    change: 'major',
    kind: 'tag',
  },
  {
    result: false,
    threshold: 'patch',
    change: 'minor',
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'patch',
    change: 'patch',
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'all',
    change: 'unknown',
    kind: 'digest',
  },
  {
    result: true,
    threshold: 'major',
    change: 'unknown',
    kind: 'digest',
  },
  {
    result: true,
    threshold: 'minor',
    change: 'unknown',
    kind: 'digest',
  },
  {
    result: true,
    threshold: 'patch',
    change: 'unknown',
    kind: 'digest',
  },
  {
    result: true,
    threshold: 'digest',
    change: 'unknown',
    kind: 'digest',
  },
  {
    result: false,
    threshold: 'digest',
    change: 'patch',
    kind: 'tag',
  },
  {
    result: false,
    threshold: 'patch-no-digest',
    change: 'unknown',
    kind: 'digest',
  },
  {
    result: true,
    threshold: 'patch-no-digest',
    change: 'patch',
    kind: 'tag',
  },
  {
    result: false,
    threshold: 'patch-no-digest',
    change: 'minor',
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'minor-only-no-digest',
    change: 'minor',
    kind: 'tag',
  },
  {
    result: false,
    threshold: 'minor-only-no-digest',
    change: 'major',
    kind: 'tag',
  },
];

test.each(
  isThresholdReachedTestCases,
)('isThresholdReached should return $result when threshold is $threshold and change is $change', (item) => {
  trigger.configuration = {
    threshold: item.threshold,
  };
  expect(
    Trigger.isThresholdReached(
      {
        updateKind: {
          kind: item.kind,
          semverDiff: item.change,
        },
      },
      trigger.configuration.threshold,
    ),
  ).toEqual(item.result);
});

test('isThresholdReached should return true when there is no semverDiff regardless of the threshold', async () => {
  trigger.configuration = {
    threshold: 'all',
  };
  expect(
    Trigger.isThresholdReached(
      {
        updateKind: { kind: 'digest' },
      },
      trigger.configuration.threshold,
    ),
  ).toBeTruthy();
});

test('parseIncludeOrIncludeTriggerString should parse digest thresholds', async () => {
  expect(Trigger.parseIncludeOrIncludeTriggerString('docker.local:digest')).toStrictEqual({
    id: 'docker.local',
    threshold: 'digest',
  });
  expect(Trigger.parseIncludeOrIncludeTriggerString('docker.local:patch-no-digest')).toStrictEqual({
    id: 'docker.local',
    threshold: 'patch-no-digest',
  });
});

test('parseIncludeOrIncludeTriggerString should trim spaces around id and threshold', () => {
  expect(Trigger.parseIncludeOrIncludeTriggerString('  docker.local : DIGEST  ')).toStrictEqual({
    id: 'docker.local',
    threshold: 'digest',
  });
});

test('parseIncludeOrIncludeTriggerString should ignore threshold when multiple separators are present', () => {
  expect(Trigger.parseIncludeOrIncludeTriggerString('docker.local:digest:extra')).toStrictEqual({
    id: 'docker.local',
    threshold: 'all',
  });
});

test('parseIncludeOrIncludeTriggerString should fallback to all for unsupported threshold', () => {
  expect(Trigger.parseIncludeOrIncludeTriggerString('docker.local:not-supported')).toStrictEqual({
    id: 'docker.local',
    threshold: 'all',
  });
});

test('doesReferenceMatchId should match full trigger id and trigger name', async () => {
  expect(Trigger.doesReferenceMatchId('docker.update', 'docker.update')).toBe(true);
  expect(Trigger.doesReferenceMatchId('update', 'docker.update')).toBe(true);
  expect(Trigger.doesReferenceMatchId('notify', 'docker.update')).toBe(false);
});

test('doesReferenceMatchId should return false for trigger ids without provider segment', () => {
  expect(Trigger.doesReferenceMatchId('docker.update', 'update')).toBe(false);
});

test('mustTrigger should accept trigger name-only include filters', async () => {
  trigger.type = 'docker';
  trigger.name = 'update';

  expect(
    trigger.mustTrigger({
      triggerInclude: 'update:minor',
      updateKind: {
        kind: 'tag',
        semverDiff: 'minor',
      },
    }),
  ).toBe(true);
});

test('mustTrigger should accept trigger name-only exclude filters', async () => {
  trigger.type = 'docker';
  trigger.name = 'update';

  expect(
    trigger.mustTrigger({
      triggerExclude: 'update',
      updateKind: {
        kind: 'tag',
        semverDiff: 'patch',
      },
    }),
  ).toBe(false);
});

test('mustTrigger should fire without include label when auto is true', () => {
  trigger.type = 'docker';
  trigger.name = 'update';
  trigger.configuration.auto = true;

  expect(
    trigger.mustTrigger({
      updateKind: {
        kind: 'tag',
        semverDiff: 'minor',
      },
    }),
  ).toBe(true);
});

test('mustTrigger should fire without include label when auto is all', () => {
  trigger.type = 'docker';
  trigger.name = 'update';
  trigger.configuration.auto = 'all';

  expect(
    trigger.mustTrigger({
      updateKind: {
        kind: 'tag',
        semverDiff: 'minor',
      },
    }),
  ).toBe(true);
});

test('mustTrigger should not fire without include label when auto is oninclude', () => {
  trigger.type = 'docker';
  trigger.name = 'update';
  trigger.configuration.auto = 'oninclude';

  expect(
    trigger.mustTrigger({
      updateKind: {
        kind: 'tag',
        semverDiff: 'minor',
      },
    }),
  ).toBe(false);
});

test('mustTrigger should fire with include label when auto is oninclude', () => {
  trigger.type = 'docker';
  trigger.name = 'update';
  trigger.configuration.auto = 'oninclude';

  expect(
    trigger.mustTrigger({
      triggerInclude: 'update:minor',
      updateKind: {
        kind: 'tag',
        semverDiff: 'minor',
      },
    }),
  ).toBe(true);
});

// --- Hybrid Triggers: name-only matching for include/exclude ---

test('doesReferenceMatchId should match name-only against multiple trigger types', async () => {
  // "update" should match "docker.update", "discord.update", etc.
  expect(Trigger.doesReferenceMatchId('update', 'docker.update')).toBe(true);
  expect(Trigger.doesReferenceMatchId('update', 'discord.update')).toBe(true);
  expect(Trigger.doesReferenceMatchId('update', 'slack.update')).toBe(true);
  // But not a different name
  expect(Trigger.doesReferenceMatchId('update', 'docker.notify')).toBe(false);
});

test('doesReferenceMatchId should be case-insensitive', async () => {
  expect(Trigger.doesReferenceMatchId('UPDATE', 'docker.update')).toBe(true);
  expect(Trigger.doesReferenceMatchId('Docker.Update', 'docker.update')).toBe(true);
});

test('mustTrigger should exclude multiple trigger types by name-only', async () => {
  // When a container has triggerExclude='update', ALL triggers named 'update'
  // should be excluded regardless of provider type
  const dockerTrigger = new Trigger();
  dockerTrigger.log = log;
  dockerTrigger.configuration = { ...configurationValid };
  dockerTrigger.type = 'docker';
  dockerTrigger.name = 'update';

  const discordTrigger = new Trigger();
  discordTrigger.log = log;
  discordTrigger.configuration = { ...configurationValid };
  discordTrigger.type = 'discord';
  discordTrigger.name = 'update';

  const container = {
    triggerExclude: 'update',
    updateKind: { kind: 'tag', semverDiff: 'minor' },
  };

  // Both docker.update and discord.update should be excluded by 'update'
  expect(dockerTrigger.mustTrigger(container)).toBe(false);
  expect(discordTrigger.mustTrigger(container)).toBe(false);
});

test('mustTrigger should include multiple trigger types by name-only', async () => {
  const dockerTrigger = new Trigger();
  dockerTrigger.log = log;
  dockerTrigger.configuration = { ...configurationValid };
  dockerTrigger.type = 'docker';
  dockerTrigger.name = 'update';

  const discordTrigger = new Trigger();
  discordTrigger.log = log;
  discordTrigger.configuration = { ...configurationValid };
  discordTrigger.type = 'discord';
  discordTrigger.name = 'update';

  const slackNotify = new Trigger();
  slackNotify.log = log;
  slackNotify.configuration = { ...configurationValid };
  slackNotify.type = 'slack';
  slackNotify.name = 'notify';

  const container = {
    triggerInclude: 'update:minor',
    updateKind: { kind: 'tag', semverDiff: 'minor' },
  };

  // Both docker.update and discord.update should be included
  expect(dockerTrigger.mustTrigger(container)).toBe(true);
  expect(discordTrigger.mustTrigger(container)).toBe(true);
  // But slack.notify should NOT be included (different name)
  expect(slackNotify.mustTrigger(container)).toBe(false);
});

test('mustTrigger should support name-only include with threshold for hybrid triggers', async () => {
  const dockerTrigger = new Trigger();
  dockerTrigger.log = log;
  dockerTrigger.configuration = { ...configurationValid };
  dockerTrigger.type = 'docker';
  dockerTrigger.name = 'update';

  const discordTrigger = new Trigger();
  discordTrigger.log = log;
  discordTrigger.configuration = { ...configurationValid };
  discordTrigger.type = 'discord';
  discordTrigger.name = 'update';

  // Include 'update' triggers only for minor (excludes major)
  const containerMinor = {
    triggerInclude: 'update:minor',
    updateKind: { kind: 'tag', semverDiff: 'minor' },
  };
  const containerMajor = {
    triggerInclude: 'update:minor',
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };

  expect(dockerTrigger.mustTrigger(containerMinor)).toBe(true);
  expect(discordTrigger.mustTrigger(containerMinor)).toBe(true);
  // Major should be excluded because threshold is 'minor'
  expect(dockerTrigger.mustTrigger(containerMajor)).toBe(false);
  expect(discordTrigger.mustTrigger(containerMajor)).toBe(false);
});

test('renderSimpleTitle should replace placeholders when called', async () => {
  expect(
    trigger.renderSimpleTitle({
      name: 'container-name',
      updateKind: {
        kind: 'tag',
      },
    }),
  ).toEqual('New tag found for container container-name');
});

test('renderSimpleTitle should show tag for digest updates', async () => {
  expect(
    trigger.renderSimpleTitle({
      name: 'container-name',
      image: { tag: { value: 'latest' } },
      updateKind: {
        kind: 'digest',
        localValue: 'sha256:abc123',
        remoteValue: 'sha256:def456',
      },
    }),
  ).toEqual('New image available for container container-name (tag latest)');
});

test('renderSimpleBody should replace placeholders when called', async () => {
  expect(
    trigger.renderSimpleBody({
      name: 'container-name',
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
      result: {
        link: 'http://test',
      },
    }),
  ).toEqual(
    'Container container-name running with tag 1.0.0 can be updated to tag 2.0.0\nhttp://test',
  );
});

test('renderSimpleBody should include watcher context for non-local watchers', async () => {
  expect(
    trigger.renderSimpleBody({
      name: 'container-name',
      watcher: 'servicevault',
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
      result: {
        link: 'http://test',
      },
    }),
  ).toEqual(
    'Container container-name (servicevault) running with tag 1.0.0 can be updated to tag 2.0.0\nhttp://test',
  );
});

test('renderSimpleBody should omit watcher context for local watchers', async () => {
  expect(
    trigger.renderSimpleBody({
      name: 'container-name',
      watcher: 'local',
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
      result: {
        link: 'http://test',
      },
    }),
  ).toEqual(
    'Container container-name running with tag 1.0.0 can be updated to tag 2.0.0\nhttp://test',
  );
});

test('renderSimpleBody should show tag instead of raw digest for digest updates', async () => {
  expect(
    trigger.renderSimpleBody({
      name: 'container-name',
      image: { tag: { value: 'latest' } },
      updateKind: {
        kind: 'digest',
        localValue: 'sha256:abc123',
        remoteValue: 'sha256:def456',
      },
      result: {
        link: 'http://test',
      },
    }),
  ).toEqual('Container container-name running tag latest has a newer image available\nhttp://test');
});

test('renderSimpleTitle should include watcher context for non-local watchers by default', () => {
  expect(
    trigger.renderSimpleTitle({
      name: 'docker-socket-proxy',
      watcher: 'servicevault',
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
    }),
  ).toBe('New tag found for container docker-socket-proxy (servicevault)');
});

test('renderSimpleBody should include watcher context for non-local watchers by default', () => {
  expect(
    trigger.renderSimpleBody({
      name: 'docker-socket-proxy',
      watcher: 'servicevault',
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
    }),
  ).toBe(
    'Container docker-socket-proxy (servicevault) running with tag 1.0.0 can be updated to tag 2.0.0',
  );
});

test('renderSimpleBody should replace placeholders when template is a customized one', async () => {
  trigger.configuration.simplebody =
    'Watcher ${watcher} reports container ${name} available update';
  expect(
    trigger.renderSimpleBody({
      name: 'container-name',
      watcher: 'DUMMY',
    }),
  ).toEqual('Watcher DUMMY reports container container-name available update');
});

test('renderSimpleTitle should use dedicated template for agent disconnect events', () => {
  const container = {
    id: 'agent-servicevault',
    name: 'servicevault',
    watcher: 'agent',
    status: 'disconnected',
    image: {
      id: 'agent-servicevault',
      registry: {
        name: 'agent',
        url: 'agent://servicevault',
      },
      name: 'servicevault',
      tag: {
        value: 'disconnected',
        semver: false,
      },
      digest: {
        watch: false,
      },
      architecture: 'unknown',
      os: 'unknown',
    },
    updateAvailable: false,
    updateKind: {
      kind: 'unknown',
    },
    notificationEvent: {
      kind: 'agent-disconnect',
      agentName: 'servicevault',
      reason: 'SSE connection lost',
    },
  } as any;

  expect(trigger.renderSimpleTitle(container)).toBe('Agent servicevault disconnected');
});

test('renderSimpleBody should use dedicated template for agent disconnect events', () => {
  const container = {
    id: 'agent-servicevault',
    name: 'servicevault',
    watcher: 'agent',
    status: 'disconnected',
    image: {
      id: 'agent-servicevault',
      registry: {
        name: 'agent',
        url: 'agent://servicevault',
      },
      name: 'servicevault',
      tag: {
        value: 'disconnected',
        semver: false,
      },
      digest: {
        watch: false,
      },
      architecture: 'unknown',
      os: 'unknown',
    },
    updateAvailable: false,
    updateKind: {
      kind: 'unknown',
    },
    notificationEvent: {
      kind: 'agent-disconnect',
      agentName: 'servicevault',
      reason: 'SSE connection lost',
    },
  } as any;

  expect(trigger.renderSimpleBody(container)).toBe(
    'Agent servicevault disconnected: SSE connection lost',
  );
});

test('renderSimpleBody should omit the reason suffix for agent disconnect events without a reason', () => {
  const container = {
    id: 'agent-servicevault',
    name: 'servicevault',
    watcher: 'agent',
    status: 'disconnected',
    image: {
      id: 'agent-servicevault',
      registry: {
        name: 'agent',
        url: 'agent://servicevault',
      },
      name: 'servicevault',
      tag: {
        value: 'disconnected',
        semver: false,
      },
      digest: {
        watch: false,
      },
      architecture: 'unknown',
      os: 'unknown',
    },
    updateAvailable: false,
    updateKind: {
      kind: 'unknown',
    },
    notificationEvent: {
      kind: 'agent-disconnect',
      agentName: 'servicevault',
    },
  } as any;

  expect(trigger.renderSimpleBody(container)).toBe('Agent servicevault disconnected');
});

test('renderSimpleTitle should use dedicated template for agent reconnect events', () => {
  const container = {
    id: 'agent-servicevault',
    name: 'servicevault',
    watcher: 'agent',
    status: 'connected',
    image: {
      id: 'agent-servicevault',
      registry: {
        name: 'agent',
        url: 'agent://servicevault',
      },
      name: 'servicevault',
      tag: {
        value: 'connected',
        semver: false,
      },
      digest: {
        watch: false,
      },
      architecture: 'unknown',
      os: 'unknown',
    },
    updateAvailable: false,
    updateKind: {
      kind: 'unknown',
    },
    notificationEvent: {
      kind: 'agent-reconnect',
      agentName: 'servicevault',
    },
  } as any;

  expect(trigger.renderSimpleTitle(container)).toBe('Agent servicevault reconnected');
});

test('getNotificationEvent should return reconnect metadata for agent reconnect containers', () => {
  expect(
    getNotificationEvent({
      notificationEvent: {
        kind: 'agent-reconnect',
        agentName: 'servicevault',
      },
    } as any),
  ).toEqual({
    kind: 'agent-reconnect',
    agentName: 'servicevault',
    reason: undefined,
  });
});

test('getNotificationEvent should return undefined when notification metadata is missing', () => {
  expect(getNotificationEvent({} as any)).toBeUndefined();
});

test('getNotificationEvent should omit invalid update-failed error values', () => {
  expect(
    getNotificationEvent({
      notificationEvent: {
        kind: 'update-failed',
        error: '',
      },
    } as any),
  ).toEqual({
    kind: 'update-failed',
    error: undefined,
  });
});

test('getNotificationEvent should omit invalid security alert metadata', () => {
  expect(
    getNotificationEvent({
      notificationEvent: {
        kind: 'security-alert',
        details: '',
        status: '',
        summary: 'invalid',
        blockingCount: Number.POSITIVE_INFINITY,
      },
    } as any),
  ).toEqual({
    kind: 'security-alert',
    details: undefined,
    status: undefined,
    summary: undefined,
    blockingCount: undefined,
  });
});

test('getNotificationEvent should return undefined for unsupported agent notification kinds', () => {
  expect(
    getNotificationEvent({
      notificationEvent: {
        kind: 'agent-error',
        agentName: 'servicevault',
      },
    } as any),
  ).toBeUndefined();
});

test('buildLiteralTemplateExpression should build literal template syntax', () => {
  expect(buildLiteralTemplateExpression('event.agentName')).toBe(`$\{event.agentName}`);
});

test('resolveNotificationTemplate falls back when a notification kind has no dedicated template', () => {
  expect(
    resolveNotificationTemplate(
      {
        kind: 'agent-reconnect',
        agentName: 'servicevault',
      },
      {
        'agent-disconnect': `Agent ${buildLiteralTemplateExpression('event.agentName')} disconnected`,
        'agent-reconnect': undefined as unknown as string,
      },
      'Fallback template',
    ),
  ).toBe('Fallback template');
});

test('renderSimpleBody should use dedicated template for agent reconnect events', () => {
  const container = {
    id: 'agent-servicevault',
    name: 'servicevault',
    watcher: 'agent',
    status: 'connected',
    image: {
      id: 'agent-servicevault',
      registry: {
        name: 'agent',
        url: 'agent://servicevault',
      },
      name: 'servicevault',
      tag: {
        value: 'connected',
        semver: false,
      },
      digest: {
        watch: false,
      },
      architecture: 'unknown',
      os: 'unknown',
    },
    updateAvailable: false,
    updateKind: {
      kind: 'unknown',
    },
    notificationEvent: {
      kind: 'agent-reconnect',
      agentName: 'servicevault',
    },
  } as any;

  expect(trigger.renderSimpleBody(container)).toBe('Agent servicevault reconnected');
});

test('renderSimpleTitle should use dedicated template for update-applied events', () => {
  const container = {
    id: 'container-servicevault',
    name: 'servicevault',
    watcher: 'local',
    status: 'running',
    image: {
      id: 'container-servicevault',
      registry: {
        name: 'docker',
        url: 'docker://local',
      },
      name: 'servicevault',
      tag: {
        value: '1.0.0',
        semver: true,
      },
      digest: {
        watch: false,
      },
      architecture: 'amd64',
      os: 'linux',
    },
    updateAvailable: false,
    updateKind: {
      kind: 'tag',
    },
    notificationEvent: {
      kind: 'update-applied',
    },
  } as any;

  expect(trigger.renderSimpleTitle(container)).toBe('Container servicevault updated successfully');
});

test('renderSimpleTitle should use notification templates when simpletitle is unset', () => {
  trigger.configuration.simpletitle = undefined;

  expect(
    trigger.renderSimpleTitle({
      name: 'servicevault',
      updateKind: {
        kind: 'tag',
      },
      notificationEvent: {
        kind: 'update-applied',
      },
    } as any),
  ).toBe('Container servicevault updated successfully');
});

test('renderSimpleBody should use dedicated template for update-failed events', () => {
  const container = {
    id: 'container-servicevault',
    name: 'servicevault',
    watcher: 'local',
    status: 'running',
    image: {
      id: 'container-servicevault',
      registry: {
        name: 'docker',
        url: 'docker://local',
      },
      name: 'servicevault',
      tag: {
        value: '1.0.0',
        semver: true,
      },
      digest: {
        watch: false,
      },
      architecture: 'amd64',
      os: 'linux',
    },
    updateAvailable: false,
    updateKind: {
      kind: 'tag',
    },
    notificationEvent: {
      kind: 'update-failed',
      error: 'pull access denied',
    },
  } as any;

  expect(trigger.renderSimpleBody(container)).toBe(
    'Container servicevault update failed: pull access denied',
  );
});

test('renderSimpleBody should use notification templates when simplebody is unset', () => {
  trigger.configuration.simplebody = undefined;

  expect(
    trigger.renderSimpleBody({
      name: 'servicevault',
      updateKind: {
        kind: 'tag',
      },
      notificationEvent: {
        kind: 'update-failed',
        error: 'pull access denied',
      },
    } as any),
  ).toBe('Container servicevault update failed: pull access denied');
});

test('renderSimpleBody should use dedicated template for security-alert events', () => {
  const container = {
    id: 'container-servicevault',
    name: 'servicevault',
    watcher: 'local',
    status: 'running',
    image: {
      id: 'container-servicevault',
      registry: {
        name: 'docker',
        url: 'docker://local',
      },
      name: 'servicevault',
      tag: {
        value: '1.0.0',
        semver: true,
      },
      digest: {
        watch: false,
      },
      architecture: 'amd64',
      os: 'linux',
    },
    updateAvailable: true,
    updateKind: {
      kind: 'tag',
      localValue: '1.0.0',
      remoteValue: '1.1.0',
    },
    notificationEvent: {
      kind: 'security-alert',
      blockingCount: 2,
      details: 'critical=1 high=1',
    },
  } as any;

  expect(trigger.renderSimpleBody(container)).toBe(
    'Security alert for container servicevault (2 blocking vulnerabilities)\ncritical=1 high=1',
  );
});

test('renderSimpleTitle should fall back to the standard template for unsupported notification events', () => {
  const container = {
    id: 'container-servicevault',
    name: 'servicevault',
    watcher: 'agent',
    status: 'running',
    image: {
      id: 'container-servicevault',
      registry: {
        name: 'agent',
        url: 'agent://servicevault',
      },
      name: 'servicevault',
      tag: {
        value: '1.0.0',
        semver: false,
      },
      digest: {
        watch: false,
      },
      architecture: 'unknown',
      os: 'unknown',
    },
    updateAvailable: true,
    updateKind: {
      kind: 'tag',
    },
    notificationEvent: {
      kind: 'unsupported-kind',
    },
  } as any;

  expect(trigger.renderSimpleTitle(container)).toBe('New tag found for container servicevault');
});

test('renderSimpleBody should fall back to the standard template when agent disconnect metadata is invalid', () => {
  const container = {
    id: 'container-servicevault',
    name: 'servicevault',
    watcher: 'agent',
    status: 'running',
    image: {
      id: 'container-servicevault',
      registry: {
        name: 'agent',
        url: 'agent://servicevault',
      },
      name: 'servicevault',
      tag: {
        value: '1.0.0',
        semver: false,
      },
      digest: {
        watch: false,
      },
      architecture: 'unknown',
      os: 'unknown',
    },
    updateAvailable: true,
    updateKind: {
      kind: 'tag',
      localValue: '1.0.0',
      remoteValue: '2.0.0',
    },
    notificationEvent: {
      kind: 'agent-disconnect',
      agentName: '',
      reason: 'SSE connection lost',
    },
  } as any;

  expect(trigger.renderSimpleBody(container)).toBe(
    'Container servicevault running with tag 1.0.0 can be updated to tag 2.0.0',
  );
});

test('renderSimpleBody should evaluate js functions when template is a customized one', async () => {
  trigger.configuration.simplebody =
    'Container ${name} update from ${local.substring(0, 15)} to ${remote.substring(0, 15)}';
  expect(
    trigger.renderSimpleBody({
      name: 'container-name',
      updateKind: {
        kind: 'digest',
        localValue: 'sha256:9a82d5773ccfcb73ba341619fd44790a30750731568c25a6e070c2c44aa30bde',
        remoteValue: 'sha256:6cdd479147e4d2f1f853c7205ead7e2a0b0ccbad6e3ff0986e01936cbd179c17',
      },
    }),
  ).toEqual('Container container-name update from sha256:9a82d577 to sha256:6cdd4791');
});

test('renderSimpleBody should expose releaseNotes variables and truncate body for notification context', async () => {
  const longReleaseBody = 'x'.repeat(900);
  trigger.configuration.simplebody =
    '${container.result.releaseNotes.title}|${container.result.releaseNotes.url}|${container.result.releaseNotes.body}';

  const renderedBody = trigger.renderSimpleBody({
    name: 'container-name',
    result: {
      releaseNotes: {
        title: 'Release 2.0.0',
        body: longReleaseBody,
        url: 'https://github.com/acme/service/releases/tag/v2.0.0',
        publishedAt: '2026-03-01T00:00:00.000Z',
        provider: 'github',
      },
    },
  });

  const [title, url, body] = renderedBody.split('|');
  expect(title).toBe('Release 2.0.0');
  expect(url).toBe('https://github.com/acme/service/releases/tag/v2.0.0');
  expect(body.length).toBeLessThanOrEqual(500);
});

test('renderSimpleBody should keep short releaseNotes body unchanged', () => {
  trigger.configuration.simplebody = '${container.result.releaseNotes.body}';

  const renderedBody = trigger.renderSimpleBody({
    name: 'container-name',
    result: {
      releaseNotes: {
        title: 'Release 2.0.1',
        body: 'short body',
        url: 'https://github.com/acme/service/releases/tag/v2.0.1',
        publishedAt: '2026-03-01T00:00:00.000Z',
        provider: 'github',
      },
    },
  });

  expect(renderedBody).toBe('short body');
});

test('renderBatchTitle should replace placeholders when called', async () => {
  expect(
    trigger.renderBatchTitle([
      {
        name: 'container-name',
        updateKind: {
          kind: 'tag',
        },
      },
    ]),
  ).toEqual('1 updates available');
});

test('renderBatchTitle should use dedicated template for update-applied events', async () => {
  expect(
    trigger.renderBatchTitle([
      {
        name: 'container-name',
        updateKind: {
          kind: 'tag',
        },
        notificationEvent: {
          kind: 'update-applied',
        },
      },
      {
        name: 'container-name-2',
        updateKind: {
          kind: 'tag',
        },
        notificationEvent: {
          kind: 'update-applied',
        },
      },
    ] as any),
  ).toEqual('2 updates applied');
});

test('renderBatchTitle should use dedicated template for update-failed events', async () => {
  expect(
    trigger.renderBatchTitle([
      {
        name: 'container-name',
        updateKind: {
          kind: 'tag',
        },
        notificationEvent: {
          kind: 'update-failed',
        },
      },
      {
        name: 'container-name-2',
        updateKind: {
          kind: 'tag',
        },
        notificationEvent: {
          kind: 'update-failed',
        },
      },
    ] as any),
  ).toEqual('2 updates failed');
});

test('renderBatchTitle should use dedicated template for security-alert events', async () => {
  expect(
    trigger.renderBatchTitle([
      {
        name: 'container-name',
        updateKind: {
          kind: 'tag',
        },
        notificationEvent: {
          kind: 'security-alert',
        },
      },
      {
        name: 'container-name-2',
        updateKind: {
          kind: 'tag',
        },
        notificationEvent: {
          kind: 'security-alert',
        },
      },
    ] as any),
  ).toEqual('2 security alerts');
});

test('renderBatchTitle should use notification templates when batchtitle is unset', async () => {
  trigger.configuration.batchtitle = undefined;

  expect(
    trigger.renderBatchTitle([
      {
        name: 'container-name',
        updateKind: {
          kind: 'tag',
        },
        notificationEvent: {
          kind: 'security-alert',
        },
      },
      {
        name: 'container-name-2',
        updateKind: {
          kind: 'tag',
        },
        notificationEvent: {
          kind: 'security-alert',
        },
      },
    ] as any),
  ).toEqual('2 security alerts');
});

test('renderBatchTitle should return fallback template result when containers is empty', () => {
  const result = trigger.renderBatchTitle([]);
  expect(result).toBe('0 updates available');
});

test('renderBatchBody should replace placeholders when called', async () => {
  expect(
    trigger.renderBatchBody([
      {
        name: 'container-name',
        updateKind: {
          kind: 'tag',
          localValue: '1.0.0',
          remoteValue: '2.0.0',
        },
        result: {
          link: 'http://test',
        },
      },
    ]),
  ).toEqual(
    '- Container container-name running with tag 1.0.0 can be updated to tag 2.0.0\nhttp://test\n',
  );
});

test('renderBatchBody should disambiguate identical container names from different watchers', () => {
  expect(
    trigger.renderBatchBody([
      {
        name: 'socket-proxy',
        watcher: 'servicevault',
        updateKind: {
          kind: 'tag',
          localValue: '1.0.0',
          remoteValue: '2.0.0',
        },
      },
      {
        name: 'socket-proxy',
        watcher: 'mediavault',
        updateKind: {
          kind: 'tag',
          localValue: '1.0.0',
          remoteValue: '2.0.0',
        },
      },
    ]),
  ).toEqual(
    '- Container socket-proxy (servicevault) running with tag 1.0.0 can be updated to tag 2.0.0\n\n- Container socket-proxy (mediavault) running with tag 1.0.0 can be updated to tag 2.0.0\n',
  );
});

test('renderBatchBody should keep identical container names distinct across watchers', () => {
  expect(
    trigger.renderBatchBody([
      {
        name: 'docker-socket-proxy',
        watcher: 'servicevault',
        updateKind: {
          kind: 'digest',
          localValue: 'sha256:abc123',
          remoteValue: 'sha256:def456',
        },
        image: {
          tag: {
            value: 'latest',
          },
        },
      },
      {
        name: 'docker-socket-proxy',
        watcher: 'mediavault',
        updateKind: {
          kind: 'digest',
          localValue: 'sha256:abc123',
          remoteValue: 'sha256:def456',
        },
        image: {
          tag: {
            value: 'latest',
          },
        },
      },
    ]),
  ).toBe(
    '- Container docker-socket-proxy (servicevault) running tag latest has a newer image available\n' +
      '\n' +
      '- Container docker-socket-proxy (mediavault) running tag latest has a newer image available\n',
  );
});

test('renderSimpleTitle should include agent prefix when container has agent set', () => {
  const { simpletitle, ...rest } = configurationValid;
  trigger.configuration = trigger.validateConfiguration(rest);
  expect(
    trigger.renderSimpleTitle({
      name: 'nginx',
      agent: 'prod-server',
      updateKind: {
        kind: 'tag',
      },
    }),
  ).toBe('[prod-server] New tag found for container nginx');
});

test('renderSimpleTitle should omit agent prefix when container has no agent', () => {
  const { simpletitle, ...rest } = configurationValid;
  trigger.configuration = trigger.validateConfiguration(rest);
  expect(
    trigger.renderSimpleTitle({
      name: 'nginx',
      updateKind: {
        kind: 'tag',
      },
    }),
  ).toBe('New tag found for container nginx');
});

// Reverted from commit 30287c24: body now includes agent prefix for batch-email disambiguation.
// Each bullet must identify its own watcher/server so recipients can tell which host
// an update belongs to when Gmail threads N bullets under one subject. See #310.
test('renderSimpleBody should include agent prefix in body for batch email disambiguation', () => {
  const { simplebody, ...rest } = configurationValid;
  trigger.configuration = trigger.validateConfiguration(rest);
  expect(
    trigger.renderSimpleBody({
      name: 'nginx',
      agent: 'prod-server',
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
    }),
  ).toBe('[prod-server] Container nginx running with tag 1.0.0 can be updated to tag 2.0.0');
});

test('renderSimpleTitle should include agent prefix for digest updates', () => {
  const { simpletitle, ...rest } = configurationValid;
  trigger.configuration = trigger.validateConfiguration(rest);
  expect(
    trigger.renderSimpleTitle({
      name: 'nginx',
      agent: 'staging',
      image: { tag: { value: 'latest' } },
      updateKind: {
        kind: 'digest',
        localValue: 'sha256:abc123',
        remoteValue: 'sha256:def456',
      },
    }),
  ).toBe('[staging] New image available for container nginx (tag latest)');
});

test('renderSimpleTitle should include agent prefix for update-applied events', () => {
  const container = {
    id: 'container-nginx',
    name: 'nginx',
    agent: 'prod-server',
    watcher: 'local',
    status: 'running',
    image: {
      id: 'container-nginx',
      registry: { name: 'docker', url: 'docker://local' },
      name: 'nginx',
      tag: { value: '1.0.0', semver: true },
      digest: { watch: false },
      architecture: 'amd64',
      os: 'linux',
    },
    updateAvailable: false,
    updateKind: { kind: 'tag' },
    notificationEvent: { kind: 'update-applied' },
  } as any;

  expect(trigger.renderSimpleTitle(container)).toBe(
    '[prod-server] Container nginx updated successfully',
  );
});

test('renderSimpleBody should include agent prefix for update-failed events for batch email disambiguation', () => {
  const container = {
    id: 'container-nginx',
    name: 'nginx',
    agent: 'prod-server',
    watcher: 'local',
    status: 'running',
    image: {
      id: 'container-nginx',
      registry: { name: 'docker', url: 'docker://local' },
      name: 'nginx',
      tag: { value: '1.0.0', semver: true },
      digest: { watch: false },
      architecture: 'amd64',
      os: 'linux',
    },
    updateAvailable: false,
    updateKind: { kind: 'tag' },
    notificationEvent: {
      kind: 'update-failed',
      error: 'pull access denied',
    },
  } as any;

  expect(trigger.renderSimpleBody(container)).toBe(
    '[prod-server] Container nginx update failed: pull access denied',
  );
});

test('renderSimpleBody should include agent prefix for security-alert events for batch email disambiguation', () => {
  const container = {
    id: 'container-nginx',
    name: 'nginx',
    agent: 'prod-server',
    watcher: 'local',
    status: 'running',
    image: {
      id: 'container-nginx',
      registry: { name: 'docker', url: 'docker://local' },
      name: 'nginx',
      tag: { value: '1.0.0', semver: true },
      digest: { watch: false },
      architecture: 'amd64',
      os: 'linux',
    },
    updateAvailable: true,
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '1.1.0' },
    notificationEvent: {
      kind: 'security-alert',
      blockingCount: 2,
      details: 'critical=1 high=1',
    },
  } as any;

  expect(trigger.renderSimpleBody(container)).toBe(
    '[prod-server] Security alert for container nginx (2 blocking vulnerabilities)\ncritical=1 high=1',
  );
});

test('renderSimpleBody should include agent prefix and watcher suffix for batch email disambiguation', () => {
  const { simplebody, ...rest } = configurationValid;
  trigger.configuration = trigger.validateConfiguration(rest);
  expect(
    trigger.renderSimpleBody({
      name: 'nginx',
      agent: 'prod-server',
      watcher: 'servicevault',
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
    }),
  ).toBe(
    '[prod-server] Container nginx (servicevault) running with tag 1.0.0 can be updated to tag 2.0.0',
  );
});

test('renderSimpleBody should include agent prefix but omit redundant watcher suffix when watcher matches agent', () => {
  const { simplebody, ...rest } = configurationValid;
  trigger.configuration = trigger.validateConfiguration(rest);
  expect(
    trigger.renderSimpleBody({
      name: 'nginx',
      agent: 'mediavault',
      watcher: 'mediavault',
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
    }),
  ).toBe('[mediavault] Container nginx running with tag 1.0.0 can be updated to tag 2.0.0');
});

test('renderSimpleBody should include controller prefix but omit redundant watcher suffix when watcher matches controller', () => {
  const { simplebody, ...rest } = configurationValid;
  trigger.configuration = trigger.validateConfiguration(rest);
  mockGetAgents.mockReturnValue([{ name: 'remote-1' }]);

  expect(
    trigger.renderSimpleBody({
      name: 'nginx',
      watcher: 'controller-host',
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
    }),
  ).toBe('[controller-host] Container nginx running with tag 1.0.0 can be updated to tag 2.0.0');

  mockGetAgents.mockReturnValue([]);
});

test('renderBatchBody should include agent prefix per container for batch email disambiguation', () => {
  const { simplebody, ...rest } = configurationValid;
  trigger.configuration = trigger.validateConfiguration(rest);
  expect(
    trigger.renderBatchBody([
      {
        name: 'nginx',
        agent: 'prod-server',
        updateKind: {
          kind: 'tag',
          localValue: '1.0.0',
          remoteValue: '2.0.0',
        },
      },
      {
        name: 'nginx',
        agent: 'staging-server',
        updateKind: {
          kind: 'tag',
          localValue: '1.0.0',
          remoteValue: '2.0.0',
        },
      },
    ]),
  ).toBe(
    '- [prod-server] Container nginx running with tag 1.0.0 can be updated to tag 2.0.0\n\n' +
      '- [staging-server] Container nginx running with tag 1.0.0 can be updated to tag 2.0.0\n',
  );
});

test('renderSimpleTitle should include controller prefix when agents are registered and container has no agent', () => {
  const { simpletitle, ...rest } = configurationValid;
  trigger.configuration = trigger.validateConfiguration(rest);
  mockGetAgents.mockReturnValue([{ name: 'remote-1' }]);

  expect(
    trigger.renderSimpleTitle({
      name: 'nginx',
      updateKind: {
        kind: 'tag',
      },
    }),
  ).toBe('[controller-host] New tag found for container nginx');

  mockGetAgents.mockReturnValue([]);
});

test('renderSimpleTitle should not include controller prefix when no agents are registered', () => {
  const { simpletitle, ...rest } = configurationValid;
  trigger.configuration = trigger.validateConfiguration(rest);
  mockGetAgents.mockReturnValue([]);

  expect(
    trigger.renderSimpleTitle({
      name: 'nginx',
      updateKind: {
        kind: 'tag',
      },
    }),
  ).toBe('New tag found for container nginx');
});

test('renderSimpleBody should include controller prefix in body for batch email disambiguation when agents exist', () => {
  const { simplebody, ...rest } = configurationValid;
  trigger.configuration = trigger.validateConfiguration(rest);
  mockGetAgents.mockReturnValue([{ name: 'remote-1' }]);

  expect(
    trigger.renderSimpleBody({
      name: 'nginx',
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
    }),
  ).toBe('[controller-host] Container nginx running with tag 1.0.0 can be updated to tag 2.0.0');

  mockGetAgents.mockReturnValue([]);
});

test('renderSimpleTitle should use agent name over controller name when both are available', () => {
  const { simpletitle, ...rest } = configurationValid;
  trigger.configuration = trigger.validateConfiguration(rest);
  mockGetAgents.mockReturnValue([{ name: 'remote-1' }]);

  expect(
    trigger.renderSimpleTitle({
      name: 'nginx',
      agent: 'remote-1',
      updateKind: {
        kind: 'tag',
      },
    }),
  ).toBe('[remote-1] New tag found for container nginx');

  mockGetAgents.mockReturnValue([]);
});

test('renderSimpleBody should expose notificationServerName as controller name for local containers', () => {
  mockGetAgents.mockReturnValue([{ name: 'remote-1' }]);
  trigger.configuration.simplebody = '${container.notificationServerName}';

  expect(
    trigger.renderSimpleBody({
      name: 'nginx',
      updateKind: { kind: 'tag' },
    }),
  ).toBe('controller-host');

  mockGetAgents.mockReturnValue([]);
});

test('renderSimpleBody should expose notificationServerName as agent name for agent containers', () => {
  trigger.configuration.simplebody = '${container.notificationServerName}';

  expect(
    trigger.renderSimpleBody({
      name: 'nginx',
      agent: 'prod-server',
      updateKind: { kind: 'tag' },
    }),
  ).toBe('prod-server');
});

test('renderSimpleBody should expose notificationServerName as controller name even without agents', () => {
  mockGetAgents.mockReturnValue([]);
  trigger.configuration.simplebody = '${container.notificationServerName}';

  expect(
    trigger.renderSimpleBody({
      name: 'nginx',
      updateKind: { kind: 'tag' },
    }),
  ).toBe('controller-host');
});

test('default title and body both start with [server] prefix for non-standalone deployments', () => {
  // Reverted from commit 30287c24: body now also carries the prefix so each bullet
  // in a batched Gmail thread identifies its own watcher/server. See #310.
  const { simpletitle, simplebody, ...rest } = configurationValid;
  trigger.configuration = trigger.validateConfiguration(rest);
  mockGetAgents.mockReturnValue([{ name: 'remote-1' }]);

  const container: any = {
    name: 'nginx',
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
  };

  const title = trigger.renderSimpleTitle(container);
  const body = trigger.renderSimpleBody(container);

  expect(title.startsWith('[controller-host]')).toBe(true);
  expect(body.startsWith('[controller-host]')).toBe(true);
  expect(body).toBe(
    '[controller-host] Container nginx running with tag 1.0.0 can be updated to tag 2.0.0',
  );

  mockGetAgents.mockReturnValue([]);
});

test('default digest-update title and body both start with [server] prefix for non-standalone deployments', () => {
  // Reverted from commit 30287c24: body now also carries the prefix so each bullet
  // in a batched Gmail thread identifies its own watcher/server. See #310.
  const { simpletitle, simplebody, ...rest } = configurationValid;
  trigger.configuration = trigger.validateConfiguration(rest);
  mockGetAgents.mockReturnValue([{ name: 'remote-1' }]);

  const container: any = {
    name: 'nginx',
    image: { tag: { value: 'latest' } },
    updateKind: { kind: 'digest', localValue: 'sha256:aaa', remoteValue: 'sha256:bbb' },
  };

  const title = trigger.renderSimpleTitle(container);
  const body = trigger.renderSimpleBody(container);

  expect(title.startsWith('[controller-host]')).toBe(true);
  expect(body.startsWith('[controller-host]')).toBe(true);
  expect(body).toBe(
    '[controller-host] Container nginx running tag latest has a newer image available',
  );

  mockGetAgents.mockReturnValue([]);
});

test('composeMessage should include title and body when disabletitle is false', () => {
  trigger.configuration.disabletitle = false;
  trigger.configuration.simpletitle = 'Title for ${container.name}';
  trigger.configuration.simplebody = 'Body for ${container.name}';

  expect(
    trigger.composeMessage({
      name: 'container-name',
      updateKind: {
        kind: 'tag',
      },
    }),
  ).toBe('Title for container-name\n\nBody for container-name');
});

test('composeMessage should return body only when disabletitle is true', () => {
  trigger.configuration.disabletitle = true;
  trigger.configuration.simpletitle = 'Title for ${container.name}';
  trigger.configuration.simplebody = 'Body for ${container.name}';

  expect(
    trigger.composeMessage({
      name: 'container-name',
      updateKind: {
        kind: 'tag',
      },
    }),
  ).toBe('Body for container-name');
});

test('composeBatchMessage should include title and body when disabletitle is false', () => {
  trigger.configuration.disabletitle = false;
  trigger.configuration.batchtitle = 'Batch ${containers.length}';
  trigger.configuration.simplebody = 'Body for ${container.name}';

  expect(
    trigger.composeBatchMessage([
      {
        name: 'container-name',
        updateKind: {
          kind: 'tag',
        },
      },
    ]),
  ).toBe('Batch 1\n\n- Body for container-name\n');
});

test('composeBatchMessage should return body only when disabletitle is true', () => {
  trigger.configuration.disabletitle = true;
  trigger.configuration.batchtitle = 'Batch ${containers.length}';
  trigger.configuration.simplebody = 'Body for ${container.name}';

  expect(
    trigger.composeBatchMessage([
      {
        name: 'container-name',
        updateKind: {
          kind: 'tag',
        },
      },
    ]),
  ).toBe('- Body for container-name\n');
});

test('init should invoke registered simple callback when handleContainerReport is called', async () => {
  let capturedCallback;
  vi.spyOn(event, 'registerContainerReport').mockImplementation((cb) => {
    capturedCallback = cb;
    return vi.fn();
  });
  trigger.configuration.mode = 'simple';
  trigger.configuration.auto = true;
  trigger.configuration.threshold = 'all';
  await trigger.init();
  const spy = vi.spyOn(trigger, 'trigger').mockResolvedValue();
  await capturedCallback({
    changed: true,
    container: {
      name: 'c1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  });
  expect(spy).toHaveBeenCalled();
});

test('init should invoke registered batch callback when handleContainerReports is called', async () => {
  let capturedCallback;
  vi.spyOn(event, 'registerContainerReports').mockImplementation((cb) => {
    capturedCallback = cb;
    return vi.fn();
  });
  trigger.configuration.mode = 'batch';
  trigger.configuration.auto = true;
  trigger.configuration.threshold = 'all';
  await trigger.init();
  const spy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue();
  await capturedCallback([
    {
      changed: true,
      container: {
        name: 'c1',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
    },
  ]);
  expect(spy).toHaveBeenCalled();
});

test('deregister should unregister batch container reports handler', async () => {
  const unregisterHandler = vi.fn();
  vi.spyOn(event, 'registerContainerReports').mockReturnValue(unregisterHandler);
  trigger.configuration.mode = 'batch';
  trigger.configuration.auto = true;
  await trigger.init();
  await trigger.deregister();
  expect(unregisterHandler).toHaveBeenCalled();
});

test('init should log manual execution when auto is false', async () => {
  trigger.configuration.auto = false;
  const spyLog = vi.spyOn(log, 'info');
  await trigger.init();
  expect(spyLog).toHaveBeenCalledWith('Registering for manual execution');
});

test('init should register for notification resolution when resolvenotifications is true', async () => {
  const unregisterFn = vi.fn();
  vi.spyOn(event, 'registerContainerReport').mockReturnValue(vi.fn());
  const registerSpy = vi.fn().mockReturnValue(unregisterFn);
  // We need to mock registerContainerUpdateApplied from event/index
  const eventModule = await import('../../event/index.js');
  vi.spyOn(eventModule, 'registerContainerUpdateApplied').mockImplementation(registerSpy);

  trigger.configuration.resolvenotifications = true;
  trigger.configuration.auto = true;
  trigger.configuration.mode = 'simple';
  const spyLog = vi.spyOn(log, 'info');
  await trigger.init();
  expect(spyLog).toHaveBeenCalledWith('Registering for notification resolution');
  expect(registerSpy).toHaveBeenCalled();
});

test('deregister should unregister containerUpdateApplied handler when resolvenotifications was true', async () => {
  const unregisterUpdateApplied = vi.fn();
  trigger.unregisterContainerUpdateAppliedForResolution = unregisterUpdateApplied;
  await trigger.deregister();
  expect(unregisterUpdateApplied).toHaveBeenCalled();
});

test('handleContainerUpdateApplied should call dismiss for stored notification', async () => {
  const mockResult = { messageId: '123' };
  trigger.notificationResults = new Map();
  trigger.notificationResults.set('docker.local/nginx', mockResult);
  trigger.dismiss = vi.fn().mockResolvedValue(undefined);
  const spyLog = vi.spyOn(log, 'info');

  await trigger.handleContainerUpdateApplied('docker.local/nginx');

  expect(trigger.dismiss).toHaveBeenCalledWith('docker.local/nginx', mockResult);
  expect(spyLog).toHaveBeenCalledWith(expect.stringContaining('Dismissing notification'));
  expect(trigger.notificationResults.has('docker.local/nginx')).toBe(false);
});

test('handleContainerUpdateApplied should dismiss for object payloads', async () => {
  const mockResult = { messageId: '123' };
  trigger.notificationResults = new Map();
  trigger.notificationResults.set('c1', mockResult);
  trigger.dismiss = vi.fn().mockResolvedValue(undefined);

  await trigger.handleContainerUpdateApplied({
    containerName: 'docker.local/nginx',
    container: {
      id: 'c1',
      name: 'nginx',
      watcher: 'local',
    },
  } as any);

  expect(trigger.dismiss).toHaveBeenCalledWith('c1', mockResult);
  expect(trigger.notificationResults.has('c1')).toBe(false);
});

test('handleContainerUpdateApplied should return early when no stored notification', async () => {
  trigger.notificationResults = new Map();
  trigger.dismiss = vi.fn();
  await trigger.handleContainerUpdateApplied('docker.local/unknown');
  expect(trigger.dismiss).not.toHaveBeenCalled();
});

test('handleContainerUpdateApplied should warn on dismiss error and still clean up', async () => {
  trigger.notificationResults = new Map();
  trigger.notificationResults.set('docker.local/nginx', { id: '1' });
  trigger.dismiss = vi.fn().mockRejectedValue(new Error('dismiss failed'));
  const spyLog = vi.spyOn(log, 'warn');

  await trigger.handleContainerUpdateApplied('docker.local/nginx');

  expect(spyLog).toHaveBeenCalledWith(expect.stringContaining('dismiss failed'));
  expect(trigger.notificationResults.has('docker.local/nginx')).toBe(false);
});

test('handleContainerUpdateApplied should dismiss using containerName when payload container has no notification key', async () => {
  const mockResult = { messageId: '123' };
  trigger.notificationResults = new Map();
  trigger.notificationResults.set('local_container1', mockResult);
  trigger.dismiss = vi.fn().mockResolvedValue(undefined);

  await trigger.handleContainerUpdateApplied({
    containerName: 'local_container1',
    container: {},
  } as any);

  expect(trigger.dismiss).toHaveBeenCalledWith('local_container1', mockResult);
  expect(trigger.notificationResults.has('local_container1')).toBe(false);
});

test('handleContainerUpdateApplied should return early when payload cannot resolve a notification key', async () => {
  trigger.notificationResults = new Map();
  trigger.notificationResults.set('local_container1', { id: '1' });
  trigger.dismiss = vi.fn();

  await trigger.handleContainerUpdateApplied('' as any);
  await trigger.handleContainerUpdateApplied(null as any);
  await trigger.handleContainerUpdateApplied({} as any);

  expect(trigger.dismiss).not.toHaveBeenCalled();
  expect(trigger.notificationResults.has('local_container1')).toBe(true);
});

test('handleContainerReport should skip when update-available rule suppresses this trigger', async () => {
  notificationStore.isTriggerEnabledForRule.mockImplementation(
    (ruleId) => ruleId !== 'update-available',
  );
  notificationStore.getTriggerDispatchDecisionForRule.mockReturnValue({
    enabled: false,
    reason: 'excluded-from-allow-list',
  });
  const spy = vi.spyOn(trigger, 'trigger');

  await trigger.handleContainerReport({
    changed: true,
    container: {
      watcher: 'local',
      name: 'container1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  });

  expect(spy).not.toHaveBeenCalled();
});

test('handleContainerReport should debug log when update-available rule suppresses this trigger', async () => {
  notificationStore.isTriggerEnabledForRule.mockImplementation(
    (ruleId) => ruleId !== 'update-available',
  );
  notificationStore.getTriggerDispatchDecisionForRule.mockReturnValue({
    enabled: false,
    reason: 'excluded-from-allow-list',
  });
  const debugSpy = vi.spyOn(log, 'debug');

  await trigger.handleContainerReport({
    changed: true,
    container: {
      watcher: 'local',
      name: 'container1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  });

  expect(debugSpy).toHaveBeenCalledWith(
    'Skipping update-available notification for local_container1 (excluded-from-allow-list)',
  );
});

test('handleContainerReport should debug log when simple mode skips an already-notified update', async () => {
  await trigger.register('trigger', 'test', 'trigger1', configurationValid);
  trigger.init();

  const alreadyNotifiedContainer = {
    id: 'c1',
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'digest', semverDiff: 'unknown' },
    result: { tag: '2.0' },
  };
  notificationHistoryStore.recordNotification(
    trigger.getId(),
    alreadyNotifiedContainer.id,
    'update-available',
    notificationHistoryStore.computeResultHash(alreadyNotifiedContainer),
  );

  const debugSpy = vi.spyOn(log, 'debug');

  await trigger.handleContainerReport({
    changed: false,
    container: alreadyNotifiedContainer,
  });

  expect(debugSpy).toHaveBeenCalledWith(
    'Skipping update-available notification for local_container1 (once=true, updateAvailable=true, alreadyNotified=true)',
  );
});

test('handleContainerReport should debug log when simple mode skips a report without an available update', async () => {
  const debugSpy = vi.spyOn(log, 'debug');

  await trigger.handleContainerReport({
    changed: true,
    container: {
      watcher: 'local',
      name: 'container1',
      updateAvailable: false,
      updateKind: { kind: 'digest', semverDiff: 'unknown' },
    },
  });

  expect(debugSpy).toHaveBeenCalledWith(
    'Skipping update-available notification for local_container1 (once=true, updateAvailable=false, alreadyNotified=false)',
  );
});

test('handleContainerReport should show once=false in skip logs when once is unset', async () => {
  trigger.configuration.once = undefined;
  const debugSpy = vi.spyOn(log, 'debug');

  await trigger.handleContainerReport({
    changed: false,
    container: {
      watcher: 'local',
      name: 'container1',
      updateAvailable: false,
      updateKind: { kind: 'digest', semverDiff: 'unknown' },
    },
  });

  expect(debugSpy).toHaveBeenCalledWith(
    'Skipping update-available notification for local_container1 (once=false, updateAvailable=false, alreadyNotified=false)',
  );
});

test('handleContainerReportDigest should warn once when update-available routing excludes a digest trigger', async () => {
  await trigger.register('trigger', 'smtp', 'gmail', {
    ...configurationValid,
    mode: 'digest',
  });
  notificationStore.getTriggerDispatchDecisionForRule.mockReturnValue({
    enabled: false,
    reason: 'excluded-from-allow-list',
  });
  const warnSpy = vi.spyOn(log, 'warn');
  const report = {
    changed: true,
    container: {
      watcher: 'local',
      name: 'container1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  };

  await trigger.handleContainerReportDigest(report);
  await trigger.handleContainerReportDigest(report);

  expect(trigger.digestBuffer.size).toBe(0);
  expect(warnSpy).toHaveBeenCalledTimes(1);
  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining('no update-available events will be buffered'),
  );
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('smtp.gmail'));
});

test('handleContainerReportDigest should silently return when dispatch reason is unrecognised and trigger is suppressed', async () => {
  await trigger.register('trigger', 'smtp', 'gmail', {
    ...configurationValid,
    mode: 'digest',
  });
  notificationStore.getTriggerDispatchDecisionForRule.mockReturnValue({
    enabled: false,
    reason: 'empty-trigger-list',
  });
  const warnSpy = vi.spyOn(log, 'warn');
  const report = {
    changed: true,
    container: {
      watcher: 'local',
      name: 'container1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  };

  await trigger.handleContainerReportDigest(report);

  expect(trigger.digestBuffer.size).toBe(0);
  expect(warnSpy).not.toHaveBeenCalled();
});

test('deregisterComponent should clear digest warning suppression state', async () => {
  await trigger.register('trigger', 'smtp', 'gmail', {
    ...configurationValid,
    mode: 'digest',
  });
  notificationStore.getTriggerDispatchDecisionForRule.mockReturnValue({
    enabled: false,
    reason: 'excluded-from-allow-list',
  });
  const warnSpy = vi.spyOn(log, 'warn');
  const report = {
    changed: true,
    container: {
      watcher: 'local',
      name: 'container1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  };

  await trigger.handleContainerReportDigest(report);
  await trigger.handleContainerReportDigest(report);
  await trigger.deregisterComponent();
  await trigger.handleContainerReportDigest(report);

  expect(warnSpy).toHaveBeenCalledTimes(2);
});

test('handleContainerUpdateAppliedEvent should run trigger when rule allows and container is found', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  storeContainer.getContainers.mockReturnValue([container]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateAppliedEvent('local_container1');

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'container1',
      notificationEvent: {
        kind: 'update-applied',
      },
    }),
  );
});

test('handleContainerUpdateAppliedEvent should resolve containers from raw store data', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
    env: {
      SECRET_TOKEN: 'raw-secret',
    },
  };
  storeContainer.getContainersRaw.mockReturnValue([container]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateAppliedEvent('local_container1');

  expect(storeContainer.getContainersRaw).toHaveBeenCalledWith();
  expect(storeContainer.getContainers).not.toHaveBeenCalled();
  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      env: expect.objectContaining({
        SECRET_TOKEN: 'raw-secret',
      }),
      notificationEvent: {
        kind: 'update-applied',
      },
    }),
  );
});

test('handleContainerUpdateAppliedEvent should use event payload container when store lookup misses', async () => {
  const container = {
    id: 'c1',
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
    env: {
      SECRET_TOKEN: 'payload-secret',
    },
  };
  storeContainer.getContainersRaw.mockReturnValue([]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateAppliedEvent({
    containerName: 'local_container1',
    container,
  } as any);

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'c1',
      name: 'container1',
      env: expect.objectContaining({
        SECRET_TOKEN: 'payload-secret',
      }),
      notificationEvent: {
        kind: 'update-applied',
      },
    }),
  );
});

test('handleContainerUpdateAppliedEvent should evict digest entries by container id when payload includes the container', async () => {
  await trigger.handleContainerReportDigest({
    container: {
      id: 'c1',
      name: 'tdarr_node',
      watcher: 'mediavault',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    },
    changed: true,
  } as any);

  const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateAppliedEvent({
    containerName: 'mediavault_tdarr_node',
    container: {
      id: 'c1',
      name: 'tdarr_node',
      watcher: 'mediavault',
      updateAvailable: false,
    },
  } as any);

  await trigger.flushDigestBuffer();

  expect(triggerBatchSpy).not.toHaveBeenCalled();
});

test('handleContainerUpdateAppliedEvent should skip when rule disables trigger dispatch', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  notificationStore.isTriggerEnabledForRule.mockImplementation(
    (ruleId) => ruleId !== 'update-applied',
  );
  storeContainer.getContainers.mockReturnValue([container]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateAppliedEvent('local_container1');

  expect(triggerSpy).not.toHaveBeenCalled();
});

test('handleContainerUpdateAppliedEvent should skip when container cannot be found', async () => {
  storeContainer.getContainers.mockReturnValue([]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateAppliedEvent('local_missing');

  expect(triggerSpy).not.toHaveBeenCalled();
});

test('handleContainerUpdateAppliedEvent should skip when payload lacks a usable container name', async () => {
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);
  const debugSpy = vi.spyOn(log, 'debug');

  await trigger.handleContainerUpdateAppliedEvent('' as any);
  await trigger.handleContainerUpdateAppliedEvent({ containerName: '', container: {} } as any);
  await trigger.handleContainerUpdateAppliedEvent(null as any);

  expect(triggerSpy).not.toHaveBeenCalled();
  expect(debugSpy).toHaveBeenCalledWith(
    'Skipping update-applied event because container name is missing',
  );
});

test('handleContainerUpdateAppliedEvent should suppress repeated identical dispatch errors during a short burst', async () => {
  const containers = [
    {
      watcher: 'local',
      name: 'container1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
    {
      watcher: 'local',
      name: 'container2',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  ];
  storeContainer.getContainers.mockReturnValue(containers);
  vi.spyOn(trigger, 'trigger').mockRejectedValue(new Error('dispatch failed'));
  const warnSpy = vi.spyOn(log, 'warn');
  let now = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);

  await trigger.handleContainerUpdateAppliedEvent('local_container1');
  now = 1_500;
  await trigger.handleContainerUpdateAppliedEvent('local_container2');

  expect(warnSpy).toHaveBeenCalledTimes(1);
  expect(warnSpy).toHaveBeenCalledWith('Error handling update-applied event (dispatch failed)');
});

test('handleContainerUpdateFailedEvent should run batch trigger when configured in batch mode', async () => {
  vi.useFakeTimers();
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  try {
    trigger.configuration.mode = 'batch';
    storeContainer.getContainers.mockReturnValue([container]);
    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    await trigger.handleContainerUpdateFailedEvent({
      containerName: 'local_container1',
      error: 'boom',
    });

    expect(triggerBatchSpy).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();

    expect(triggerBatchSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'container1',
        notificationEvent: {
          kind: 'update-failed',
          error: 'boom',
        },
      }),
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test('handleContainerUpdateFailedEvent should skip when threshold is not reached', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  trigger.configuration.mode = 'simple';
  trigger.configuration.threshold = 'minor';
  storeContainer.getContainers.mockReturnValue([container]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateFailedEvent({
    containerName: 'local_container1',
    error: 'boom',
  });

  expect(triggerSpy).not.toHaveBeenCalled();
});

test('handleContainerUpdateFailedEvent should skip when mustTrigger returns false', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    triggerExclude: 'update',
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  trigger.configuration.mode = 'simple';
  trigger.configuration.threshold = 'all';
  trigger.type = 'docker';
  trigger.name = 'update';
  storeContainer.getContainers.mockReturnValue([container]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateFailedEvent({
    containerName: 'local_container1',
    error: 'boom',
  });

  expect(triggerSpy).not.toHaveBeenCalled();
});

test('handleContainerUpdateFailedEvent should not trigger when container is not found in store', async () => {
  storeContainer.getContainers.mockReturnValue([]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateFailedEvent({
    containerName: 'local_nonexistent',
    error: 'boom',
  });

  expect(triggerSpy).not.toHaveBeenCalled();
});

test('handleSecurityAlertEvent should dispatch using payload container when provided', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleSecurityAlertEvent({
    containerName: 'local_container1',
    details: 'high=1',
    container,
  });

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'container1',
      notificationEvent: {
        kind: 'security-alert',
        details: 'high=1',
      },
    }),
  );
  expect(storeContainer.getContainers).not.toHaveBeenCalled();
});

test('handleSecurityAlertEvent should resolve container from store when payload container is missing', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  storeContainer.getContainers.mockReturnValue([container]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleSecurityAlertEvent({
    containerName: 'local_container1',
    details: 'high=1',
  });

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'container1',
      notificationEvent: {
        kind: 'security-alert',
        details: 'high=1',
      },
    }),
  );
});

test('handleSecurityAlertEvent should catch trigger execution errors', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  const warnSpy = vi.spyOn(log, 'warn');
  const debugSpy = vi.spyOn(log, 'debug');
  vi.spyOn(trigger, 'trigger').mockRejectedValue(new Error('dispatch failed'));

  await trigger.handleSecurityAlertEvent({
    containerName: 'local_container1',
    details: 'high=1',
    container,
  });

  expect(warnSpy).toHaveBeenCalledWith('Error handling security-alert event (dispatch failed)');
  expect(debugSpy).toHaveBeenCalledWith(expect.any(Error));
});

test('handleSecurityAlertEvent should not trigger when neither payload container nor store container is found', async () => {
  storeContainer.getContainers.mockReturnValue([]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleSecurityAlertEvent({
    containerName: 'local_nonexistent',
    details: 'high=1',
    container: undefined,
  });

  expect(triggerSpy).not.toHaveBeenCalled();
});

test('handleContainerUpdateAppliedEvent should aggregate nearby update-applied events in batch mode', async () => {
  vi.useFakeTimers();
  const containers = [
    {
      watcher: 'local',
      name: 'container1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
    {
      watcher: 'local',
      name: 'container2',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  ];

  try {
    trigger.configuration.mode = 'batch';
    storeContainer.getContainers.mockReturnValue(containers);
    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    await trigger.handleContainerUpdateAppliedEvent('local_container1');
    await trigger.handleContainerUpdateAppliedEvent('local_container2');

    expect(triggerBatchSpy).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();

    expect(triggerBatchSpy).toHaveBeenCalledTimes(1);
    expect(triggerBatchSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'container1',
        notificationEvent: {
          kind: 'update-applied',
        },
      }),
      expect.objectContaining({
        name: 'container2',
        notificationEvent: {
          kind: 'update-applied',
        },
      }),
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test('handleSecurityAlertEvent should aggregate nearby security alerts in batch mode', async () => {
  vi.useFakeTimers();
  const containers = [
    {
      watcher: 'local',
      name: 'container1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
    {
      watcher: 'local',
      name: 'container2',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  ];

  try {
    trigger.configuration.mode = 'batch';
    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    await trigger.handleSecurityAlertEvent({
      containerName: 'local_container1',
      details: 'high=1',
      container: containers[0],
    });
    await trigger.handleSecurityAlertEvent({
      containerName: 'local_container2',
      details: 'high=2',
      container: containers[1],
    });

    expect(triggerBatchSpy).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();

    expect(triggerBatchSpy).toHaveBeenCalledTimes(1);
    expect(triggerBatchSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'container1',
        notificationEvent: {
          kind: 'security-alert',
          details: 'high=1',
        },
      }),
      expect.objectContaining({
        name: 'container2',
        notificationEvent: {
          kind: 'security-alert',
          details: 'high=2',
        },
      }),
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test('handleAgentDisconnectedEvent should bypass threshold filtering', async () => {
  trigger.configuration.threshold = 'major-only';
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleAgentDisconnectedEvent({
    agentName: 'edge-a',
    reason: 'disconnected',
  });

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'edge-a',
      watcher: 'agent',
      status: 'disconnected',
      notificationEvent: {
        kind: 'agent-disconnect',
        agentName: 'edge-a',
        reason: 'disconnected',
      },
    }),
  );
});

test('handleAgentDisconnectedEvent should omit agent disconnect reason when it is missing', async () => {
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleAgentDisconnectedEvent({
    agentName: 'edge-a',
  });

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      notificationEvent: {
        kind: 'agent-disconnect',
        agentName: 'edge-a',
      },
      error: undefined,
    }),
  );
});

test('handleAgentDisconnectedEvent should use simple dispatch even when trigger mode is batch', async () => {
  trigger.configuration.mode = 'batch';
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);
  const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

  await trigger.handleAgentDisconnectedEvent({
    agentName: 'edge-a',
    reason: 'SSE connection lost',
  });

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      notificationEvent: {
        kind: 'agent-disconnect',
        agentName: 'edge-a',
        reason: 'SSE connection lost',
      },
    }),
  );
  expect(triggerBatchSpy).not.toHaveBeenCalled();
});

test('handleAgentConnectedEvent should bypass threshold filtering when reconnected', async () => {
  trigger.configuration.threshold = 'major-only';
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleAgentConnectedEvent({
    agentName: 'edge-a',
    reconnected: true,
  });

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'edge-a',
      watcher: 'agent',
      status: 'connected',
      notificationEvent: {
        kind: 'agent-reconnect',
        agentName: 'edge-a',
      },
    }),
  );
});

test('handleAgentConnectedEvent should ignore the initial connected event', async () => {
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleAgentConnectedEvent({
    agentName: 'edge-a',
    reconnected: false,
  });

  expect(triggerSpy).not.toHaveBeenCalled();
});

test('handleAgentConnectedEvent should use simple dispatch even when trigger mode is batch', async () => {
  trigger.configuration.mode = 'batch';
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);
  const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

  await trigger.handleAgentConnectedEvent({
    agentName: 'edge-a',
    reconnected: true,
  });

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      notificationEvent: {
        kind: 'agent-reconnect',
        agentName: 'edge-a',
      },
    }),
  );
  expect(triggerBatchSpy).not.toHaveBeenCalled();
});

test('dispatchContainerForEvent should fallback to all threshold when threshold is undefined', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  trigger.configuration.threshold = undefined;
  storeContainer.getContainers.mockReturnValue([container]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateAppliedEvent('local_container1');

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'container1',
      notificationEvent: {
        kind: 'update-applied',
      },
    }),
  );
});

test('handleContainerReports should skip when update-available rule disables trigger dispatch', async () => {
  notificationStore.isTriggerEnabledForRule.mockImplementation(
    (ruleId) => ruleId !== 'update-available',
  );
  notificationStore.getTriggerDispatchDecisionForRule.mockReturnValue({
    enabled: false,
    reason: 'excluded-from-allow-list',
  });
  const spy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

  await trigger.handleContainerReports([
    {
      changed: true,
      container: {
        name: 'container1',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
    },
  ]);

  expect(spy).not.toHaveBeenCalled();
});

test('init should wire auto dispatch callbacks for update/security/agent events', async () => {
  let onUpdateApplied;
  let onUpdateFailed;
  let onSecurityAlert;
  let onAgentConnected;
  let onAgentDisconnected;

  vi.spyOn(event, 'registerContainerUpdateApplied').mockImplementation((cb) => {
    onUpdateApplied = cb;
    return vi.fn();
  });
  vi.spyOn(event, 'registerContainerUpdateFailed').mockImplementation((cb) => {
    onUpdateFailed = cb;
    return vi.fn();
  });
  vi.spyOn(event, 'registerSecurityAlert').mockImplementation((cb) => {
    onSecurityAlert = cb;
    return vi.fn();
  });
  vi.spyOn(event, 'registerAgentConnected').mockImplementation((cb) => {
    onAgentConnected = cb;
    return vi.fn();
  });
  vi.spyOn(event, 'registerAgentDisconnected').mockImplementation((cb) => {
    onAgentDisconnected = cb;
    return vi.fn();
  });

  const updateAppliedSpy = vi
    .spyOn(trigger, 'handleContainerUpdateAppliedEvent')
    .mockResolvedValue(undefined);
  const updateFailedSpy = vi
    .spyOn(trigger, 'handleContainerUpdateFailedEvent')
    .mockResolvedValue(undefined);
  const securityAlertSpy = vi
    .spyOn(trigger, 'handleSecurityAlertEvent')
    .mockResolvedValue(undefined);
  const agentConnectedSpy = vi
    .spyOn(trigger, 'handleAgentConnectedEvent')
    .mockResolvedValue(undefined);
  const agentDisconnectedSpy = vi
    .spyOn(trigger, 'handleAgentDisconnectedEvent')
    .mockResolvedValue(undefined);

  trigger.configuration.auto = true;
  trigger.configuration.mode = 'simple';
  await trigger.init();

  await onUpdateApplied('container-a');
  await onUpdateFailed({ containerName: 'container-b', error: 'boom' });
  await onSecurityAlert({ containerName: 'container-c', details: 'high=1' });
  await onAgentConnected({ agentName: 'edge-a', reconnected: true });
  await onAgentDisconnected({ agentName: 'edge-a', reason: 'disconnected' });

  expect(updateAppliedSpy).toHaveBeenCalledWith('container-a');
  expect(updateFailedSpy).toHaveBeenCalledWith({
    containerName: 'container-b',
    error: 'boom',
  });
  expect(securityAlertSpy).toHaveBeenCalledWith({
    containerName: 'container-c',
    details: 'high=1',
  });
  expect(agentConnectedSpy).toHaveBeenCalledWith({
    agentName: 'edge-a',
    reconnected: true,
  });
  expect(agentDisconnectedSpy).toHaveBeenCalledWith({
    agentName: 'edge-a',
    reason: 'disconnected',
  });
});

test('dismiss should be a no-op by default', async () => {
  await expect(trigger.dismiss('test', {})).resolves.toBeUndefined();
});

test('mustTrigger should return false when agent does not match', async () => {
  trigger.agent = 'remote-agent';
  trigger.type = 'docker';
  trigger.name = 'update';
  expect(trigger.mustTrigger({ agent: 'local-agent' })).toBe(false);
});

test('getMustTriggerDecision should describe agent mismatches when the container agent is missing', () => {
  trigger.agent = 'remote-agent';

  expect((trigger as any).getMustTriggerDecision({})).toEqual({
    allowed: false,
    reason: 'agent mismatch expected=remote-agent actual=<none>',
  });
});

test('mustTrigger should return false when strictAgentMatch and agent mismatch', async () => {
  trigger.strictAgentMatch = true;
  trigger.agent = undefined;
  trigger.type = 'docker';
  trigger.name = 'update';
  expect(trigger.mustTrigger({ agent: 'remote-agent' })).toBe(false);
});

test('getMustTriggerDecision should describe strict agent mismatches when the trigger agent is missing', () => {
  trigger.strictAgentMatch = true;
  trigger.agent = undefined;

  expect((trigger as any).getMustTriggerDecision({ agent: 'remote-agent' })).toEqual({
    allowed: false,
    reason: 'strict agent mismatch expected=<none> actual=remote-agent',
  });
});

test('getMustTriggerDecision should treat null strict-agent values as missing in the reason string', () => {
  trigger.strictAgentMatch = true;
  trigger.agent = undefined;

  expect((trigger as any).getMustTriggerDecision({ agent: null })).toEqual({
    allowed: false,
    reason: 'strict agent mismatch expected=<none> actual=<none>',
  });
});

test('isTriggerIncludedOrExcluded should return false when trigger not found in list', () => {
  trigger.type = 'docker';
  trigger.name = 'update';
  expect(
    trigger.isTriggerIncludedOrExcluded(
      { updateKind: { kind: 'tag', semverDiff: 'major' } },
      'slack.notify:major',
    ),
  ).toBe(false);
});

test('isTriggerIncludedOrExcluded should parse comma-separated trigger list with spaces', () => {
  trigger.type = 'docker';
  trigger.name = 'update';
  expect(
    trigger.isTriggerIncludedOrExcluded(
      { updateKind: { kind: 'tag', semverDiff: 'minor' } },
      '  , slack.notify:major, docker.update : minor , ',
    ),
  ).toBe(true);
});

test('handleContainerReport should store result when resolvenotifications is enabled', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'simple',
    resolvenotifications: true,
  };
  trigger.notificationResults = new Map();
  const mockResult = { messageId: '456' };
  trigger.trigger = vi.fn().mockResolvedValue(mockResult);
  await trigger.init();
  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      watcher: 'local',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  });
  expect(trigger.notificationResults.size).toBe(1);
});

test('handleContainerReport should store result under fallback fullName when notification key is missing', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'simple',
    resolvenotifications: true,
  };
  trigger.notificationResults = new Map();
  const mockResult = { messageId: '456' };
  trigger.trigger = vi.fn().mockResolvedValue(mockResult);
  await trigger.init();

  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  } as any);

  expect(trigger.notificationResults.get('undefined_container1')).toBe(mockResult);
});

test('doesReferenceMatchId should match provider.name against 3-part trigger id', () => {
  // When triggerId is 'prefix.docker.update', reference 'docker.update' should match
  expect(Trigger.doesReferenceMatchId('docker.update', 'prefix.docker.update')).toBe(true);
});

test('handleContainerReport should log when mustTrigger returns false', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'simple',
  };
  trigger.agent = 'remote-agent';
  await trigger.init();
  const spy = vi.spyOn(trigger, 'trigger');
  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      agent: 'local-agent',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  });
  expect(spy).not.toHaveBeenCalled();
});

test('isThresholdReached should return true for major-only when semverDiff is major', () => {
  expect(
    Trigger.isThresholdReached({ updateKind: { kind: 'tag', semverDiff: 'major' } }, 'major-only'),
  ).toBe(true);
});

test('isThresholdReached should return false for major-only when semverDiff is minor', () => {
  expect(
    Trigger.isThresholdReached({ updateKind: { kind: 'tag', semverDiff: 'minor' } }, 'major-only'),
  ).toBe(false);
});

test('doesReferenceMatchId should match provider.name when trigger id has 3+ parts', () => {
  // Trigger id: scope.docker.update -> provider.name = "docker.update"
  expect(Trigger.doesReferenceMatchId('docker.update', 'scope.docker.update')).toBe(true);
  expect(Trigger.doesReferenceMatchId('slack.notify', 'scope.docker.update')).toBe(false);
});

test('handleContainerReport should debug log when mustTrigger returns false', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'simple',
  };
  trigger.type = 'docker';
  trigger.name = 'update';
  await trigger.init();
  const spy = vi.spyOn(trigger, 'trigger');
  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      updateAvailable: true,
      triggerExclude: 'update',
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  });
  expect(spy).not.toHaveBeenCalled();
});

test('handleContainerReport should include trigger filter context when mustTrigger returns false', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'simple',
  };
  trigger.type = 'pushover';
  trigger.name = 'mobile';
  const debugSpy = vi.spyOn(log, 'debug');

  await trigger.handleContainerReport({
    changed: true,
    container: {
      watcher: 'local',
      name: 'container1',
      updateAvailable: true,
      triggerExclude: 'mobile',
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  });

  expect(debugSpy).toHaveBeenCalledWith(
    'Trigger conditions not met => ignore (triggerInclude=<none>, triggerExclude=mobile, included=true, excluded=true)',
  );
});

test('handleContainerReport should debug log when threshold is not reached', async () => {
  trigger.configuration = {
    threshold: 'major-only',
    mode: 'simple',
  };
  const debugSpy = vi.spyOn(log, 'debug');

  await trigger.handleContainerReport({
    changed: true,
    container: {
      watcher: 'local',
      name: 'container1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'minor' },
    },
  });

  expect(debugSpy).toHaveBeenCalledWith(
    'Threshold not reached => ignore (threshold=major-only, updateKind=tag, semverDiff=minor)',
  );
});

test('handleContainerReport should use unknown placeholders when threshold logging lacks update details', async () => {
  trigger.configuration = {
    threshold: 'major-only',
    mode: 'simple',
  };
  vi.spyOn(Trigger, 'isThresholdReached').mockReturnValue(false);
  const debugSpy = vi.spyOn(log, 'debug');

  await trigger.handleContainerReport({
    changed: true,
    container: {
      watcher: 'local',
      name: 'container1',
      updateAvailable: true,
    },
  });

  expect(debugSpy).toHaveBeenCalledWith(
    'Threshold not reached => ignore (threshold=major-only, updateKind=unknown, semverDiff=unknown)',
  );
});

test('handleContainerReport should fallback to parent logger when child logger is unavailable', async () => {
  trigger.configuration = {
    threshold: undefined,
    mode: 'simple',
    once: true,
  };
  trigger.type = 'docker';
  trigger.name = 'update';
  trigger.log = {
    ...log,
    child: vi.fn().mockReturnValue(undefined),
  };
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  });

  expect(triggerSpy).toHaveBeenCalled();
});

test('handleContainerReports should fallback to all threshold when configuration threshold is empty', async () => {
  trigger.configuration = {
    threshold: '',
    once: true,
    mode: 'batch',
  };
  const spy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

  await trigger.handleContainerReports([
    {
      changed: true,
      container: {
        name: 'container1',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
    },
  ]);

  expect(spy).toHaveBeenCalledTimes(1);
});

test('init with resolvenotifications should invoke handleContainerUpdateApplied callback', async () => {
  let capturedCallback;
  vi.spyOn(event, 'registerContainerReport').mockReturnValue(vi.fn());
  const eventModule = await import('../../event/index.js');
  vi.spyOn(eventModule, 'registerContainerUpdateApplied').mockImplementation((cb) => {
    capturedCallback = cb;
    return vi.fn();
  });
  trigger.configuration.resolvenotifications = true;
  trigger.configuration.auto = true;
  trigger.configuration.mode = 'simple';
  trigger.notificationResults = new Map();
  trigger.notificationResults.set('docker.local/nginx', { id: 'msg1' });
  trigger.dismiss = vi.fn().mockResolvedValue(undefined);

  await trigger.init();
  expect(capturedCallback).toBeDefined();

  await capturedCallback('docker.local/nginx');
  expect(trigger.dismiss).toHaveBeenCalledWith('docker.local/nginx', { id: 'msg1' });
});

test('renderSimpleBody should return empty for disallowed method calls', async () => {
  trigger.configuration.simplebody = 'Result: ${name.constructor()}';
  expect(trigger.renderSimpleBody({ name: 'test' })).toBe('Result: ');
});

test('renderSimpleBody should return empty for method on unresolvable path', async () => {
  trigger.configuration.simplebody = 'Result: ${nonexistent.substring(0, 5)}';
  expect(trigger.renderSimpleBody({})).toBe('Result: ');
});

test('renderSimpleBody should return empty when method target has no such method', async () => {
  trigger.configuration.simplebody = 'Result: ${name.nonExistentMethod()}';
  expect(trigger.renderSimpleBody({ name: 'test' })).toBe('Result: ');
});

test('renderSimpleBody should return empty for unsupported expression syntax', async () => {
  trigger.configuration.simplebody = 'Result: ${[1,2,3]}';
  expect(trigger.renderSimpleBody({})).toBe('Result: ');
});

test('renderSimpleBody should handle method call without closing paren', async () => {
  trigger.configuration.simplebody = 'Result: ${name.substring(0, 5}';
  expect(trigger.renderSimpleBody({ name: 'hello world' })).toBe('Result: ');
});

test('renderSimpleBody should handle method call with nested closing paren in args', async () => {
  trigger.configuration.simplebody = 'Result: ${name.substring(0, foo())}';
  expect(trigger.renderSimpleBody({ name: 'hello world' })).toBe('Result: ');
});

test('renderSimpleBody should handle method call with no dot before method', async () => {
  trigger.configuration.simplebody = 'Result: ${substring(0, 5)}';
  expect(trigger.renderSimpleBody({ substring: 'test' })).toBe('Result: ');
});

test('renderSimpleBody should handle invalid property path with leading dot', async () => {
  trigger.configuration.simplebody = 'Result: ${.name}';
  expect(trigger.renderSimpleBody({ name: 'test' })).toBe('Result: ');
});

test('renderSimpleBody should handle empty segments in property path', async () => {
  trigger.configuration.simplebody = 'Result: ${name..value}';
  expect(trigger.renderSimpleBody({ name: { value: 'test' } })).toBe('Result: ');
});

test('renderSimpleBody should handle templates with single-quoted strings in expressions', async () => {
  trigger.configuration.simplebody = "Container ${name} status is ${'running'}";
  expect(
    trigger.renderSimpleBody({
      name: 'test-container',
    }),
  ).toContain('Container test-container');
});

test('handleContainerReports should warn when triggerBatch fails', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'batch',
  };
  trigger.triggerBatch = vi.fn().mockRejectedValue(new Error('batch fail'));
  await trigger.init();
  const spyLog = vi.spyOn(log, 'warn');
  await trigger.handleContainerReports([
    {
      changed: true,
      container: {
        name: 'c1',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
    },
  ]);
  expect(spyLog).toHaveBeenCalledWith('Error (batch fail)');
});

test('handleContainerReports should retain failed batch deliveries for retry on later watcher cycles', async () => {
  trigger.configuration = {
    threshold: 'all',
    once: true,
    mode: 'batch',
  };
  trigger.triggerBatch = vi
    .fn()
    .mockRejectedValueOnce(new Error('batch fail'))
    .mockResolvedValueOnce(undefined);
  await trigger.init();

  const container = {
    name: 'c1',
    watcher: 'local',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  storeContainer.getContainersRaw.mockReturnValue([container]);

  await trigger.handleContainerReports([
    {
      changed: true,
      container,
    },
  ]);

  await trigger.handleContainerReports([
    {
      changed: false,
      container,
    },
  ]);

  expect(trigger.triggerBatch).toHaveBeenCalledTimes(2);
  expect(trigger.triggerBatch).toHaveBeenLastCalledWith([container]);
});

test('handleContainerReports should increment trigger counter when batch send succeeds', async () => {
  trigger.type = 'smtp';
  trigger.name = 'gmail';
  trigger.configuration = {
    threshold: 'all',
    once: true,
    mode: 'batch',
  };
  trigger.triggerBatch = vi.fn().mockResolvedValue(undefined);

  await trigger.handleContainerReports([
    {
      changed: true,
      container: {
        name: 'c1',
        watcher: 'local',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
    },
  ]);

  expect(mockTriggerCounterInc).toHaveBeenCalledWith({
    type: 'smtp',
    name: 'gmail',
    status: 'success',
  });
});

test('handleContainerReports should increment trigger counter when batch send fails', async () => {
  trigger.type = 'smtp';
  trigger.name = 'gmail';
  trigger.configuration = {
    threshold: 'all',
    once: true,
    mode: 'batch',
  };
  trigger.triggerBatch = vi.fn().mockRejectedValue(new Error('batch fail'));

  await trigger.handleContainerReports([
    {
      changed: true,
      container: {
        name: 'c1',
        watcher: 'local',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
    },
  ]);

  expect(mockTriggerCounterInc).toHaveBeenCalledWith({
    type: 'smtp',
    name: 'gmail',
    status: 'error',
  });
});

test('handleContainerReports should audit failed batch deliveries', async () => {
  trigger.type = 'smtp';
  trigger.name = 'gmail';
  trigger.configuration = {
    threshold: 'all',
    once: true,
    mode: 'batch',
  };
  trigger.triggerBatch = vi.fn().mockRejectedValue(new Error('SMTP timeout'));

  await trigger.handleContainerReports([
    {
      changed: true,
      container: {
        name: 'c1',
        watcher: 'local',
        image: {
          name: 'library/nginx',
        },
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0', semverDiff: 'major' },
      },
    },
  ]);

  expect(auditStore.insertAudit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'notification-delivery-failed',
      containerName: 'local_c1',
      triggerName: 'smtp.gmail',
      status: 'error',
      details: 'SMTP timeout',
    }),
  );
});

test('getBatchRetryContainers should keep a newer retry-buffer entry when iteration sees stale state', () => {
  trigger.configuration = {
    threshold: 'all',
    once: true,
    mode: 'batch',
  };

  const staleContainer = {
    id: 'stale-id',
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  } as any;
  const replacementContainer = {
    id: 'replacement-id',
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  } as any;

  trigger.batchRetryBuffer.set('local_container1', staleContainer);
  const originalGet = trigger.batchRetryBuffer.get.bind(trigger.batchRetryBuffer);
  trigger.batchRetryBuffer.get = vi.fn((key: string) => {
    if (key === 'local_container1') {
      return replacementContainer;
    }
    return originalGet(key);
  });
  storeContainer.getContainersRaw.mockReturnValue([]);

  const retryContainers = (trigger as any).getBatchRetryContainers([]);

  expect(retryContainers).toEqual([staleContainer]);
  expect(trigger.batchRetryBuffer.size).toBe(1);
  expect(trigger.batchRetryBuffer.get('local_container1')).toBe(replacementContainer);
});

test('getBatchRetryContainers should match raw containers by fallback fullName when notification keys are missing', () => {
  trigger.configuration = {
    threshold: 'all',
    once: true,
    mode: 'batch',
  };

  const bufferedContainer = {
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  } as any;
  const currentContainer = {
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  } as any;

  trigger.batchRetryBuffer.set('undefined_container1', bufferedContainer);
  storeContainer.getContainersRaw.mockReturnValue([currentContainer]);

  const retryContainers = (trigger as any).getBatchRetryContainers([]);

  expect(retryContainers).toEqual([currentContainer]);
  expect(trigger.batchRetryBuffer.get('undefined_container1')).toBe(currentContainer);
});

test('getBatchRetryContainers should evict stale retry-buffer entries before reuse', () => {
  trigger.configuration = {
    threshold: 'all',
    once: true,
    mode: 'batch',
  };

  const currentContainer = {
    id: 'stale-id',
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  } as any;

  trigger.batchRetryBuffer.set('stale-id', currentContainer);
  (trigger as any).batchRetryBufferUpdatedAt = new Map([['stale-id', 1_000]]);
  (trigger as any).bufferEntryRetentionMs = 100;
  storeContainer.getContainersRaw.mockReturnValue([currentContainer]);
  const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_101);

  try {
    const retryContainers = (trigger as any).getBatchRetryContainers([]);

    expect(retryContainers).toEqual([]);
    expect(trigger.batchRetryBuffer.size).toBe(0);
  } finally {
    nowSpy.mockRestore();
  }
});

test('handleContainerReports should cap retry-buffer growth by evicting the oldest entries', async () => {
  trigger.configuration = {
    threshold: 'all',
    once: true,
    mode: 'batch',
  };
  (trigger as any).batchRetryBufferMaxEntries = 2;
  trigger.triggerBatch = vi.fn().mockRejectedValue(new Error('SMTP timeout'));

  const nowSpy = vi
    .spyOn(Date, 'now')
    .mockReturnValueOnce(1_000)
    .mockReturnValueOnce(1_001)
    .mockReturnValueOnce(1_002);

  try {
    await trigger.handleContainerReports([
      {
        changed: true,
        container: {
          id: 'c1',
          name: 'c1',
          watcher: 'local',
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'major' },
        },
      },
      {
        changed: true,
        container: {
          id: 'c2',
          name: 'c2',
          watcher: 'local',
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'major' },
        },
      },
      {
        changed: true,
        container: {
          id: 'c3',
          name: 'c3',
          watcher: 'local',
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'major' },
        },
      },
    ] as any);

    expect([...trigger.batchRetryBuffer.keys()]).toEqual(['c2', 'c3']);
  } finally {
    nowSpy.mockRestore();
  }
});

test('handleContainerReports should use fallback fullName keys for retry cleanup when notification keys are missing', async () => {
  trigger.configuration = {
    threshold: 'all',
    once: true,
    mode: 'batch',
  };

  const container = {
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  } as any;
  trigger.batchRetryBuffer.set('undefined_container1', container);
  trigger.triggerBatch = vi.fn().mockResolvedValue(undefined);

  await trigger.handleContainerReports([
    {
      changed: false,
      container,
    },
  ] as any);

  expect(trigger.triggerBatch).toHaveBeenCalledWith([container]);
  expect(trigger.batchRetryBuffer.size).toBe(0);
});

test('handleContainerReports should suppress repeated identical batch errors during a short burst', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'batch',
  };
  trigger.triggerBatch = vi.fn().mockRejectedValue(new Error('batch fail'));
  await trigger.init();
  const warnSpy = vi.spyOn(log, 'warn');
  const debugSpy = vi.spyOn(log, 'debug');
  let now = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);

  const reports = [
    {
      changed: true,
      container: {
        name: 'c1',
        watcher: 'local',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
    },
  ];

  await trigger.handleContainerReports(reports);
  now = 1_500;
  await trigger.handleContainerReports(reports);

  expect(warnSpy).toHaveBeenCalledTimes(1);
  expect(debugSpy).toHaveBeenCalledWith('Suppressed repeated error (batch fail)');
});

test('handleContainerReports should not suppress identical batch errors across different watchers', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'batch',
  };
  trigger.triggerBatch = vi.fn().mockRejectedValue(new Error('batch fail'));
  await trigger.init();
  const warnSpy = vi.spyOn(log, 'warn');
  const debugSpy = vi.spyOn(log, 'debug');
  let now = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);

  await trigger.handleContainerReports([
    {
      changed: true,
      container: {
        name: 'c1',
        watcher: 'local',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
    },
  ]);
  now = 1_500;
  await trigger.handleContainerReports([
    {
      changed: true,
      container: {
        name: 'c1',
        watcher: 'servicevault',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
    },
  ]);

  expect(warnSpy).toHaveBeenCalledTimes(2);
  expect(debugSpy).not.toHaveBeenCalledWith('Suppressed repeated error (batch fail)');
});

test('flushEventBatchDispatch should warn when auto event batch dispatch fails', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'batch',
  };
  trigger.triggerBatch = vi.fn().mockRejectedValue(new Error('event batch fail'));
  vi.spyOn(trigger as any, 'shouldSuppressAutoTriggerError').mockReturnValue(false);

  const warnSpy = vi.spyOn(log, 'warn');
  const debugSpy = vi.spyOn(log, 'debug');

  await (trigger as any).flushEventBatchDispatch('update-applied', [
    { name: 'c1', watcher: 'local' },
  ]);

  expect(warnSpy).toHaveBeenCalledWith('Error handling update-applied event (event batch fail)');
  expect(debugSpy).toHaveBeenCalledWith(expect.any(Error));
});

test('flushEventBatchDispatch should skip empty batches', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'batch',
  };
  trigger.triggerBatch = vi.fn();

  await (trigger as any).flushEventBatchDispatch('update-applied', []);

  expect(trigger.triggerBatch).not.toHaveBeenCalled();
});

test('flushEventBatchDispatch should suppress repeated auto event batch errors', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'batch',
  };
  trigger.triggerBatch = vi.fn().mockRejectedValue(new Error('event batch fail'));
  vi.spyOn(trigger as any, 'shouldSuppressAutoTriggerError').mockReturnValue(true);

  const warnSpy = vi.spyOn(log, 'warn');
  const debugSpy = vi.spyOn(log, 'debug');

  await (trigger as any).flushEventBatchDispatch('update-applied', [
    { name: 'c1', watcher: 'local' },
  ]);

  expect(warnSpy).not.toHaveBeenCalledWith(
    'Error handling update-applied event (event batch fail)',
  );
  expect(debugSpy).toHaveBeenCalledWith(
    'Suppressed repeated error handling update-applied event (event batch fail)',
  );
  expect(debugSpy).toHaveBeenCalledWith(expect.any(Error));
});

test('shouldSuppressAutoTriggerError should prune stale cache entries', () => {
  const triggerAny = trigger as any;
  triggerAny.autoTriggerErrorSeenAt.set('stale-signature', 0);
  vi.spyOn(Date, 'now').mockReturnValue(100_000);

  triggerAny.shouldSuppressAutoTriggerError(
    'update-available',
    { watcher: 'local' },
    'fresh error',
  );

  expect(triggerAny.autoTriggerErrorSeenAt.has('stale-signature')).toBe(false);
});

test('parseThresholdWithDigestBehavior should parse suffix behavior', () => {
  expect(Trigger.parseThresholdWithDigestBehavior(undefined)).toEqual({
    thresholdBase: 'all',
    nonDigestOnly: false,
  });
  expect(Trigger.parseThresholdWithDigestBehavior('minor-no-digest')).toEqual({
    thresholdBase: 'minor',
    nonDigestOnly: true,
  });
});

test('doesReferenceMatchId should return false when trigger id has no name segment', () => {
  expect(Trigger.doesReferenceMatchId('update', '')).toBe(false);
});

test('canonicalizeReportName should strip docker recreate aliases', () => {
  const report = {
    container: {
      name: '0123456789ab_nginx',
    },
    changed: false,
  };

  Trigger.canonicalizeReportName(report);

  expect(report.container.name).toBe('nginx');
});

test('canonicalizeReportName should ignore reports without a string name', () => {
  const report = {
    container: {
      name: undefined,
    },
    changed: false,
  };

  Trigger.canonicalizeReportName(report);

  expect(report.container.name).toBeUndefined();
});

test('preview should return an empty object by default', async () => {
  await expect(trigger.preview({})).resolves.toEqual({});
});

test('maskFields should mask non-empty configured values', () => {
  trigger.configuration = {
    token: 'super-secret',
    empty: '',
  };
  const masked = trigger.maskFields(['token', 'empty']);
  expect(masked.token).toBe('[REDACTED]');
  expect(masked.empty).toBe('');
});

describe('digest mode', () => {
  const mockStop = vi.fn();

  beforeEach(() => {
    vi.mocked(mockCron.schedule).mockReturnValue({ stop: mockStop } as any);
    vi.mocked(event.registerContainerReport).mockReturnValue(vi.fn());
    vi.mocked(event.registerContainerUpdateApplied).mockReturnValue(vi.fn());
    vi.mocked(event.registerContainerUpdateFailed).mockReturnValue(vi.fn());
    vi.mocked(event.registerSecurityAlert).mockReturnValue(vi.fn());
    vi.mocked(event.registerSecurityScanCycleComplete).mockReturnValue(vi.fn());
    vi.mocked(event.registerAgentDisconnected).mockReturnValue(vi.fn());
    vi.mocked(mockCron.validate).mockReturnValue(true);
  });

  test('validateConfiguration should accept digest mode', () => {
    const validated = trigger.validateConfiguration({
      ...configurationValid,
      mode: 'digest',
    });
    expect(validated.mode).toBe('digest');
  });

  test('validateConfiguration should default digestcron to 0 8 * * *', () => {
    const validated = trigger.validateConfiguration(configurationValid);
    expect(validated.digestcron).toBe('0 8 * * *');
  });

  test('init should schedule digest cron when mode is digest', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
      digestcron: '0 9 * * *',
    });
    trigger.init();

    expect(event.registerContainerReport).toHaveBeenCalled();
    expect(mockCron.schedule).toHaveBeenCalledWith('0 9 * * *', expect.any(Function));
  });

  test('handleContainerReportDigest should buffer containers', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    // Buffer should have one entry — verified via flush
    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();
    expect(triggerBatchSpy).toHaveBeenCalledWith([expect.objectContaining({ name: 'app' })]);
    triggerBatchSpy.mockRestore();
  });

  test('handleContainerReportDigest should keep same-name siblings distinct when ids differ', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'tdarr_node',
        watcher: 'mediavault',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    } as any);
    await trigger.handleContainerReportDigest({
      container: {
        id: 'c2',
        name: 'tdarr_node',
        watcher: 'mediavault',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    } as any);

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();

    expect(triggerBatchSpy).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'c1', name: 'tdarr_node' }),
      expect.objectContaining({ id: 'c2', name: 'tdarr_node' }),
    ]);
  });

  test('handleContainerReportDigest should return early when auto trigger is disabled', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();
    notificationStore.isTriggerEnabledForRule.mockReturnValue(false);
    notificationStore.getTriggerDispatchDecisionForRule.mockReturnValue({
      enabled: false,
      reason: 'rule-disabled',
    });
    const warnSpy = vi.spyOn(log, 'warn');

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });
    await trigger.flushDigestBuffer();

    expect(triggerBatchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Digest mode is configured for test.digest-trigger, but the update-available notification rule is disabled; no update-available events will be buffered until the rule is enabled.',
    );
    triggerBatchSpy.mockRestore();
  });

  test('bufferContainerForDigest should cap digest-buffer growth by evicting the oldest entries', () => {
    (trigger as any).digestBufferMaxEntries = 2;
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_001)
      .mockReturnValueOnce(1_002);

    try {
      (trigger as any).bufferContainerForDigest({
        id: 'c1',
        name: 'app-1',
        watcher: 'test',
      });
      (trigger as any).bufferContainerForDigest({
        id: 'c2',
        name: 'app-2',
        watcher: 'test',
      });
      (trigger as any).bufferContainerForDigest({
        id: 'c3',
        name: 'app-3',
        watcher: 'test',
      });

      expect([...trigger.digestBuffer.keys()]).toEqual(['c2', 'c3']);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('pruneDigestBuffer should keep buffered entries when retention is disabled', () => {
    trigger.digestBuffer.set('c1', {
      id: 'c1',
      name: 'app',
      watcher: 'test',
    } as any);
    (trigger as any).digestBufferUpdatedAt = new Map([['c1', 1_000]]);
    (trigger as any).bufferEntryRetentionMs = 0;

    (trigger as any).pruneDigestBuffer(1_500);

    expect(trigger.digestBuffer.size).toBe(1);
    expect(trigger.digestBuffer.get('c1')).toMatchObject({ id: 'c1' });
    expect((trigger as any).digestBufferUpdatedAt.get('c1')).toBe(1_000);
  });

  test('pruneDigestBuffer should clear buffered entries when max entries is zero', () => {
    trigger.digestBuffer.set('c1', {
      id: 'c1',
      name: 'app',
      watcher: 'test',
    } as any);
    (trigger as any).digestBufferUpdatedAt = new Map([['c1', 1_000]]);
    (trigger as any).digestBufferMaxEntries = 0;

    (trigger as any).pruneDigestBuffer(1_500);

    expect(trigger.digestBuffer.size).toBe(0);
    expect((trigger as any).digestBufferUpdatedAt.size).toBe(0);
  });

  test('enforceBufferedContainerLimit should stop when the oldest key is blank', () => {
    const buffer = new Map<string, any>([
      [
        '',
        {
          id: 'blank',
          name: 'blank',
          watcher: 'test',
        },
      ],
      [
        'c2',
        {
          id: 'c2',
          name: 'app',
          watcher: 'test',
        },
      ],
    ]);
    const timestamps = new Map<string, number>([
      ['', 1_000],
      ['c2', 1_001],
    ]);

    (trigger as any).enforceBufferedContainerLimit('digest buffer', buffer, timestamps, 1);

    expect([...buffer.keys()]).toEqual(['', 'c2']);
    expect([...timestamps.keys()]).toEqual(['', 'c2']);
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('enforceBufferedContainerLimit should treat missing timestamps as the oldest entries', () => {
    const buffer = new Map<string, any>([
      [
        'c1',
        {
          id: 'c1',
          name: 'app-1',
          watcher: 'test',
        },
      ],
      [
        'c2',
        {
          id: 'c2',
          name: 'app-2',
          watcher: 'test',
        },
      ],
    ]);
    const timestamps = new Map<string, number>([['c2', 1_001]]);

    (trigger as any).enforceBufferedContainerLimit('digest buffer', buffer, timestamps, 1);

    expect([...buffer.keys()]).toEqual(['c2']);
    expect([...timestamps.keys()]).toEqual(['c2']);
    expect(log.warn).toHaveBeenCalledWith(
      'Evicted oldest digest buffer entry c1 after reaching the 1-entry limit',
    );
  });

  test('handleContainerReportDigest should return early when report is not eligible for simple handling', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: false,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: false,
    });
    await trigger.flushDigestBuffer();

    expect(triggerBatchSpy).not.toHaveBeenCalled();
    triggerBatchSpy.mockRestore();
  });

  test('handleContainerReportDigest should evict a buffered container when a later report clears updateAvailable', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: false,
        updateKind: { kind: 'tag', localValue: '2.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();

    expect(trigger.digestBuffer.size).toBe(0);
    expect(triggerBatchSpy).not.toHaveBeenCalled();
    triggerBatchSpy.mockRestore();
  });

  test('handleContainerReportDigest should not buffer when the result hash was already notified and once is true', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    const alreadyNotifiedContainer = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    };
    notificationHistoryStore.recordNotification(
      trigger.getId(),
      alreadyNotifiedContainer.id,
      'update-available-digest',
      notificationHistoryStore.computeResultHash(alreadyNotifiedContainer),
    );

    await trigger.handleContainerReportDigest({
      container: alreadyNotifiedContainer,
      changed: false,
    });

    expect(trigger.digestBuffer.size).toBe(0);
  });

  test('handleContainerReportDigest should canonicalize recreate aliases before negative eviction', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: '0123456789ab_app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: false,
        updateKind: { kind: 'tag', localValue: '2.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();

    expect(trigger.digestBuffer.size).toBe(0);
    expect(triggerBatchSpy).not.toHaveBeenCalled();
    triggerBatchSpy.mockRestore();
  });

  test('handleContainerReportDigest should return early when threshold is not reached', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();
    const thresholdSpy = vi.spyOn(Trigger, 'isThresholdReached').mockReturnValue(false);

    try {
      const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
      await trigger.handleContainerReportDigest({
        container: {
          id: 'c1',
          name: 'app',
          watcher: 'test',
          updateAvailable: true,
          updateKind: { kind: 'digest', localValue: 'sha256:1', remoteValue: 'sha256:2' },
        },
        changed: true,
      });
      await trigger.flushDigestBuffer();

      expect(triggerBatchSpy).not.toHaveBeenCalled();
      triggerBatchSpy.mockRestore();
    } finally {
      thresholdSpy.mockRestore();
    }
  });

  test('handleContainerReportDigest should return early when mustTrigger rejects the container', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app-old-1234567890',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });
    await trigger.flushDigestBuffer();

    expect(triggerBatchSpy).not.toHaveBeenCalled();
    triggerBatchSpy.mockRestore();
  });

  test('buildEventBatchDispatchKey should fall back to fullName when no notification key can be derived', () => {
    expect((trigger as any).buildEventBatchDispatchKey({ name: 'container1' })).toBe(
      'undefined_container1',
    );
  });

  test('flushDigestBuffer should skip when buffer is empty', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();
    expect(triggerBatchSpy).not.toHaveBeenCalled();
    triggerBatchSpy.mockRestore();
  });

  test('flushDigestBuffer should evict stale buffered entries before dispatch', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });

    const staleContainer = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    } as any;
    trigger.digestBuffer.set('c1', staleContainer);
    (trigger as any).digestBufferUpdatedAt = new Map([['c1', 1_000]]);
    (trigger as any).bufferEntryRetentionMs = 100;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_101);

    try {
      const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
      await trigger.flushDigestBuffer();

      expect(trigger.digestBuffer.size).toBe(0);
      expect(triggerBatchSpy).not.toHaveBeenCalled();
      triggerBatchSpy.mockRestore();
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('flushDigestBuffer should return early when a digest flush is already in progress', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    (trigger as any).isDigestFlushInProgress = true;

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();

    expect(trigger.log.debug).toHaveBeenCalledWith('Digest flush already in progress');
    expect(triggerBatchSpy).not.toHaveBeenCalled();
    triggerBatchSpy.mockRestore();
  });

  test('flushDigestBuffer should deduplicate by keeping latest container', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    const report1 = {
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    };
    const report2 = {
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '3.0' },
      },
      changed: true,
    };

    await trigger.handleContainerReportDigest(report1);
    await trigger.handleContainerReportDigest(report2);

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();
    expect(triggerBatchSpy).toHaveBeenCalledTimes(1);
    expect(triggerBatchSpy).toHaveBeenCalledWith([
      expect.objectContaining({ updateKind: expect.objectContaining({ remoteValue: '3.0' }) }),
    ]);
    triggerBatchSpy.mockRestore();
  });

  test('flushDigestBuffer should clear buffer after flush', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();
    await trigger.flushDigestBuffer(); // second flush should be no-op
    expect(triggerBatchSpy).toHaveBeenCalledTimes(1);
    triggerBatchSpy.mockRestore();
  });

  test('flushDigestBuffer should skip buffered containers that no longer have an update in store state', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    storeContainer.getContainers.mockReturnValue([
      {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: false,
        updateKind: { kind: 'tag', localValue: '2.0', remoteValue: '2.0' },
      },
    ]);

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();

    expect(trigger.digestBuffer.size).toBe(0);
    expect(triggerBatchSpy).not.toHaveBeenCalled();
    triggerBatchSpy.mockRestore();
  });

  test('flushDigestBuffer should not delete replacement when buffer entry is swapped during revalidation', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    // Buffer the original container under its stable digest key ('c1')
    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    const replacement = {
      id: 'c3',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '2.0', remoteValue: '3.0' },
    };

    // The store returns updateAvailable=false so the revalidation falls through
    // to the identity check at line 1324. Use the raw container mock to inject a
    // replacement into the buffer AFTER the snapshot is taken (the snapshot uses
    // Array.from, which runs before getContainersRaw is called for the store lookup).
    storeContainer.getContainersRaw.mockImplementation(() => {
      // Replace the buffer entry mid-revalidation — simulates a concurrent report
      trigger.digestBuffer.set('c1', replacement);
      return [
        {
          id: 'c1',
          name: 'app',
          watcher: 'test',
          updateAvailable: false,
          updateKind: { kind: 'tag', localValue: '2.0', remoteValue: '2.0' },
        },
      ];
    });

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();

    // The replacement should NOT have been deleted — the identity check prevents it
    expect(trigger.digestBuffer.size).toBe(1);
    expect(trigger.digestBuffer.get('c1')).toBe(replacement);
    // No dispatch because the store container has updateAvailable=false
    expect(triggerBatchSpy).not.toHaveBeenCalled();
    triggerBatchSpy.mockRestore();
  });

  test('flushDigestBuffer should use current store container when it still has an update', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    const storeContainer2 = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '3.0' },
    };
    storeContainer.getContainers.mockReturnValue([storeContainer2]);

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();

    expect(triggerBatchSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'app',
        updateKind: expect.objectContaining({ remoteValue: '3.0' }),
      }),
    ]);
    expect(trigger.digestBuffer.size).toBe(0);
    triggerBatchSpy.mockRestore();
  });

  test('flushDigestBuffer should use fallback fullName keys when digest containers lack notification keys', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        name: 'app',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    } as any);

    const currentContainer = {
      name: 'app',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '3.0' },
    };
    storeContainer.getContainersRaw.mockReturnValue([currentContainer] as any);

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();

    expect(triggerBatchSpy).toHaveBeenCalledWith([currentContainer]);
    expect(trigger.digestBuffer.size).toBe(0);
    triggerBatchSpy.mockRestore();
  });

  test('flushDigestBuffer should evict fallback-key containers when revalidation shows no update', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        name: 'app',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    } as any);

    storeContainer.getContainersRaw.mockReturnValue([
      {
        name: 'app',
        updateAvailable: false,
        updateKind: { kind: 'tag', localValue: '2.0', remoteValue: '2.0' },
      },
    ] as any);

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();

    expect(trigger.digestBuffer.size).toBe(0);
    expect(triggerBatchSpy).not.toHaveBeenCalled();
    triggerBatchSpy.mockRestore();
  });

  test('flushDigestBuffer should revalidate against raw store containers without redaction', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    storeContainer.getContainers.mockClear();
    storeContainer.getContainersRaw.mockClear();
    storeContainer.getContainersRaw.mockReturnValue([
      {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '3.0' },
        env: {
          SECRET_TOKEN: 'raw-secret',
        },
      },
    ]);

    storeContainer.getContainers.mockClear();
    storeContainer.getContainersRaw.mockClear();
    storeContainer.getContainersRaw.mockReturnValueOnce([
      {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '3.0' },
        env: {
          SECRET_TOKEN: 'raw-secret',
        },
      },
    ]);

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();

    expect(storeContainer.getContainersRaw).toHaveBeenCalledWith();
    expect(storeContainer.getContainers).not.toHaveBeenCalled();
    expect(triggerBatchSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        env: expect.objectContaining({
          SECRET_TOKEN: 'raw-secret',
        }),
      }),
    ]);
    triggerBatchSpy.mockRestore();
  });

  test('flushDigestBuffer should preserve replacements buffered during an in-flight flush', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    const replacement = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '2.0', remoteValue: '2.1' },
    };
    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockImplementationOnce(async () => {
      trigger.digestBuffer.set('c1', replacement);
    });

    await trigger.flushDigestBuffer();
    triggerBatchSpy.mockResolvedValueOnce(undefined);
    await trigger.flushDigestBuffer();

    expect(triggerBatchSpy).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({
        name: 'app',
        updateKind: expect.objectContaining({ remoteValue: '2.0' }),
      }),
    ]);
    expect(triggerBatchSpy).toHaveBeenNthCalledWith(2, [replacement]);
    triggerBatchSpy.mockRestore();
  });

  test('deregisterComponent should stop digest cron and clear buffer', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    await trigger.deregisterComponent();
    expect(mockStop).toHaveBeenCalled();

    // Buffer should be cleared — flush should be no-op
    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();
    expect(triggerBatchSpy).not.toHaveBeenCalled();
    triggerBatchSpy.mockRestore();
  });

  test('deregisterComponent should unregister agent-connected handlers', async () => {
    const unregisterAgentConnected = vi.fn();
    trigger.unregisterAgentConnected = unregisterAgentConnected;

    await trigger.deregisterComponent();

    expect(unregisterAgentConnected).toHaveBeenCalledTimes(1);
    expect(trigger.unregisterAgentConnected).toBeUndefined();
  });

  test('clearEventBatchDispatches should clear pending timers and buffered containers', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const timer = setTimeout(() => undefined, 1_000);
    const scheduledDispatch = {
      timer,
      containers: new Map([['test_app', { name: 'app', watcher: 'test' }]]),
    };
    const unscheduledDispatch = {
      containers: new Map([['test_web', { name: 'web', watcher: 'test' }]]),
    };

    (trigger as any).eventBatchDispatches.set('update-applied', scheduledDispatch);
    (trigger as any).eventBatchDispatches.set('update-failed', unscheduledDispatch);

    (trigger as any).clearEventBatchDispatches();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
    expect(scheduledDispatch.containers.size).toBe(0);
    expect(scheduledDispatch.timer).toBeUndefined();
    expect(unscheduledDispatch.containers.size).toBe(0);
    expect(unscheduledDispatch.timer).toBeUndefined();
    expect((trigger as any).eventBatchDispatches.size).toBe(0);
  });

  test('handleContainerUpdateAppliedEvent should evict container from digest buffer', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });
    await trigger.handleContainerReportDigest({
      container: {
        id: 'c2',
        name: 'web',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '3.0' },
      },
      changed: true,
    });

    // Simulate update applied for 'app' — uses full business ID (watcher_name)
    await trigger.handleContainerUpdateAppliedEvent('test_app');

    // Flush should only contain 'web'
    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();
    expect(triggerBatchSpy).toHaveBeenCalledWith([expect.objectContaining({ name: 'web' })]);
    triggerBatchSpy.mockRestore();
  });

  test('validateConfiguration should reject invalid digestcron expression', () => {
    vi.mocked(mockCron.validate).mockReturnValue(false);
    expect(() =>
      trigger.validateConfiguration({
        ...configurationValid,
        digestcron: 'not-a-cron',
      }),
    ).toThrow('digestcron must be a valid cron expression');
  });

  test('validateConfiguration should accept valid digestcron expression', () => {
    const validated = trigger.validateConfiguration({
      ...configurationValid,
      digestcron: '30 6 * * 1-5',
    });
    expect(validated.digestcron).toBe('30 6 * * 1-5');
  });

  test('flushDigestBuffer should log warning and increment error counter when triggerBatch throws', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    const triggerBatchSpy = vi
      .spyOn(trigger, 'triggerBatch')
      .mockRejectedValue(new Error('SMTP down'));
    await trigger.flushDigestBuffer();
    expect(triggerBatchSpy).toHaveBeenCalled();
    triggerBatchSpy.mockRestore();
  });

  test('flushDigestBuffer should audit failed digest deliveries', async () => {
    await trigger.register('trigger', 'smtp', 'gmail', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        image: {
          name: 'library/nginx',
        },
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    vi.spyOn(trigger, 'triggerBatch').mockRejectedValueOnce(new Error('SMTP down'));

    await trigger.flushDigestBuffer();

    expect(auditStore.insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'notification-delivery-failed',
        containerName: 'test_app',
        triggerName: 'smtp.gmail',
        status: 'error',
        details: 'SMTP down',
      }),
    );
  });

  test('flushDigestBuffer should retain buffered updates when triggerBatch throws', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    const triggerBatchSpy = vi
      .spyOn(trigger, 'triggerBatch')
      .mockRejectedValueOnce(new Error('SMTP down'))
      .mockResolvedValueOnce(undefined);

    await trigger.flushDigestBuffer();
    await trigger.flushDigestBuffer();

    expect(triggerBatchSpy).toHaveBeenCalledTimes(2);
    expect(triggerBatchSpy).toHaveBeenNthCalledWith(2, [expect.objectContaining({ name: 'app' })]);
    triggerBatchSpy.mockRestore();
  });

  test('flushDigestBuffer should use the accepted update batch path for action triggers', async () => {
    const actionTrigger = Object.create(Trigger.prototype) as any;
    actionTrigger.configuration = { ...configurationValid, mode: 'digest' };
    actionTrigger.type = 'docker';
    actionTrigger.log = trigger.log;
    actionTrigger.digestBuffer = new Map();
    actionTrigger.digestBufferUpdatedAt = new Map();
    actionTrigger.batchRetryBuffer = new Map();
    actionTrigger.batchRetryBufferUpdatedAt = new Map();
    actionTrigger.isDigestFlushInProgress = false;
    actionTrigger.pruneDigestBuffer = vi.fn();
    actionTrigger.deleteBufferedContainerEntry = vi.fn(
      (buffer: Map<string, unknown>, updatedAt: Map<string, unknown>, key: string) => {
        buffer.delete(key);
        updatedAt.delete(key);
        return true;
      },
    );
    actionTrigger.incrementTriggerCounter = vi.fn();
    actionTrigger.isUpdateActionTrigger = () => true;
    const runAcceptedUpdateBatch = vi.fn().mockResolvedValue(undefined);
    actionTrigger.runAcceptedUpdateBatch = runAcceptedUpdateBatch;
    actionTrigger.triggerBatch = vi.fn();

    const container = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    };
    actionTrigger.digestBuffer.set('c1', container as any);
    actionTrigger.digestBufferUpdatedAt = new Map([['c1', 1_000]]);
    storeContainer.getContainersRaw.mockReturnValue([container]);

    expect(actionTrigger.isUpdateActionTrigger()).toBe(true);

    await actionTrigger.flushDigestBuffer();
    expect(runAcceptedUpdateBatch).toHaveBeenCalledTimes(1);
    expect(actionTrigger.digestBuffer.size).toBe(0);
    expect(actionTrigger.digestBufferUpdatedAt.size).toBe(0);
  });

  test('handleContainerReports should use the accepted update batch path for action triggers', async () => {
    trigger.configuration.mode = 'batch';
    vi.spyOn(trigger as any, 'isUpdateActionTrigger').mockReturnValue(true);
    const runAcceptedUpdateBatchSpy = vi
      .spyOn(trigger as any, 'runAcceptedUpdateBatch')
      .mockResolvedValue(undefined);

    await trigger.handleContainerReports([
      {
        container: {
          id: 'c1',
          name: 'app',
          watcher: 'test',
          updateAvailable: true,
          updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
        },
        changed: true,
      } as any,
    ]);

    expect(runAcceptedUpdateBatchSpy).toHaveBeenCalledWith([expect.objectContaining({ id: 'c1' })]);
  });

  test('runAcceptedUpdateBatch should skip rejected-only batches', async () => {
    forceRejectedUpdateBatch.enabled = true;
    const debugSpy = vi.spyOn(trigger.log, 'debug').mockImplementation(() => undefined);
    try {
      await expect(
        (trigger as any).runAcceptedUpdateBatch([
          {
            id: 'c1',
            name: 'app',
            watcher: 'test',
            updateAvailable: false,
          },
        ]),
      ).resolves.toBeUndefined();
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('Skipped batched auto update'));
    } finally {
      debugSpy.mockRestore();
      forceRejectedUpdateBatch.enabled = false;
    }
  });

  test('runAcceptedUpdateBatch should log rejected batches with notification keys', async () => {
    forceRejectedUpdateBatch.enabled = true;
    const debugSpy = vi.spyOn(trigger.log, 'debug').mockImplementation(() => undefined);
    try {
      await expect(
        (trigger as any).runAcceptedUpdateBatch([
          {
            id: 'with-key',
            name: 'app',
            watcher: 'test',
            updateAvailable: false,
          },
        ]),
      ).resolves.toBeUndefined();
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('Skipped batched auto update'));
    } finally {
      debugSpy.mockRestore();
      forceRejectedUpdateBatch.enabled = false;
    }
  });

  test('runAcceptedUpdateBatch should fall back to fullName for rejected containers without a notification key', async () => {
    const debugSpy = vi.spyOn(trigger.log, 'debug').mockImplementation(() => undefined);
    try {
      await expect(
        (trigger as any).runAcceptedUpdateBatch([
          {
            updateAvailable: false,
          } as any,
        ]),
      ).resolves.toBeUndefined();
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipped batched auto update for undefined_undefined'),
      );
    } finally {
      debugSpy.mockRestore();
    }
  });

  test('handleUpdateAvailableSimpleTriggerError should skip update request errors', () => {
    const debugSpy = vi.spyOn(trigger.log, 'debug').mockImplementation(() => undefined);
    const error = new UpdateRequestError(400, 'No update available for this container');

    expect(
      (trigger as any).handleUpdateAvailableSimpleTriggerError(error, { id: 'c1' }, trigger.log),
    ).toBeUndefined();
    expect(debugSpy).toHaveBeenCalledWith(
      'Skipped auto update (No update available for this container)',
    );

    debugSpy.mockRestore();
  });

  test('runAcceptedUpdateBatch should execute accepted batches', async () => {
    trigger.type = 'docker';

    await expect(
      (trigger as any).runAcceptedUpdateBatch([
        {
          id: 'c1',
          name: 'app',
          watcher: 'test',
          updateAvailable: true,
          updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
        },
      ]),
    ).resolves.toBeUndefined();
  });

  test('digest cron callback should invoke flushDigestBuffer', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
      digestcron: '0 9 * * *',
    });
    trigger.init();

    // Get the cron callback that was registered
    const cronCallback = mockCron.schedule.mock.calls[0]?.[1];
    expect(cronCallback).toBeDefined();

    // Buffer a container and spy on flushDigestBuffer
    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    const flushSpy = vi.spyOn(trigger, 'flushDigestBuffer').mockResolvedValue(undefined);
    cronCallback();
    expect(flushSpy).toHaveBeenCalled();
    flushSpy.mockRestore();
  });

  test('digest mode report listener callback should forward report to digest handler', async () => {
    await trigger.register('trigger', 'test', 'digest-trigger', {
      ...configurationValid,
      mode: 'digest',
    });
    trigger.init();

    const reportCallback = vi.mocked(event.registerContainerReport).mock.calls[0]?.[0];
    expect(reportCallback).toBeDefined();

    const digestHandlerSpy = vi
      .spyOn(trigger, 'handleContainerReportDigest')
      .mockResolvedValue(undefined);
    const report = {
      container: {
        id: 'c42',
        name: 'api',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    };

    await reportCallback?.(report as any);

    expect(digestHandlerSpy).toHaveBeenCalledWith(report);
    digestHandlerSpy.mockRestore();
  });

  test('init should fall back to default digest cron when digestcron is missing at runtime', async () => {
    trigger.configuration = {
      ...configurationValid,
      auto: 'all',
      mode: 'digest',
      digestcron: undefined as unknown as string,
    };
    await trigger.init();

    expect(mockCron.schedule).toHaveBeenCalledWith('0 8 * * *', expect.any(Function));
  });
});

describe('batch+digest mode', () => {
  const mockStop = vi.fn();

  beforeEach(() => {
    mockStop.mockClear();
    vi.mocked(mockCron.schedule).mockReturnValue({ stop: mockStop } as any);
    vi.mocked(mockCron.validate).mockReturnValue(true);
    vi.mocked(event.registerContainerReport).mockReturnValue(vi.fn());
    vi.mocked(event.registerContainerReports).mockReturnValue(vi.fn());
    vi.mocked(event.registerContainerUpdateApplied).mockReturnValue(vi.fn());
    vi.mocked(event.registerContainerUpdateFailed).mockReturnValue(vi.fn());
    vi.mocked(event.registerSecurityAlert).mockReturnValue(vi.fn());
    vi.mocked(event.registerSecurityScanCycleComplete).mockReturnValue(vi.fn());
    vi.mocked(event.registerAgentConnected).mockReturnValue(vi.fn());
    vi.mocked(event.registerAgentDisconnected).mockReturnValue(vi.fn());
  });

  test('validateConfiguration should accept batch+digest mode', () => {
    const validated = trigger.validateConfiguration({
      ...configurationValid,
      mode: 'batch+digest',
    });
    expect(validated.mode).toBe('batch+digest');
  });

  test('init should register both batch and digest handlers and schedule digest cron', async () => {
    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
      digestcron: '0 9 * * *',
    });

    expect(event.registerContainerReports).toHaveBeenCalledTimes(1);
    expect(event.registerContainerReport).toHaveBeenCalledTimes(1);
    expect(mockCron.schedule).toHaveBeenCalledWith('0 9 * * *', expect.any(Function));
  });

  test('batch handler should fire immediately on scan results in batch+digest mode', async () => {
    let batchCallback;
    vi.mocked(event.registerContainerReports).mockImplementation((cb) => {
      batchCallback = cb;
      return vi.fn();
    });

    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
    });

    const report = {
      changed: true,
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
    };
    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    await batchCallback?.([report] as any);

    expect(triggerBatchSpy).toHaveBeenCalledWith([report.container]);
  });

  test('batch handler should keep same-name siblings distinct when ids differ', async () => {
    let batchCallback;
    vi.mocked(event.registerContainerReports).mockImplementation((cb) => {
      batchCallback = cb;
      return vi.fn();
    });

    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
    });

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    await batchCallback?.([
      {
        changed: true,
        container: {
          id: 'c1',
          name: 'tdarr_node',
          watcher: 'mediavault',
          updateAvailable: true,
          updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
        },
      },
      {
        changed: true,
        container: {
          id: 'c2',
          name: 'tdarr_node',
          watcher: 'mediavault',
          updateAvailable: true,
          updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
        },
      },
    ] as any);

    expect(triggerBatchSpy).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'c1', name: 'tdarr_node' }),
      expect.objectContaining({ id: 'c2', name: 'tdarr_node' }),
    ]);
  });

  test('batch handler should NOT drain digest buffer in batch+digest mode — digest fires independently', async () => {
    let batchCallback;
    vi.mocked(event.registerContainerReports).mockImplementation((cb) => {
      batchCallback = cb;
      return vi.fn();
    });

    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
    });

    const container = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    };

    // The per-container event fills the digest buffer
    await trigger.handleContainerReportDigest({
      container,
      changed: true,
    } as any);

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    storeContainer.getContainersRaw.mockReturnValue([container]);

    // The same scan cycle's batch event fires
    await batchCallback?.([{ container, changed: true }] as any);

    expect(triggerBatchSpy).toHaveBeenCalledWith([container]);
    // Digest buffer must retain the entry — the morning cron should still see it
    expect(trigger.digestBuffer.size).toBe(1);

    // Cron tick: digest flush dispatches the same container in a separate email
    const cronCallback = vi.mocked(mockCron.schedule).mock.calls[0]?.[1];
    triggerBatchSpy.mockClear();
    cronCallback?.();
    await Promise.resolve();

    expect(triggerBatchSpy).toHaveBeenCalledWith([container]);
  });

  test('batch handler should not evict from digest buffer when batch send fails', async () => {
    let batchCallback;
    vi.mocked(event.registerContainerReports).mockImplementation((cb) => {
      batchCallback = cb;
      return vi.fn();
    });

    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
    });

    const container = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    };

    // Pre-populate the digest buffer
    await trigger.handleContainerReportDigest({
      container,
      changed: true,
    } as any);

    // Batch send fails
    const triggerBatchSpy = vi
      .spyOn(trigger, 'triggerBatch')
      .mockRejectedValue(new Error('SMTP timeout'));

    await batchCallback?.([{ container, changed: true }] as any);

    // Buffer should still have the entry since batch failed
    triggerBatchSpy.mockResolvedValue(undefined);
    storeContainer.getContainersRaw.mockReturnValue([container]);

    const cronCallback = vi.mocked(mockCron.schedule).mock.calls[0]?.[1];
    cronCallback?.();
    await Promise.resolve();

    // Digest flush SHOULD still send because batch failed — entry was retained
    expect(triggerBatchSpy).toHaveBeenCalledWith([container]);
  });

  test('digest handler should buffer containers and flush them on cron in batch+digest mode', async () => {
    let digestCallback;
    vi.mocked(event.registerContainerReport).mockImplementation((cb) => {
      digestCallback = cb;
      return vi.fn();
    });

    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
      digestcron: '0 9 * * *',
    });

    const report = {
      changed: true,
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
    };
    const cronCallback = vi.mocked(mockCron.schedule).mock.calls[0]?.[1];
    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    await digestCallback?.(report as any);
    expect(triggerBatchSpy).not.toHaveBeenCalled();

    cronCallback?.();
    await Promise.resolve();

    expect(triggerBatchSpy).toHaveBeenCalledWith([report.container]);
  });

  test('handleContainerUpdateAppliedEvent should evict digest entries in batch+digest mode', async () => {
    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
    });
    storeContainer.getContainers.mockReturnValue([]);

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });
    await trigger.handleContainerReportDigest({
      container: {
        id: 'c2',
        name: 'web',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '3.0' },
      },
      changed: true,
    });

    await trigger.handleContainerUpdateAppliedEvent('test_app');

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();

    expect(triggerBatchSpy).toHaveBeenCalledWith([expect.objectContaining({ name: 'web' })]);
  });

  test('deregister should unregister both handlers, stop cron, and clear digest buffer', async () => {
    const unregisterBatch = vi.fn();
    const unregisterDigest = vi.fn();
    vi.mocked(event.registerContainerReports).mockReturnValue(unregisterBatch);
    vi.mocked(event.registerContainerReport).mockReturnValue(unregisterDigest);

    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
    });

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: true,
    });

    await trigger.deregister();

    expect(unregisterBatch).toHaveBeenCalledTimes(1);
    expect(unregisterDigest).toHaveBeenCalledTimes(1);
    expect(mockStop).toHaveBeenCalledTimes(1);

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    await trigger.flushDigestBuffer();
    expect(triggerBatchSpy).not.toHaveBeenCalled();
  });

  test('non-scan events should use event batch dispatch in batch+digest mode', async () => {
    vi.useFakeTimers();
    try {
      const containers = [
        {
          watcher: 'local',
          name: 'container1',
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'major' },
        },
        {
          watcher: 'local',
          name: 'container2',
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'major' },
        },
      ];
      await trigger.register('trigger', 'test', 'combined-trigger', {
        ...configurationValid,
        mode: 'batch+digest',
      });
      storeContainer.getContainers.mockReturnValue(containers);
      const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

      await trigger.handleContainerUpdateAppliedEvent('local_container1');
      await trigger.handleContainerUpdateAppliedEvent('local_container2');

      expect(triggerBatchSpy).not.toHaveBeenCalled();

      await vi.runOnlyPendingTimersAsync();

      expect(triggerBatchSpy).toHaveBeenCalledTimes(1);
      expect(triggerBatchSpy).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'container1',
          notificationEvent: {
            kind: 'update-applied',
          },
        }),
        expect.objectContaining({
          name: 'container2',
          notificationEvent: {
            kind: 'update-applied',
          },
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('digest handler re-buffers across scan cycles when the result hash changes', async () => {
    let digestCallback;
    let batchCallback;
    vi.mocked(event.registerContainerReport).mockImplementation((cb) => {
      digestCallback = cb;
      return vi.fn();
    });
    vi.mocked(event.registerContainerReports).mockImplementation((cb) => {
      batchCallback = cb;
      return vi.fn();
    });

    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
    });

    const initialContainer = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    };

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    // Scan cycle 1: batch fires and records update-available history
    await digestCallback?.({ container: initialContainer, changed: true } as any);
    await batchCallback?.([{ container: initialContainer, changed: true }] as any);

    expect(triggerBatchSpy).toHaveBeenCalledTimes(1);
    expect(trigger.digestBuffer.size).toBe(1);

    // Scan cycle 2 detects a new remote value — result hash changes
    const upgradedContainer = {
      ...initialContainer,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '3.0' },
    };
    await digestCallback?.({ container: upgradedContainer, changed: true } as any);

    // Buffer retains one entry per container key — the newer result overwrites
    expect(trigger.digestBuffer.size).toBe(1);
    const [bufferedContainer] = trigger.digestBuffer.values();
    expect(bufferedContainer.updateKind).toMatchObject({ remoteValue: '3.0' });
  });

  test('digest handler skips re-buffer when result hash unchanged and once=true', async () => {
    let digestCallback;
    let batchCallback;
    vi.mocked(event.registerContainerReport).mockImplementation((cb) => {
      digestCallback = cb;
      return vi.fn();
    });
    vi.mocked(event.registerContainerReports).mockImplementation((cb) => {
      batchCallback = cb;
      return vi.fn();
    });

    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
    });

    const container = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    };
    storeContainer.getContainersRaw.mockReturnValue([container]);

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    // Scan cycle 1: digest buffers + batch fires
    await digestCallback?.({ container, changed: true } as any);
    await batchCallback?.([{ container, changed: true }] as any);

    expect(triggerBatchSpy).toHaveBeenCalled();

    // Digest cron flushes, records update-available-digest history
    const cronCallback = vi.mocked(mockCron.schedule).mock.calls[0]?.[1];
    cronCallback?.();
    await Promise.resolve();

    // Reset: buffer is drained by the flush dispatch path
    expect(trigger.digestBuffer.size).toBe(0);

    // Scan cycle 2: same container, same hash — digest handler must not re-buffer
    await digestCallback?.({ container, changed: false } as any);
    expect(trigger.digestBuffer.size).toBe(0);
  });

  test('flushDigestBuffer records update-available-digest, not update-available', async () => {
    let digestCallback;
    vi.mocked(event.registerContainerReport).mockImplementation((cb) => {
      digestCallback = cb;
      return vi.fn();
    });

    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
    });

    const container = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    };
    storeContainer.getContainersRaw.mockReturnValue([container]);

    vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);
    const recordSpy = vi.spyOn(notificationHistoryStore, 'recordNotification');

    await digestCallback?.({ container, changed: true } as any);
    const cronCallback = vi.mocked(mockCron.schedule).mock.calls[0]?.[1];
    cronCallback?.();
    await Promise.resolve();

    const digestRecordCalls = recordSpy.mock.calls.filter(
      ([, , kind]) => kind === 'update-available-digest',
    );
    const batchRecordCalls = recordSpy.mock.calls.filter(
      ([, containerId, kind]) => containerId === 'c1' && kind === 'update-available',
    );
    expect(digestRecordCalls.length).toBeGreaterThan(0);
    expect(batchRecordCalls.length).toBe(0);
  });

  test('seedNotificationHistoryFromStore seeds only update-available for batch+digest mode (digest channel must NOT be seeded — #282)', async () => {
    const container = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    };
    storeContainer.getContainersRaw.mockReturnValue([container]);

    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
    });
    trigger.init();

    expect(
      notificationHistoryStore.getLastNotifiedHash(trigger.getId(), 'c1', 'update-available'),
    ).toBeDefined();
    // Digest history represents "a digest email was sent" — seeding it would
    // suppress the first cron after startup, leaving the morning digest
    // empty. The digest channel is populated exclusively by a successful
    // `flushUpdateDigestBuffer`.
    expect(
      notificationHistoryStore.getLastNotifiedHash(
        trigger.getId(),
        'c1',
        'update-available-digest',
      ),
    ).toBeUndefined();
  });

  test('seedNotificationHistoryFromStore seeds only update-available for pure batch mode', async () => {
    const container = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    };
    storeContainer.getContainersRaw.mockReturnValue([container]);

    await trigger.register('trigger', 'test', 'batch-only', {
      ...configurationValid,
      mode: 'batch',
    });
    trigger.init();

    expect(
      notificationHistoryStore.getLastNotifiedHash(trigger.getId(), 'c1', 'update-available'),
    ).toBeDefined();
    expect(
      notificationHistoryStore.getLastNotifiedHash(
        trigger.getId(),
        'c1',
        'update-available-digest',
      ),
    ).toBeUndefined();
  });

  test('seedNotificationHistoryFromStore skips containers without updates or stable ids', async () => {
    storeContainer.getContainersRaw.mockReturnValue([
      {
        id: 'skip-no-update',
        name: 'skip-no-update',
        watcher: 'test',
        updateAvailable: false,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      {
        id: '',
        name: 'skip-no-id',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
    ]);

    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
    });
    trigger.init();

    expect(
      notificationHistoryStore.getLastNotifiedHash(
        trigger.getId(),
        'skip-no-update',
        'update-available',
      ),
    ).toBeUndefined();
    expect(
      notificationHistoryStore.getLastNotifiedHash(trigger.getId(), '', 'update-available'),
    ).toBeUndefined();
    expect(
      notificationHistoryStore.getLastNotifiedHash(trigger.getId(), 'c1', 'update-available'),
    ).toBeDefined();
  });

  test('seedNotificationHistoryFromStore does not suppress first digest flush after startup (#282 regression)', async () => {
    let digestCallback: any;
    vi.mocked(event.registerContainerReport).mockImplementation((cb) => {
      digestCallback = cb;
      return vi.fn();
    });

    const container = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    };
    storeContainer.getContainersRaw.mockReturnValue([container]);

    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
    });
    trigger.init();

    // After seeding: batch channel is primed (prevents spurious re-batch),
    // but digest channel MUST be empty so the next scan can buffer.
    expect(
      notificationHistoryStore.getLastNotifiedHash(trigger.getId(), 'c1', 'update-available'),
    ).toBeDefined();
    expect(
      notificationHistoryStore.getLastNotifiedHash(
        trigger.getId(),
        'c1',
        'update-available-digest',
      ),
    ).toBeUndefined();

    // Simulate the next scan cycle emitting the same container (no hash change).
    // Pre-rc.9 fix: this would be silently dropped because the seeded
    // update-available-digest hash matched. Post-fix: container must land
    // in the digest buffer so the morning cron has something to send.
    await digestCallback?.({ container, changed: false } as any);

    expect(trigger.digestBuffer.size).toBe(1);
    expect(trigger.digestBuffer.get('c1')).toMatchObject({ id: 'c1' });
  });

  test('handleContainerReportDigest emits debug log on once+alreadyNotified skip', async () => {
    let digestCallback;
    vi.mocked(event.registerContainerReport).mockImplementation((cb) => {
      digestCallback = cb;
      return vi.fn();
    });

    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
    });

    const container = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
    };

    notificationHistoryStore.recordNotification(
      trigger.getId(),
      'c1',
      'update-available-digest',
      notificationHistoryStore.computeResultHash(container),
    );

    const debugSpy = vi.spyOn((trigger as any).log, 'debug');

    await digestCallback?.({ container, changed: false } as any);

    expect(trigger.digestBuffer.size).toBe(0);
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Skipping update-available digest buffer for .*alreadyBuffered=true/),
    );
  });

  test('handleContainerReportDigest falls back to once=false in skip logs when configuration.once is unset', async () => {
    await trigger.register('trigger', 'test', 'combined-trigger', {
      ...configurationValid,
      mode: 'batch+digest',
    });
    trigger.init();

    trigger.configuration.once = undefined;
    vi.spyOn(trigger as any, 'shouldHandleDigestContainerReport').mockReturnValue(false);
    const debugSpy = vi.spyOn((trigger as any).log, 'debug');

    await trigger.handleContainerReportDigest({
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
      changed: false,
    } as any);

    expect(trigger.digestBuffer.size).toBe(0);
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /Skipping update-available digest buffer for .*once=false, updateAvailable=true, alreadyBuffered=false/,
      ),
    );
  });

  test('shouldHandleDigestContainerReport reflects update availability and once=false fast path', () => {
    trigger.configuration.once = false;

    expect(
      (trigger as any).shouldHandleDigestContainerReport({
        container: {
          id: 'c1',
          name: 'app',
          watcher: 'test',
          updateAvailable: false,
        },
      }),
    ).toBe(false);

    expect(
      (trigger as any).shouldHandleDigestContainerReport({
        container: {
          id: 'c1',
          name: 'app',
          watcher: 'test',
          updateAvailable: true,
        },
      }),
    ).toBe(true);
  });
});

describe('notification history (once=true dedup)', () => {
  test('handleContainerReport should fire for same-name siblings on different hosts with different ids', async () => {
    await trigger.register('trigger', 'test', 'pushover', configurationValid);
    trigger.init();
    const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

    await trigger.handleContainerReport({
      changed: false,
      container: {
        id: 'id-datavault-tdarr',
        name: 'tdarr_node',
        watcher: 'datavault',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
        result: { tag: '2.0' },
      },
    });

    await trigger.handleContainerReport({
      changed: false,
      container: {
        id: 'id-tmvault-tdarr',
        name: 'tdarr_node',
        watcher: 'tmvault',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
        result: { tag: '2.0' },
      },
    });

    expect(triggerSpy).toHaveBeenCalledTimes(2);
    expect(triggerSpy.mock.calls[0]?.[0]).toMatchObject({
      id: 'id-datavault-tdarr',
      watcher: 'datavault',
    });
    expect(triggerSpy.mock.calls[1]?.[0]).toMatchObject({
      id: 'id-tmvault-tdarr',
      watcher: 'tmvault',
    });
  });

  test('handleContainerReport should not re-fire for an already-notified identical result', async () => {
    await trigger.register('trigger', 'test', 'pushover', configurationValid);
    trigger.init();
    const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

    const report = {
      changed: false,
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
        result: { tag: '2.0' },
      },
    };

    await trigger.handleContainerReport(report);
    await trigger.handleContainerReport(report);

    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  test('handleContainerReport should re-fire when the result hash changes (new tag)', async () => {
    await trigger.register('trigger', 'test', 'pushover', configurationValid);
    trigger.init();
    const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

    await trigger.handleContainerReport({
      changed: false,
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
        result: { tag: '2.0' },
      },
    });

    await trigger.handleContainerReport({
      changed: false,
      container: {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.1' },
        result: { tag: '2.1' },
      },
    });

    expect(triggerSpy).toHaveBeenCalledTimes(2);
  });

  test('handleContainerUpdateAppliedEvent clears update-available history so the same result can re-notify', async () => {
    await trigger.register('trigger', 'test', 'pushover', configurationValid);
    trigger.init();
    vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

    const container = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      result: { tag: '2.0' },
    };

    await trigger.handleContainerReport({ changed: false, container });
    expect(
      notificationHistoryStore.getLastNotifiedHash(trigger.getId(), 'c1', 'update-available'),
    ).toBeDefined();

    storeContainer.getContainersRaw.mockReturnValueOnce([container]);
    await trigger.handleContainerUpdateAppliedEvent({
      containerName: 'test_app',
      container,
    });

    expect(
      notificationHistoryStore.getLastNotifiedHash(trigger.getId(), 'c1', 'update-available'),
    ).toBeUndefined();
  });

  test('init seeds notification history from pre-existing update-available containers to avoid upgrade spam', async () => {
    const preExisting = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateDetectedAt: '2026-04-15T10:00:00Z',
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      result: { tag: '2.0' },
    };
    storeContainer.getContainers.mockReturnValue([preExisting]);

    await trigger.register('trigger', 'test', 'pushover', configurationValid);
    trigger.init();

    const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

    await trigger.handleContainerReport({ changed: false, container: preExisting });

    expect(triggerSpy).not.toHaveBeenCalled();
  });

  test('init does not seed when once=false', async () => {
    const preExisting = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      result: { tag: '2.0' },
    };
    storeContainer.getContainers.mockReturnValue([preExisting]);

    await trigger.register('trigger', 'test', 'pushover', {
      ...configurationValid,
      once: false,
    });
    trigger.init();

    // With once=false every scan fires — so no seeding needed.
    expect(
      notificationHistoryStore.getLastNotifiedHash(
        'trigger.test.pushover',
        'c1',
        'update-available',
      ),
    ).toBeUndefined();
  });
});

describe('security digest mode (SECURITYMODE=digest)', () => {
  const mockStop = vi.fn();

  beforeEach(() => {
    mockStop.mockClear();
    vi.mocked(mockCron.schedule).mockReturnValue({ stop: mockStop } as any);
    vi.mocked(mockCron.validate).mockReturnValue(true);
    vi.mocked(event.registerContainerReport).mockReturnValue(vi.fn());
    vi.mocked(event.registerContainerReports).mockReturnValue(vi.fn());
    vi.mocked(event.registerContainerUpdateApplied).mockReturnValue(vi.fn());
    vi.mocked(event.registerContainerUpdateFailed).mockReturnValue(vi.fn());
    vi.mocked(event.registerSecurityAlert).mockReturnValue(vi.fn());
    vi.mocked(event.registerSecurityScanCycleComplete).mockReturnValue(vi.fn());
    vi.mocked(event.registerAgentConnected).mockReturnValue(vi.fn());
    vi.mocked(event.registerAgentDisconnected).mockReturnValue(vi.fn());
  });

  test('validateConfiguration should accept securitymode=digest', () => {
    const validated = trigger.validateConfiguration({
      ...configurationValid,
      securitymode: 'digest',
    });
    expect(validated.securitymode).toBe('digest');
  });

  test('validateConfiguration should accept securitymode=batch+digest', () => {
    const validated = trigger.validateConfiguration({
      ...configurationValid,
      securitymode: 'batch+digest',
    });
    expect(validated.securitymode).toBe('batch+digest');
  });

  test('validateConfiguration should default securitymode to simple', () => {
    const validated = trigger.validateConfiguration(configurationValid);
    expect(validated.securitymode).toBe('simple');
  });

  test('validateConfiguration should reject invalid securitymode', () => {
    expect(() =>
      trigger.validateConfiguration({
        ...configurationValid,
        securitymode: 'turbo',
      }),
    ).toThrow();
  });

  test('validateConfiguration should accept securitydigesttitle and securitydigestbody', () => {
    const validated = trigger.validateConfiguration({
      ...configurationValid,
      securitymode: 'digest',
      securitydigesttitle: 'Custom title',
      securitydigestbody: 'Custom body',
    });
    expect(validated.securitydigesttitle).toBe('Custom title');
    expect(validated.securitydigestbody).toBe('Custom body');
  });

  test('init registers securityScanCycleComplete handler', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();
    expect(event.registerSecurityScanCycleComplete).toHaveBeenCalled();
  });

  test('deregisterComponent unregisters securityScanCycleComplete handler', async () => {
    const unregisterFn = vi.fn();
    vi.mocked(event.registerSecurityScanCycleComplete).mockReturnValue(unregisterFn);

    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();
    await trigger.deregisterComponent();
    expect(unregisterFn).toHaveBeenCalled();
  });

  test('init wires the registered securityScanCycleComplete callback to the trigger handler', async () => {
    let cycleCompleteCallback;
    vi.mocked(event.registerSecurityScanCycleComplete).mockImplementation((cb) => {
      cycleCompleteCallback = cb;
      return vi.fn();
    });

    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    const handlerSpy = vi
      .spyOn(trigger, 'handleSecurityScanCycleCompleteEvent')
      .mockResolvedValue(undefined);

    await trigger.init();

    const payload = {
      cycleId: 'cycle-001',
      scannedCount: 2,
      alertCount: 1,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
    };

    await cycleCompleteCallback?.(payload);

    expect(handlerSpy).toHaveBeenCalledWith(payload);
  });

  test('handleSecurityAlertEvent in simple mode dispatches immediately (unchanged)', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'simple',
    });
    trigger.init();

    const container = {
      id: 'c1',
      watcher: 'local',
      name: 'app',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    };
    const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

    await trigger.handleSecurityAlertEvent({
      containerName: 'local_app',
      details: 'high=1',
      container,
    });

    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect((trigger as any).securityDigestBuffer.size).toBe(0);
  });

  test('handleSecurityAlertEvent in digest mode without cycleId falls through to immediate dispatch', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    const container = {
      id: 'c1',
      watcher: 'local',
      name: 'app',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    };
    const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

    await trigger.handleSecurityAlertEvent({
      containerName: 'local_app',
      details: 'high=1',
      container,
      // no cycleId
    });

    // Without cycleId, falls back to immediate dispatch
    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect((trigger as any).securityDigestBuffer.size).toBe(0);
  });

  test('handleSecurityAlertEvent in digest mode with cycleId buffers the alert', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    const container = {
      id: 'c1',
      watcher: 'local',
      name: 'app',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    };
    const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

    await trigger.handleSecurityAlertEvent({
      containerName: 'local_app',
      details: 'high=1',
      container,
      cycleId: 'cycle-001',
      summary: { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 },
    });

    expect(triggerSpy).not.toHaveBeenCalled();
    const cycleBuffer = (trigger as any).securityDigestBuffer.get('cycle-001');
    expect(cycleBuffer).toBeDefined();
    expect(cycleBuffer.size).toBe(1);
  });

  test('handleSecurityAlertEvent falls back to payload values when container lookup and summary are missing', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    await trigger.handleSecurityAlertEvent({
      containerName: 'remote_agent-app',
      details: 'summary unavailable',
      cycleId: 'cycle-fallback',
    });

    const cycleBuffer = (trigger as any).securityDigestBuffer.get('cycle-fallback');
    expect(cycleBuffer).toBeDefined();
    expect(cycleBuffer.get('remote_agent-app')).toMatchObject({
      containerName: 'remote_agent-app',
      summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
    });
  });

  test('handleSecurityAlertEvent buffers multiple alerts independently by container key', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    const container1 = {
      id: 'c1',
      watcher: 'local',
      name: 'app1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    };
    const container2 = {
      id: 'c2',
      watcher: 'local',
      name: 'app2',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    };

    await trigger.handleSecurityAlertEvent({
      containerName: 'local_app1',
      details: 'high=1',
      container: container1,
      cycleId: 'cycle-001',
      summary: { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 },
    });
    await trigger.handleSecurityAlertEvent({
      containerName: 'local_app2',
      details: 'critical=2',
      container: container2,
      cycleId: 'cycle-001',
      summary: { critical: 2, high: 0, medium: 0, low: 0, unknown: 0 },
    });

    const cycleBuffer = (trigger as any).securityDigestBuffer.get('cycle-001');
    expect(cycleBuffer.size).toBe(2);
  });

  test('handleSecurityAlertEvent last-write-wins within same cycle for same container', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    const container = {
      id: 'c1',
      watcher: 'local',
      name: 'app',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    };

    await trigger.handleSecurityAlertEvent({
      containerName: 'local_app',
      details: 'high=1',
      container,
      cycleId: 'cycle-001',
      summary: { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 },
    });
    await trigger.handleSecurityAlertEvent({
      containerName: 'local_app',
      details: 'critical=3',
      container,
      cycleId: 'cycle-001',
      summary: { critical: 3, high: 0, medium: 0, low: 0, unknown: 0 },
    });

    const cycleBuffer = (trigger as any).securityDigestBuffer.get('cycle-001');
    expect(cycleBuffer.size).toBe(1);
    const entry = Array.from(cycleBuffer.values())[0];
    expect(entry.summary.critical).toBe(3);
  });

  test('handleSecurityAlertEvent falls back to containerName and an empty summary when details are missing', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    await trigger.handleSecurityAlertEvent({
      containerName: 'local_missing-app',
      details: '',
      cycleId: 'cycle-fallback',
    } as any);

    const cycleBuffer = (trigger as any).securityDigestBuffer.get('cycle-fallback');
    const entry = cycleBuffer.get('local_missing-app');
    expect(entry).toMatchObject({
      containerName: 'local_missing-app',
      summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
    });
  });

  test('overlapping cycles buffer independently by cycleId', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    const c1 = {
      id: 'c1',
      watcher: 'local',
      name: 'app1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    };
    const c2 = {
      id: 'c2',
      watcher: 'local',
      name: 'app2',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    };

    await trigger.handleSecurityAlertEvent({
      containerName: 'local_app1',
      details: '',
      container: c1,
      cycleId: 'cycle-A',
      summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
    });
    await trigger.handleSecurityAlertEvent({
      containerName: 'local_app2',
      details: '',
      container: c2,
      cycleId: 'cycle-B',
      summary: { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 },
    });

    expect((trigger as any).securityDigestBuffer.get('cycle-A').size).toBe(1);
    expect((trigger as any).securityDigestBuffer.get('cycle-B').size).toBe(1);
  });

  test('handleSecurityScanCycleCompleteEvent no-ops when securitymode is simple', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'simple',
    });
    trigger.init();

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    await trigger.handleSecurityScanCycleCompleteEvent({
      cycleId: 'cycle-001',
      scannedCount: 3,
      alertCount: 1,
    });

    expect(triggerBatchSpy).not.toHaveBeenCalled();
  });

  test('cycle-complete with zero buffered entries is a no-op (zero-alert suppression)', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    await trigger.handleSecurityScanCycleCompleteEvent({
      cycleId: 'cycle-empty',
      scannedCount: 5,
      alertCount: 0,
    });

    expect(triggerBatchSpy).not.toHaveBeenCalled();
  });

  test('cycle-complete flushes buffered entries and drains the buffer', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    const container = {
      id: 'c1',
      watcher: 'local',
      name: 'app',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    };
    await trigger.handleSecurityAlertEvent({
      containerName: 'local_app',
      details: 'critical=1',
      container,
      cycleId: 'cycle-001',
      summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
    });

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    await trigger.handleSecurityScanCycleCompleteEvent({
      cycleId: 'cycle-001',
      scannedCount: 3,
      alertCount: 1,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
    });

    expect(triggerBatchSpy).toHaveBeenCalledTimes(1);
    // Buffer should be drained after flush
    expect((trigger as any).securityDigestBuffer.has('cycle-001')).toBe(false);
  });

  test('cycle-complete falls back to the current time and logs failures when security digest dispatch fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T10:02:03.000Z'));

    try {
      await trigger.register('trigger', 'test', 'smtp', {
        ...configurationValid,
        mode: 'simple',
        securitymode: 'digest',
        securitydigesttitle: 'Started ${scan.startedAt}',
        securitydigestbody: 'Completed ${scan.completedAt}',
      });
      trigger.init();

      const container = {
        id: 'c1',
        watcher: 'local',
        name: 'app',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      };
      await trigger.handleSecurityAlertEvent({
        containerName: 'local_app',
        details: 'critical=1',
        container,
        cycleId: 'cycle-001',
        summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
      });

      const warnSpy = vi.spyOn(trigger.log, 'warn');
      const debugSpy = vi.spyOn(trigger.log, 'debug');
      let batchContext;
      const error = new Error('batch fail');
      const triggerBatchSpy = vi
        .spyOn(trigger, 'triggerBatch')
        .mockImplementation(async (_rows, runtimeContext) => {
          batchContext = runtimeContext;
          throw error;
        });

      await trigger.handleSecurityScanCycleCompleteEvent({
        cycleId: 'cycle-001',
        scannedCount: 3,
        alertCount: 1,
      });

      expect(batchContext).toMatchObject({
        eventKind: 'security-alert-digest',
        title: 'Started 2026-04-17T10:02:03.000Z',
        body: 'Completed 2026-04-17T10:02:03.000Z',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        'Security digest flush failed for cycle cycle-001 (batch fail)',
      );
      expect(debugSpy).toHaveBeenCalledWith(error);
      expect((trigger as any).securityDigestBuffer.has('cycle-001')).toBe(true);

      triggerBatchSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  test('cycle-complete sorts findings by severity and computes each severity bucket count', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
      securitydigesttitle:
        'c=${scan.criticalCount} h=${scan.highCount} m=${scan.mediumCount} l=${scan.lowCount} u=${scan.unknownCount}',
    });
    trigger.init();

    await trigger.handleSecurityAlertEvent({
      containerName: 'unknown-only',
      details: 'unknown=5',
      cycleId: 'cycle-severity-order',
      summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 5 },
    });
    await trigger.handleSecurityAlertEvent({
      containerName: 'unknown-only-2',
      details: 'unknown=1',
      cycleId: 'cycle-severity-order',
      summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 1 },
    });
    await trigger.handleSecurityAlertEvent({
      containerName: 'low-only',
      details: 'low=4',
      cycleId: 'cycle-severity-order',
      summary: { critical: 0, high: 0, medium: 0, low: 4, unknown: 0 },
    });
    await trigger.handleSecurityAlertEvent({
      containerName: 'medium-only',
      details: 'medium=3',
      cycleId: 'cycle-severity-order',
      summary: { critical: 0, high: 0, medium: 3, low: 0, unknown: 0 },
    });
    await trigger.handleSecurityAlertEvent({
      containerName: 'high-only',
      details: 'high=2',
      cycleId: 'cycle-severity-order',
      summary: { critical: 0, high: 2, medium: 0, low: 0, unknown: 0 },
    });
    await trigger.handleSecurityAlertEvent({
      containerName: 'critical-only',
      details: 'critical=1',
      cycleId: 'cycle-severity-order',
      summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
    });

    let batchContext: { eventKind: string; title: string; body: string } | undefined;
    let batchRows:
      | Array<{
          name: string;
          critical: number;
          high: number;
          medium: number;
          low: number;
          unknown: number;
        }>
      | undefined;
    const triggerBatchSpy = vi
      .spyOn(trigger, 'triggerBatch')
      .mockImplementation(async (rows, runtimeContext) => {
        batchRows = rows as Array<{
          name: string;
          critical: number;
          high: number;
          medium: number;
          low: number;
          unknown: number;
        }>;
        batchContext = runtimeContext as { eventKind: string; title: string; body: string };
      });

    await trigger.handleSecurityScanCycleCompleteEvent({
      cycleId: 'cycle-severity-order',
      scannedCount: 6,
      alertCount: 6,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
    });

    expect(triggerBatchSpy).toHaveBeenCalledTimes(1);
    expect(batchRows).toEqual([
      { name: 'critical-only', critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
      { name: 'high-only', critical: 0, high: 2, medium: 0, low: 0, unknown: 0 },
      { name: 'medium-only', critical: 0, high: 0, medium: 3, low: 0, unknown: 0 },
      { name: 'low-only', critical: 0, high: 0, medium: 0, low: 4, unknown: 0 },
      { name: 'unknown-only', critical: 0, high: 0, medium: 0, low: 0, unknown: 5 },
      { name: 'unknown-only-2', critical: 0, high: 0, medium: 0, low: 0, unknown: 1 },
    ]);
    expect(batchContext).toMatchObject({
      eventKind: 'security-alert-digest',
      title: 'c=1 h=1 m=1 l=1 u=2',
    });
  });

  test('cycle-complete is idempotent: second call with same cycleId is a no-op', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    const container = {
      id: 'c1',
      watcher: 'local',
      name: 'app',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    };
    await trigger.handleSecurityAlertEvent({
      containerName: 'local_app',
      details: 'critical=1',
      container,
      cycleId: 'cycle-001',
      summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
    });

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    await trigger.handleSecurityScanCycleCompleteEvent({
      cycleId: 'cycle-001',
      scannedCount: 1,
      alertCount: 1,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
    });

    // Second call — buffer already drained
    await trigger.handleSecurityScanCycleCompleteEvent({
      cycleId: 'cycle-001',
      scannedCount: 1,
      alertCount: 1,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
    });

    // triggerBatch called only once (first flush)
    expect(triggerBatchSpy).toHaveBeenCalledTimes(1);
  });

  test('overlapping cycles flush independently: each cycle-complete drains only its own entries', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    const c1 = {
      id: 'c1',
      watcher: 'local',
      name: 'app1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    };
    const c2 = {
      id: 'c2',
      watcher: 'local',
      name: 'app2',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    };

    await trigger.handleSecurityAlertEvent({
      containerName: 'local_app1',
      details: '',
      container: c1,
      cycleId: 'cycle-A',
      summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
    });
    await trigger.handleSecurityAlertEvent({
      containerName: 'local_app2',
      details: '',
      container: c2,
      cycleId: 'cycle-B',
      summary: { critical: 0, high: 2, medium: 0, low: 0, unknown: 0 },
    });

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    // Flush cycle-A only
    await trigger.handleSecurityScanCycleCompleteEvent({
      cycleId: 'cycle-A',
      scannedCount: 1,
      alertCount: 1,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
    });

    expect(triggerBatchSpy).toHaveBeenCalledTimes(1);
    // cycle-B still buffered
    expect((trigger as any).securityDigestBuffer.has('cycle-B')).toBe(true);
    expect((trigger as any).securityDigestBuffer.get('cycle-B').size).toBe(1);

    // Now flush cycle-B
    await trigger.handleSecurityScanCycleCompleteEvent({
      cycleId: 'cycle-B',
      scannedCount: 1,
      alertCount: 1,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
    });

    expect(triggerBatchSpy).toHaveBeenCalledTimes(2);
    expect((trigger as any).securityDigestBuffer.has('cycle-B')).toBe(false);
  });

  test('cycle-complete sorts security digest rows by severity before dispatch', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    await trigger.handleSecurityAlertEvent({
      containerName: 'local_high-app',
      details: 'high=1',
      container: {
        id: 'c1',
        watcher: 'local',
        name: 'high-app',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
      cycleId: 'cycle-001',
      summary: { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 },
    });
    await trigger.handleSecurityAlertEvent({
      containerName: 'local_critical-app',
      details: 'critical=1',
      container: {
        id: 'c2',
        watcher: 'local',
        name: 'critical-app',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
      cycleId: 'cycle-001',
      summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
    });

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    await trigger.handleSecurityScanCycleCompleteEvent({
      cycleId: 'cycle-001',
      scannedCount: 2,
      alertCount: 2,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
    });

    expect(triggerBatchSpy).toHaveBeenCalledWith(
      [
        expect.objectContaining({ name: 'local_critical-app', critical: 1, high: 0 }),
        expect.objectContaining({ name: 'local_high-app', critical: 0, high: 1 }),
      ],
      expect.objectContaining({ eventKind: 'security-alert-digest' }),
    );
  });

  test('cycle-complete tracks medium, low, and unknown findings in severity order', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
      securitydigesttitle:
        'medium=${scan.mediumCount}, low=${scan.lowCount}, unknown=${scan.unknownCount}',
    });
    trigger.init();

    await trigger.handleSecurityAlertEvent({
      containerName: 'local_low-app',
      details: 'low=1',
      container: {
        id: 'c1',
        watcher: 'local',
        name: 'low-app',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
      cycleId: 'cycle-xyz',
      summary: { critical: 0, high: 0, medium: 0, low: 1, unknown: 0 },
    });
    await trigger.handleSecurityAlertEvent({
      containerName: 'local_unknown-app',
      details: 'unknown=1',
      container: {
        id: 'c2',
        watcher: 'local',
        name: 'unknown-app',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
      cycleId: 'cycle-xyz',
      summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 1 },
    });
    await trigger.handleSecurityAlertEvent({
      containerName: 'local_medium-app',
      details: 'medium=1',
      container: {
        id: 'c3',
        watcher: 'local',
        name: 'medium-app',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
      cycleId: 'cycle-xyz',
      summary: { critical: 0, high: 0, medium: 1, low: 0, unknown: 0 },
    });

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    await trigger.handleSecurityScanCycleCompleteEvent({
      cycleId: 'cycle-xyz',
      scannedCount: 3,
      alertCount: 3,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
    });

    expect(triggerBatchSpy).toHaveBeenCalledWith(
      [
        expect.objectContaining({ name: 'local_medium-app', medium: 1, low: 0, unknown: 0 }),
        expect.objectContaining({ name: 'local_low-app', medium: 0, low: 1, unknown: 0 }),
        expect.objectContaining({ name: 'local_unknown-app', medium: 0, low: 0, unknown: 1 }),
      ],
      expect.objectContaining({
        eventKind: 'security-alert-digest',
        title: 'medium=1, low=1, unknown=1',
      }),
    );
  });

  test('flushDigestBuffer warns and skips security digest flushes without complete cycle metadata', async () => {
    const flushSecurityDigestBufferSpy = vi
      .spyOn(trigger as any, 'flushSecurityDigestBuffer')
      .mockResolvedValue(undefined);

    await trigger.flushDigestBuffer({
      eventKind: 'security-alert-digest',
      cyclePayload: {
        cycleId: 'cycle-001',
        scannedCount: 3,
        alertCount: 1,
      } as any,
    });
    await trigger.flushDigestBuffer({
      eventKind: 'security-alert-digest',
      cycleId: 'cycle-001',
    });

    expect(trigger.log.warn).toHaveBeenCalledTimes(2);
    expect(trigger.log.warn).toHaveBeenNthCalledWith(
      1,
      'flushDigestBuffer called for security-alert-digest without cycleId/cyclePayload — skipping',
    );
    expect(trigger.log.warn).toHaveBeenNthCalledWith(
      2,
      'flushDigestBuffer called for security-alert-digest without cycleId/cyclePayload — skipping',
    );
    expect(flushSecurityDigestBufferSpy).not.toHaveBeenCalled();
  });

  test('seedNotificationHistoryFromStore seeds security-alert-digest for digest-capable securitymode', async () => {
    const preExisting = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      result: { tag: '2.0' },
    };
    storeContainer.getContainers.mockReturnValue([preExisting]);

    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
      once: true,
    });

    // Verify that recordNotification was called for security-alert-digest
    const calls = (notificationHistoryStore.recordNotification as ReturnType<typeof vi.fn>).mock
      .calls;
    const secDigestCalls = calls.filter((call: unknown[]) => call[2] === 'security-alert-digest');
    expect(secDigestCalls.length).toBeGreaterThan(0);
    expect(secDigestCalls[0]?.[0]).toBe(trigger.getId());
    expect(secDigestCalls[0]?.[1]).toBe('c1');
  });

  test('seedNotificationHistoryFromStore does NOT seed security-alert-digest for simple securitymode', async () => {
    const preExisting = {
      id: 'c1',
      name: 'app',
      watcher: 'test',
      updateAvailable: true,
      updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      result: { tag: '2.0' },
    };
    storeContainer.getContainers.mockReturnValue([preExisting]);

    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'simple',
      once: true,
    });

    // Should NOT have been called for security-alert-digest
    const calls = (notificationHistoryStore.recordNotification as ReturnType<typeof vi.fn>).mock
      .calls;
    const secDigestCalls = calls.filter((call: unknown[]) => call[2] === 'security-alert-digest');
    expect(secDigestCalls).toHaveLength(0);
  });

  test('deregisterComponent clears securityDigestBuffer', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    // Buffer a security alert
    await trigger.handleSecurityAlertEvent({
      containerName: 'local_app',
      details: 'critical=1',
      container: {
        id: 'c1',
        watcher: 'local',
        name: 'app',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
      cycleId: 'cycle-001',
      summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
    });

    expect((trigger as any).securityDigestBuffer.size).toBeGreaterThan(0);
    await trigger.deregisterComponent();
    expect((trigger as any).securityDigestBuffer.size).toBe(0);
  });
});

describe('security digest templates (6.7)', () => {
  const mockStop = vi.fn();

  beforeEach(() => {
    mockStop.mockClear();
    vi.mocked(mockCron.schedule).mockReturnValue({ stop: mockStop } as any);
    vi.mocked(mockCron.validate).mockReturnValue(true);
    vi.mocked(event.registerContainerReport).mockReturnValue(vi.fn());
    vi.mocked(event.registerContainerReports).mockReturnValue(vi.fn());
    vi.mocked(event.registerContainerUpdateApplied).mockReturnValue(vi.fn());
    vi.mocked(event.registerContainerUpdateFailed).mockReturnValue(vi.fn());
    vi.mocked(event.registerSecurityAlert).mockReturnValue(vi.fn());
    vi.mocked(event.registerSecurityScanCycleComplete).mockReturnValue(vi.fn());
    vi.mocked(event.registerAgentConnected).mockReturnValue(vi.fn());
    vi.mocked(event.registerAgentDisconnected).mockReturnValue(vi.fn());
  });

  test('default security digest title uses alertCount', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    const ctx = {
      kind: 'security' as const,
      containers: [{ name: 'app', critical: 1, high: 0, medium: 0, low: 0, unknown: 0 }],
      scannedCount: 3,
      alertCount: 1,
      criticalCount: 1,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      unknownCount: 0,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
      cycleId: 'cycle-001',
    };

    const title = (trigger as any).formatDigestTitle('security-alert-digest', ctx);
    expect(title).toContain('1 container with findings');
  });

  test('default security digest title pluralizes for multiple containers', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    const ctx = {
      kind: 'security' as const,
      containers: [],
      scannedCount: 5,
      alertCount: 3,
      criticalCount: 2,
      highCount: 1,
      mediumCount: 0,
      lowCount: 0,
      unknownCount: 0,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
      cycleId: 'cycle-001',
    };

    const title = (trigger as any).formatDigestTitle('security-alert-digest', ctx);
    expect(title).toContain('3 containers with findings');
  });

  test('formatDigestBody reuses the batch body renderer for update digests', () => {
    const containers = [
      {
        id: 'c1',
        name: 'app',
        watcher: 'local',
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '2.0' },
      },
    ] as any;

    expect(
      (trigger as any).formatDigestBody('update-available-digest', {
        kind: 'update',
        containers,
      }),
    ).toBe(trigger.renderBatchBody(containers));
  });

  test('custom securitydigesttitle overrides default', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
      securitydigesttitle: 'Scan done: ${scan.alertCount} alerts',
    });
    trigger.init();

    const ctx = {
      kind: 'security' as const,
      containers: [],
      scannedCount: 2,
      alertCount: 5,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      unknownCount: 0,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
      cycleId: 'cycle-001',
    };

    const title = (trigger as any).formatDigestTitle('security-alert-digest', ctx);
    expect(title).toBe('Scan done: 5 alerts');
  });

  test('renderSecurityDigestTemplate falls back to the raw template on syntax errors', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    const malformedTemplate = 'Alerts: ${scan.alertCount';
    const ctx = {
      kind: 'security' as const,
      containers: [],
      scannedCount: 2,
      alertCount: 5,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      unknownCount: 0,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
      cycleId: 'cycle-001',
    };

    expect((trigger as any).renderSecurityDigestTemplate(malformedTemplate, ctx)).toBe(
      malformedTemplate,
    );
  });

  test('default security digest body includes scan metadata', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    const ctx = {
      kind: 'security' as const,
      containers: [
        { name: 'nginx', critical: 2, high: 0, medium: 0, low: 0, unknown: 0 },
        { name: 'redis', critical: 0, high: 1, medium: 0, low: 0, unknown: 0 },
      ],
      scannedCount: 5,
      alertCount: 2,
      criticalCount: 1,
      highCount: 1,
      mediumCount: 0,
      lowCount: 0,
      unknownCount: 0,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
      cycleId: 'cycle-001',
    };

    const body = (trigger as any).formatDigestBody('security-alert-digest', ctx);
    expect(body).toContain('2 of 5 containers have findings');
    expect(body).toContain('2026-04-17T10:00:00.000Z');
  });

  test('custom securitydigestbody overrides default', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
      securitydigestbody: 'Containers scanned: ${scan.scannedCount}',
    });
    trigger.init();

    const ctx = {
      kind: 'security' as const,
      containers: [],
      scannedCount: 7,
      alertCount: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      unknownCount: 0,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
      cycleId: 'cycle-001',
    };

    const body = (trigger as any).formatDigestBody('security-alert-digest', ctx);
    expect(body).toBe('Containers scanned: 7');
  });

  test('formatDigestTitle for update-available-digest uses batch title', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'digest',
      securitymode: 'digest',
    });
    trigger.init();

    const containers = [
      {
        id: 'c1',
        name: 'app',
        watcher: 'test',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
    ];
    const ctx = { kind: 'update' as const, containers: containers as any };

    const title = (trigger as any).formatDigestTitle('update-available-digest', ctx);
    expect(title).toContain('1');
  });

  test('triggerBatch is called with security digest context title and body on flush', async () => {
    await trigger.register('trigger', 'test', 'smtp', {
      ...configurationValid,
      mode: 'simple',
      securitymode: 'digest',
    });
    trigger.init();

    const container = {
      id: 'c1',
      watcher: 'local',
      name: 'vuln-app',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    };
    await trigger.handleSecurityAlertEvent({
      containerName: 'local_vuln-app',
      details: 'critical=3',
      container,
      cycleId: 'cycle-001',
      summary: { critical: 3, high: 0, medium: 0, low: 0, unknown: 0 },
    });

    const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

    await trigger.handleSecurityScanCycleCompleteEvent({
      cycleId: 'cycle-001',
      scannedCount: 2,
      alertCount: 1,
      startedAt: '2026-04-17T10:00:00.000Z',
      completedAt: '2026-04-17T10:01:00.000Z',
    });

    expect(triggerBatchSpy).toHaveBeenCalledTimes(1);
    // The second argument (runtimeContext) should carry title and body
    const callArgs = triggerBatchSpy.mock.calls[0];
    expect(callArgs?.[1]).toMatchObject({
      eventKind: 'security-alert-digest',
    });
    expect((callArgs?.[1] as any).title).toContain('1 container with findings');
  });
});

// ---------------------------------------------------------------------------
// emitAutoUpdateBlockedAuditOnTransition + clearAutoUpdateBlockedForContainerKey
// ---------------------------------------------------------------------------

test('handleUpdateAvailableSimpleTriggerError should emit auto-update-blocked audit on first UpdateRequestError', () => {
  const error = new UpdateRequestError(400, 'snooze active');
  const container = { id: 'c1', name: 'web', watcher: 'local' } as any;

  (trigger as any).handleUpdateAvailableSimpleTriggerError(error, container, trigger.log);

  expect(auditStore.insertAudit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'auto-update-blocked',
      details: expect.stringContaining('snooze active'),
    }),
  );
});

test('handleUpdateAvailableSimpleTriggerError should not emit duplicate audit for same container+reason', () => {
  const error = new UpdateRequestError(400, 'snooze active');
  const container = { id: 'c1', name: 'web', watcher: 'local' } as any;

  (trigger as any).handleUpdateAvailableSimpleTriggerError(error, container, trigger.log);
  (trigger as any).handleUpdateAvailableSimpleTriggerError(error, container, trigger.log);

  // insertAudit should only have been called once (second call is deduped)
  expect(auditStore.insertAudit).toHaveBeenCalledTimes(1);
});

test('handleContainerUpdateApplied clears auto-update-blocked dedup so next block emits a fresh audit', async () => {
  const error = new UpdateRequestError(400, 'snooze active');
  // Container with no id so fullName ('local_web') is used as the notification key
  const container = { name: 'web', watcher: 'local' } as any;
  // Second container with a different key — ensures the false-branch of startsWith is exercised
  const otherContainer = { name: 'db', watcher: 'local' } as any;

  // Emit audit for both containers
  (trigger as any).handleUpdateAvailableSimpleTriggerError(error, container, trigger.log);
  (trigger as any).handleUpdateAvailableSimpleTriggerError(error, otherContainer, trigger.log);
  expect(auditStore.insertAudit).toHaveBeenCalledTimes(2);

  // Simulate update applied for 'web' only — should clear 'local_web|*' but not 'local_db|*'
  trigger.notificationResults = new Map();
  trigger.notificationResults.set('local_web', { messageId: '1' });
  trigger.dismiss = vi.fn().mockResolvedValue(undefined);
  await trigger.handleContainerUpdateApplied({ containerName: 'local_web', container } as any);

  // Reset the insertAudit mock call count
  (auditStore.insertAudit as ReturnType<typeof vi.fn>).mockClear();

  // 'web' dedup cleared — should emit again
  (trigger as any).handleUpdateAvailableSimpleTriggerError(error, container, trigger.log);
  expect(auditStore.insertAudit).toHaveBeenCalledTimes(1);

  // 'db' was NOT cleared — still deduped
  (trigger as any).handleUpdateAvailableSimpleTriggerError(error, otherContainer, trigger.log);
  expect(auditStore.insertAudit).toHaveBeenCalledTimes(1); // still 1, no new call
});

test('runAcceptedUpdateBatch should emit auto-update-blocked audit for rejected entries', async () => {
  forceRejectedUpdateBatch.enabled = true;
  try {
    await (trigger as any).runAcceptedUpdateBatch([
      { id: 'c1', name: 'app', watcher: 'test', updateAvailable: false },
    ]);
    expect(auditStore.insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auto-update-blocked' }),
    );
  } finally {
    forceRejectedUpdateBatch.enabled = false;
  }
});
