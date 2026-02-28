type SseBusEvent =
  | 'sse:connected'
  | 'self-update'
  | 'connection-lost'
  | 'container-changed'
  | 'agent-status-changed'
  | 'scan-started'
  | 'scan-completed';

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

    this.eventSource = new EventSource('/api/events/ui');

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

    this.eventSource.addEventListener('dd:agent-connected', () => {
      this.eventBus?.emit('agent-status-changed');
    });

    this.eventSource.addEventListener('dd:agent-disconnected', () => {
      this.eventBus?.emit('agent-status-changed');
    });

    this.eventSource.addEventListener('dd:heartbeat', () => {
      // Keep-alive, no action needed
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
      await fetch(`/api/events/ui/self-update/${encodeURIComponent(opId)}/ack`, {
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
    return;
  }
}

export default new SseService();
