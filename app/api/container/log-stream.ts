import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { Readable } from 'node:stream';
import { type WebSocket, WebSocketServer } from 'ws';
import { getServerConfiguration } from '../../configuration/index.js';
import type { Container } from '../../model/container.js';
import * as registry from '../../registry/index.js';
import * as storeContainer from '../../store/container.js';
import { getErrorMessage } from '../../util/error.js';
import {
  applySessionMiddleware,
  createFixedWindowRateLimiter,
  createIdentityAwareUpgradeRateLimitKeyResolver,
  getDefaultRateLimitKey,
  isAuthenticatedSession,
  type SessionMiddleware,
  type UpgradeRequest,
  writeUpgradeError,
} from '../ws-upgrade-utils.js';
import { isLocalDockerWatcherApi } from './logs.js';

const STREAM_ROUTE_PATTERN = /^\/api(?:\/v1)?\/containers\/([^/]+)\/logs\/stream$/;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 1000;
const CLOSE_CODE_CONTAINER_NOT_RUNNING = 4001;
const CLOSE_CODE_CONTAINER_NOT_FOUND = 4004;

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

interface ParsedContainerLogStreamQuery {
  stdout: boolean;
  stderr: boolean;
  tail: number;
  since: number;
  follow: boolean;
}

interface DockerLogFrame {
  type: 'stdout' | 'stderr';
  payload: string;
}

interface DockerLogMessage {
  type: 'stdout' | 'stderr';
  ts: string;
  line: string;
}

interface LogStreamContainerApi {
  getContainer: (id: string) => Container | undefined;
}

interface LocalDockerContainerApi {
  logs: (options: {
    follow: boolean;
    stdout: boolean;
    stderr: boolean;
    tail: number;
    since: number;
    timestamps: boolean;
  }) => Promise<Buffer | string | Uint8Array | Readable>;
}

interface LocalDockerWatcherApi {
  dockerApi?: {
    getContainer: (containerName: string) => LocalDockerContainerApi;
  };
}

interface ContainerLogStreamGatewayDependencies {
  getContainer: LogStreamContainerApi['getContainer'];
  getWatchers: () => Record<string, unknown>;
  sessionMiddleware?: SessionMiddleware;
  webSocketServer?: WebSocketServerLike;
  isRateLimited?: (key: string) => boolean;
  getRateLimitKey?: (request: UpgradeRequest, authenticated: boolean) => string;
  getErrorMessage?: (error: unknown) => string;
}

function parseBooleanParam(rawValue: string | null, fallback: boolean): boolean {
  if (rawValue === null) {
    return fallback;
  }
  if (rawValue === 'true') {
    return true;
  }
  if (rawValue === 'false') {
    return false;
  }
  return fallback;
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

function parseSinceParam(rawValue: string | null, fallback: number): number {
  if (rawValue === null) {
    return fallback;
  }

  const trimmedValue = rawValue.trim();
  if (/^[0-9]+$/.test(trimmedValue)) {
    const parsedNumericValue = parseIntegerParam(trimmedValue, Number.NaN);
    if (Number.isFinite(parsedNumericValue)) {
      return parsedNumericValue;
    }
  }

  const parsedTimestamp = Date.parse(trimmedValue);
  if (!Number.isNaN(parsedTimestamp) && parsedTimestamp >= 0) {
    return Math.floor(parsedTimestamp / 1000);
  }

  return fallback;
}

export function parseContainerLogStreamQuery(
  query: URLSearchParams,
): ParsedContainerLogStreamQuery {
  return {
    stdout: parseBooleanParam(query.get('stdout'), true),
    stderr: parseBooleanParam(query.get('stderr'), true),
    tail: parseIntegerParam(query.get('tail'), 100),
    since: parseSinceParam(query.get('since'), 0),
    follow: parseBooleanParam(query.get('follow'), true),
  };
}

function parseContainerIdFromUpgradeUrl(rawUrl: string | undefined):
  | {
      containerId: string;
      query: ParsedContainerLogStreamQuery;
    }
  | undefined {
  if (!rawUrl) {
    return undefined;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl, 'http://localhost');
  } catch {
    return undefined;
  }

  const routeMatch = parsedUrl.pathname.match(STREAM_ROUTE_PATTERN);
  if (!routeMatch?.[1]) {
    return undefined;
  }

  let containerId = routeMatch[1];
  try {
    containerId = decodeURIComponent(containerId);
  } catch {
    return undefined;
  }

  return {
    containerId,
    query: parseContainerLogStreamQuery(parsedUrl.searchParams),
  };
}

function isReadableStream(value: unknown): value is Readable {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { on?: unknown }).on === 'function' &&
    typeof (value as { destroy?: unknown }).destroy === 'function'
  );
}

export function createDockerLogFrameDemuxer() {
  let bufferedChunk = Buffer.alloc(0);

  return {
    push(chunk: Buffer | string | Uint8Array): DockerLogFrame[] {
      const chunkBuffer = Buffer.from(chunk);
      bufferedChunk =
        bufferedChunk.length > 0 ? Buffer.concat([bufferedChunk, chunkBuffer]) : chunkBuffer;

      const frames: DockerLogFrame[] = [];
      while (bufferedChunk.length >= 8) {
        const streamType = bufferedChunk[0];
        const payloadSize = bufferedChunk.readUInt32BE(4);
        if (bufferedChunk.length < 8 + payloadSize) {
          break;
        }

        const payload = bufferedChunk.subarray(8, 8 + payloadSize).toString('utf8');
        bufferedChunk = bufferedChunk.subarray(8 + payloadSize);

        if (streamType === 1) {
          frames.push({ type: 'stdout', payload });
        } else if (streamType === 2) {
          frames.push({ type: 'stderr', payload });
        }
      }
      return frames;
    },
  };
}

function splitTimestampedLogLine(rawLine: string): { ts: string; line: string } {
  const separatorIndex = rawLine.indexOf(' ');
  if (separatorIndex <= 0) {
    return { ts: '', line: rawLine };
  }
  return {
    ts: rawLine.slice(0, separatorIndex),
    line: rawLine.slice(separatorIndex + 1),
  };
}

export function createDockerLogMessageDecoder() {
  const trailingPartialByStream: Record<'stdout' | 'stderr', string> = {
    stdout: '',
    stderr: '',
  };

  return {
    push(frame: DockerLogFrame): DockerLogMessage[] {
      const combinedPayload = trailingPartialByStream[frame.type] + frame.payload;
      const splitLines = combinedPayload.split('\n');
      trailingPartialByStream[frame.type] = splitLines.pop() ?? '';

      return splitLines.map((line) => {
        const normalizedLine = line.endsWith('\r') ? line.slice(0, -1) : line;
        const { ts, line: messageLine } = splitTimestampedLogLine(normalizedLine);
        return {
          type: frame.type,
          ts,
          line: messageLine,
        };
      });
    },
    flush(): DockerLogMessage[] {
      const messages: DockerLogMessage[] = [];
      for (const type of ['stdout', 'stderr'] as const) {
        const trailingLine = trailingPartialByStream[type];
        if (trailingLine.length === 0) {
          continue;
        }
        const normalizedLine = trailingLine.endsWith('\r')
          ? trailingLine.slice(0, -1)
          : trailingLine;
        const { ts, line } = splitTimestampedLogLine(normalizedLine);
        messages.push({ type, ts, line });
        trailingPartialByStream[type] = '';
      }
      return messages;
    },
  };
}

async function streamContainerLogsToWebSocket({
  webSocket,
  containerId,
  query,
  getContainer,
  getWatchers,
  getErrorMessage,
}: {
  webSocket: WebSocketLike;
  containerId: string;
  query: ParsedContainerLogStreamQuery;
  getContainer: ContainerLogStreamGatewayDependencies['getContainer'];
  getWatchers: ContainerLogStreamGatewayDependencies['getWatchers'];
  getErrorMessage: (error: unknown) => string;
}): Promise<void> {
  const container = getContainer(containerId);
  if (!container) {
    webSocket.close(CLOSE_CODE_CONTAINER_NOT_FOUND, 'Container not found');
    return;
  }
  if (container.status !== 'running') {
    webSocket.close(CLOSE_CODE_CONTAINER_NOT_RUNNING, 'Container not running');
    return;
  }

  const watcher = getWatchers()[`docker.${container.watcher}`];
  if (!isLocalDockerWatcherApi(watcher) || !watcher.dockerApi) {
    webSocket.close(1011, 'Watcher not available');
    return;
  }

  let dockerStream: Buffer | string | Uint8Array | Readable;
  try {
    dockerStream = await watcher.dockerApi.getContainer(container.name).logs({
      follow: query.follow,
      stdout: query.stdout,
      stderr: query.stderr,
      tail: query.tail,
      since: query.since,
      timestamps: true,
    });
  } catch (error: unknown) {
    webSocket.close(1011, `Unable to open logs (${getErrorMessage(error)})`);
    return;
  }

  const demuxer = createDockerLogFrameDemuxer();
  const decoder = createDockerLogMessageDecoder();

  const emitMessages = (messages: DockerLogMessage[]): void => {
    for (const message of messages) {
      webSocket.send(JSON.stringify(message));
    }
  };

  const emitChunk = (chunk: Buffer | string | Uint8Array): void => {
    const frames = demuxer.push(chunk);
    for (const frame of frames) {
      emitMessages(decoder.push(frame));
    }
  };

  if (!isReadableStream(dockerStream)) {
    emitChunk(dockerStream);
    emitMessages(decoder.flush());
    webSocket.close(1000, 'Stream complete');
    return;
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    dockerStream.off('data', handleData);
    dockerStream.off('end', handleEnd);
    dockerStream.off('error', handleError);
    webSocket.off?.('close', handleWebSocketClose);
    webSocket.off?.('error', handleWebSocketError);
    dockerStream.destroy();
  };

  const handleData = (chunk: Buffer | string | Uint8Array) => {
    emitChunk(chunk);
  };
  const handleEnd = () => {
    emitMessages(decoder.flush());
    webSocket.close(1000, 'Stream ended');
    cleanup();
  };
  const handleError = (error: unknown) => {
    webSocket.close(1011, `Log stream error (${getErrorMessage(error)})`);
    cleanup();
  };
  const handleWebSocketClose = () => {
    cleanup();
  };
  const handleWebSocketError = () => {
    cleanup();
  };

  dockerStream.on('data', handleData);
  dockerStream.on('end', handleEnd);
  dockerStream.on('error', handleError);
  webSocket.on('close', handleWebSocketClose);
  webSocket.on('error', handleWebSocketError);
}

export function createContainerLogStreamGateway(
  dependencies: ContainerLogStreamGatewayDependencies,
) {
  const {
    getContainer,
    getWatchers,
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
    getErrorMessage: getLogStreamErrorMessage = getErrorMessage,
  } = dependencies;

  return {
    async handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
      const parsedRequest = parseContainerIdFromUpgradeUrl(request.url);
      if (!parsedRequest) {
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
          void streamContainerLogsToWebSocket({
            webSocket,
            containerId: parsedRequest.containerId,
            query: parsedRequest.query,
            getContainer,
            getWatchers,
            getErrorMessage: getLogStreamErrorMessage,
          }).finally(resolve);
        });
      });
    },
  };
}

export function attachContainerLogStreamWebSocketServer(options: {
  server: {
    on: (
      event: 'upgrade',
      listener: (request: IncomingMessage, socket: Socket, head: Buffer) => void,
    ) => void;
  };
  sessionMiddleware?: SessionMiddleware;
  serverConfiguration?: Record<string, unknown>;
}) {
  const serverConfiguration =
    options.serverConfiguration ?? (getServerConfiguration() as Record<string, unknown>);
  const gateway = createContainerLogStreamGateway({
    getContainer: storeContainer.getContainer,
    getWatchers: () => registry.getState().watcher,
    sessionMiddleware: options.sessionMiddleware,
    getRateLimitKey: createIdentityAwareUpgradeRateLimitKeyResolver(serverConfiguration),
  });

  options.server.on('upgrade', (request, socket, head) => {
    void gateway.handleUpgrade(request, socket, head);
  });

  return gateway;
}
