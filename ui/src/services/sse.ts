type SseBusEvent =
  | 'sse:connected'
  | 'self-update'
  | 'connection-lost'
  | 'scan-started'
  | 'scan-completed';

interface SseEventBus {
  emit: (event: SseBusEvent) => void;
}

class SseService {
  private eventSource: EventSource | undefined;
  private eventBus: SseEventBus | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private selfUpdateMode = false;
  private consecutiveErrors = 0;

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
      this.consecutiveErrors = 0;
      this.eventBus?.emit('sse:connected');
    });

    this.eventSource.addEventListener('dd:self-update', () => {
      this.selfUpdateMode = true;
      this.eventBus?.emit('self-update');
    });

    this.eventSource.addEventListener('dd:scan-started', () => {
      this.eventBus?.emit('scan-started');
    });

    this.eventSource.addEventListener('dd:scan-completed', () => {
      this.eventBus?.emit('scan-completed');
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
    return;
  }
}

export default new SseService();
