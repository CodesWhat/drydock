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
  logs: (options: {
    stdout: boolean;
    stderr: boolean;
    tail: number;
    since: number;
    timestamps: boolean;
    follow: boolean;
  }) => Promise<Buffer | string>;
}

interface LocalDockerWatcherApi {
  dockerApi?: {
    getContainer: (containerName: string) => LocalDockerContainerApi;
  };
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

export function createLogHandlers({
  storeContainer,
  getAgent,
  getWatchers,
  getErrorMessage,
}: LogHandlerDependencies) {
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

  /**
   * Get container logs.
   * @param req
   * @param res
   */
  async function getContainerLogs(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);
    const container = storeContainer.getContainer(id);
    if (!container) {
      sendErrorResponse(res, 404, 'Container not found');
      return;
    }

    const tail = parseIntegerQueryParam(req.query.tail, 100);
    const since = parseIntegerQueryParam(req.query.since, 0);
    const timestamps = parseBooleanQueryParam(req.query.timestamps, true);

    if (container.agent) {
      try {
        const agent = getAgent(container.agent);
        if (!agent) {
          res.status(500).json({
            error: `Agent ${container.agent} not found`,
          });
          return;
        }
        const result = await agent.getContainerLogs(id, { tail, since, timestamps });
        res.status(200).json(result);
      } catch (error: unknown) {
        res.status(500).json({
          error: `Error fetching logs from agent (${getErrorMessage(error)})`,
        });
      }
      return;
    }

    const watcherId = `docker.${container.watcher}`;
    const watcher = getWatchers()[watcherId];
    if (!isLocalDockerWatcherApi(watcher) || !watcher.dockerApi) {
      res.status(500).json({
        error: `No watcher found for container ${id}`,
      });
      return;
    }

    try {
      const logsBuffer = await watcher.dockerApi
        .getContainer(container.name)
        .logs({ stdout: true, stderr: true, tail, since, timestamps, follow: false });
      const logs = demuxDockerStream(logsBuffer);
      res.status(200).json({ logs });
    } catch (error: unknown) {
      res.status(500).json({
        error: `Error fetching container logs (${getErrorMessage(error)})`,
      });
    }
  }

  return {
    getContainerLogs,
  };
}
