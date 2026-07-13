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

const { mockInsertAudit, mockInc, mockGetAuditCounter } = vi.hoisted(() => ({
  mockInsertAudit: vi.fn(),
  mockInc: vi.fn(),
  mockGetAuditCounter: vi.fn(),
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
  containerUpdatedHandler: (payload: ContainerLifecycleEventPayload) => void;
} {
  const handlers: {
    containerReport?: OrderedEventHandlerFn<ContainerReport>;
    containerUpdateApplied?: OrderedEventHandlerFn<ContainerUpdateAppliedEvent>;
    securityAlert?: OrderedEventHandlerFn<SecurityAlertEventPayload>;
    containerHealthTransition?: OrderedEventHandlerFn<ContainerHealthTransitionEventPayload>;
    agentDisconnected?: OrderedEventHandlerFn<AgentDisconnectedEventPayload>;
    containerUpdated?: (payload: ContainerLifecycleEventPayload) => void;
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
    registerContainerAdded: registerEvent<ContainerLifecycleEventPayload>(() => {}),
    registerContainerUpdated: registerEvent<ContainerLifecycleEventPayload>((handler) => {
      handlers.containerUpdated = handler;
    }),
    registerContainerRemoved: registerEvent<ContainerLifecycleEventPayload>(() => {}),
  };

  registerAuditLogSubscriptions(registrars);

  if (
    !handlers.containerReport ||
    !handlers.containerUpdateApplied ||
    !handlers.securityAlert ||
    !handlers.containerHealthTransition ||
    !handlers.agentDisconnected ||
    !handlers.containerUpdated
  ) {
    throw new Error('Expected audit handlers to be registered');
  }

  return {
    containerReportHandler: handlers.containerReport,
    containerUpdateAppliedHandler: handlers.containerUpdateApplied,
    securityAlertHandler: handlers.securityAlert,
    containerHealthTransitionHandler: handlers.containerHealthTransition,
    agentDisconnectedHandler: handlers.agentDisconnected,
    containerUpdatedHandler: handlers.containerUpdated,
  };
}

describe('audit-subscriptions dedupe windows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    clearAuditSubscriptionCachesForTests();
    mockGetAuditCounter.mockReturnValue({ inc: mockInc });
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
      expect.objectContaining({ action: 'update-available', semverDiff: 'major' }),
    );
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

  test('ignores invalid or nameless update-applied payloads', async () => {
    const { containerUpdateAppliedHandler } = setupAuditSubscriptions();

    await containerUpdateAppliedHandler('' as unknown as ContainerUpdateAppliedEvent);
    await containerUpdateAppliedHandler(null as unknown as ContainerUpdateAppliedEvent);
    await containerUpdateAppliedHandler({ containerName: '' });

    expect(mockInsertAudit).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalledWith({ action: 'update-applied' });
  });
});
