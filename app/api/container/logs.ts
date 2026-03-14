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
  logs: (options: LocalDockerLogsOptions) => Promise<Buffer | string>;
}

interface LocalDockerWatcherApi {
  dockerApi?: {
    getContainer: (containerName: string) => LocalDockerContainerApi;
  };
}

interface ParsedContainerLogQuery {
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
function demuxDockerStream(buffer: Buffer | string | Uint8Array) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const lines = [];
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

function parseContainerLogQuery(req: Request): ParsedContainerLogQuery {
  return {
    tail: parseIntegerQueryParam(req.query.tail, 100),
    since: parseIntegerQueryParam(req.query.since, 0),
    timestamps: parseBooleanQueryParam(req.query.timestamps, true),
  };
}

function buildLocalDockerLogsOptions(query: ParsedContainerLogQuery): LocalDockerLogsOptions {
  return {
    stdout: true,
    stderr: true,
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

async function handleAgentContainerLogs({
  id,
  container,
  query,
  getAgent,
  getErrorMessage,
  res,
}: {
  id: string;
  container: Container;
  query: ParsedContainerLogQuery;
  getAgent: LogHandlerDependencies['getAgent'];
  getErrorMessage: LogHandlerDependencies['getErrorMessage'];
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
    const result = await agent.getContainerLogs(id, query);
    res.status(200).json(result);
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
  res,
}: {
  id: string;
  container: Container;
  query: ParsedContainerLogQuery;
  getWatchers: LogHandlerDependencies['getWatchers'];
  getErrorMessage: LogHandlerDependencies['getErrorMessage'];
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
    res.status(200).json({ logs });
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

    const query = parseContainerLogQuery(req);
    const handledByAgent = await handleAgentContainerLogs({
      id,
      container,
      query,
      getAgent,
      getErrorMessage,
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
      res,
    });
  };
}

export function createLogHandlers(dependencies: LogHandlerDependencies) {
  return {
    getContainerLogs: createGetContainerLogsHandler(dependencies),
  };
}
