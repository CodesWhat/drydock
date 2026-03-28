import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { type WebSocket, WebSocketServer } from 'ws';
import { getServerConfiguration } from '../configuration/index.js';
import {
  getEntries,
  getMinLevel,
  type LogEntry,
  matchesComponent,
  meetsMinLevel,
  onEntry,
} from '../log/buffer.js';
import {
  applySessionMiddleware,
  createFixedWindowRateLimiter,
  createIdentityAwareUpgradeRateLimitKeyResolver,
  getDefaultRateLimitKey,
  isAuthenticatedSession,
  isOriginAllowed,
  type SessionMiddleware,
  type UpgradeRequest,
  writeUpgradeError,
} from './ws-upgrade-utils.js';

const STREAM_ROUTE_PATTERN = /^\/api(?:\/v1)?\/log\/stream$/;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 1000;

interface ParsedSystemLogStreamQuery {
  level?: string;
  component?: string;
  tail: number;
}

type WebSocketLike = Pick<WebSocket, 'close' | 'on' | 'send'> & {
  off?: (event: 'close' | 'error', listener: () => void) => void;
};

type WebSocketServerLike = {
  handleUpgrade: (
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
    callback: (webSocket: WebSocketLike) => void,
  ) => void;
};

export interface SystemLogStreamGatewayDependencies {
  sessionMiddleware?: SessionMiddleware;
  webSocketServer?: WebSocketServerLike;
  isRateLimited?: (key: string) => boolean;
  getRateLimitKey?: (request: UpgradeRequest, authenticated: boolean) => string;
  getBackfillEntries?: (options: {
    level?: string;
    component?: string;
    tail: number;
  }) => LogEntry[];
  subscribeToEntries?: (listener: (entry: LogEntry) => void) => () => void;
}

function parseIntegerParam(rawValue: string | null, fallback: number): number {
  if (rawValue === null) {
    return fallback;
  }
  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return fallback;
  }
  return parsedValue;
}

export function parseSystemLogStreamQuery(query: URLSearchParams): ParsedSystemLogStreamQuery {
  const level = query.get('level') ?? undefined;
  const component = query.get('component') ?? undefined;
  const tail = parseIntegerParam(query.get('tail'), 100);
  return {
    level: level && level !== 'all' ? level : undefined,
    component: component || undefined,
    tail,
  };
}

function parseSystemLogStreamUpgradeUrl(
  rawUrl: string | undefined,
): { query: ParsedSystemLogStreamQuery } | undefined {
  if (!rawUrl) {
    return undefined;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl, 'http://localhost');
  } catch {
    return undefined;
  }

  if (!STREAM_ROUTE_PATTERN.test(parsedUrl.pathname)) {
    return undefined;
  }

  return {
    query: parseSystemLogStreamQuery(parsedUrl.searchParams),
  };
}

function matchesFilter(entry: LogEntry, minLevel: number, component?: string): boolean {
  return meetsMinLevel(entry, minLevel) && matchesComponent(entry, component);
}

function trySendLogEntry(webSocket: WebSocketLike, entry: LogEntry): boolean {
  try {
    webSocket.send(JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

function streamSystemLogsToWebSocket({
  webSocket,
  query,
  getBackfillEntries,
  subscribeToEntries,
}: {
  webSocket: WebSocketLike;
  query: ParsedSystemLogStreamQuery;
  getBackfillEntries: NonNullable<SystemLogStreamGatewayDependencies['getBackfillEntries']>;
  subscribeToEntries: NonNullable<SystemLogStreamGatewayDependencies['subscribeToEntries']>;
}): Promise<void> {
  const backfill = getBackfillEntries({
    level: query.level,
    component: query.component,
    tail: query.tail,
  });
  for (const entry of backfill) {
    if (!trySendLogEntry(webSocket, entry)) {
      return Promise.resolve();
    }
  }

  const minLevel = getMinLevel(query.level);

  return new Promise<void>((resolve) => {
    const unsubscribe = subscribeToEntries((entry: LogEntry) => {
      if (matchesFilter(entry, minLevel, query.component)) {
        if (!trySendLogEntry(webSocket, entry)) {
          cleanup();
        }
      }
    });

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      unsubscribe();
      webSocket.off?.('close', handleClose);
      webSocket.off?.('error', handleError);
      resolve();
    };

    const handleClose = () => {
      cleanup();
    };
    const handleError = () => {
      cleanup();
    };

    webSocket.on('close', handleClose);
    webSocket.on('error', handleError);
  });
}

export function createSystemLogStreamGateway(dependencies: SystemLogStreamGatewayDependencies) {
  const {
    sessionMiddleware,
    webSocketServer = new WebSocketServer({ noServer: true }),
    isRateLimited = (() => {
      const limiter = createFixedWindowRateLimiter({
        windowMs: RATE_LIMIT_WINDOW_MS,
        max: RATE_LIMIT_MAX,
      });
      return (key: string) => !limiter.consume(key);
    })(),
    getRateLimitKey = (request: UpgradeRequest) => getDefaultRateLimitKey(request),
    getBackfillEntries = (options) => getEntries(options),
    subscribeToEntries = (listener) => onEntry(listener),
  } = dependencies;

  return {
    async handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
      const parsedRequest = parseSystemLogStreamUpgradeUrl(request.url);
      if (!parsedRequest) {
        return;
      }

      if (!isOriginAllowed(request)) {
        writeUpgradeError(socket, 403, 'Forbidden');
        return;
      }

      if (!sessionMiddleware) {
        writeUpgradeError(socket, 503, 'Session middleware unavailable');
        return;
      }

      try {
        await applySessionMiddleware(sessionMiddleware, request);
      } catch {
        writeUpgradeError(socket, 401, 'Unauthorized');
        return;
      }

      const upgradeRequest = request as UpgradeRequest;
      const authenticated = isAuthenticatedSession(upgradeRequest);
      const rateLimitKey = getRateLimitKey(upgradeRequest, authenticated);
      if (isRateLimited(rateLimitKey)) {
        writeUpgradeError(socket, 429, 'Too Many Requests');
        return;
      }
      if (!authenticated) {
        writeUpgradeError(socket, 401, 'Unauthorized');
        return;
      }

      await new Promise<void>((resolve) => {
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          void streamSystemLogsToWebSocket({
            webSocket,
            query: parsedRequest.query,
            getBackfillEntries,
            subscribeToEntries,
          }).finally(resolve);
        });
      });
    },
  };
}

export function attachSystemLogStreamWebSocketServer(options: {
  server: {
    on: (
      event: 'upgrade',
      listener: (request: IncomingMessage, socket: Socket, head: Buffer) => void,
    ) => void;
  };
  sessionMiddleware?: SessionMiddleware;
  serverConfiguration?: Record<string, unknown>;
  isRateLimited?: (key: string) => boolean;
}) {
  const serverConfiguration =
    options.serverConfiguration ?? (getServerConfiguration() as Record<string, unknown>);
  const gateway = createSystemLogStreamGateway({
    sessionMiddleware: options.sessionMiddleware,
    getRateLimitKey: createIdentityAwareUpgradeRateLimitKeyResolver(serverConfiguration),
    isRateLimited: options.isRateLimited,
  });

  options.server.on('upgrade', (request, socket, head) => {
    void gateway.handleUpgrade(request, socket, head);
  });

  return gateway;
}
