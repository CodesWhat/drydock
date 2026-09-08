import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ContainerLifecycleEventContext } from '../event/index.js';
import { type Container, validate } from '../model/container.js';
import type {
  InventoryRefreshOptions,
  InventoryRefreshResult,
} from '../model/inventory-refresh.js';
import { applyUpdatePolicyOverrides, getUpdatePolicyOverrides } from '../model/update-policy.js';
import * as store from '../store/container.js';
import { findControllerLocalWatcherClaimingContainerId } from '../watchers/controller-local-container-ids.js';
import {
  InventoryRefreshOperationError,
  runInventoryRefresh,
  sanitizeInventoryErrors,
} from '../watchers/inventory-refresh.js';

interface Dependencies {
  agent: string;
  isConnected: () => boolean;
  request: (type: string, name: string, options: InventoryRefreshOptions) => Promise<unknown>;
}
interface Operation {
  context: ContainerLifecycleEventContext;
  cancellation: AbortController;
  current: () => boolean;
  baseline: Map<string, Container>;
  removed: Set<string>;
  errors: InventoryRefreshResult['errors'];
}
const PATCH_FIELDS = [
  'name',
  'displayName',
  'displayIcon',
  'status',
  'health',
  'labels',
  'details',
  'includeTags',
  'excludeTags',
  'transformTags',
  'tagFamily',
  'tagPinInfo',
  'linkTemplate',
  'portLabel',
  'actionTriggerInclude',
  'actionTriggerExclude',
  'notificationTriggerInclude',
  'notificationTriggerExclude',
  'actionTriggerAuto',
  'triggerInclude',
  'triggerExclude',
  'dependsOn',
  'dependsOnSource',
  'dependsOnAction',
] as const;
const ERROR_PHASES = new Set([
  'store',
  'enumerate',
  'inspect',
  'labels',
  'image',
  'ownership',
  'stale',
  'persist',
]);
const RUNTIME_FIELDS = new Set<string>(['name', 'status', 'health', 'details']);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function key(type: string, name: string) {
  return JSON.stringify([type, name]);
}
function matches(context: unknown, operation: Operation): boolean {
  return (
    record(context) &&
    context.origin === 'inventory' &&
    context.operationId === operation.context.operationId &&
    record(context.source) &&
    context.source.type === operation.context.source.type &&
    context.source.name === operation.context.source.name &&
    context.source.agent === undefined
  );
}
function parseContainer(value: unknown, operation: Operation): Container {
  if (
    !record(value) ||
    value.watcher !== operation.context.source.name ||
    (value.agent !== undefined && value.agent !== '')
  )
    throw new Error('Invalid inventory source');
  return validate({ ...value, agent: operation.context.source.agent });
}
function sameIdentity(previous: Container, current: Container) {
  return previous.identityKey === current.identityKey && previous.image.id === current.image.id;
}

export class AgentInventoryRefresh {
  private readonly active = new Map<string, Operation>();
  constructor(private readonly dependencies: Dependencies) {}

  invalidate(): void {
    for (const operation of this.active.values()) operation.cancellation.abort();
    this.active.clear();
  }

  private owned(operation: Operation, container: Container): boolean {
    return (
      container.agent === this.dependencies.agent &&
      container.watcher === operation.context.source.name
    );
  }

  private sourceContainers(operation: Operation): Container[] {
    return store.getContainersRaw({
      agent: this.dependencies.agent,
      watcher: operation.context.source.name,
    });
  }

  private fail(operation: Operation, phase: 'ownership' | 'persist', id: string): void {
    if (!operation.errors.some((error) => error.phase === phase && error.id === id))
      operation.errors.push({ phase, id, message: '' });
  }

  private remove(operation: Operation, id: string): void {
    if (!operation.current()) return;
    const current = store.getContainerRaw(id);
    if (!current) return;
    const baseline = operation.baseline.get(id);
    if (!this.owned(operation, current) || !baseline || !sameIdentity(baseline, current)) {
      this.fail(operation, 'ownership', id);
      return;
    }
    store.deleteContainer(id, { replacementExpected: true, context: operation.context });
    operation.removed.add(id);
    operation.baseline.delete(id);
  }

  private upsert(operation: Operation, incoming: Container): void {
    if (!operation.current()) return;
    const current = store.getContainerRaw(incoming.id);
    const baseline = operation.baseline.get(incoming.id);
    if (
      findControllerLocalWatcherClaimingContainerId(incoming.id) ||
      (current &&
        (!this.owned(operation, current) ||
          !baseline ||
          !sameIdentity(baseline, current) ||
          current.image.id !== incoming.image.id))
    ) {
      this.fail(operation, 'ownership', incoming.id);
      return;
    }
    if (!current) {
      if (
        baseline ||
        store.getContainersRaw({
          agent: this.dependencies.agent,
          watcher: operation.context.source.name,
          name: incoming.name,
        }).length > 0
      ) {
        this.fail(operation, 'ownership', incoming.id);
        return;
      }
      applyUpdatePolicyOverrides(incoming, {});
      const inserted = store.insertContainer(incoming, operation.context);
      operation.baseline.set(incoming.id, inserted);
      return;
    }
    const patch: Partial<Container> = {};
    const labelsCurrent = isDeepStrictEqual(current.labels, baseline!.labels);
    for (const field of PATCH_FIELDS) {
      if (!labelsCurrent && !RUNTIME_FIELDS.has(field)) continue;
      if (
        isDeepStrictEqual(current[field], baseline![field]) &&
        !isDeepStrictEqual(current[field], incoming[field])
      ) {
        Object.assign(patch, { [field]: incoming[field] });
      }
    }
    if (
      labelsCurrent &&
      isDeepStrictEqual(current.updatePolicyDeclarative, baseline!.updatePolicyDeclarative) &&
      !isDeepStrictEqual(current.updatePolicyDeclarative, incoming.updatePolicyDeclarative)
    ) {
      const policy = { ...current, updatePolicyDeclarative: incoming.updatePolicyDeclarative };
      applyUpdatePolicyOverrides(policy, getUpdatePolicyOverrides(current));
      Object.assign(patch, {
        updatePolicy: policy.updatePolicy,
        updatePolicyDeclarative: policy.updatePolicyDeclarative,
        updatePolicyOverrides: policy.updatePolicyOverrides,
        updatePolicySources: policy.updatePolicySources,
      });
    }
    if (Object.keys(patch).length === 0) return;
    store.updateContainerFields(incoming.id, patch, operation.context);
    operation.baseline.set(incoming.id, { ...baseline!, ...patch });
  }

  private mutate(operation: Operation, id: string, action: () => void): void {
    try {
      action();
    } catch {
      this.fail(operation, 'persist', id);
    }
  }

  handleEvent(eventName: string, value: unknown): void {
    if (!record(value) || !record(value.context) || !record(value.context.source)) return;
    const source = value.context.source;
    if (typeof source.type !== 'string' || typeof source.name !== 'string') return;
    const operation = this.active.get(key(source.type, source.name));
    if (!operation || !operation.current() || !matches(value.context, operation)) return;
    if (eventName === 'dd:inventory-removed') {
      if (record(value.container) && validId(value.container.id))
        this.mutate(operation, value.container.id, () =>
          this.remove(operation, (value.container as { id: string }).id),
        );
      return;
    }
    if (eventName !== 'dd:inventory-added' && eventName !== 'dd:inventory-updated') return;
    try {
      const container = parseContainer(value.container, operation);
      this.mutate(operation, container.id, () => this.upsert(operation, container));
    } catch {
      /* Invalid remote frames never enter the store. */
    }
  }

  private finish(operation: Operation, value: unknown): InventoryRefreshResult {
    if (!operation.current()) return this.result(operation, false);
    let incoming: Container[];
    try {
      if (
        !record(value) ||
        !matches(value.context, operation) ||
        !Array.isArray(value.containers) ||
        !Array.isArray(value.removedIds) ||
        !value.removedIds.every(validId) ||
        !Array.isArray(value.errors) ||
        !value.errors.every(
          (error) =>
            record(error) &&
            typeof error.phase === 'string' &&
            ERROR_PHASES.has(error.phase) &&
            typeof error.message === 'string' &&
            (error.id === undefined || validId(error.id)),
        ) ||
        typeof value.authoritative !== 'boolean'
      )
        throw new Error('Invalid inventory result');
      incoming = value.containers.map((container) => parseContainer(container, operation));
      const ids = new Set(incoming.map((container) => container.id));
      if (ids.size !== incoming.length || value.removedIds.some((id) => ids.has(id)))
        throw new Error('Conflicting inventory identities');
    } catch {
      throw new InventoryRefreshOperationError(500, 'Invalid agent inventory response');
    }
    const parsed = value as unknown as InventoryRefreshResult;
    operation.errors.push(...sanitizeInventoryErrors(parsed.errors));
    if (!parsed.errors.some((error) => error.id === undefined)) {
      const failedIds = new Set(parsed.errors.map((error) => error.id));
      for (const id of parsed.removedIds)
        if (!failedIds.has(id)) this.mutate(operation, id, () => this.remove(operation, id));
      for (const container of incoming)
        if (!failedIds.has(container.id))
          this.mutate(operation, container.id, () => this.upsert(operation, container));
    }
    return this.result(operation, parsed.authoritative);
  }

  private result(operation: Operation, authoritative: boolean): InventoryRefreshResult {
    return {
      context: operation.context,
      containers: this.sourceContainers(operation),
      removedIds: [...operation.removed],
      errors: sanitizeInventoryErrors(operation.errors),
      authoritative: authoritative && operation.current() && operation.errors.length === 0,
    };
  }

  async refresh(
    type: string,
    name: string,
    options: InventoryRefreshOptions = {},
  ): Promise<InventoryRefreshResult> {
    if (!this.dependencies.isConnected())
      throw new InventoryRefreshOperationError(503, 'Agent is disconnected');
    const sourceKey = key(type, name);
    this.active.get(sourceKey)?.cancellation.abort();
    const cancellation = new AbortController();
    const operation: Operation = {
      context: {
        origin: 'inventory',
        operationId: options.operationId ?? randomUUID(),
        source: { type: 'docker', name, agent: this.dependencies.agent },
      },
      cancellation,
      current: () =>
        this.active.get(sourceKey) === operation &&
        this.dependencies.isConnected() &&
        (options.isCurrent?.() ?? true),
      baseline: new Map(),
      removed: new Set(),
      errors: [],
    };
    operation.baseline = new Map(
      this.sourceContainers(operation).map((container) => [container.id, container]),
    );
    this.active.set(sourceKey, operation);
    try {
      return await runInventoryRefresh(
        {
          refreshInventory: async (effective) => {
            operation.current = effective!.isCurrent!;
            try {
              return this.finish(
                operation,
                await this.dependencies.request(type, name, effective!),
              );
            } catch (error) {
              if (!operation.current()) return this.result(operation, false);
              throw error;
            }
          },
        },
        {
          operationId: operation.context.operationId,
          signal: options.signal
            ? AbortSignal.any([options.signal, cancellation.signal])
            : cancellation.signal,
          isCurrent: operation.current,
        },
      );
    } finally {
      cancellation.abort();
      if (this.active.get(sourceKey) === operation) this.active.delete(sourceKey);
    }
  }
}
