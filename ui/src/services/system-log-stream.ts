import { createWebSocketStreamConnection } from '@/services/websocket-stream-connection';

export interface SystemLogEntry {
  timestamp: number;
  displayTimestamp: string;
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
  if (typeof entry.timestamp !== 'number') {
    return false;
  }
  if (typeof entry.displayTimestamp !== 'string') {
    return false;
  }
  if (typeof entry.level !== 'string') {
    return false;
  }
  if (typeof entry.component !== 'string') {
    return false;
  }
  if (typeof entry.msg !== 'string') {
    return false;
  }
  return true;
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
  return createWebSocketStreamConnection<SystemLogStreamQuery, SystemLogEntry>({
    query: options.query,
    onMessage: options.onMessage,
    onStatus: options.onStatus,
    webSocketFactory: options.webSocketFactory,
    location: options.location,
    buildUrl: buildSystemLogStreamUrl,
    parseMessage: parseSystemLogMessage,
  });
}
