export type WebSocketStreamStatus = 'connected' | 'disconnected';

export interface WebSocketStreamConnectionOptions<TQuery extends object, TMessage> {
  query?: TQuery;
  onMessage: (message: TMessage) => void;
  onStatus?: (status: WebSocketStreamStatus) => void;
  webSocketFactory?: (url: string) => WebSocket;
  location?: Location;
  buildUrl: (query: TQuery, location: Location) => string;
  parseMessage: (data: unknown) => TMessage | null;
}

export interface WebSocketStreamConnection<TQuery extends object> {
  update: (query: Partial<TQuery>) => void;
  pause: () => void;
  resume: () => void;
  close: () => void;
  isPaused: () => boolean;
}

class WebSocketStreamConnectionController<TQuery extends object, TMessage>
  implements WebSocketStreamConnection<TQuery>
{
  private query: TQuery;
  private paused = false;
  private closed = false;
  private socket: WebSocket | undefined;
  private readonly locationRef: Location;
  private readonly webSocketFactory: (url: string) => WebSocket;

  constructor(private readonly options: WebSocketStreamConnectionOptions<TQuery, TMessage>) {
    this.query = { ...(options.query ?? {}) } as TQuery;
    this.locationRef = options.location ?? window.location;
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
    this.connect();
  }

  update(nextQuery: Partial<TQuery>): void {
    this.query = { ...this.query, ...nextQuery };
    this.closeSocket(1000, 'reconnect');
    this.connect();
  }

  pause(): void {
    if (this.paused || this.closed) {
      return;
    }
    this.paused = true;
    this.closeSocket(1000, 'pause');
  }

  resume(): void {
    if (!this.paused || this.closed) {
      return;
    }
    this.paused = false;
    this.connect();
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closeSocket(1000, 'manual-close');
  }

  isPaused(): boolean {
    return this.paused;
  }

  private connect(): void {
    if (this.closed || this.paused) {
      return;
    }

    const nextSocket = this.webSocketFactory(this.options.buildUrl(this.query, this.locationRef));
    this.socket = nextSocket;

    nextSocket.onopen = () => {
      if (this.isStaleSocket(nextSocket)) {
        return;
      }
      this.options.onStatus?.('connected');
    };
    nextSocket.onmessage = (event) => {
      if (this.isStaleSocket(nextSocket)) {
        return;
      }
      const message = this.options.parseMessage(event.data);
      if (message) {
        this.options.onMessage(message);
      }
    };
    nextSocket.onerror = () => {
      this.notifyDisconnectedIfActive(nextSocket);
    };
    nextSocket.onclose = () => {
      this.handleSocketClose(nextSocket);
    };
  }

  private closeSocket(code: number, reason: string): void {
    if (!this.socket) {
      return;
    }

    const activeSocket = this.socket;
    this.socket = undefined;
    activeSocket.close(code, reason);
  }

  private handleSocketClose(candidate: WebSocket): void {
    if (this.isStaleSocket(candidate)) {
      return;
    }

    const shouldNotify = !this.paused && !this.closed;
    this.socket = undefined;
    if (shouldNotify) {
      this.options.onStatus?.('disconnected');
    }
  }

  private isStaleSocket(candidate: WebSocket): boolean {
    return this.socket !== candidate;
  }

  private notifyDisconnectedIfActive(candidate: WebSocket): void {
    if (this.isStaleSocket(candidate) || this.paused || this.closed) {
      return;
    }
    this.options.onStatus?.('disconnected');
  }
}

export function createWebSocketStreamConnection<TQuery extends object, TMessage>(
  options: WebSocketStreamConnectionOptions<TQuery, TMessage>,
): WebSocketStreamConnection<TQuery> {
  return new WebSocketStreamConnectionController(options);
}
