import { EventEmitter } from 'node:events';
import type { Container, ContainerReport } from '../model/container.js';
import {
  clearAuditSubscriptionCachesForTests,
  pruneAuditDedupeCacheForTests as pruneAuditDedupeCacheForTestsInternal,
  registerAuditLogSubscriptions,
} from './audit-subscriptions.js';

// Build EventEmitter
const eventEmitter = new EventEmitter();

// Container related events
const DD_CONTAINER_ADDED = 'dd:container-added';
const DD_CONTAINER_UPDATED = 'dd:container-updated';
const DD_CONTAINER_REMOVED = 'dd:container-removed';

// Watcher related events
const DD_WATCHER_START = 'dd:watcher-start';
const DD_WATCHER_STOP = 'dd:watcher-stop';

const DEFAULT_HANDLER_ORDER = 100;

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
}

export interface AgentConnectedEventPayload {
  agentName: string;
}

export interface AgentDisconnectedEventPayload {
  agentName: string;
  reason?: string;
}

export type ContainerLifecycleEventPayload = Partial<Omit<Container, 'image'>> & {
  image?: Partial<Container['image']>;
};

const containerReportHandlers = new Map<number, OrderedEventHandler<ContainerReport>>();
const containerReportsHandlers = new Map<number, OrderedEventHandler<ContainerReport[]>>();
const containerUpdateAppliedHandlers = new Map<number, OrderedEventHandler<string>>();
const containerUpdateFailedHandlers = new Map<
  number,
  OrderedEventHandler<ContainerUpdateFailedEventPayload>
>();
const securityAlertHandlers = new Map<number, OrderedEventHandler<SecurityAlertEventPayload>>();
const agentConnectedHandlers = new Map<number, OrderedEventHandler<AgentConnectedEventPayload>>();
const agentDisconnectedHandlers = new Map<
  number,
  OrderedEventHandler<AgentDisconnectedEventPayload>
>();
const selfUpdateStartingHandlers = new Map<
  number,
  OrderedEventHandler<SelfUpdateStartingEventPayload>
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

async function emitOrderedHandlers<TPayload>(
  handlers: Map<number, OrderedEventHandler<TPayload>>,
  payload: TPayload,
): Promise<void> {
  const handlersOrdered = [...handlers.values()].sort(compareOrderedHandlers);
  for (const handler of handlersOrdered) {
    await handler.handler(payload);
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
 * @param containerId
 */
export async function emitContainerUpdateApplied(containerId: string): Promise<void> {
  await emitOrderedHandlers(containerUpdateAppliedHandlers, containerId);
}

/**
 * Register to ContainerUpdateApplied event.
 * @param handler
 */
export function registerContainerUpdateApplied(
  handler: OrderedEventHandlerFn<string>,
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
): void {
  eventEmitter.on(DD_CONTAINER_ADDED, handler as (payload: unknown) => void);
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
): void {
  eventEmitter.on(DD_CONTAINER_UPDATED, handler as (payload: unknown) => void);
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
): void {
  eventEmitter.on(DD_CONTAINER_REMOVED, handler as (payload: unknown) => void);
}

export function emitWatcherStart(watcher: unknown): void {
  eventEmitter.emit(DD_WATCHER_START, watcher);
}

export function registerWatcherStart(handler: (watcher: unknown) => void): void {
  eventEmitter.on(DD_WATCHER_START, handler);
}

export function emitWatcherStop(watcher: unknown): void {
  eventEmitter.emit(DD_WATCHER_STOP, watcher);
}

export function registerWatcherStop(handler: (watcher: unknown) => void): void {
  eventEmitter.on(DD_WATCHER_STOP, handler);
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

// Audit log integration
registerAuditLogSubscriptions({
  registerContainerReport,
  registerContainerUpdateApplied,
  registerContainerUpdateFailed,
  registerSecurityAlert,
  registerAgentDisconnected,
  registerContainerAdded,
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
  containerUpdateAppliedHandlers.clear();
  containerUpdateFailedHandlers.clear();
  securityAlertHandlers.clear();
  agentConnectedHandlers.clear();
  agentDisconnectedHandlers.clear();
  selfUpdateStartingHandlers.clear();
  clearAuditSubscriptionCachesForTests();
  handlerRegistrationSequence = 0;
}
