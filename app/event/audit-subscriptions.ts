import { getAuditUpdateAvailableDedupeMs } from '../configuration/index.js';
import { type ContainerReport, getContainerIdentityKey } from '../model/container.js';
import { getAuditCounter } from '../prometheus/audit.js';
import * as auditStore from '../store/audit.js';
import type {
  AgentDisconnectedEventPayload,
  ContainerHealthTransitionEventPayload,
  ContainerLifecycleEventPayload,
  ContainerUpdateAppliedEvent,
  ContainerUpdateFailedEventPayload,
  SecurityAlertEventPayload,
} from './index.js';

const AUDIT_HANDLER_OPTIONS = { id: 'audit', order: 200 };
const SECURITY_ALERT_AUDIT_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const AGENT_DISCONNECT_AUDIT_DEDUPE_WINDOW_MS = 60 * 1000;
const CONTAINER_UNHEALTHY_AUDIT_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

type OrderedEventHandlerFn<TPayload> = (payload: TPayload) => void | Promise<void>;

type OrderedEventRegistrarFn<TPayload> = (
  handler: OrderedEventHandlerFn<TPayload>,
  options?: {
    order?: number;
    id?: string;
  },
) => () => void;

type EventRegistrarFn<TPayload> = (handler: (payload: TPayload) => void) => void;

export interface AuditSubscriptionRegistrars {
  registerContainerReport: OrderedEventRegistrarFn<ContainerReport>;
  registerContainerUpdateApplied: OrderedEventRegistrarFn<ContainerUpdateAppliedEvent>;
  registerContainerUpdateFailed: OrderedEventRegistrarFn<ContainerUpdateFailedEventPayload>;
  registerSecurityAlert: OrderedEventRegistrarFn<SecurityAlertEventPayload>;
  registerContainerHealthTransition: OrderedEventRegistrarFn<ContainerHealthTransitionEventPayload>;
  registerAgentDisconnected: OrderedEventRegistrarFn<AgentDisconnectedEventPayload>;
  registerContainerAdded: EventRegistrarFn<ContainerLifecycleEventPayload>;
  registerContainerUpdated: EventRegistrarFn<ContainerLifecycleEventPayload>;
  registerContainerRemoved: EventRegistrarFn<ContainerLifecycleEventPayload>;
}

const securityAlertAuditSeenAt = new Map<string, number>();
const agentDisconnectedAuditSeenAt = new Map<string, number>();
const containerUnhealthyAuditSeenAt = new Map<string, number>();
const updateAvailableAuditState = new Map<string, { signature: string; seenAt: number }>();
let updateAvailableAuditDedupeWindowMs: number | undefined;

function getUpdateAvailableAuditDedupeWindowMs(): number {
  updateAvailableAuditDedupeWindowMs ??= getAuditUpdateAvailableDedupeMs();
  return updateAvailableAuditDedupeWindowMs;
}

function getUpdateAvailableAuditIdentity(containerReport: ContainerReport): string | undefined {
  const container = containerReport.container;
  if (!container?.name) {
    return undefined;
  }
  return getContainerIdentityKey(container) ?? container.name;
}

function shouldRecordUpdateAvailableAudit(containerReport: ContainerReport): boolean {
  const identity = getUpdateAvailableAuditIdentity(containerReport);
  if (!identity) {
    return false;
  }

  if (!containerReport.container?.updateAvailable) {
    updateAvailableAuditState.delete(identity);
    return false;
  }

  const now = Date.now();
  const dedupeWindowMs = getUpdateAvailableAuditDedupeWindowMs();
  const updateKind = containerReport.container.updateKind;
  const signature = JSON.stringify([
    updateKind?.kind ?? '',
    updateKind?.localValue ?? '',
    updateKind?.remoteValue ?? '',
  ]);
  const previousState = updateAvailableAuditState.get(identity);
  if (previousState?.signature === signature && now - previousState.seenAt < dedupeWindowMs) {
    return false;
  }

  updateAvailableAuditState.set(identity, { signature, seenAt: now });
  const oldestAllowedTimestamp = now - dedupeWindowMs * 2;
  for (const [cachedIdentity, state] of updateAvailableAuditState.entries()) {
    if (state.seenAt < oldestAllowedTimestamp) {
      updateAvailableAuditState.delete(cachedIdentity);
    }
  }
  return true;
}

function getContainerUpdateAppliedEventContainerName(
  payload: ContainerUpdateAppliedEvent,
): string | undefined {
  if (typeof payload === 'string') {
    return payload || undefined;
  }

  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  return typeof payload.containerName === 'string' && payload.containerName !== ''
    ? payload.containerName
    : undefined;
}

function pruneAuditDedupeCache(
  cache: Map<string, number>,
  now: number,
  dedupeWindowMs: number,
): void {
  const oldestAllowedTimestamp = now - dedupeWindowMs * 2;
  for (const [key, timestamp] of cache.entries()) {
    if (timestamp < oldestAllowedTimestamp) {
      cache.delete(key);
    }
  }
}

function isDuplicateAuditEvent(
  cache: Map<string, number>,
  key: string,
  dedupeWindowMs: number,
): boolean {
  const now = Date.now();
  const previousTimestamp = cache.get(key);
  if (previousTimestamp && now - previousTimestamp < dedupeWindowMs) {
    return true;
  }
  cache.set(key, now);
  pruneAuditDedupeCache(cache, now, dedupeWindowMs);
  return false;
}

export function registerAuditLogSubscriptions(registrars: AuditSubscriptionRegistrars): void {
  registrars.registerContainerReport(async (containerReport) => {
    if (shouldRecordUpdateAvailableAudit(containerReport)) {
      const containerIdentityKey = getContainerIdentityKey(containerReport.container!);
      auditStore.insertAudit({
        id: '',
        timestamp: new Date().toISOString(),
        action: 'update-available',
        containerName: containerReport.container.name,
        ...(containerIdentityKey !== undefined ? { containerIdentityKey } : {}),
        containerImage: containerReport.container.image?.name,
        fromVersion: containerReport.container.updateKind?.localValue,
        toVersion: containerReport.container.updateKind?.remoteValue,
        updateKind: containerReport.container.updateKind?.kind,
        semverDiff: containerReport.container.updateKind?.semverDiff,
        status: 'info',
      });
      getAuditCounter()?.inc({ action: 'update-available' });
    }
  }, AUDIT_HANDLER_OPTIONS);

  registrars.registerContainerUpdateApplied(async (payload) => {
    const containerName = getContainerUpdateAppliedEventContainerName(payload);
    if (!containerName) {
      return;
    }
    const dryRun = typeof payload === 'object' && payload?.phase === 'dryrun';
    const action = dryRun ? 'update-applied-dryrun' : 'update-applied';
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action,
      containerName,
      status: dryRun ? 'info' : 'success',
    });
    getAuditCounter()?.inc({ action });
  }, AUDIT_HANDLER_OPTIONS);

  registrars.registerContainerUpdateFailed(async (payload) => {
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'update-failed',
      containerName: payload.containerName,
      status: 'error',
      details: payload.error,
    });
    getAuditCounter()?.inc({ action: 'update-failed' });
  }, AUDIT_HANDLER_OPTIONS);

  registrars.registerSecurityAlert(async (payload) => {
    const dedupeKey = `${payload.containerName}|${payload.details}`;
    if (
      isDuplicateAuditEvent(
        securityAlertAuditSeenAt,
        dedupeKey,
        SECURITY_ALERT_AUDIT_DEDUPE_WINDOW_MS,
      )
    ) {
      return;
    }
    const blockingCount =
      Number.isFinite(payload.blockingCount) && payload.blockingCount > 0
        ? `; blocking=${payload.blockingCount}`
        : '';
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'security-alert',
      containerName: payload.containerName,
      status: 'error',
      details: `${payload.details}${blockingCount}`,
    });
    getAuditCounter()?.inc({ action: 'security-alert' });
  }, AUDIT_HANDLER_OPTIONS);

  registrars.registerContainerHealthTransition(async (payload) => {
    const containerIdentityKey = payload.container
      ? getContainerIdentityKey(payload.container)
      : undefined;
    const dedupeKey = containerIdentityKey ?? payload.containerName;
    if (
      isDuplicateAuditEvent(
        containerUnhealthyAuditSeenAt,
        dedupeKey,
        CONTAINER_UNHEALTHY_AUDIT_DEDUPE_WINDOW_MS,
      )
    ) {
      return;
    }
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'container-unhealthy',
      containerName: payload.containerName,
      ...(containerIdentityKey !== undefined ? { containerIdentityKey } : {}),
      status: 'error',
      details: payload.previousHealth ? `(was ${payload.previousHealth})` : undefined,
    });
    getAuditCounter()?.inc({ action: 'container-unhealthy' });
  }, AUDIT_HANDLER_OPTIONS);

  registrars.registerAgentDisconnected(async (payload) => {
    const dedupeKey = `${payload.agentName}|${payload.reason || ''}`;
    if (
      isDuplicateAuditEvent(
        agentDisconnectedAuditSeenAt,
        dedupeKey,
        AGENT_DISCONNECT_AUDIT_DEDUPE_WINDOW_MS,
      )
    ) {
      return;
    }
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'agent-disconnect',
      containerName: payload.agentName,
      status: 'error',
      details: payload.reason,
    });
    getAuditCounter()?.inc({ action: 'agent-disconnect' });
  }, AUDIT_HANDLER_OPTIONS);

  registrars.registerContainerAdded((containerAdded) => {
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'container-added',
      containerName: containerAdded.name || containerAdded.id || '',
      containerImage: containerAdded.image?.name,
      status: 'info',
    });
    getAuditCounter()?.inc({ action: 'container-added' });
  });

  registrars.registerContainerUpdated((containerUpdated) => {
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'container-update',
      containerName: containerUpdated.name || containerUpdated.id || '',
      containerImage: containerUpdated.image?.name,
      status: 'info',
      details: containerUpdated.status ? `status: ${containerUpdated.status}` : undefined,
    });
    getAuditCounter()?.inc({ action: 'container-update' });
  });

  registrars.registerContainerRemoved((containerRemoved) => {
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'container-removed',
      containerName: containerRemoved.name || containerRemoved.id || '',
      containerImage: containerRemoved.image?.name,
      status: 'info',
    });
    getAuditCounter()?.inc({ action: 'container-removed' });
  });
}

// Testing helper.
export function pruneAuditDedupeCacheForTests(
  cache: Map<string, number>,
  now: number,
  dedupeWindowMs: number,
): void {
  pruneAuditDedupeCache(cache, now, dedupeWindowMs);
}

export function clearAuditSubscriptionCachesForTests(): void {
  securityAlertAuditSeenAt.clear();
  agentDisconnectedAuditSeenAt.clear();
  containerUnhealthyAuditSeenAt.clear();
  updateAvailableAuditState.clear();
  updateAvailableAuditDedupeWindowMs = undefined;
}
