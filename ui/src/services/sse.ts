type SseBusEvent =
  | 'sse:connected'
  | 'self-update'
  | 'connection-lost'
  | 'container-changed'
  | 'container-added'
  | 'container-updated'
  | 'container-removed'
  | 'update-operation-changed'
  | 'agent-status-changed'
  | 'scan-started'
  | 'scan-completed'
  | 'resync-required';

export type OperationChangedPayload = {
  operationId?: string;
  containerName?: string;
  containerId?: string;
  newContainerId?: string;
  status: string;
  phase?: string;
};

// Backend emits dd:scan-started / dd:scan-completed with the containerId so the
// UI can pin the per-row scanning chip to the row whose container is actually
// being scanned (manual single-container scans, scheduled scans, and bulk scans
// all emit per-container events). dd:scan-completed additionally carries the
// scan status so the bell / refresh hooks can react to error vs success.
export type ScanLifecyclePayload = {
  containerId?: string;
  status?: string;
};

// The backend spreads the full validated container object into the SSE payload
// for dd:container-added/-updated (app/store/container.ts) and adds
// `replacementExpected` on dd:container-removed when the remove is part of a
// recreate cycle. We forward the raw object to let consumers run it through
// mapApiContainer() for in-place row patching — avoiding the full-list refetch
// that the previous bare 'container-changed' signal forced.
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

type ConnectedSsePayload = {
  clientId?: string;
  clientToken?: string;
};

interface SseEventBus {
  emit: (event: SseBusEvent, payload?: unknown) => void;
}

class SseService {
  private eventSource: EventSource | undefined;
  private eventBus: SseEventBus | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private selfUpdateMode = false;
  private consecutiveErrors = 0;
  private serverClientId: string | undefined;
  private serverClientToken: string | undefined;

  connect(eventBus: SseEventBus): void {
    this.eventBus = eventBus;
    this.doConnect();
  }

  private doConnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.eventSource = new EventSource('/api/v1/events/ui');

    this.eventSource.addEventListener('dd:connected', (event: MessageEvent) => {
      const connectedPayload = this.parseConnectedPayload(event?.data);
      this.serverClientId = connectedPayload.clientId;
      this.serverClientToken = connectedPayload.clientToken;
      this.consecutiveErrors = 0;
      this.eventBus?.emit('sse:connected');
    });

    this.eventSource.addEventListener('dd:self-update', (event: MessageEvent) => {
      const payload = this.parseSelfUpdatePayload(event?.data);
      this.selfUpdateMode = true;
      if (payload.opId) {
        void this.acknowledgeSelfUpdate(payload.opId, event?.lastEventId || undefined);
      }
      this.eventBus?.emit('self-update', payload);
    });

    this.eventSource.addEventListener('dd:scan-started', (event: MessageEvent) => {
      this.eventBus?.emit('scan-started', this.parseScanLifecyclePayload(event?.data));
    });

    this.eventSource.addEventListener('dd:scan-completed', (event: MessageEvent) => {
      this.eventBus?.emit('scan-completed', this.parseScanLifecyclePayload(event?.data));
    });

    this.eventSource.addEventListener('dd:container-added', (event) => {
      const payload = this.parseContainerLifecyclePayload(event);
      this.eventBus?.emit('container-added', payload);
      this.eventBus?.emit('container-changed', payload);
    });

    this.eventSource.addEventListener('dd:container-updated', (event) => {
      const payload = this.parseContainerLifecyclePayload(event);
      this.eventBus?.emit('container-updated', payload);
      this.eventBus?.emit('container-changed', payload);
    });

    this.eventSource.addEventListener('dd:container-removed', (event) => {
      const payload = this.parseContainerLifecyclePayload(event);
      this.eventBus?.emit('container-removed', payload);
      this.eventBus?.emit('container-changed', payload);
    });

    this.eventSource.addEventListener('dd:update-operation-changed', (event) => {
      // Operation phase changes (queued/pulling/restarting/failed/cancelled) do not mutate
      // container state. Terminal success fires dd:container-updated on its own, so emitting
      // container-changed here triggers a redundant full refresh on every phase transition.
      this.eventBus?.emit('update-operation-changed', this.parseOperationPayload(event));
    });

    this.eventSource.addEventListener('dd:agent-connected', () => {
      this.eventBus?.emit('agent-status-changed');
    });

    this.eventSource.addEventListener('dd:agent-disconnected', () => {
      this.eventBus?.emit('agent-status-changed');
    });

    this.eventSource.addEventListener('dd:resync-required', (event: MessageEvent) => {
      const payload = this.parseResyncRequiredPayload(event?.data);
      this.eventBus?.emit('resync-required', payload);
    });

    this.eventSource.onerror = (): void => {
      this.consecutiveErrors++;
      if (this.selfUpdateMode) {
        this.eventBus?.emit('connection-lost');
      } else if (this.consecutiveErrors >= 2) {
        // Server likely down — emit connection-lost after 2 consecutive failures
        this.eventBus?.emit('connection-lost');
        this.scheduleReconnect();
      } else {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(delayMs = 5000): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.doConnect(), delayMs);
  }

  private parseOperationPayload(event: Event): OperationChangedPayload | undefined {
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
        status: p.status,
        phase: typeof p.phase === 'string' ? p.phase : undefined,
      };
    } catch {
      return undefined;
    }
  }

  private parseContainerLifecyclePayload(
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

  private parseSelfUpdatePayload(rawData: unknown): SelfUpdateSsePayload {
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

  private parseConnectedPayload(rawData: unknown): ConnectedSsePayload {
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

  private parseScanLifecyclePayload(rawData: unknown): ScanLifecyclePayload {
    if (!rawData || typeof rawData !== 'string') {
      return {};
    }
    try {
      const parsed = JSON.parse(rawData);
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      const containerId =
        typeof (parsed as Record<string, unknown>).containerId === 'string'
          ? ((parsed as Record<string, unknown>).containerId as string)
          : undefined;
      const status =
        typeof (parsed as Record<string, unknown>).status === 'string'
          ? ((parsed as Record<string, unknown>).status as string)
          : undefined;
      return { containerId, status };
    } catch {
      return {};
    }
  }

  private parseResyncRequiredPayload(rawData: unknown): ResyncRequiredPayload {
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

  private async acknowledgeSelfUpdate(opId: string, lastEventId?: string): Promise<void> {
    if (!this.serverClientId || !this.serverClientToken) {
      return;
    }
    try {
      const payload: Record<string, string> = {
        clientId: this.serverClientId,
        clientToken: this.serverClientToken,
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

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
    this.eventBus = undefined;
    this.selfUpdateMode = false;
    this.consecutiveErrors = 0;
    this.serverClientId = undefined;
    this.serverClientToken = undefined;
  }
}

export default new SseService();
