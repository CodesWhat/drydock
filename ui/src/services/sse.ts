type SseBusEvent =
  | 'sse:connected'
  | 'self-update'
  | 'connection-lost'
  | 'container-changed'
  | 'update-operation-changed'
  | 'agent-status-changed'
  | 'scan-started'
  | 'scan-completed';

export type OperationChangedPayload = {
  operationId?: string;
  containerName?: string;
  containerId?: string;
  newContainerId?: string;
  status: string;
  phase?: string;
};

type SelfUpdateSsePayload = {
  opId?: string;
  requiresAck?: boolean;
  ackTimeoutMs?: number;
  startedAt?: string;
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

    this.eventSource.addEventListener('dd:scan-started', () => {
      this.eventBus?.emit('scan-started');
    });

    this.eventSource.addEventListener('dd:scan-completed', () => {
      this.eventBus?.emit('scan-completed');
    });

    this.eventSource.addEventListener('dd:container-added', () => {
      this.eventBus?.emit('container-changed');
    });

    this.eventSource.addEventListener('dd:container-updated', () => {
      this.eventBus?.emit('container-changed');
    });

    this.eventSource.addEventListener('dd:container-removed', () => {
      this.eventBus?.emit('container-changed');
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
