type SseBusEvent = 'sse:connected' | 'self-update' | 'connection-lost';

interface SseEventBus {
  emit: (event: SseBusEvent) => void;
}

class SseService {
  private eventSource: EventSource | undefined;
  private eventBus: SseEventBus | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private selfUpdateMode = false;

  connect(eventBus: SseEventBus): void {
    this.eventBus = eventBus;
    this.doConnect();
  }

  private doConnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.eventSource = new EventSource('/api/events/ui');

    this.eventSource.addEventListener('dd:connected', () => {
      this.eventBus?.emit('sse:connected');
    });

    this.eventSource.addEventListener('dd:self-update', () => {
      this.selfUpdateMode = true;
      this.eventBus?.emit('self-update');
    });

    this.eventSource.addEventListener('dd:heartbeat', () => {
      // Keep-alive, no action needed
    });

    this.eventSource.onerror = (): void => {
      if (this.selfUpdateMode) {
        this.eventBus?.emit('connection-lost');
      } else {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(delayMs = 5000): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.doConnect(), delayMs);
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
  }
}

export default new SseService();
