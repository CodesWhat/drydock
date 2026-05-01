import { defineStore } from 'pinia';
import { ref } from 'vue';

export type SseBusEvent =
  | 'sse:connected'
  | 'self-update'
  | 'connection-lost'
  | 'container-changed'
  | 'container-added'
  | 'container-updated'
  | 'container-removed'
  | 'update-operation-changed'
  | 'update-applied'
  | 'update-failed'
  | 'batch-update-completed'
  | 'agent-status-changed'
  | 'scan-started'
  | 'scan-completed'
  | 'resync-required';

export type EventStreamConnectionStatus = 'connecting' | 'open' | 'closed' | 'error';

export type OperationChangedPayload = {
  operationId?: string;
  containerName?: string;
  containerId?: string;
  newContainerId?: string;
  batchId?: string;
  status: string;
  phase?: string;
  lastError?: string;
  rollbackReason?: string;
};

export type ScanLifecyclePayload = {
  containerId?: string;
  status?: string;
};

export type ContainerLifecycleChangedPayload = Record<string, unknown> & {
  id?: string;
  name?: string;
  replacementExpected?: boolean;
};

type SelfUpdateSsePayload = {
  opId?: string;
  requiresAck?: boolean;
  ackTimeoutMs?: number;
  startedAt?: string;
};

export type ResyncRequiredPayload = {
  reason: 'boot-mismatch' | 'buffer-evicted';
};

export type UpdateAppliedPayload = {
  operationId: string;
  containerId: string;
  containerName: string;
  imageName?: string;
  previousDigest?: string | null;
  newDigest?: string | null;
  batchId?: string | null;
  timestamp: string;
};

export type UpdateFailedPayload = {
  operationId: string;
  containerId: string;
  containerName: string;
  error: string;
  phase: string;
  batchId?: string | null;
  timestamp: string;
};

export type BatchUpdateCompletedPayload = {
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
};

type ConnectedSsePayload = {
  clientId?: string;
  clientToken?: string;
};

export interface EventStreamEvent {
  id?: string;
  event: SseBusEvent;
  payload?: unknown;
  receivedAt: number;
}

export interface SseEventBus {
  emit: (event: SseBusEvent, payload?: unknown) => void;
}

type EventStreamSubscriber = (payload: unknown, event: EventStreamEvent) => void;

const MAX_RECENT_EVENTS = 500;

export function createManagedEventSource(streamUrl: string): EventSource {
  return new EventSource(streamUrl);
}

export const useEventStreamStore = defineStore('eventStream', () => {
  const status = ref<EventStreamConnectionStatus>('closed');
  const lastEventId = ref<string | undefined>();
  const recentEvents = ref<EventStreamEvent[]>([]);

  let eventSource: EventSource | undefined;
  let eventBus: SseEventBus | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let selfUpdateMode = false;
  let consecutiveErrors = 0;
  let serverClientId: string | undefined;
  let serverClientToken: string | undefined;
  const subscribers = new Map<SseBusEvent, Set<EventStreamSubscriber>>();

  function emit(
    event: SseBusEvent,
    payload?: unknown,
    id?: string,
    emitUndefinedPayload = false,
  ): void {
    if (id) {
      lastEventId.value = id;
    }
    const entry: EventStreamEvent = {
      id,
      event,
      payload,
      receivedAt: Date.now(),
    };
    recentEvents.value = [...recentEvents.value.slice(-(MAX_RECENT_EVENTS - 1)), entry];
    if (payload === undefined && !emitUndefinedPayload) {
      eventBus?.emit(event);
    } else {
      eventBus?.emit(event, payload);
    }
    for (const subscriber of subscribers.get(event) || []) {
      subscriber(payload, entry);
    }
  }

  function publish(event: SseBusEvent, payload?: unknown, id?: string): void {
    emit(event, payload, id, true);
  }

  function subscribe(event: SseBusEvent, subscriber: EventStreamSubscriber): () => void {
    const eventSubscribers = subscribers.get(event) || new Set<EventStreamSubscriber>();
    eventSubscribers.add(subscriber);
    subscribers.set(event, eventSubscribers);
    return () => {
      eventSubscribers.delete(subscriber);
      if (eventSubscribers.size === 0) {
        subscribers.delete(event);
      }
    };
  }

  function connect(bus?: SseEventBus): void {
    eventBus = bus;
    doConnect();
  }

  function doConnect(): void {
    closeSource();
    status.value = 'connecting';
    eventSource = createManagedEventSource('/api/v1/events/ui');
    registerEventSourceListeners(eventSource);
  }

  function clearReconnectTimer(): void {
    if (!reconnectTimer) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }

  function registerEventSourceListeners(source: EventSource): void {
    source.addEventListener('dd:connected', (event: MessageEvent) => {
      const connectedPayload = parseConnectedPayload(event?.data);
      serverClientId = connectedPayload.clientId;
      serverClientToken = connectedPayload.clientToken;
      clearReconnectTimer();
      consecutiveErrors = 0;
      status.value = 'open';
      emit('sse:connected', undefined, event?.lastEventId || undefined);
    });

    source.addEventListener('dd:self-update', (event: MessageEvent) => {
      const payload = parseSelfUpdatePayload(event?.data);
      selfUpdateMode = true;
      if (payload.opId) {
        void acknowledgeSelfUpdate(payload.opId, event?.lastEventId || undefined);
      }
      emit('self-update', payload, event?.lastEventId || undefined);
    });

    source.addEventListener('dd:scan-started', (event: MessageEvent) => {
      emit('scan-started', parseScanLifecyclePayload(event?.data), event?.lastEventId || undefined);
    });

    source.addEventListener('dd:scan-completed', (event: MessageEvent) => {
      emit(
        'scan-completed',
        parseScanLifecyclePayload(event?.data),
        event?.lastEventId || undefined,
      );
    });

    source.addEventListener('dd:container-added', (event) => {
      const payload = parseContainerLifecyclePayload(event);
      emit('container-added', payload, (event as MessageEvent)?.lastEventId || undefined, true);
      emit('container-changed', payload, (event as MessageEvent)?.lastEventId || undefined, true);
    });

    source.addEventListener('dd:container-updated', (event) => {
      const payload = parseContainerLifecyclePayload(event);
      emit('container-updated', payload, (event as MessageEvent)?.lastEventId || undefined, true);
      emit('container-changed', payload, (event as MessageEvent)?.lastEventId || undefined, true);
    });

    source.addEventListener('dd:container-removed', (event) => {
      const payload = parseContainerLifecyclePayload(event);
      emit('container-removed', payload, (event as MessageEvent)?.lastEventId || undefined, true);
      emit('container-changed', payload, (event as MessageEvent)?.lastEventId || undefined, true);
    });

    source.addEventListener('dd:update-operation-changed', (event) => {
      emit(
        'update-operation-changed',
        parseOperationPayload(event),
        (event as MessageEvent)?.lastEventId || undefined,
        true,
      );
    });

    source.addEventListener('dd:agent-connected', (event) => {
      emit('agent-status-changed', undefined, (event as MessageEvent)?.lastEventId || undefined);
    });

    source.addEventListener('dd:agent-disconnected', (event) => {
      emit('agent-status-changed', undefined, (event as MessageEvent)?.lastEventId || undefined);
    });

    source.addEventListener('dd:resync-required', (event: MessageEvent) => {
      emit(
        'resync-required',
        parseResyncRequiredPayload(event?.data),
        event?.lastEventId || undefined,
      );
    });

    source.addEventListener('dd:update-applied', (event: MessageEvent) => {
      emit('update-applied', parseJsonPayload(event?.data), event?.lastEventId || undefined, true);
    });

    source.addEventListener('dd:update-failed', (event: MessageEvent) => {
      emit('update-failed', parseJsonPayload(event?.data), event?.lastEventId || undefined, true);
    });

    source.addEventListener('dd:batch-update-completed', (event: MessageEvent) => {
      emit(
        'batch-update-completed',
        parseJsonPayload(event?.data),
        event?.lastEventId || undefined,
        true,
      );
    });

    source.onerror = (): void => {
      consecutiveErrors++;
      status.value = 'error';
      if (selfUpdateMode) {
        emit('connection-lost');
      } else if (consecutiveErrors >= 2) {
        emit('connection-lost');
        scheduleReconnect();
      } else {
        scheduleReconnect();
      }
    };
  }

  function scheduleReconnect(delayMs = 5000): void {
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      doConnect();
    }, delayMs);
  }

  function parseOperationPayload(event: Event): OperationChangedPayload | undefined {
    const rawData = (event as MessageEvent)?.data;
    if (!rawData || typeof rawData !== 'string') {
      return undefined;
    }
    try {
      const parsed = JSON.parse(rawData);
      if (!parsed || typeof parsed !== 'object') {
        return undefined;
      }
      const p = parsed as Record<string, unknown>;
      if (typeof p.status !== 'string') {
        return undefined;
      }
      return {
        operationId: typeof p.operationId === 'string' ? p.operationId : undefined,
        containerName: typeof p.containerName === 'string' ? p.containerName : undefined,
        containerId: typeof p.containerId === 'string' ? p.containerId : undefined,
        newContainerId: typeof p.newContainerId === 'string' ? p.newContainerId : undefined,
        batchId: typeof p.batchId === 'string' ? p.batchId : undefined,
        status: p.status,
        phase: typeof p.phase === 'string' ? p.phase : undefined,
        lastError: typeof p.lastError === 'string' ? p.lastError : undefined,
        rollbackReason: typeof p.rollbackReason === 'string' ? p.rollbackReason : undefined,
      };
    } catch {
      return undefined;
    }
  }

  function parseContainerLifecyclePayload(
    event: Event,
  ): ContainerLifecycleChangedPayload | undefined {
    const rawData = (event as MessageEvent)?.data;
    if (!rawData || typeof rawData !== 'string') {
      return undefined;
    }
    try {
      const parsed = JSON.parse(rawData);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return undefined;
      }
      return parsed as ContainerLifecycleChangedPayload;
    } catch {
      return undefined;
    }
  }

  function parseSelfUpdatePayload(rawData: unknown): SelfUpdateSsePayload {
    if (!rawData || typeof rawData !== 'string') {
      return {};
    }
    try {
      const parsed = JSON.parse(rawData);
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      return parsed as SelfUpdateSsePayload;
    } catch {
      return {};
    }
  }

  function parseConnectedPayload(rawData: unknown): ConnectedSsePayload {
    if (!rawData || typeof rawData !== 'string') {
      return {};
    }
    try {
      const parsed = JSON.parse(rawData);
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      const clientId = typeof parsed.clientId === 'string' ? parsed.clientId : undefined;
      const clientToken = typeof parsed.clientToken === 'string' ? parsed.clientToken : undefined;
      return { clientId, clientToken };
    } catch {
      return {};
    }
  }

  function parseScanLifecyclePayload(rawData: unknown): ScanLifecyclePayload {
    if (!rawData || typeof rawData !== 'string') {
      return {};
    }
    try {
      const parsed = JSON.parse(rawData);
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      const p = parsed as Record<string, unknown>;
      return {
        containerId: typeof p.containerId === 'string' ? p.containerId : undefined,
        status: typeof p.status === 'string' ? p.status : undefined,
      };
    } catch {
      return {};
    }
  }

  function parseJsonPayload(rawData: unknown): Record<string, unknown> | undefined {
    if (!rawData || typeof rawData !== 'string') {
      return undefined;
    }
    try {
      const parsed = JSON.parse(rawData);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return undefined;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  function parseResyncRequiredPayload(rawData: unknown): ResyncRequiredPayload {
    if (!rawData || typeof rawData !== 'string') {
      return { reason: 'boot-mismatch' };
    }
    try {
      const parsed = JSON.parse(rawData);
      if (!parsed || typeof parsed !== 'object') {
        return { reason: 'boot-mismatch' };
      }
      const reason = (parsed as Record<string, unknown>).reason;
      if (reason === 'boot-mismatch' || reason === 'buffer-evicted') {
        return { reason };
      }
      return { reason: 'boot-mismatch' };
    } catch {
      return { reason: 'boot-mismatch' };
    }
  }

  async function acknowledgeSelfUpdate(opId: string, lastEventId?: string): Promise<void> {
    if (!serverClientId || !serverClientToken) {
      return;
    }
    try {
      const payload: Record<string, string> = {
        clientId: serverClientId,
        clientToken: serverClientToken,
      };
      if (lastEventId) {
        payload.lastEventId = lastEventId;
      }
      await fetch(`/api/v1/events/ui/self-update/${encodeURIComponent(opId)}/ack`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // Best effort ack; no-op when connection is unstable.
    }
  }

  function closeSource(): void {
    if (eventSource) {
      eventSource.close();
      eventSource = undefined;
    }
  }

  function disconnect(): void {
    clearReconnectTimer();
    closeSource();
    eventBus = undefined;
    selfUpdateMode = false;
    consecutiveErrors = 0;
    serverClientId = undefined;
    serverClientToken = undefined;
    status.value = 'closed';
  }

  return {
    status,
    lastEventId,
    recentEvents,
    connect,
    disconnect,
    publish,
    subscribe,
  };
});
