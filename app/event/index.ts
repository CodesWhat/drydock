import { EventEmitter } from 'node:events';
import log from '../log/index.js';
import type { Container, ContainerReport } from '../model/container.js';
import {
  clearAuditSubscriptionCachesForTests,
  pruneAuditDedupeCacheForTests as pruneAuditDedupeCacheForTestsInternal,
  registerAuditLogSubscriptions,
} from './audit-subscriptions.js';

const eventLog = log.child({ component: 'event' });

/**
 * Event dispatch architecture (temporary dual path):
 *
 * 1) Ordered handler pipeline (preferred): used by the async `emit*` functions
 *    backed by `emitOrderedHandlers()`. Handlers can be async, are awaited in a
 *    deterministic order (`order`, then `id`, then registration sequence), and
 *    registration returns an unsubscribe function.
 *
 * 2) Node.js EventEmitter (legacy): used by container lifecycle and watcher
 *    events below. Dispatch is synchronous and ordering is implicit
 *    registration order.
 *
 * Current split:
 * - Ordered handlers: reports, update lifecycle, security alerts, agent
 *   connectivity, self-update-starting.
 * - Legacy EventEmitter: container added/updated/removed, watcher start/stop.
 *
 * Migration plan:
 * - Phase 1: keep adding new events only on the ordered handler pipeline.
 * - Phase 2: introduce ordered equivalents for legacy lifecycle/watcher events
 *   and migrate subscribers (SSE, MQTT, audit) to those registrars.
 * - Phase 3: expose unsubscribe cleanup for all subscriptions, then remove the
 *   legacy EventEmitter path and `removeAllListeners()` test dependency.
 */
const eventEmitter = new EventEmitter();

// Legacy EventEmitter channel names.
const DD_CONTAINER_ADDED = 'dd:container-added';
const DD_CONTAINER_UPDATED = 'dd:container-updated';
const DD_CONTAINER_REMOVED = 'dd:container-removed';

// Legacy EventEmitter channel names.
const DD_WATCHER_START = 'dd:watcher-start';
const DD_WATCHER_STOP = 'dd:watcher-stop';

const DEFAULT_HANDLER_ORDER = 100;

// Per-handler timeout. Prevents one slow/hung handler (e.g. an SMTP transport
// stalling on retry) from stalling the entire emit chain — and, transitively,
// the update lifecycle that awaits an emit. Configurable via env so operators
// with legitimately slow notification providers can extend it.
const DEFAULT_HANDLER_TIMEOUT_MS = 30_000;
let handlerTimeoutMs = parseHandlerTimeoutMs(process.env.DD_EVENT_HANDLER_TIMEOUT_MS);

function parseHandlerTimeoutMs(raw: string | undefined): number {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return DEFAULT_HANDLER_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HANDLER_TIMEOUT_MS;
  }
  return parsed;
}

export function setHandlerTimeoutMsForTests(value: number | undefined): void {
  handlerTimeoutMs = value === undefined ? DEFAULT_HANDLER_TIMEOUT_MS : value;
}

export function getHandlerTimeoutMsForTests(): number {
  return handlerTimeoutMs;
}

interface EventHandlerRegistrationOptions {
  order?: number;
  id?: string;
}

type OrderedEventHandlerFn<TPayload> = (payload: TPayload) => void | Promise<void>;

interface OrderedEventHandler<TPayload> {
  handler: OrderedEventHandlerFn<TPayload>;
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

export interface ContainerUpdateFailedEventPayload {
  containerName: string;
  error: string;
  operationId?: string;
  containerId?: string;
  batchId?: string | null;
  phase?: string;
}

export interface UpdateOperationChangedEventPayload {
  operationId: string;
  containerName: string;
  containerId?: string;
  newContainerId?: string;
  batchId?: string;
  status?: string;
  phase?: string;
}

export interface ContainerUpdateAppliedEventPayload {
  containerName: string;
  containerId?: string;
  container?: Container | Record<string, unknown>;
  operationId?: string;
  batchId?: string | null;
}

export type ContainerUpdateAppliedEvent = string | ContainerUpdateAppliedEventPayload;

export interface BatchUpdateCompletedEventPayload {
  batchId: string;
  total: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  items: Array<{
    operationId: string;
    containerId: string;
    containerName: string;
    status: 'succeeded' | 'failed';
  }>;
  timestamp: string;
}

export interface SecurityAlertSummary {
  unknown: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface SecurityAlertEventPayload {
  containerName: string;
  details: string;
  status?: string;
  summary?: SecurityAlertSummary;
  blockingCount?: number;
  container?: Container;
  /**
   * Optional correlation id linking this alert to its scan cycle. When present, consumers
   * should match the same id on a subsequent `emitSecurityScanCycleComplete` to group the
   * alert into a cycle-level digest. Absent for legacy callers (pre-v1.5.0 agents, etc.);
   * consumers should treat an unset id as a single-alert cycle.
   */
  cycleId?: string;
}

export interface SecurityScanCycleCompleteEventPayload {
  scannedCount: number;
  alertCount?: number;
  /** Correlation id shared with each `emitSecurityAlert` emitted during this cycle. */
  cycleId: string;
  startedAt?: string;
  completedAt?: string;
  scope?: 'scheduled' | 'on-demand-single' | 'on-demand-bulk' | 'agent-forwarded';
}

export interface AgentConnectedEventPayload {
  agentName: string;
  reconnected: boolean;
}

export interface AgentDisconnectedEventPayload {
  agentName: string;
  reason?: string;
}

export interface WatcherSnapshotEventPayload {
  watcher: {
    type: string;
    name: string;
    configuration?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  containers: Container[];
}

export type ContainerLifecycleEventPayload = Partial<Omit<Container, 'image'>> & {
  image?: Partial<Container['image']>;
  replacementExpected?: boolean;
};

const containerReportHandlers = new Map<number, OrderedEventHandler<ContainerReport>>();
const containerReportsHandlers = new Map<number, OrderedEventHandler<ContainerReport[]>>();
const watcherSnapshotHandlers = new Map<number, OrderedEventHandler<WatcherSnapshotEventPayload>>();
const containerUpdateAppliedHandlers = new Map<
  number,
  OrderedEventHandler<ContainerUpdateAppliedEvent>
>();
const containerUpdateFailedHandlers = new Map<
  number,
  OrderedEventHandler<ContainerUpdateFailedEventPayload>
>();
const updateOperationChangedHandlers = new Map<
  number,
  OrderedEventHandler<UpdateOperationChangedEventPayload>
>();
const securityAlertHandlers = new Map<number, OrderedEventHandler<SecurityAlertEventPayload>>();
const securityScanCycleCompleteHandlers = new Map<
  number,
  OrderedEventHandler<SecurityScanCycleCompleteEventPayload>
>();
const agentConnectedHandlers = new Map<number, OrderedEventHandler<AgentConnectedEventPayload>>();
const agentDisconnectedHandlers = new Map<
  number,
  OrderedEventHandler<AgentDisconnectedEventPayload>
>();
const selfUpdateStartingHandlers = new Map<
  number,
  OrderedEventHandler<SelfUpdateStartingEventPayload>
>();
const batchUpdateCompletedHandlers = new Map<
  number,
  OrderedEventHandler<BatchUpdateCompletedEventPayload>
>();
let handlerRegistrationSequence = 0;

function registerOrderedEventHandler<TPayload>(
  handlers: Map<number, OrderedEventHandler<TPayload>>,
  handler: OrderedEventHandlerFn<TPayload>,
  options: EventHandlerRegistrationOptions = {},
): () => void {
  const orderNumber = Number(options.order);
  const registrationKey = handlerRegistrationSequence++;
  handlers.set(registrationKey, {
    handler,
    order: Number.isFinite(orderNumber) ? orderNumber : DEFAULT_HANDLER_ORDER,
    id: options.id || '',
    sequence: registrationKey,
  });
  return () => {
    handlers.delete(registrationKey);
  };
}

function compareOrderedHandlers<TPayload>(
  handlerA: OrderedEventHandler<TPayload>,
  handlerB: OrderedEventHandler<TPayload>,
): number {
  if (handlerA.order !== handlerB.order) {
    return handlerA.order - handlerB.order;
  }
  if (handlerA.id !== handlerB.id) {
    return handlerA.id.localeCompare(handlerB.id);
  }
  return handlerA.sequence - handlerB.sequence;
}

const TIMEOUT_SENTINEL = Symbol('event-handler-timeout');

async function runHandlerWithTimeout<TPayload>(
  handler: OrderedEventHandler<TPayload>,
  payload: TPayload,
): Promise<void> {
  const timeoutMs = handlerTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const handlerPromise: Promise<unknown> = Promise.resolve().then(() => handler.handler(payload));
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
  });

  try {
    const result = await Promise.race([handlerPromise, timeoutPromise]);
    if (result === TIMEOUT_SENTINEL) {
      eventLog.warn(
        `Event handler timed out after ${timeoutMs}ms (id=${handler.id || '<anonymous>'} order=${handler.order}); skipping to next handler. ` +
          'A hung notification provider should not stall the update lifecycle. ' +
          'Set DD_EVENT_HANDLER_TIMEOUT_MS to override the default.',
      );
      // Detach: prevent unhandled-rejection if the late handler eventually rejects.
      handlerPromise.catch(() => undefined);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function emitOrderedHandlers<TPayload>(
  handlers: Map<number, OrderedEventHandler<TPayload>>,
  payload: TPayload,
): Promise<void> {
  const handlersOrdered = [...handlers.values()].sort(compareOrderedHandlers);
  for (const handler of handlersOrdered) {
    await runHandlerWithTimeout(handler, payload);
  }
}

/**
 * Emit ContainerReports event.
 * @param containerReports
 */
export async function emitContainerReports(containerReports: ContainerReport[]): Promise<void> {
  await emitOrderedHandlers(containerReportsHandlers, containerReports);
}

/**
 * Register to ContainersResult event.
 * @param handler
 */
export function registerContainerReports(
  handler: OrderedEventHandlerFn<ContainerReport[]>,
  options: EventHandlerRegistrationOptions = {},
): () => void {
  return registerOrderedEventHandler(containerReportsHandlers, handler, options);
}

/**
 * Emit WatcherSnapshot event.
 * @param payload
 */
export async function emitWatcherSnapshot(payload: WatcherSnapshotEventPayload): Promise<void> {
  await emitOrderedHandlers(watcherSnapshotHandlers, payload);
}

/**
 * Register to WatcherSnapshot event.
 * @param handler
 */
export function registerWatcherSnapshot(
  handler: OrderedEventHandlerFn<WatcherSnapshotEventPayload>,
  options: EventHandlerRegistrationOptions = {},
): () => void {
  return registerOrderedEventHandler(watcherSnapshotHandlers, handler, options);
}

/**
 * Emit ContainerReport event.
 * @param containerReport
 */
export async function emitContainerReport(containerReport: ContainerReport): Promise<void> {
  await emitOrderedHandlers(containerReportHandlers, containerReport);
}

/**
 * Register to ContainerReport event.
 * @param handler
 */
export function registerContainerReport(
  handler: OrderedEventHandlerFn<ContainerReport>,
  options: EventHandlerRegistrationOptions = {},
): () => void {
  return registerOrderedEventHandler(containerReportHandlers, handler, options);
}

/**
 * Emit ContainerUpdateApplied event.
 * @param payload
 */
export async function emitContainerUpdateApplied(
  payload: ContainerUpdateAppliedEvent,
): Promise<void> {
  await emitOrderedHandlers(containerUpdateAppliedHandlers, payload);
}

export function getContainerUpdateAppliedEventContainerName(
  payload: ContainerUpdateAppliedEvent,
): string | undefined {
  if (typeof payload === 'string') {
    return payload || undefined;
  }

  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const containerName = payload.containerName;
  return typeof containerName === 'string' && containerName !== '' ? containerName : undefined;
}

/**
 * Register to ContainerUpdateApplied event.
 * @param handler
 */
export function registerContainerUpdateApplied(
  handler: OrderedEventHandlerFn<ContainerUpdateAppliedEvent>,
  options: EventHandlerRegistrationOptions = {},
): () => void {
  return registerOrderedEventHandler(containerUpdateAppliedHandlers, handler, options);
}

/**
 * Emit ContainerUpdateFailed event.
 * @param payload
 */
export async function emitContainerUpdateFailed(
  payload: ContainerUpdateFailedEventPayload,
): Promise<void> {
  await emitOrderedHandlers(containerUpdateFailedHandlers, payload);
}

/**
 * Register to ContainerUpdateFailed event.
 * @param handler
 */
export function registerContainerUpdateFailed(
  handler: OrderedEventHandlerFn<ContainerUpdateFailedEventPayload>,
  options: EventHandlerRegistrationOptions = {},
): () => void {
  return registerOrderedEventHandler(containerUpdateFailedHandlers, handler, options);
}

export async function emitUpdateOperationChanged(
  payload: UpdateOperationChangedEventPayload,
): Promise<void> {
  await emitOrderedHandlers(updateOperationChangedHandlers, payload);
}

export function registerUpdateOperationChanged(
  handler: OrderedEventHandlerFn<UpdateOperationChangedEventPayload>,
  options: EventHandlerRegistrationOptions = {},
): () => void {
  return registerOrderedEventHandler(updateOperationChangedHandlers, handler, options);
}

/**
 * Emit SecurityAlert event.
 * @param payload
 */
export async function emitSecurityAlert(payload: SecurityAlertEventPayload): Promise<void> {
  await emitOrderedHandlers(securityAlertHandlers, payload);
}

/**
 * Register to SecurityAlert event.
 * @param handler
 */
export function registerSecurityAlert(
  handler: OrderedEventHandlerFn<SecurityAlertEventPayload>,
  options: EventHandlerRegistrationOptions = {},
): () => void {
  return registerOrderedEventHandler(securityAlertHandlers, handler, options);
}

/**
 * Emit SecurityScanCycleComplete event. Fired after a scan cycle finishes so digest-mode
 * triggers can flush any buffered per-container alerts into a single summary notification.
 * @param payload
 */
export async function emitSecurityScanCycleComplete(
  payload: SecurityScanCycleCompleteEventPayload,
): Promise<void> {
  await emitOrderedHandlers(securityScanCycleCompleteHandlers, payload);
}

/**
 * Register to SecurityScanCycleComplete event.
 * @param handler
 */
export function registerSecurityScanCycleComplete(
  handler: OrderedEventHandlerFn<SecurityScanCycleCompleteEventPayload>,
  options: EventHandlerRegistrationOptions = {},
): () => void {
  return registerOrderedEventHandler(securityScanCycleCompleteHandlers, handler, options);
}

/**
 * Emit AgentConnected event.
 * @param payload
 */
export async function emitAgentConnected(payload: AgentConnectedEventPayload): Promise<void> {
  await emitOrderedHandlers(agentConnectedHandlers, payload);
}

/**
 * Register to AgentConnected event.
 * @param handler
 */
export function registerAgentConnected(
  handler: OrderedEventHandlerFn<AgentConnectedEventPayload>,
  options: EventHandlerRegistrationOptions = {},
): () => void {
  return registerOrderedEventHandler(agentConnectedHandlers, handler, options);
}

/**
 * Emit AgentDisconnected event.
 * @param payload
 */
export async function emitAgentDisconnected(payload: AgentDisconnectedEventPayload): Promise<void> {
  await emitOrderedHandlers(agentDisconnectedHandlers, payload);
}

/**
 * Register to AgentDisconnected event.
 * @param handler
 */
export function registerAgentDisconnected(
  handler: OrderedEventHandlerFn<AgentDisconnectedEventPayload>,
  options: EventHandlerRegistrationOptions = {},
): () => void {
  return registerOrderedEventHandler(agentDisconnectedHandlers, handler, options);
}

/**
 * Legacy EventEmitter dispatch path.
 *
 * These lifecycle and watcher handlers are intentionally kept as-is for
 * backwards compatibility while subscribers are migrated to ordered handlers.
 */

/**
 * Emit container added.
 * @param containerAdded
 */
export function emitContainerAdded(containerAdded: ContainerLifecycleEventPayload): void {
  eventEmitter.emit(DD_CONTAINER_ADDED, containerAdded);
}

/**
 * Register to container added event.
 * @param handler
 */
export function registerContainerAdded(
  handler: (payload: ContainerLifecycleEventPayload) => void,
): () => void {
  eventEmitter.on(DD_CONTAINER_ADDED, handler as (payload: unknown) => void);
  return () => {
    eventEmitter.off(DD_CONTAINER_ADDED, handler as (payload: unknown) => void);
  };
}

/**
 * Emit container added.
 * @param containerUpdated
 */
export function emitContainerUpdated(containerUpdated: ContainerLifecycleEventPayload): void {
  eventEmitter.emit(DD_CONTAINER_UPDATED, containerUpdated);
}

/**
 * Register to container updated event.
 * @param handler
 */
export function registerContainerUpdated(
  handler: (payload: ContainerLifecycleEventPayload) => void,
): () => void {
  eventEmitter.on(DD_CONTAINER_UPDATED, handler as (payload: unknown) => void);
  return () => {
    eventEmitter.off(DD_CONTAINER_UPDATED, handler as (payload: unknown) => void);
  };
}

/**
 * Emit container removed.
 * @param containerRemoved
 */
export function emitContainerRemoved(containerRemoved: ContainerLifecycleEventPayload): void {
  eventEmitter.emit(DD_CONTAINER_REMOVED, containerRemoved);
}

/**
 * Register to container removed event.
 * @param handler
 */
export function registerContainerRemoved(
  handler: (payload: ContainerLifecycleEventPayload) => void,
): () => void {
  eventEmitter.on(DD_CONTAINER_REMOVED, handler as (payload: unknown) => void);
  return () => {
    eventEmitter.off(DD_CONTAINER_REMOVED, handler as (payload: unknown) => void);
  };
}

export function emitWatcherStart(watcher: unknown): void {
  eventEmitter.emit(DD_WATCHER_START, watcher);
}

export function registerWatcherStart(handler: (watcher: unknown) => void): () => void {
  eventEmitter.on(DD_WATCHER_START, handler);
  return () => {
    eventEmitter.off(DD_WATCHER_START, handler);
  };
}

export function emitWatcherStop(watcher: unknown): void {
  eventEmitter.emit(DD_WATCHER_STOP, watcher);
}

export function registerWatcherStop(handler: (watcher: unknown) => void): () => void {
  eventEmitter.on(DD_WATCHER_STOP, handler);
  return () => {
    eventEmitter.off(DD_WATCHER_STOP, handler);
  };
}

export async function emitSelfUpdateStarting(
  payload: SelfUpdateStartingEventPayload,
): Promise<void> {
  await emitOrderedHandlers(selfUpdateStartingHandlers, payload);
}

export function registerSelfUpdateStarting(
  handler: OrderedEventHandlerFn<SelfUpdateStartingEventPayload>,
  options: EventHandlerRegistrationOptions = {},
): () => void {
  return registerOrderedEventHandler(selfUpdateStartingHandlers, handler, options);
}

/**
 * Emit BatchUpdateCompleted event. Fired when every operation in a batch reaches a terminal state.
 * @param payload
 */
export async function emitBatchUpdateCompleted(
  payload: BatchUpdateCompletedEventPayload,
): Promise<void> {
  await emitOrderedHandlers(batchUpdateCompletedHandlers, payload);
}

/**
 * Register to BatchUpdateCompleted event.
 * @param handler
 */
export function registerBatchUpdateCompleted(
  handler: OrderedEventHandlerFn<BatchUpdateCompletedEventPayload>,
  options: EventHandlerRegistrationOptions = {},
): () => void {
  return registerOrderedEventHandler(batchUpdateCompletedHandlers, handler, options);
}

// Audit log integration
registerAuditLogSubscriptions({
  registerContainerReport,
  registerContainerUpdateApplied,
  registerContainerUpdateFailed,
  registerSecurityAlert,
  registerAgentDisconnected,
  registerContainerAdded,
  registerContainerUpdated,
  registerContainerRemoved,
});

// Testing helper.
export function pruneAuditDedupeCacheForTests(
  cache: Map<string, number>,
  now: number,
  dedupeWindowMs: number,
): void {
  pruneAuditDedupeCacheForTestsInternal(cache, now, dedupeWindowMs);
}

// Testing helper.
export function clearAllListenersForTests(): void {
  eventEmitter.removeAllListeners();
  containerReportHandlers.clear();
  containerReportsHandlers.clear();
  watcherSnapshotHandlers.clear();
  containerUpdateAppliedHandlers.clear();
  containerUpdateFailedHandlers.clear();
  updateOperationChangedHandlers.clear();
  securityAlertHandlers.clear();
  securityScanCycleCompleteHandlers.clear();
  agentConnectedHandlers.clear();
  agentDisconnectedHandlers.clear();
  selfUpdateStartingHandlers.clear();
  batchUpdateCompletedHandlers.clear();
  clearAuditSubscriptionCachesForTests();
  handlerRegistrationSequence = 0;
}
