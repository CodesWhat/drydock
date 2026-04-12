import { createWebSocketStreamConnection } from '@/services/websocket-stream-connection';

type LogStreamTail = number | 'all';

export interface ContainerLogFrame {
  type: 'stdout' | 'stderr';
  ts: string;
  displayTs: string;
  line: string;
}

export type ContainerLogStreamFrame = ContainerLogFrame;
export type ContainerLogStreamStatus = 'connected' | 'disconnected';

export interface ContainerLogQuery {
  stdout?: boolean;
  stderr?: boolean;
  tail?: LogStreamTail;
  since?: string | number;
  follow?: boolean;
}

interface ContainerLogStreamConnectionOptions {
  containerId: string;
  query?: ContainerLogQuery;
  onMessage: (frame: ContainerLogStreamFrame) => void;
  onStatus?: (status: ContainerLogStreamStatus) => void;
  webSocketFactory?: (url: string) => WebSocket;
  location?: Location;
}

export interface ContainerLogStreamConnection {
  update: (query: Partial<ContainerLogQuery>) => void;
  pause: () => void;
  resume: () => void;
  close: () => void;
  isPaused: () => boolean;
}

const ALL_TAIL_VALUE = 2147483647;

function isLogFrame(payload: unknown): payload is ContainerLogFrame {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const frame = payload as Record<string, unknown>;
  if (frame.type !== 'stdout' && frame.type !== 'stderr') {
    return false;
  }
  if (typeof frame.ts !== 'string') {
    return false;
  }
  if (typeof frame.displayTs !== 'string') {
    return false;
  }
  if (typeof frame.line !== 'string') {
    return false;
  }
  return true;
}

function parseLogFrameMessage(data: unknown): ContainerLogFrame | null {
  if (typeof data !== 'string') {
    return null;
  }

  try {
    const payload = JSON.parse(data);
    return isLogFrame(payload) ? payload : null;
  } catch {
    // Ignore malformed stream frames.
    return null;
  }
}

export function toLogTailValue(value: LogStreamTail): number {
  return value === 'all' ? ALL_TAIL_VALUE : value;
}

function normalizeQuery(
  query: ContainerLogQuery = {},
): Required<Omit<ContainerLogQuery, 'since'>> & Pick<ContainerLogQuery, 'since'> {
  return {
    stdout: query.stdout ?? true,
    stderr: query.stderr ?? true,
    tail: query.tail ?? 100,
    since: query.since,
    follow: query.follow ?? true,
  };
}

export function buildContainerLogStreamUrl(
  containerId: string,
  query: ContainerLogQuery = {},
  locationRef: Location = window.location,
): string {
  const normalized = normalizeQuery(query);
  const protocol = locationRef.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams();
  params.set('stdout', `${normalized.stdout}`);
  params.set('stderr', `${normalized.stderr}`);
  params.set('tail', `${toLogTailValue(normalized.tail)}`);

  if (normalized.since) {
    params.set('since', `${normalized.since}`);
  }
  params.set('follow', `${normalized.follow}`);

  return `${protocol}//${locationRef.host}/api/v1/containers/${encodeURIComponent(containerId)}/logs/stream?${params.toString()}`;
}

export function createContainerLogStreamConnection(
  options: ContainerLogStreamConnectionOptions,
): ContainerLogStreamConnection {
  return createWebSocketStreamConnection<ContainerLogQuery, ContainerLogStreamFrame>({
    query: options.query,
    onMessage: options.onMessage,
    onStatus: options.onStatus,
    webSocketFactory: options.webSocketFactory,
    location: options.location,
    buildUrl: (query, locationRef) =>
      buildContainerLogStreamUrl(options.containerId, query, locationRef),
    parseMessage: parseLogFrameMessage,
  });
}

export async function downloadContainerLogs(
  containerId: string,
  query: Pick<ContainerLogQuery, 'stdout' | 'stderr' | 'tail' | 'since'> = {},
): Promise<Blob> {
  const params = new URLSearchParams();
  params.set('stdout', `${query.stdout ?? true}`);
  params.set('stderr', `${query.stderr ?? true}`);
  params.set('tail', `${toLogTailValue(query.tail ?? 100)}`);
  if (query.since) {
    params.set('since', `${query.since}`);
  }

  const response = await fetch(
    `/api/v1/containers/${encodeURIComponent(containerId)}/logs?${params.toString()}`,
    {
      credentials: 'include',
      headers: {
        Accept: 'text/plain',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to download logs for container ${containerId}: ${response.statusText}`);
  }

  return response.blob();
}
