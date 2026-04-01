export interface SystemLogEntry {
  timestamp: number;
  displayTimestamp?: string;
  level: string;
  component: string;
  msg: string;
}

export type SystemLogStreamStatus = 'connected' | 'disconnected';

export interface SystemLogStreamQuery {
  level?: string;
  component?: string;
  tail?: number;
}

interface SystemLogStreamConnectionOptions {
  query?: SystemLogStreamQuery;
  onMessage: (entry: SystemLogEntry) => void;
  onStatus?: (status: SystemLogStreamStatus) => void;
  webSocketFactory?: (url: string) => WebSocket;
  location?: Location;
}

export interface SystemLogStreamConnection {
  update: (query: Partial<SystemLogStreamQuery>) => void;
  pause: () => void;
  resume: () => void;
  close: () => void;
  isPaused: () => boolean;
}

function isSystemLogEntry(payload: unknown): payload is SystemLogEntry {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const entry = payload as Record<string, unknown>;
  return (
    typeof entry.timestamp === 'number' &&
    (entry.displayTimestamp === undefined || typeof entry.displayTimestamp === 'string') &&
    typeof entry.level === 'string' &&
    typeof entry.component === 'string' &&
    typeof entry.msg === 'string'
  );
}

function parseSystemLogMessage(data: unknown): SystemLogEntry | null {
  if (typeof data !== 'string') {
    return null;
  }
  try {
    const payload = JSON.parse(data);
    return isSystemLogEntry(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function buildSystemLogStreamUrl(
  query: SystemLogStreamQuery = {},
  locationRef: Location = window.location,
): string {
  const protocol = locationRef.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams();
  if (query.level && query.level !== 'all') {
    params.set('level', query.level);
  }
  if (query.component) {
    params.set('component', query.component);
  }
  params.set('tail', `${query.tail ?? 100}`);

  return `${protocol}//${locationRef.host}/api/v1/log/stream?${params.toString()}`;
}

export function createSystemLogStreamConnection(
  options: SystemLogStreamConnectionOptions,
): SystemLogStreamConnection {
  const webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
  const locationRef = options.location ?? window.location;
  let query: SystemLogStreamQuery = { ...options.query };
  let paused = false;
  let closed = false;
  let socket: WebSocket | undefined;

  function closeSocket(code: number, reason: string) {
    if (!socket) {
      return;
    }
    const activeSocket = socket;
    socket = undefined;
    activeSocket.close(code, reason);
  }

  function isActiveSocket(candidate: WebSocket): boolean {
    return socket === candidate;
  }

  function notifyDisconnectedIfActive(candidate: WebSocket) {
    if (!isActiveSocket(candidate) || paused || closed) {
      return;
    }
    options.onStatus?.('disconnected');
  }

  function connect() {
    if (closed || paused) {
      return;
    }

    const streamUrl = buildSystemLogStreamUrl(query, locationRef);
    const nextSocket = webSocketFactory(streamUrl);
    socket = nextSocket;

    nextSocket.onopen = () => {
      if (!isActiveSocket(nextSocket)) {
        return;
      }
      options.onStatus?.('connected');
    };
    nextSocket.onmessage = (event) => {
      if (!isActiveSocket(nextSocket)) {
        return;
      }
      const entry = parseSystemLogMessage(event.data);
      if (entry) {
        options.onMessage(entry);
      }
    };
    nextSocket.onerror = () => {
      notifyDisconnectedIfActive(nextSocket);
    };
    nextSocket.onclose = () => {
      if (!isActiveSocket(nextSocket)) {
        return;
      }
      const shouldNotify = !paused && !closed;
      socket = undefined;
      if (shouldNotify) {
        options.onStatus?.('disconnected');
      }
    };
  }

  connect();

  return {
    update(nextQuery) {
      query = { ...query, ...nextQuery };
      closeSocket(1000, 'reconnect');
      connect();
    },
    pause() {
      if (paused || closed) {
        return;
      }
      paused = true;
      closeSocket(1000, 'pause');
    },
    resume() {
      if (!paused || closed) {
        return;
      }
      paused = false;
      connect();
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      closeSocket(1000, 'manual-close');
    },
    isPaused() {
      return paused;
    },
  };
}
