// @ts-nocheck
import events from 'node:events';

// Build EventEmitter
const eventEmitter = new events.EventEmitter();

// Container related events
const DD_CONTAINER_ADDED = 'dd:container-added';
const DD_CONTAINER_UPDATED = 'dd:container-updated';
const DD_CONTAINER_REMOVED = 'dd:container-removed';

// Watcher related events
const DD_WATCHER_START = 'dd:watcher-start';
const DD_WATCHER_STOP = 'dd:watcher-stop';

const DEFAULT_HANDLER_ORDER = 100;
const SECURITY_ALERT_AUDIT_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const AGENT_DISCONNECT_AUDIT_DEDUPE_WINDOW_MS = 60 * 1000;

interface EventHandlerRegistrationOptions {
  order?: number;
  id?: string;
}

interface OrderedEventHandler {
  handler: (payload: any) => any;
  order: number;
  id: string;
  sequence: number;
}

export interface SelfUpdateStartingEventPayload {
  opId: string;
  requiresAck?: boolean;
  ackTimeoutMs?: number;
  startedAt?: string;
}

const containerReportHandlers: OrderedEventHandler[] = [];
const containerReportsHandlers: OrderedEventHandler[] = [];
const containerUpdateAppliedHandlers: OrderedEventHandler[] = [];
const containerUpdateFailedHandlers: OrderedEventHandler[] = [];
const securityAlertHandlers: OrderedEventHandler[] = [];
const agentConnectedHandlers: OrderedEventHandler[] = [];
const agentDisconnectedHandlers: OrderedEventHandler[] = [];
const selfUpdateStartingHandlers: OrderedEventHandler[] = [];
let handlerRegistrationSequence = 0;
const securityAlertAuditSeenAt = new Map<string, number>();
const agentDisconnectedAuditSeenAt = new Map<string, number>();

function registerOrderedEventHandler(
  handlers: OrderedEventHandler[],
  handler: (payload: any) => any,
  options: EventHandlerRegistrationOptions = {},
) {
  const orderNumber = Number(options.order);
  handlers.push({
    handler,
    order: Number.isFinite(orderNumber) ? orderNumber : DEFAULT_HANDLER_ORDER,
    id: options.id || '',
    sequence: handlerRegistrationSequence++,
  });
  return () => {
    const handlerIndex = handlers.findIndex(
      (registeredHandler) => registeredHandler.handler === handler,
    );
    if (handlerIndex >= 0) {
      handlers.splice(handlerIndex, 1);
    }
  };
}

function compareOrderedHandlers(handlerA: OrderedEventHandler, handlerB: OrderedEventHandler) {
  if (handlerA.order !== handlerB.order) {
    return handlerA.order - handlerB.order;
  }
  if (handlerA.id !== handlerB.id) {
    return handlerA.id.localeCompare(handlerB.id);
  }
  return handlerA.sequence - handlerB.sequence;
}

async function emitOrderedHandlers(handlers: OrderedEventHandler[], payload: any) {
  const handlersOrdered = [...handlers].sort(compareOrderedHandlers);
  for (const handler of handlersOrdered) {
    await handler.handler(payload);
  }
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

/**
 * Emit ContainerReports event.
 * @param containerReports
 */
export async function emitContainerReports(containerReports) {
  await emitOrderedHandlers(containerReportsHandlers, containerReports);
}

/**
 * Register to ContainersResult event.
 * @param handler
 */
export function registerContainerReports(handler, options: EventHandlerRegistrationOptions = {}) {
  return registerOrderedEventHandler(containerReportsHandlers, handler, options);
}

/**
 * Emit ContainerReport event.
 * @param containerReport
 */
export async function emitContainerReport(containerReport) {
  await emitOrderedHandlers(containerReportHandlers, containerReport);
}

/**
 * Register to ContainerReport event.
 * @param handler
 */
export function registerContainerReport(handler, options: EventHandlerRegistrationOptions = {}) {
  return registerOrderedEventHandler(containerReportHandlers, handler, options);
}

/**
 * Emit ContainerUpdateApplied event.
 * @param containerId
 */
export async function emitContainerUpdateApplied(containerId: string) {
  await emitOrderedHandlers(containerUpdateAppliedHandlers, containerId);
}

/**
 * Register to ContainerUpdateApplied event.
 * @param handler
 */
export function registerContainerUpdateApplied(
  handler: (containerId: string) => any,
  options: EventHandlerRegistrationOptions = {},
) {
  return registerOrderedEventHandler(containerUpdateAppliedHandlers, handler, options);
}

/**
 * Emit ContainerUpdateFailed event.
 * @param payload
 */
export async function emitContainerUpdateFailed(payload: { containerName: string; error: string }) {
  await emitOrderedHandlers(containerUpdateFailedHandlers, payload);
}

/**
 * Register to ContainerUpdateFailed event.
 * @param handler
 */
export function registerContainerUpdateFailed(
  handler: (payload: { containerName: string; error: string }) => any,
  options: EventHandlerRegistrationOptions = {},
) {
  return registerOrderedEventHandler(containerUpdateFailedHandlers, handler, options);
}

/**
 * Emit SecurityAlert event.
 * @param payload
 */
export async function emitSecurityAlert(payload: {
  containerName: string;
  details: string;
  status?: string;
  summary?: {
    unknown: number;
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  blockingCount?: number;
  container?: any;
}) {
  await emitOrderedHandlers(securityAlertHandlers, payload);
}

/**
 * Register to SecurityAlert event.
 * @param handler
 */
export function registerSecurityAlert(
  handler: (payload: {
    containerName: string;
    details: string;
    status?: string;
    summary?: {
      unknown: number;
      low: number;
      medium: number;
      high: number;
      critical: number;
    };
    blockingCount?: number;
    container?: any;
  }) => any,
  options: EventHandlerRegistrationOptions = {},
) {
  return registerOrderedEventHandler(securityAlertHandlers, handler, options);
}

/**
 * Emit AgentConnected event.
 * @param payload
 */
export async function emitAgentConnected(payload: { agentName: string }) {
  await emitOrderedHandlers(agentConnectedHandlers, payload);
}

/**
 * Register to AgentConnected event.
 * @param handler
 */
export function registerAgentConnected(
  handler: (payload: { agentName: string }) => any,
  options: EventHandlerRegistrationOptions = {},
) {
  return registerOrderedEventHandler(agentConnectedHandlers, handler, options);
}

/**
 * Emit AgentDisconnected event.
 * @param payload
 */
export async function emitAgentDisconnected(payload: { agentName: string; reason?: string }) {
  await emitOrderedHandlers(agentDisconnectedHandlers, payload);
}

/**
 * Register to AgentDisconnected event.
 * @param handler
 */
export function registerAgentDisconnected(
  handler: (payload: { agentName: string; reason?: string }) => any,
  options: EventHandlerRegistrationOptions = {},
) {
  return registerOrderedEventHandler(agentDisconnectedHandlers, handler, options);
}

/**
 * Emit container added.
 * @param containerAdded
 */
export function emitContainerAdded(containerAdded) {
  eventEmitter.emit(DD_CONTAINER_ADDED, containerAdded);
}

/**
 * Register to container added event.
 * @param handler
 */
export function registerContainerAdded(handler) {
  eventEmitter.on(DD_CONTAINER_ADDED, handler);
}

/**
 * Emit container added.
 * @param containerUpdated
 */
export function emitContainerUpdated(containerUpdated) {
  eventEmitter.emit(DD_CONTAINER_UPDATED, containerUpdated);
}

/**
 * Register to container updated event.
 * @param handler
 */
export function registerContainerUpdated(handler) {
  eventEmitter.on(DD_CONTAINER_UPDATED, handler);
}

/**
 * Emit container removed.
 * @param containerRemoved
 */
export function emitContainerRemoved(containerRemoved) {
  eventEmitter.emit(DD_CONTAINER_REMOVED, containerRemoved);
}

/**
 * Register to container removed event.
 * @param handler
 */
export function registerContainerRemoved(handler) {
  eventEmitter.on(DD_CONTAINER_REMOVED, handler);
}

export function emitWatcherStart(watcher) {
  eventEmitter.emit(DD_WATCHER_START, watcher);
}

export function registerWatcherStart(handler) {
  eventEmitter.on(DD_WATCHER_START, handler);
}

export function emitWatcherStop(watcher) {
  eventEmitter.emit(DD_WATCHER_STOP, watcher);
}

export function registerWatcherStop(handler) {
  eventEmitter.on(DD_WATCHER_STOP, handler);
}

export async function emitSelfUpdateStarting(payload: SelfUpdateStartingEventPayload) {
  await emitOrderedHandlers(selfUpdateStartingHandlers, payload);
}

export function registerSelfUpdateStarting(
  handler: (payload: SelfUpdateStartingEventPayload) => any,
  options: EventHandlerRegistrationOptions = {},
) {
  return registerOrderedEventHandler(selfUpdateStartingHandlers, handler, options);
}

import { getAuditCounter } from '../prometheus/audit.js';
// Audit log integration
import * as auditStore from '../store/audit.js';

registerContainerReport(
  async (containerReport) => {
    if (containerReport?.container?.updateAvailable) {
      auditStore.insertAudit({
        id: '',
        timestamp: new Date().toISOString(),
        action: 'update-available',
        containerName: containerReport.container.name,
        containerImage: containerReport.container.image?.name,
        fromVersion: containerReport.container.updateKind?.localValue,
        toVersion: containerReport.container.updateKind?.remoteValue,
        status: 'info',
      });
      getAuditCounter()?.inc({ action: 'update-available' });
    }
  },
  { id: 'audit', order: 200 },
);

registerContainerUpdateApplied(
  async (containerId: string) => {
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'update-applied',
      containerName: containerId,
      status: 'success',
    });
    getAuditCounter()?.inc({ action: 'update-applied' });
  },
  { id: 'audit', order: 200 },
);

registerContainerUpdateFailed(
  async (payload) => {
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'update-failed',
      containerName: payload.containerName,
      status: 'error',
      details: payload.error,
    });
    getAuditCounter()?.inc({ action: 'update-failed' });
  },
  { id: 'audit', order: 200 },
);

registerSecurityAlert(
  async (payload) => {
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
  },
  { id: 'audit', order: 200 },
);

registerAgentDisconnected(
  async (payload) => {
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
  },
  { id: 'audit', order: 200 },
);

registerContainerAdded((containerAdded) => {
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

registerContainerRemoved((containerRemoved) => {
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

// Testing helper.
export function pruneAuditDedupeCacheForTests(
  cache: Map<string, number>,
  now: number,
  dedupeWindowMs: number,
) {
  pruneAuditDedupeCache(cache, now, dedupeWindowMs);
}

// Testing helper.
export function clearAllListenersForTests() {
  eventEmitter.removeAllListeners();
  containerReportHandlers.length = 0;
  containerReportsHandlers.length = 0;
  containerUpdateAppliedHandlers.length = 0;
  containerUpdateFailedHandlers.length = 0;
  securityAlertHandlers.length = 0;
  agentConnectedHandlers.length = 0;
  agentDisconnectedHandlers.length = 0;
  selfUpdateStartingHandlers.length = 0;
  securityAlertAuditSeenAt.clear();
  agentDisconnectedAuditSeenAt.clear();
  handlerRegistrationSequence = 0;
}
