import type { Request, Response } from 'express';
import logger from '../../log/index.js';
import type { Container } from '../../model/container.js';
import type { ContainerStatsCollector } from '../../stats/collector.js';
import { STATS_STREAM_HEARTBEAT_INTERVAL_MS } from '../../stats/config.js';
import { getErrorMessage } from '../../util/error.js';
import { sendErrorResponse } from '../error-response.js';
import { getPathParamValue } from './request-helpers.js';

type ContainerStatsSnapshot = ReturnType<ContainerStatsCollector['getLatest']>;
type ContainerStatsListener = (snapshot: NonNullable<ContainerStatsSnapshot>) => void;

interface StatsStoreContainerApi {
  getContainer: (id: string) => Container | undefined;
  getContainers: (query?: Record<string, unknown>) => Container[];
}

interface StreamableResponse extends Response {
  flush?: () => void;
}

interface StatsHandlerDependencies {
  storeContainer: StatsStoreContainerApi;
  statsCollector: Pick<
    ContainerStatsCollector,
    'watch' | 'touch' | 'subscribe' | 'getLatest' | 'getHistory'
  >;
}

function ensureContainerExists(
  storeContainer: StatsStoreContainerApi,
  id: string,
  res: Response,
): Container | undefined {
  const container = storeContainer.getContainer(id);
  if (!container) {
    sendErrorResponse(res, 404, 'Container not found');
    return undefined;
  }
  return container;
}

function writeStatsEvent(res: StreamableResponse, snapshot: unknown): void {
  res.write(`event: dd:container-stats\ndata: ${JSON.stringify(snapshot)}\n\n`);
  res.flush?.();
}

function writeHeartbeatEvent(res: StreamableResponse): void {
  res.write('event: dd:heartbeat\ndata: {}\n\n');
}

function createGetContainerStatsHandler({
  storeContainer,
  statsCollector,
}: StatsHandlerDependencies) {
  return function getContainerStats(req: Request, res: Response): void {
    const id = getPathParamValue(req.params.id);
    const container = ensureContainerExists(storeContainer, id, res);
    if (!container) {
      return;
    }

    statsCollector.touch(container.id);
    res.status(200).json({
      data: statsCollector.getLatest(container.id) ?? null,
      history: statsCollector.getHistory(container.id),
    });
  };
}

function createGetAllContainerStatsHandler({
  storeContainer,
  statsCollector,
}: StatsHandlerDependencies) {
  return function getAllContainerStats(_req: Request, res: Response): void {
    const containers = storeContainer.getContainers();

    const data = containers.map((container) => {
      statsCollector.touch(container.id);
      return {
        id: container.id,
        name: container.name,
        status: container.status,
        watcher: container.watcher,
        agent: container.agent,
        stats: statsCollector.getLatest(container.id) ?? null,
      };
    });

    res.status(200).json({ data });
  };
}

function createStreamContainerStatsHandler({
  storeContainer,
  statsCollector,
}: StatsHandlerDependencies) {
  return function streamContainerStats(req: Request, res: Response): void {
    const id = getPathParamValue(req.params.id);
    const container = ensureContainerExists(storeContainer, id, res);
    if (!container) {
      return;
    }
    const log = logger.child({ component: 'container-stats' });

    const streamResponse = res as StreamableResponse;
    streamResponse.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    streamResponse.flushHeaders?.();

    const latestSnapshot = statsCollector.getLatest(container.id);
    if (latestSnapshot) {
      writeStatsEvent(streamResponse, latestSnapshot);
    }

    const releaseWatch = statsCollector.watch(container.id);
    const unsubscribe = statsCollector.subscribe(container.id, ((snapshot) => {
      writeStatsEvent(streamResponse, snapshot);
    }) as ContainerStatsListener);

    const heartbeatInterval = globalThis.setInterval(() => {
      writeHeartbeatEvent(streamResponse);
    }, STATS_STREAM_HEARTBEAT_INTERVAL_MS);

    let disconnected = false;
    const cleanup = () => {
      if (disconnected) {
        return;
      }
      disconnected = true;
      try {
        globalThis.clearInterval(heartbeatInterval);
      } catch (error: unknown) {
        log.debug(
          `Failed to clear stats stream heartbeat interval for ${container.id} (${getErrorMessage(error)})`,
        );
      }
      try {
        unsubscribe();
      } catch (error: unknown) {
        log.debug(
          `Failed to unsubscribe stats stream listener for ${container.id} (${getErrorMessage(error)})`,
        );
      }
      try {
        releaseWatch();
      } catch (error: unknown) {
        log.debug(
          `Failed to release stats stream watch for ${container.id} (${getErrorMessage(error)})`,
        );
      }
    };

    req.on('close', cleanup);
    req.on('aborted', cleanup);
    streamResponse.on('close', cleanup);
    streamResponse.on('error', cleanup);
  };
}

export function createStatsHandlers(dependencies: StatsHandlerDependencies) {
  return {
    getContainerStats: createGetContainerStatsHandler(dependencies),
    getAllContainerStats: createGetAllContainerStatsHandler(dependencies),
    streamContainerStats: createStreamContainerStatsHandler(dependencies),
  };
}
