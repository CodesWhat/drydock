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
const CONTAINER_LIFECYCLE_AUDIT_STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
const containerLifecycleAuditState = new Map<string, { signature: string; lastSeenAt: number }>();
let updateAvailableAuditDedupeWindowMs: number | undefined;

function normalizeLifecyclePolicy(
  policy:
    | {
        skipTags?: string[];
        skipDigests?: string[];
        maturityMode?: 'all' | 'mature';
        maturityMinAgeDays?: number;
        snoozeUntil?: string;
      }
    | undefined,
) {
  // Mirrors store/container.ts policy comparison without importing the store
  // module back into the event layer (which would create a dependency cycle).
  return {
    maturityMode: policy?.maturityMode ?? null,
    maturityMinAgeDays: policy?.maturityMinAgeDays ?? null,
    skipTags: policy?.skipTags ? [...policy.skipTags].sort() : null,
    skipDigests: policy?.skipDigests ? [...policy.skipDigests].sort() : null,
    snoozeUntil: policy?.snoozeUntil ?? null,
  };
}

function getContainerLifecycleAuditSignature(container: ContainerLifecycleEventPayload): string {
  return JSON.stringify({
    status: container.status ?? null,
    health: container.health ?? null,
    error: container.error?.message ?? null,
    image: {
      name: container.image?.name ?? null,
      tag: container.image?.tag?.value ?? null,
      digest: container.image?.digest?.value ?? null,
    },
    result: {
      tag: container.result?.tag ?? null,
      digest: container.result?.digest ?? null,
    },
    updateAvailable: container.updateAvailable ?? null,
    updateKind: {
      kind: container.updateKind?.kind ?? null,
      localValue: container.updateKind?.localValue ?? null,
      remoteValue: container.updateKind?.remoteValue ?? null,
      semverDiff: container.updateKind?.semverDiff ?? null,
    },
    policy: {
      hasEffective: Object.hasOwn(container, 'updatePolicy'),
      effective: normalizeLifecyclePolicy(container.updatePolicy),
      hasDeclarative: Object.hasOwn(container, 'updatePolicyDeclarative'),
      declarative: {
        env: normalizeLifecyclePolicy(container.updatePolicyDeclarative?.env),
        label: normalizeLifecyclePolicy(container.updatePolicyDeclarative?.label),
      },
      hasOverrides: Object.hasOwn(container, 'updatePolicyOverrides'),
      overrides: normalizeLifecyclePolicy(container.updatePolicyOverrides),
      sources: {
        skipTags: container.updatePolicySources?.skipTags ?? null,
        skipDigests: container.updatePolicySources?.skipDigests ?? null,
        maturityMode: container.updatePolicySources?.maturityMode ?? null,
        maturityMinAgeDays: container.updatePolicySources?.maturityMinAgeDays ?? null,
      },
    },
  });
}

function getContainerLifecycleAuditIdentity(
  container: ContainerLifecycleEventPayload,
): string | undefined {
  if (typeof container.identityKey === 'string' && container.identityKey.length > 0) {
    return container.identityKey;
  }
  return getContainerIdentityKey(container);
}

function pruneContainerLifecycleAuditState(now: number): void {
  const staleBefore = now - CONTAINER_LIFECYCLE_AUDIT_STATE_TTL_MS;
  for (const [identity, state] of containerLifecycleAuditState.entries()) {
    if (state.lastSeenAt >= staleBefore) {
      break;
    }
    containerLifecycleAuditState.delete(identity);
  }
}

function setContainerLifecycleAuditState(
  identity: string,
  signature: string,
  now = Date.now(),
): void {
  // Delete before set so Map insertion order remains a cheap LRU ordering.
  containerLifecycleAuditState.delete(identity);
  containerLifecycleAuditState.set(identity, { signature, lastSeenAt: now });
  pruneContainerLifecycleAuditState(now);
}

function shouldRecordContainerLifecycleUpdate(container: ContainerLifecycleEventPayload): {
  record: boolean;
  identity?: string;
  signature?: string;
} {
  const identity = getContainerLifecycleAuditIdentity(container);
  if (!identity) {
    // Preserve the historical fail-open behavior for malformed event payloads.
    return { record: true };
  }

  const signature = getContainerLifecycleAuditSignature(container);
  const previousState = containerLifecycleAuditState.get(identity);
  if (previousState?.signature === signature) {
    setContainerLifecycleAuditState(identity, signature);
    return { record: false, identity };
  }
  return { record: true, identity, signature };
}

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
    const containerIdentityKey = getContainerLifecycleAuditIdentity(containerAdded);
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'container-added',
      containerName: containerAdded.name || containerAdded.id || '',
      ...(containerIdentityKey !== undefined ? { containerIdentityKey } : {}),
      containerImage: containerAdded.image?.name,
      status: 'info',
    });
    if (containerIdentityKey) {
      setContainerLifecycleAuditState(
        containerIdentityKey,
        getContainerLifecycleAuditSignature(containerAdded),
      );
    }
    getAuditCounter()?.inc({ action: 'container-added' });
  });

  registrars.registerContainerUpdated((containerUpdated) => {
    const lifecycleUpdate = shouldRecordContainerLifecycleUpdate(containerUpdated);
    if (!lifecycleUpdate.record) {
      return;
    }
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'container-update',
      containerName: containerUpdated.name || containerUpdated.id || '',
      ...(lifecycleUpdate.identity !== undefined
        ? { containerIdentityKey: lifecycleUpdate.identity }
        : {}),
      containerImage: containerUpdated.image?.name,
      status: 'info',
      details: containerUpdated.status ? `status: ${containerUpdated.status}` : undefined,
    });
    if (lifecycleUpdate.identity && lifecycleUpdate.signature) {
      setContainerLifecycleAuditState(lifecycleUpdate.identity, lifecycleUpdate.signature);
    }
    getAuditCounter()?.inc({ action: 'container-update' });
  });

  registrars.registerContainerRemoved((containerRemoved) => {
    const containerIdentityKey = getContainerLifecycleAuditIdentity(containerRemoved);
    if (containerIdentityKey) {
      containerLifecycleAuditState.delete(containerIdentityKey);
    }
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'container-removed',
      containerName: containerRemoved.name || containerRemoved.id || '',
      ...(containerIdentityKey !== undefined ? { containerIdentityKey } : {}),
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
  containerLifecycleAuditState.clear();
  updateAvailableAuditDedupeWindowMs = undefined;
}
