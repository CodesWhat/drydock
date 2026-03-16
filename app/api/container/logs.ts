import { gzipSync } from 'node:zlib';
import type { Request, Response } from 'express';
import type { AgentClient } from '../../agent/AgentClient.js';
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
  logs: (options: LocalDockerLogsOptions) => Promise<Buffer | string | Uint8Array>;
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

export interface LogHandlerDependencies {
  storeContainer: LogStoreContainerApi;
  getAgent: (name: string) => AgentClient | undefined;
  getWatchers: () => Record<string, unknown>;
  getErrorMessage: (error: unknown) => string;
}

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
  return {
    stdout: parseBooleanQueryParam(query.stdout, true),
    stderr: parseBooleanQueryParam(query.stderr, true),
    tail: parseIntegerQueryParam(query.tail, 1000),
    since: parseSinceQueryParam(query.since, 0),
    timestamps: parseBooleanQueryParam(query.timestamps, true),
  };
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
    sendLogDownloadResponse({
      req,
      res,
      container,
      logs: getAgentLogPayload(result),
    });
  } catch (error: unknown) {
    sendErrorResponse(res, 500, `Error fetching logs from agent (${getErrorMessage(error)})`);
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
    const logsBuffer = await watcher.dockerApi
      .getContainer(container.name)
      .logs(buildLocalDockerLogsOptions(query));
    const logs = demuxDockerStream(logsBuffer);
    sendLogDownloadResponse({ req, res, container, logs });
  } catch (error: unknown) {
    sendErrorResponse(res, 500, `Error fetching container logs (${getErrorMessage(error)})`);
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
