import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ContainerReport } from '../model/container.js';
import type { AuditSubscriptionRegistrars } from './audit-subscriptions.js';
import {
  clearAuditSubscriptionCachesForTests,
  registerAuditLogSubscriptions,
} from './audit-subscriptions.js';
import type {
  AgentDisconnectedEventPayload,
  ContainerLifecycleEventPayload,
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
  securityAlertHandler: OrderedEventHandlerFn<SecurityAlertEventPayload>;
  agentDisconnectedHandler: OrderedEventHandlerFn<AgentDisconnectedEventPayload>;
} {
  const handlers: {
    securityAlert?: OrderedEventHandlerFn<SecurityAlertEventPayload>;
    agentDisconnected?: OrderedEventHandlerFn<AgentDisconnectedEventPayload>;
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
    registerContainerReport: registerOrdered<ContainerReport>(() => {}),
    registerContainerUpdateApplied: registerOrdered<string>(() => {}),
    registerContainerUpdateFailed: registerOrdered<ContainerUpdateFailedEventPayload>(() => {}),
    registerSecurityAlert: registerOrdered<SecurityAlertEventPayload>((handler) => {
      handlers.securityAlert = handler;
    }),
    registerAgentDisconnected: registerOrdered<AgentDisconnectedEventPayload>((handler) => {
      handlers.agentDisconnected = handler;
    }),
    registerContainerAdded: registerEvent<ContainerLifecycleEventPayload>(() => {}),
    registerContainerUpdated: registerEvent<ContainerLifecycleEventPayload>(() => {}),
    registerContainerRemoved: registerEvent<ContainerLifecycleEventPayload>(() => {}),
  };

  registerAuditLogSubscriptions(registrars);

  if (!handlers.securityAlert || !handlers.agentDisconnected) {
    throw new Error('Expected audit handlers to be registered');
  }

  return {
    securityAlertHandler: handlers.securityAlert,
    agentDisconnectedHandler: handlers.agentDisconnected,
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
});
