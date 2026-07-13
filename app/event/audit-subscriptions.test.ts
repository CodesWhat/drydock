import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ContainerReport } from '../model/container.js';
import type { AuditSubscriptionRegistrars } from './audit-subscriptions.js';
import {
  clearAuditSubscriptionCachesForTests,
  registerAuditLogSubscriptions,
} from './audit-subscriptions.js';
import type {
  AgentDisconnectedEventPayload,
  ContainerHealthTransitionEventPayload,
  ContainerLifecycleEventPayload,
  ContainerUpdateAppliedEvent,
  ContainerUpdateFailedEventPayload,
  SecurityAlertEventPayload,
} from './index.js';

const { mockInsertAudit, mockInc, mockGetAuditCounter, mockGetUpdateAvailableDedupeMs } =
  vi.hoisted(() => ({
    mockInsertAudit: vi.fn(),
    mockInc: vi.fn(),
    mockGetAuditCounter: vi.fn(),
    mockGetUpdateAvailableDedupeMs: vi.fn(() => 60 * 60 * 1000),
  }));

vi.mock('../configuration/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../configuration/index.js')>()),
  getAuditUpdateAvailableDedupeMs: mockGetUpdateAvailableDedupeMs,
}));

vi.mock('../store/audit.js', () => ({
  insertAudit: mockInsertAudit,
}));

vi.mock('../prometheus/audit.js', () => ({
  getAuditCounter: mockGetAuditCounter,
}));

type OrderedEventHandlerFn<TPayload> = (payload: TPayload) => void | Promise<void>;

function setupAuditSubscriptions(): {
  containerReportHandler: OrderedEventHandlerFn<ContainerReport>;
  containerUpdateAppliedHandler: OrderedEventHandlerFn<ContainerUpdateAppliedEvent>;
  securityAlertHandler: OrderedEventHandlerFn<SecurityAlertEventPayload>;
  containerHealthTransitionHandler: OrderedEventHandlerFn<ContainerHealthTransitionEventPayload>;
  agentDisconnectedHandler: OrderedEventHandlerFn<AgentDisconnectedEventPayload>;
  containerAddedHandler: (payload: ContainerLifecycleEventPayload) => void;
  containerUpdatedHandler: (payload: ContainerLifecycleEventPayload) => void;
  containerRemovedHandler: (payload: ContainerLifecycleEventPayload) => void;
} {
  const handlers: {
    containerReport?: OrderedEventHandlerFn<ContainerReport>;
    containerUpdateApplied?: OrderedEventHandlerFn<ContainerUpdateAppliedEvent>;
    securityAlert?: OrderedEventHandlerFn<SecurityAlertEventPayload>;
    containerHealthTransition?: OrderedEventHandlerFn<ContainerHealthTransitionEventPayload>;
    agentDisconnected?: OrderedEventHandlerFn<AgentDisconnectedEventPayload>;
    containerAdded?: (payload: ContainerLifecycleEventPayload) => void;
    containerUpdated?: (payload: ContainerLifecycleEventPayload) => void;
    containerRemoved?: (payload: ContainerLifecycleEventPayload) => void;
  } = {};

  const registerOrdered =
    <TPayload>(assign: (handler: OrderedEventHandlerFn<TPayload>) => void) =>
    (handler: OrderedEventHandlerFn<TPayload>) => {
      assign(handler);
      return () => {};
    };

  const registerEvent =
    <TPayload>(assign: (handler: (payload: TPayload) => void) => void) =>
    (handler: (payload: TPayload) => void) => {
      assign(handler);
    };

  const registrars: AuditSubscriptionRegistrars = {
    registerContainerReport: registerOrdered<ContainerReport>((handler) => {
      handlers.containerReport = handler;
    }),
    registerContainerUpdateApplied: registerOrdered<ContainerUpdateAppliedEvent>((handler) => {
      handlers.containerUpdateApplied = handler;
    }),
    registerContainerUpdateFailed: registerOrdered<ContainerUpdateFailedEventPayload>(() => {}),
    registerSecurityAlert: registerOrdered<SecurityAlertEventPayload>((handler) => {
      handlers.securityAlert = handler;
    }),
    registerContainerHealthTransition: registerOrdered<ContainerHealthTransitionEventPayload>(
      (handler) => {
        handlers.containerHealthTransition = handler;
      },
    ),
    registerAgentDisconnected: registerOrdered<AgentDisconnectedEventPayload>((handler) => {
      handlers.agentDisconnected = handler;
    }),
    registerContainerAdded: registerEvent<ContainerLifecycleEventPayload>((handler) => {
      handlers.containerAdded = handler;
    }),
    registerContainerUpdated: registerEvent<ContainerLifecycleEventPayload>((handler) => {
      handlers.containerUpdated = handler;
    }),
    registerContainerRemoved: registerEvent<ContainerLifecycleEventPayload>((handler) => {
      handlers.containerRemoved = handler;
    }),
  };

  registerAuditLogSubscriptions(registrars);

  if (
    !handlers.containerReport ||
    !handlers.containerUpdateApplied ||
    !handlers.securityAlert ||
    !handlers.containerHealthTransition ||
    !handlers.agentDisconnected ||
    !handlers.containerAdded ||
    !handlers.containerUpdated ||
    !handlers.containerRemoved
  ) {
    throw new Error('Expected audit handlers to be registered');
  }

  return {
    containerReportHandler: handlers.containerReport,
    containerUpdateAppliedHandler: handlers.containerUpdateApplied,
    securityAlertHandler: handlers.securityAlert,
    containerHealthTransitionHandler: handlers.containerHealthTransition,
    agentDisconnectedHandler: handlers.agentDisconnected,
    containerAddedHandler: handlers.containerAdded,
    containerUpdatedHandler: handlers.containerUpdated,
    containerRemovedHandler: handlers.containerRemoved,
  };
}

function makeLifecyclePayload(
  overrides: Partial<ContainerLifecycleEventPayload> = {},
): ContainerLifecycleEventPayload {
  return {
    id: 'container-1',
    name: 'web',
    watcher: 'docker',
    agent: 'edge-a',
    status: 'running',
    image: { name: 'library/nginx' },
    result: { tag: '1.27.0', digest: 'sha256:one' },
    ...overrides,
  } as unknown as ContainerLifecycleEventPayload;
}

describe('audit-subscriptions dedupe windows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    clearAuditSubscriptionCachesForTests();
    mockGetAuditCounter.mockReturnValue({ inc: mockInc });
    mockGetUpdateAvailableDedupeMs.mockReturnValue(60 * 60 * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
    clearAuditSubscriptionCachesForTests();
  });

  test('records update severity for notification bell thresholds', async () => {
    const { containerReportHandler } = setupAuditSubscriptions();
    await containerReportHandler({
      container: {
        name: 'api',
        image: { name: 'acme/api' },
        updateAvailable: true,
        updateKind: {
          kind: 'tag',
          localValue: '1.0.0',
          remoteValue: '2.0.0',
          semverDiff: 'major',
        },
      },
      changed: true,
    } as ContainerReport);

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update-available',
        updateKind: 'tag',
        semverDiff: 'major',
      }),
    );
  });

  test('records digest update kind for notification bell thresholds', async () => {
    const { containerReportHandler } = setupAuditSubscriptions();
    await containerReportHandler({
      container: {
        name: 'api',
        image: { name: 'acme/api' },
        updateAvailable: true,
        updateKind: {
          kind: 'digest',
          localValue: 'sha256:old',
          remoteValue: 'sha256:new',
          semverDiff: 'unknown',
        },
      },
      changed: true,
    } as ContainerReport);

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update-available',
        updateKind: 'digest',
        semverDiff: 'unknown',
      }),
    );
  });

  test('ignores malformed update reports without a container identity', async () => {
    const { containerReportHandler } = setupAuditSubscriptions();

    await containerReportHandler({ changed: true } as ContainerReport);
    await containerReportHandler({ container: {}, changed: true } as ContainerReport);

    expect(mockInsertAudit).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalled();
  });

  test('deduplicates repeated update-available reports inside the configured window', async () => {
    const { containerReportHandler } = setupAuditSubscriptions();
    const report = {
      container: {
        name: 'api',
        watcher: 'docker',
        agent: 'edge-a',
        updateAvailable: true,
        updateKind: { localValue: '1.0.0', remoteValue: '1.1.0' },
      },
      changed: false,
    } as ContainerReport;

    await containerReportHandler(report);
    vi.advanceTimersByTime(60 * 60 * 1000 - 1);
    await containerReportHandler(report);

    expect(mockInsertAudit).toHaveBeenCalledTimes(1);
    expect(mockInc).toHaveBeenCalledTimes(1);
  });

  test('records a changed update target immediately inside the dedupe window', async () => {
    const { containerReportHandler } = setupAuditSubscriptions();
    const container = {
      name: 'api',
      watcher: 'docker',
      agent: 'edge-a',
      updateAvailable: true,
      updateKind: { localValue: '1.0.0', remoteValue: '1.1.0' },
    };

    await containerReportHandler({ container, changed: true } as ContainerReport);
    await containerReportHandler({
      container: {
        ...container,
        updateKind: { localValue: '1.0.0', remoteValue: '2.0.0' },
      },
      changed: true,
    } as ContainerReport);

    expect(mockInsertAudit).toHaveBeenCalledTimes(2);
    expect(mockInc).toHaveBeenCalledTimes(2);
  });

  test('does not deduplicate different update kinds with the same displayed values', async () => {
    const { containerReportHandler } = setupAuditSubscriptions();
    const container = {
      name: 'api',
      watcher: 'docker',
      agent: 'edge-a',
      updateAvailable: true,
    };

    await containerReportHandler({
      container: {
        ...container,
        updateKind: { kind: 'tag', localValue: 'stable', remoteValue: 'candidate' },
      },
      changed: true,
    } as ContainerReport);
    await containerReportHandler({
      container: {
        ...container,
        updateKind: { kind: 'digest', localValue: 'stable', remoteValue: 'candidate' },
      },
      changed: true,
    } as ContainerReport);

    expect(mockInsertAudit).toHaveBeenCalledTimes(2);
    expect(mockInc).toHaveBeenCalledTimes(2);
  });

  test('deduplicates incomplete update signatures without conflating distinct values', async () => {
    const { containerReportHandler } = setupAuditSubscriptions();
    const reportFor = (name: string, updateKind?: ContainerReport['container']['updateKind']) =>
      ({
        container: {
          name,
          watcher: 'docker',
          agent: 'edge-a',
          updateAvailable: true,
          updateKind,
        },
        changed: true,
      }) as ContainerReport;

    await containerReportHandler(reportFor('missing-kind'));
    await containerReportHandler(reportFor('missing-remote', { localValue: '1.0.0' }));
    await containerReportHandler(reportFor('missing-local', { remoteValue: '1.1.0' }));
    await containerReportHandler(reportFor('missing-kind'));

    expect(mockInsertAudit).toHaveBeenCalledTimes(3);
    expect(mockInc).toHaveBeenCalledTimes(3);
  });

  test('scopes update-available dedupe by agent and watcher', async () => {
    const { containerReportHandler } = setupAuditSubscriptions();
    const reportFor = (agent: string, watcher: string) =>
      ({
        container: {
          name: 'api',
          watcher,
          agent,
          updateAvailable: true,
          updateKind: { localValue: '1.0.0', remoteValue: '1.1.0' },
        },
        changed: true,
      }) as ContainerReport;

    await containerReportHandler(reportFor('edge-a', 'docker'));
    await containerReportHandler(reportFor('edge-b', 'docker'));
    await containerReportHandler(reportFor('edge-a', 'podman'));
    await containerReportHandler(reportFor('edge-a', 'docker'));

    expect(mockInsertAudit).toHaveBeenCalledTimes(3);
    expect(mockInsertAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ containerIdentityKey: 'edge-a::docker::api' }),
    );
    expect(mockInsertAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ containerIdentityKey: 'edge-b::docker::api' }),
    );
    expect(mockInsertAudit).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ containerIdentityKey: 'edge-a::podman::api' }),
    );
  });

  test('records a new no-to-yes update transition inside the dedupe window', async () => {
    const { containerReportHandler } = setupAuditSubscriptions();
    const container = {
      name: 'api',
      watcher: 'docker',
      agent: 'edge-a',
      updateAvailable: true,
      updateKind: { localValue: '1.0.0', remoteValue: '1.1.0' },
    };

    await containerReportHandler({ container, changed: true } as ContainerReport);
    await containerReportHandler({
      container: { ...container, updateAvailable: false },
      changed: true,
    } as ContainerReport);
    await containerReportHandler({ container, changed: true } as ContainerReport);

    expect(mockInsertAudit).toHaveBeenCalledTimes(2);
    expect(mockInc).toHaveBeenCalledTimes(2);
  });

  test('records the same update again after the configured dedupe window', async () => {
    const { containerReportHandler } = setupAuditSubscriptions();
    const report = {
      container: {
        name: 'api',
        watcher: 'docker',
        agent: 'edge-a',
        updateAvailable: true,
        updateKind: { localValue: '1.0.0', remoteValue: '1.1.0' },
      },
      changed: false,
    } as ContainerReport;

    await containerReportHandler(report);
    vi.advanceTimersByTime(60 * 60 * 1000);
    await containerReportHandler(report);

    expect(mockInsertAudit).toHaveBeenCalledTimes(2);
  });

  test('captures the configured update dedupe window when the first update report is handled', async () => {
    mockGetUpdateAvailableDedupeMs.mockReturnValue(1_000);
    const { containerReportHandler } = setupAuditSubscriptions();
    const report = {
      container: {
        name: 'api',
        watcher: 'docker',
        agent: 'edge-a',
        updateAvailable: true,
        updateKind: { localValue: '1.0.0', remoteValue: '1.1.0' },
      },
      changed: false,
    } as ContainerReport;

    expect(mockGetUpdateAvailableDedupeMs).not.toHaveBeenCalled();
    await containerReportHandler(report);
    expect(mockGetUpdateAvailableDedupeMs).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    await containerReportHandler(report);

    expect(mockGetUpdateAvailableDedupeMs).toHaveBeenCalledTimes(1);
    expect(mockInsertAudit).toHaveBeenCalledTimes(2);
  });

  test('prunes stale update identities while accepting a later transition', async () => {
    const { containerReportHandler } = setupAuditSubscriptions();
    const reportFor = (name: string) =>
      ({
        container: {
          name,
          watcher: 'docker',
          agent: 'edge-a',
          updateAvailable: true,
          updateKind: { localValue: '1.0.0', remoteValue: '1.1.0' },
        },
        changed: true,
      }) as ContainerReport;

    await containerReportHandler(reportFor('old-api'));
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1);
    await containerReportHandler(reportFor('new-api'));

    expect(mockInsertAudit).toHaveBeenCalledTimes(2);
    expect(mockInc).toHaveBeenCalledTimes(2);
  });

  test('deduplicates security alerts that repeat before 5 minutes', async () => {
    const { securityAlertHandler } = setupAuditSubscriptions();
    const payload: SecurityAlertEventPayload = {
      containerName: 'docker_local_nginx',
      details: 'critical=1, high=2',
      blockingCount: 3,
    };

    await securityAlertHandler(payload);
    vi.advanceTimersByTime(5 * 60 * 1000 - 1);
    await securityAlertHandler(payload);

    expect(mockInsertAudit).toHaveBeenCalledTimes(1);
    expect(mockInc).toHaveBeenCalledTimes(1);
    expect(mockInc).toHaveBeenCalledWith({ action: 'security-alert' });
  });

  test('records security alerts again once 5-minute dedupe window elapses', async () => {
    const { securityAlertHandler } = setupAuditSubscriptions();
    const payload: SecurityAlertEventPayload = {
      containerName: 'docker_local_nginx',
      details: 'critical=1, high=2',
      blockingCount: 3,
    };

    await securityAlertHandler(payload);
    vi.advanceTimersByTime(5 * 60 * 1000);
    await securityAlertHandler(payload);

    expect(mockInsertAudit).toHaveBeenCalledTimes(2);
    expect(mockInc).toHaveBeenCalledTimes(2);
  });

  test('records container unhealthy audits, deduplicates per container, and expires after 5 minutes', async () => {
    const { containerHealthTransitionHandler } = setupAuditSubscriptions();
    await containerHealthTransitionHandler({ containerName: 'web', health: 'unhealthy' });

    expect(mockInsertAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'container-unhealthy',
        status: 'error',
        containerName: 'web',
        details: undefined,
      }),
    );
    expect(mockInc).toHaveBeenLastCalledWith({ action: 'container-unhealthy' });

    vi.advanceTimersByTime(5 * 60 * 1000 - 1);
    await containerHealthTransitionHandler({ containerName: 'web', health: 'unhealthy' });
    expect(mockInsertAudit).toHaveBeenCalledTimes(1);

    await containerHealthTransitionHandler({ containerName: 'api', health: 'unhealthy' });
    expect(mockInsertAudit).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1);
    await containerHealthTransitionHandler({ containerName: 'web', health: 'unhealthy' });
    expect(mockInsertAudit).toHaveBeenCalledTimes(3);
    expect(mockInc).toHaveBeenCalledTimes(3);
  });

  test('scopes same-name unhealthy dedupe by agent and watcher', async () => {
    const { containerHealthTransitionHandler } = setupAuditSubscriptions();

    await containerHealthTransitionHandler({
      containerName: 'web',
      container: {
        id: 'edge-a-web',
        name: 'web',
        watcher: 'docker',
        agent: 'edge-a',
      },
      health: 'unhealthy',
    });
    await containerHealthTransitionHandler({
      containerName: 'web',
      container: {
        id: 'edge-b-web',
        name: 'web',
        watcher: 'docker',
        agent: 'edge-b',
      },
      health: 'unhealthy',
    });
    await containerHealthTransitionHandler({
      containerName: 'web',
      container: {
        id: 'edge-a-podman-web',
        name: 'web',
        watcher: 'podman',
        agent: 'edge-a',
      },
      health: 'unhealthy',
    });
    await containerHealthTransitionHandler({
      containerName: 'web',
      container: {
        id: 'edge-a-web-repeated',
        name: 'web',
        watcher: 'docker',
        agent: 'edge-a',
      },
      health: 'unhealthy',
    });

    expect(mockInsertAudit).toHaveBeenCalledTimes(3);
    expect(mockInc).toHaveBeenCalledTimes(3);
    expect(mockInsertAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ containerIdentityKey: 'edge-a::docker::web' }),
    );
    expect(mockInsertAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ containerIdentityKey: 'edge-b::docker::web' }),
    );
    expect(mockInsertAudit).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ containerIdentityKey: 'edge-a::podman::web' }),
    );
  });

  test('records the previous health in container unhealthy audit details', async () => {
    const { containerHealthTransitionHandler } = setupAuditSubscriptions();

    await containerHealthTransitionHandler({
      containerName: 'web',
      previousHealth: 'healthy',
      health: 'unhealthy',
    });

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'container-unhealthy',
        containerName: 'web',
        status: 'error',
        details: '(was healthy)',
      }),
    );
  });

  test('deduplicates agent disconnects that repeat before 60 seconds', async () => {
    const { agentDisconnectedHandler } = setupAuditSubscriptions();
    const payload: AgentDisconnectedEventPayload = {
      agentName: 'edge-a',
      reason: 'SSE connection lost',
    };

    await agentDisconnectedHandler(payload);
    vi.advanceTimersByTime(60 * 1000 - 1);
    await agentDisconnectedHandler(payload);

    expect(mockInsertAudit).toHaveBeenCalledTimes(1);
    expect(mockInc).toHaveBeenCalledTimes(1);
    expect(mockInc).toHaveBeenCalledWith({ action: 'agent-disconnect' });
  });

  test('records agent disconnect again once 60-second dedupe window elapses', async () => {
    const { agentDisconnectedHandler } = setupAuditSubscriptions();
    const payload: AgentDisconnectedEventPayload = {
      agentName: 'edge-a',
      reason: 'SSE connection lost',
    };

    await agentDisconnectedHandler(payload);
    vi.advanceTimersByTime(60 * 1000);
    await agentDisconnectedHandler(payload);

    expect(mockInsertAudit).toHaveBeenCalledTimes(2);
    expect(mockInc).toHaveBeenCalledTimes(2);
  });

  test('records container update audit with empty containerName fallback when name and id are missing', () => {
    const { containerUpdatedHandler } = setupAuditSubscriptions();

    containerUpdatedHandler({
      image: { name: 'nginx' },
      status: 'running',
    } as unknown as ContainerLifecycleEventPayload);

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'container-update',
        containerName: '',
        details: 'status: running',
      }),
    );
    expect(mockInc).toHaveBeenCalledWith({ action: 'container-update' });
  });

  test('suppresses security-only container updates after the lifecycle baseline', () => {
    const { containerAddedHandler, containerUpdatedHandler } = setupAuditSubscriptions();
    const baseline = makeLifecyclePayload({
      security: { scan: { scannedAt: '2026-01-01T00:00:00.000Z' } },
    });

    containerAddedHandler(baseline);
    mockInsertAudit.mockClear();
    mockInc.mockClear();

    containerUpdatedHandler({
      ...baseline,
      security: { scan: { scannedAt: '2026-01-01T00:10:00.000Z' } },
    } as unknown as ContainerLifecycleEventPayload);

    expect(mockInsertAudit).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalled();
  });

  test('retries a changed lifecycle audit after persistence fails', () => {
    const { containerAddedHandler, containerUpdatedHandler } = setupAuditSubscriptions();
    const baseline = makeLifecyclePayload({ result: undefined });

    containerAddedHandler(baseline);
    mockInsertAudit.mockClear();
    mockInc.mockClear();
    mockInsertAudit.mockImplementationOnce(() => {
      throw new Error('audit write failed');
    });

    expect(() => containerUpdatedHandler({ ...baseline, status: 'stopped' })).toThrow(
      'audit write failed',
    );
    containerUpdatedHandler({ ...baseline, status: 'stopped' });

    expect(mockInsertAudit).toHaveBeenCalledTimes(2);
    expect(mockInc).toHaveBeenCalledTimes(1);
  });

  test('does not seed lifecycle state when the container-added audit fails', () => {
    const { containerAddedHandler, containerUpdatedHandler } = setupAuditSubscriptions();
    const baseline = makeLifecyclePayload({ result: undefined });
    mockInsertAudit.mockImplementationOnce(() => {
      throw new Error('audit write failed');
    });

    expect(() => containerAddedHandler(baseline)).toThrow('audit write failed');
    containerUpdatedHandler(baseline);

    expect(mockInsertAudit).toHaveBeenCalledTimes(2);
    expect(mockInc).toHaveBeenCalledTimes(1);
  });

  test('suppresses security-only updates for a valid partial lifecycle baseline', () => {
    const { containerAddedHandler, containerUpdatedHandler } = setupAuditSubscriptions();
    const baseline = {
      id: 'container-1',
      name: 'web',
      watcher: 'docker',
      agent: 'edge-a',
    } as ContainerLifecycleEventPayload;

    containerAddedHandler(baseline);
    mockInsertAudit.mockClear();
    mockInc.mockClear();
    containerUpdatedHandler({
      ...baseline,
      security: { scan: { scannedAt: '2026-01-01T00:10:00.000Z' } },
    } as unknown as ContainerLifecycleEventPayload);

    expect(mockInsertAudit).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalled();
  });

  test('records status transitions while suppressing repeated security refreshes', () => {
    const { containerAddedHandler, containerUpdatedHandler } = setupAuditSubscriptions();
    const baseline = makeLifecyclePayload();

    containerAddedHandler(baseline);
    mockInsertAudit.mockClear();
    mockInc.mockClear();

    containerUpdatedHandler({ ...baseline, status: 'stopped' });
    containerUpdatedHandler({
      ...baseline,
      status: 'stopped',
      security: { scan: { scannedAt: '2026-01-01T00:10:00.000Z' } },
    } as unknown as ContainerLifecycleEventPayload);
    containerUpdatedHandler({ ...baseline, status: 'running' });

    expect(mockInsertAudit).toHaveBeenCalledTimes(2);
    expect(mockInsertAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ details: 'status: stopped' }),
    );
    expect(mockInsertAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ details: 'status: running' }),
    );
    expect(mockInc).toHaveBeenCalledTimes(2);
  });

  test('records a changed image result even when container status is unchanged', () => {
    const { containerAddedHandler, containerUpdatedHandler } = setupAuditSubscriptions();
    const baseline = makeLifecyclePayload();

    containerAddedHandler(baseline);
    mockInsertAudit.mockClear();
    mockInc.mockClear();
    containerUpdatedHandler({
      ...baseline,
      result: { tag: '1.27.1', digest: 'sha256:two' },
    } as unknown as ContainerLifecycleEventPayload);

    expect(mockInsertAudit).toHaveBeenCalledTimes(1);
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ containerIdentityKey: 'edge-a::docker::web' }),
    );
    expect(mockInc).toHaveBeenCalledTimes(1);
  });

  test('records update availability, health, error, and policy transitions', () => {
    const { containerAddedHandler, containerUpdatedHandler } = setupAuditSubscriptions();
    const baseline = makeLifecyclePayload({
      health: 'healthy',
      image: { name: 'library/nginx', tag: { value: '1.27.0' } },
      updateAvailable: false,
      updatePolicy: { skipTags: ['beta', 'alpha'] },
    } as unknown as Partial<ContainerLifecycleEventPayload>);

    containerAddedHandler(baseline);
    mockInsertAudit.mockClear();
    mockInc.mockClear();

    const updateAvailable = {
      ...baseline,
      updateAvailable: true,
      updateKind: {
        kind: 'tag',
        localValue: '1.27.0',
        remoteValue: '1.27.1',
        semverDiff: 'patch',
      },
    } as unknown as ContainerLifecycleEventPayload;
    containerUpdatedHandler(updateAvailable);
    containerUpdatedHandler({ ...updateAvailable, health: 'unhealthy' });
    containerUpdatedHandler({
      ...updateAvailable,
      health: 'unhealthy',
      error: { message: 'boom' },
    });
    containerUpdatedHandler({
      ...updateAvailable,
      health: 'unhealthy',
      error: { message: 'boom' },
      updatePolicy: { skipTags: ['stable'] },
    });

    expect(mockInsertAudit).toHaveBeenCalledTimes(4);
    expect(mockInc).toHaveBeenCalledTimes(4);
  });

  test('normalizes policy list ordering before comparing lifecycle state', () => {
    const { containerAddedHandler, containerUpdatedHandler } = setupAuditSubscriptions();
    const baseline = makeLifecyclePayload({
      updatePolicy: { skipTags: ['alpha', 'beta'], skipDigests: ['two', 'one'] },
    } as unknown as Partial<ContainerLifecycleEventPayload>);

    containerAddedHandler(baseline);
    mockInsertAudit.mockClear();
    mockInc.mockClear();
    containerUpdatedHandler({
      ...baseline,
      updatePolicy: { skipTags: ['beta', 'alpha'], skipDigests: ['one', 'two'] },
      security: { scan: { scannedAt: '2026-01-01T00:10:00.000Z' } },
    } as unknown as ContainerLifecycleEventPayload);

    expect(mockInsertAudit).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalled();
  });

  test('scopes lifecycle audit state by agent and watcher', () => {
    const { containerUpdatedHandler } = setupAuditSubscriptions();
    const updateFor = (agent: string, watcher: string, scannedAt: string) =>
      makeLifecyclePayload({
        id: `${agent}-${watcher}`,
        watcher,
        agent,
        security: { scan: { scannedAt } },
      });

    containerUpdatedHandler(updateFor('edge-a', 'docker', '2026-01-01T00:00:00.000Z'));
    containerUpdatedHandler(updateFor('edge-b', 'docker', '2026-01-01T00:00:00.000Z'));
    containerUpdatedHandler(updateFor('edge-a', 'podman', '2026-01-01T00:00:00.000Z'));
    containerUpdatedHandler(updateFor('edge-a', 'docker', '2026-01-01T00:10:00.000Z'));

    expect(mockInsertAudit).toHaveBeenCalledTimes(3);
    expect(mockInc).toHaveBeenCalledTimes(3);
  });

  test('scopes same-name lifecycle state by compose-aware identity', () => {
    const { containerAddedHandler, containerUpdatedHandler } = setupAuditSubscriptions();
    const siblingFor = (identityKey: string, status: string, scannedAt: string) =>
      makeLifecyclePayload({
        id: identityKey,
        identityKey,
        status,
        result: undefined,
        security: { scan: { scannedAt } },
      });

    containerAddedHandler(siblingFor('edge-a::docker::web::compose-a', 'running', 'baseline'));
    containerAddedHandler(siblingFor('edge-a::docker::web::compose-b', 'stopped', 'baseline'));
    mockInsertAudit.mockClear();
    mockInc.mockClear();

    containerUpdatedHandler(
      siblingFor('edge-a::docker::web::compose-a', 'running', '2026-01-01T00:10:00.000Z'),
    );
    containerUpdatedHandler(
      siblingFor('edge-a::docker::web::compose-b', 'stopped', '2026-01-01T00:10:00.000Z'),
    );

    expect(mockInsertAudit).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalled();
  });

  test('removing one compose sibling preserves the other sibling lifecycle state', () => {
    const { containerAddedHandler, containerUpdatedHandler, containerRemovedHandler } =
      setupAuditSubscriptions();
    const siblingFor = (identityKey: string, scannedAt: string) =>
      makeLifecyclePayload({
        id: identityKey,
        identityKey,
        result: undefined,
        security: { scan: { scannedAt } },
      });

    const firstSibling = siblingFor('edge-a::docker::web::compose-a', 'baseline');
    const secondSibling = siblingFor('edge-a::docker::web::compose-b', 'baseline');
    containerAddedHandler(firstSibling);
    containerAddedHandler(secondSibling);
    containerRemovedHandler(firstSibling);
    mockInsertAudit.mockClear();
    mockInc.mockClear();

    containerUpdatedHandler(
      siblingFor('edge-a::docker::web::compose-b', '2026-01-01T00:10:00.000Z'),
    );

    expect(mockInsertAudit).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalled();
  });

  test('does not churn a stable fleet when lifecycle state exceeds ten thousand containers', () => {
    const { containerUpdatedHandler } = setupAuditSubscriptions();
    const updateFor = (index: number) =>
      makeLifecyclePayload({
        id: `container-${index}`,
        name: `web-${index}`,
        result: undefined,
        security: { scan: { scannedAt: '2026-01-01T00:00:00.000Z' } },
      });

    for (let index = 0; index < 10_001; index += 1) {
      containerUpdatedHandler(updateFor(index));
    }
    mockInsertAudit.mockClear();
    mockInc.mockClear();

    for (let index = 0; index < 10_001; index += 1) {
      containerUpdatedHandler(updateFor(index));
    }

    expect(mockInsertAudit).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalled();
  });

  test('prunes orphaned lifecycle state after thirty days without activity', () => {
    const { containerUpdatedHandler } = setupAuditSubscriptions();
    const updateFor = (name: string) =>
      makeLifecyclePayload({
        id: name,
        name,
        result: undefined,
      });

    containerUpdatedHandler(updateFor('orphaned'));
    vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000 + 1);
    containerUpdatedHandler(updateFor('active'));
    mockInsertAudit.mockClear();
    mockInc.mockClear();

    containerUpdatedHandler(updateFor('orphaned'));

    expect(mockInsertAudit).toHaveBeenCalledTimes(1);
    expect(mockInc).toHaveBeenCalledTimes(1);
  });

  test('forgets lifecycle audit state when a container is removed', () => {
    const { containerUpdatedHandler, containerRemovedHandler } = setupAuditSubscriptions();
    const update = makeLifecyclePayload();

    containerUpdatedHandler(update);
    containerRemovedHandler(update);
    mockInsertAudit.mockClear();
    mockInc.mockClear();
    containerUpdatedHandler(update);

    expect(mockInsertAudit).toHaveBeenCalledTimes(1);
    expect(mockInc).toHaveBeenCalledTimes(1);
  });

  test('fails open for repeated lifecycle updates without a stable identity', () => {
    const { containerUpdatedHandler } = setupAuditSubscriptions();
    const malformed = {
      id: 'container-1',
      name: 'web',
      status: 'running',
      security: { scan: { scannedAt: '2026-01-01T00:00:00.000Z' } },
    } as unknown as ContainerLifecycleEventPayload;

    containerUpdatedHandler(malformed);
    containerUpdatedHandler({
      ...malformed,
      security: { scan: { scannedAt: '2026-01-01T00:10:00.000Z' } },
    } as unknown as ContainerLifecycleEventPayload);

    expect(mockInsertAudit).toHaveBeenCalledTimes(2);
    expect(mockInc).toHaveBeenCalledTimes(2);
  });

  test('records update-applied audits for valid string payloads', async () => {
    const { containerUpdateAppliedHandler } = setupAuditSubscriptions();

    await containerUpdateAppliedHandler('web');

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update-applied',
        containerName: 'web',
        status: 'success',
      }),
    );
    expect(mockInc).toHaveBeenCalledWith({ action: 'update-applied' });
  });

  test('records dry-run update audits without claiming the container was replaced', async () => {
    const { containerUpdateAppliedHandler } = setupAuditSubscriptions();

    await containerUpdateAppliedHandler({ containerName: 'web', phase: 'dryrun' });

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update-applied-dryrun',
        containerName: 'web',
        status: 'info',
      }),
    );
    expect(mockInc).toHaveBeenCalledWith({ action: 'update-applied-dryrun' });
    expect(mockInc).not.toHaveBeenCalledWith({ action: 'update-applied' });
  });

  test('ignores invalid or nameless update-applied payloads', async () => {
    const { containerUpdateAppliedHandler } = setupAuditSubscriptions();

    await containerUpdateAppliedHandler('' as unknown as ContainerUpdateAppliedEvent);
    await containerUpdateAppliedHandler(null as unknown as ContainerUpdateAppliedEvent);
    await containerUpdateAppliedHandler({ containerName: '' });

    expect(mockInsertAudit).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalledWith({ action: 'update-applied' });
  });
});
