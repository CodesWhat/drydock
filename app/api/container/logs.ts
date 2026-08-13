import { gzipSync } from 'node:zlib';
import type { Request, Response } from 'express';
import type { AgentClient } from '../../agent/AgentClient.js';
import { getOutboundHttpTimeoutMs } from '../../configuration/runtime-defaults.js';
import logger from '../../log/index.js';
import { sanitizeLogParam } from '../../log/sanitize.js';
import type { Container } from '../../model/container.js';
import { sendErrorResponse } from '../error-response.js';
import {
  getPathParamValue,
  parseBooleanQueryParam,
  parseIntegerQueryParam,
} from './request-helpers.js';

interface LogStoreContainerApi {
  getContainer: (id: string) => Container | undefined;
}

interface LocalDockerContainerApi {
  modem?: {
    dial: (
      options: {
        path: string;
        method: string;
        isStream: boolean;
        statusCodes: Record<number, true | string>;
        options: LocalDockerLogsOptions;
      },
      callback: (error: unknown, stream?: unknown) => void,
    ) => void;
  };
  logs: (options: LocalDockerLogsOptions) => Promise<Buffer | string | Uint8Array>;
}

interface LocalDockerLogStream {
  destroy?: () => void;
  on(event: 'data', listener: (chunk: Buffer | string | Uint8Array) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

interface LocalDockerWatcherApi {
  dockerApi?: {
    getContainer: (containerName: string) => LocalDockerContainerApi;
  };
}

interface ParsedContainerLogQuery {
  stdout: boolean;
  stderr: boolean;
  tail: number;
  since: number;
  timestamps: boolean;
}

interface LocalDockerLogsOptions {
  stdout: boolean;
  stderr: boolean;
  tail: number;
  since: number;
  timestamps: boolean;
  follow: boolean;
}

interface LogHandlerDependencies {
  storeContainer: LogStoreContainerApi;
  getAgent: (name: string) => AgentClient | undefined;
  getWatchers: () => Record<string, unknown>;
  getErrorMessage: (error: unknown) => string;
}

const log = logger.child({ component: 'api-container-logs' });
const CONTAINER_LOG_ERROR_MESSAGE = 'Unable to fetch container logs';
const MAX_CONTAINER_LOG_DOWNLOAD_LINES = 10_000;
const MAX_CONTAINER_LOG_DOWNLOAD_BYTES = 16 * 1024 * 1024;
const CONTAINER_LOG_TOO_LARGE_MESSAGE = 'Container log download exceeds 16 MiB';

class ContainerLogPayloadTooLargeError extends Error {}

export function isLocalDockerWatcherApi(value: unknown): value is LocalDockerWatcherApi {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const dockerApi = (value as { dockerApi?: unknown }).dockerApi;
  return (
    !!dockerApi && typeof (dockerApi as { getContainer?: unknown }).getContainer === 'function'
  );
}

/**
 * Demultiplex Docker stream output.
 * Docker uses an 8-byte header per frame: [streamType(1), padding(3), size(4BE)].
 * This strips those headers and returns the raw log text.
 */
export function demuxDockerStream(buffer: Buffer | string | Uint8Array): string {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const lines: string[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size > buf.length) break;
    lines.push(buf.subarray(offset, offset + size).toString('utf-8'));
    offset += size;
  }
  return lines.join('');
}

function parseSinceQueryParam(rawValue: unknown, fallback: number): number {
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmedValue = value.trim();
  if (/^[0-9]+$/.test(trimmedValue)) {
    const parsedNumericValue = Number.parseInt(trimmedValue, 10);
    if (Number.isFinite(parsedNumericValue) && parsedNumericValue >= 0) {
      return parsedNumericValue;
    }
  }

  const parsedTimestamp = Date.parse(trimmedValue);
  if (!Number.isNaN(parsedTimestamp) && parsedTimestamp >= 0) {
    return Math.floor(parsedTimestamp / 1000);
  }

  return fallback;
}

export function parseContainerLogDownloadQuery(query: Request['query']): ParsedContainerLogQuery {
  const requestedTail = parseIntegerQueryParam(query.tail, 1000);
  return {
    stdout: parseBooleanQueryParam(query.stdout, true),
    stderr: parseBooleanQueryParam(query.stderr, true),
    tail: Math.min(MAX_CONTAINER_LOG_DOWNLOAD_LINES, Math.max(0, requestedTail)),
    since: parseSinceQueryParam(query.since, 0),
    timestamps: parseBooleanQueryParam(query.timestamps, true),
  };
}

function isLogPayloadTooLarge(payload: Buffer | string | Uint8Array): boolean {
  return Buffer.byteLength(payload) > MAX_CONTAINER_LOG_DOWNLOAD_BYTES;
}

function buildLocalDockerLogsOptions(query: ParsedContainerLogQuery): LocalDockerLogsOptions {
  return {
    stdout: query.stdout,
    stderr: query.stderr,
    follow: false,
    tail: query.tail,
    since: query.since,
    timestamps: query.timestamps,
  };
}

function isLocalDockerLogStream(value: unknown): value is LocalDockerLogStream {
  return (
    !!value && typeof value === 'object' && typeof (value as { on?: unknown }).on === 'function'
  );
}

async function getBoundedLocalDockerLogs(
  dockerContainer: LocalDockerContainerApi,
  containerId: string,
  options: LocalDockerLogsOptions,
): Promise<Buffer | string | Uint8Array> {
  const modem = dockerContainer.modem;
  if (!modem) {
    return dockerContainer.logs(options);
  }

  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    let stream: LocalDockerLogStream | undefined;
    const settle = (action: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      action();
    };
    const handleTimeout = () => {
      settle(() => reject(new Error('Docker log stream timed out')));
      stream?.destroy?.();
    };
    const timeoutHandle = setTimeout(handleTimeout, getOutboundHttpTimeoutMs());

    modem.dial(
      {
        path: `/containers/${encodeURIComponent(containerId)}/logs?`,
        method: 'GET',
        isStream: true,
        statusCodes: {
          200: true,
          404: 'no such container',
          500: 'server error',
        },
        options,
      },
      (error, value) => {
        if (settled) {
          if (isLocalDockerLogStream(value)) {
            value.destroy?.();
          }
          return;
        }
        if (error) {
          settle(() => reject(error));
          return;
        }
        if (!isLocalDockerLogStream(value)) {
          settle(() => reject(new Error('Docker log response is not a readable stream')));
          return;
        }

        stream = value;
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        value.on('data', (chunk) => {
          if (settled) {
            return;
          }
          const normalizedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += normalizedChunk.length;
          if (totalBytes > MAX_CONTAINER_LOG_DOWNLOAD_BYTES) {
            settle(() => reject(new ContainerLogPayloadTooLargeError()));
            value.destroy?.();
            return;
          }
          chunks.push(normalizedChunk);
          timeoutHandle.refresh();
        });
        value.on('error', (streamError) => {
          settle(() => reject(streamError));
        });
        value.on('end', () => {
          settle(() => resolve(Buffer.concat(chunks, totalBytes)));
        });
        value.on('close', () => {
          settle(() => reject(new Error('Docker log stream closed before completion')));
        });
      },
    );
  });
}

function resolveLocalDockerWatcher(
  container: Container,
  getWatchers: LogHandlerDependencies['getWatchers'],
): LocalDockerWatcherApi | undefined {
  const watcherId = `docker.${container.watcher}`;
  const watcher = getWatchers()[watcherId];
  if (!isLocalDockerWatcherApi(watcher) || !watcher.dockerApi) {
    return undefined;
  }
  return watcher;
}

function getAgentLogPayload(responsePayload: unknown): string {
  if (typeof responsePayload === 'string') {
    return responsePayload;
  }
  if (responsePayload && typeof responsePayload === 'object') {
    const logs = (responsePayload as { logs?: unknown }).logs;
    if (typeof logs === 'string') {
      return logs;
    }
  }
  return '';
}

function acceptsGzip(req: Request): boolean {
  const rawAcceptEncoding = req.headers?.['accept-encoding'];
  const normalizedAcceptEncoding = Array.isArray(rawAcceptEncoding)
    ? rawAcceptEncoding.join(',')
    : rawAcceptEncoding;
  return typeof normalizedAcceptEncoding === 'string' && /\bgzip\b/i.test(normalizedAcceptEncoding);
}

function getDownloadFilename(container: Container, gzipEnabled: boolean): string {
  const sanitizedName = container.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'container';
  return gzipEnabled ? `${sanitizedName}-logs.txt.gz` : `${sanitizedName}-logs.txt`;
}

function sendLogDownloadResponse({
  req,
  res,
  container,
  logs,
}: {
  req: Request;
  res: Response;
  container: Container;
  logs: string;
}): void {
  const gzipEnabled = acceptsGzip(req);
  const filename = getDownloadFilename(container, gzipEnabled);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Vary', 'Accept-Encoding');

  if (gzipEnabled) {
    res.setHeader('Content-Encoding', 'gzip');
    res.status(200).send(gzipSync(Buffer.from(logs, 'utf8')));
    return;
  }

  res.status(200).send(logs);
}

async function handleAgentContainerLogs({
  id,
  container,
  query,
  getAgent,
  getErrorMessage,
  req,
  res,
}: {
  id: string;
  container: Container;
  query: ParsedContainerLogQuery;
  getAgent: LogHandlerDependencies['getAgent'];
  getErrorMessage: LogHandlerDependencies['getErrorMessage'];
  req: Request;
  res: Response;
}): Promise<boolean> {
  if (!container.agent) {
    return false;
  }

  try {
    const agent = getAgent(container.agent);
    if (!agent) {
      sendErrorResponse(res, 500, `Agent ${container.agent} not found`);
      return true;
    }
    const result = await agent.getContainerLogs(id, {
      tail: query.tail,
      since: query.since,
      timestamps: query.timestamps,
    });
    const logs = getAgentLogPayload(result);
    if (isLogPayloadTooLarge(logs)) {
      sendErrorResponse(res, 413, CONTAINER_LOG_TOO_LARGE_MESSAGE);
      return true;
    }
    sendLogDownloadResponse({
      req,
      res,
      container,
      logs,
    });
  } catch (error: unknown) {
    log.warn(`Error fetching logs from agent (${sanitizeLogParam(getErrorMessage(error), 500)})`);
    sendErrorResponse(res, 500, CONTAINER_LOG_ERROR_MESSAGE);
  }
  return true;
}

async function handleLocalContainerLogs({
  id,
  container,
  query,
  getWatchers,
  getErrorMessage,
  req,
  res,
}: {
  id: string;
  container: Container;
  query: ParsedContainerLogQuery;
  getWatchers: LogHandlerDependencies['getWatchers'];
  getErrorMessage: LogHandlerDependencies['getErrorMessage'];
  req: Request;
  res: Response;
}): Promise<void> {
  const watcher = resolveLocalDockerWatcher(container, getWatchers);
  if (!watcher) {
    sendErrorResponse(res, 500, `No watcher found for container ${id}`);
    return;
  }

  try {
    const dockerContainer = watcher.dockerApi.getContainer(container.name);
    const logsBuffer = await getBoundedLocalDockerLogs(
      dockerContainer,
      container.name,
      buildLocalDockerLogsOptions(query),
    );
    if (isLogPayloadTooLarge(logsBuffer)) {
      sendErrorResponse(res, 413, CONTAINER_LOG_TOO_LARGE_MESSAGE);
      return;
    }
    const logs = demuxDockerStream(logsBuffer);
    sendLogDownloadResponse({ req, res, container, logs });
  } catch (error: unknown) {
    if (error instanceof ContainerLogPayloadTooLargeError) {
      sendErrorResponse(res, 413, CONTAINER_LOG_TOO_LARGE_MESSAGE);
      return;
    }
    log.warn(`Error fetching container logs (${sanitizeLogParam(getErrorMessage(error), 500)})`);
    sendErrorResponse(res, 500, CONTAINER_LOG_ERROR_MESSAGE);
  }
}

function createGetContainerLogsHandler({
  storeContainer,
  getAgent,
  getWatchers,
  getErrorMessage,
}: LogHandlerDependencies) {
  return async function getContainerLogs(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);
    const container = storeContainer.getContainer(id);
    if (!container) {
      sendErrorResponse(res, 404, 'Container not found');
      return;
    }

    const query = parseContainerLogDownloadQuery(req.query);
    const handledByAgent = await handleAgentContainerLogs({
      id,
      container,
      query,
      getAgent,
      getErrorMessage,
      req,
      res,
    });
    if (handledByAgent) {
      return;
    }

    await handleLocalContainerLogs({
      id,
      container,
      query,
      getWatchers,
      getErrorMessage,
      req,
      res,
    });
  };
}

export function createLogHandlers(dependencies: LogHandlerDependencies) {
  return {
    getContainerLogs: createGetContainerLogsHandler(dependencies),
  };
}
