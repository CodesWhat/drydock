import type { Request, Response } from 'express';
import logger from '../../log/index.js';
import type { Container } from '../../model/container.js';
import type { ContainerStatsAggregator } from '../../stats/aggregator.js';
import type { ContainerStatsCollector } from '../../stats/collector.js';
import { STATS_STREAM_HEARTBEAT_INTERVAL_MS } from '../../stats/config.js';
import { getErrorMessage } from '../../util/error.js';
import { sendErrorResponse } from '../error-response.js';
import { SSE_STALE_SWEEP_INTERVAL_MS } from '../sse-constants.js';
import { getPathParamValue } from './request-helpers.js';

type ContainerStatsSnapshot = ReturnType<ContainerStatsCollector['getLatest']>;
type ContainerStatsListener = (snapshot: NonNullable<ContainerStatsSnapshot>) => void;

interface StatsStoreContainerApi {
  getContainer: (id: string) => Container | undefined;
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

interface SummaryStatsHandlerDependencies {
  aggregator: ContainerStatsAggregator;
}

interface SummaryStatsStreamClient {
  response: StreamableResponse;
  cleanup: () => void;
}

interface SummaryStatsStreamRuntime {
  clients: Set<SummaryStatsStreamClient>;
  staleSweepInterval?: ReturnType<typeof globalThis.setInterval>;
}

interface StatsStreamPressureController<Snapshot> {
  cleanup: () => void;
  enqueueSnapshot: (snapshot: Snapshot) => void;
  writeHeartbeat: () => void;
}

const STATS_STREAM_BACKPRESSURE_TIMEOUT_MS = 30_000;

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

function writeStatsEvent(res: StreamableResponse, snapshot: unknown): boolean {
  const accepted = res.write(`event: dd:container-stats\ndata: ${JSON.stringify(snapshot)}\n\n`);
  res.flush?.();
  return accepted;
}

function writeSummaryStatsEvent(res: StreamableResponse, snapshot: unknown): boolean {
  const accepted = res.write(`event: dd:stats-summary\ndata: ${JSON.stringify(snapshot)}\n\n`);
  res.flush?.();
  return accepted;
}

function writeHeartbeatEvent(res: StreamableResponse): boolean {
  return res.write('event: dd:heartbeat\ndata: {}\n\n');
}

function createStatsStreamPressureController<Snapshot>(
  response: StreamableResponse,
  writeSnapshot: (snapshot: Snapshot) => boolean,
  onStall: () => void,
): StatsStreamPressureController<Snapshot> {
  let blocked = false;
  let cleaned = false;
  let pendingSnapshot: { value: Snapshot } | undefined;
  let stallTimeout: ReturnType<typeof globalThis.setTimeout> | undefined;

  const clearStallTimeout = () => {
    if (stallTimeout === undefined) {
      return;
    }
    globalThis.clearTimeout(stallTimeout);
    stallTimeout = undefined;
  };

  const markBlocked = () => {
    blocked = true;
    stallTimeout = globalThis.setTimeout(() => {
      stallTimeout = undefined;
      onStall();
    }, STATS_STREAM_BACKPRESSURE_TIMEOUT_MS);
  };

  const enqueueSnapshot = (snapshot: Snapshot) => {
    if (cleaned) {
      return;
    }
    if (blocked) {
      pendingSnapshot = { value: snapshot };
      return;
    }
    if (!writeSnapshot(snapshot)) {
      markBlocked();
    }
  };

  const writeHeartbeat = () => {
    if (cleaned || blocked) {
      return;
    }
    if (!writeHeartbeatEvent(response)) {
      markBlocked();
    }
  };

  const onDrain = () => {
    if (!blocked) {
      return;
    }
    blocked = false;
    clearStallTimeout();
    const latestSnapshot = pendingSnapshot;
    pendingSnapshot = undefined;
    if (latestSnapshot) {
      enqueueSnapshot(latestSnapshot.value);
    }
  };

  response.on('drain', onDrain);

  return {
    enqueueSnapshot,
    writeHeartbeat,
    cleanup: () => {
      cleaned = true;
      pendingSnapshot = undefined;
      clearStallTimeout();
      response.off('drain', onDrain);
    },
  };
}

function isStreamResponseClosed(response: StreamableResponse): boolean {
  const state = response as Response & {
    destroyed?: boolean;
    writableEnded?: boolean;
    writableFinished?: boolean;
  };
  return (
    state.writableEnded === true || state.writableFinished === true || state.destroyed === true
  );
}

function stopSummaryStatsStaleSweepIfIdle(runtime: SummaryStatsStreamRuntime): void {
  if (!runtime.staleSweepInterval || runtime.clients.size > 0) {
    return;
  }
  const staleSweepInterval = runtime.staleSweepInterval;
  runtime.staleSweepInterval = undefined;
  try {
    globalThis.clearInterval(staleSweepInterval);
  } catch {
    // The sweep is best-effort cleanup for stale HTTP responses; cleanup must continue.
  }
}

function sweepStaleSummaryStatsStreams(runtime: SummaryStatsStreamRuntime): void {
  for (const client of runtime.clients) {
    if (isStreamResponseClosed(client.response)) {
      client.cleanup();
    }
  }
  stopSummaryStatsStaleSweepIfIdle(runtime);
}

function startSummaryStatsStaleSweepIfNeeded(runtime: SummaryStatsStreamRuntime): void {
  if (runtime.staleSweepInterval || runtime.clients.size === 0) {
    return;
  }
  runtime.staleSweepInterval = globalThis.setInterval(() => {
    sweepStaleSummaryStatsStreams(runtime);
  }, SSE_STALE_SWEEP_INTERVAL_MS);
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

    let cleanup: () => void;
    const pressureController = createStatsStreamPressureController(
      streamResponse,
      (snapshot: NonNullable<ContainerStatsSnapshot>) => writeStatsEvent(streamResponse, snapshot),
      () => {
        cleanup();
        streamResponse.destroy();
      },
    );

    const latestSnapshot = statsCollector.getLatest(container.id);
    if (latestSnapshot) {
      pressureController.enqueueSnapshot(latestSnapshot);
    }

    const releaseWatch = statsCollector.watch(container.id);
    const unsubscribe = statsCollector.subscribe(container.id, ((snapshot) => {
      pressureController.enqueueSnapshot(snapshot);
    }) as ContainerStatsListener);

    const heartbeatInterval = globalThis.setInterval(() => {
      pressureController.writeHeartbeat();
    }, STATS_STREAM_HEARTBEAT_INTERVAL_MS);

    let disconnected = false;
    cleanup = () => {
      if (disconnected) {
        return;
      }
      disconnected = true;
      pressureController.cleanup();
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

function createGetStatsSummaryHandler({ aggregator }: SummaryStatsHandlerDependencies) {
  return function getStatsSummary(_req: Request, res: Response): void {
    res.status(200).json({ data: aggregator.getCurrent() });
  };
}

function createStreamStatsSummaryHandler(
  { aggregator }: SummaryStatsHandlerDependencies,
  runtime: SummaryStatsStreamRuntime,
) {
  return function streamStatsSummary(req: Request, res: Response): void {
    const log = logger.child({ component: 'container-stats' });
    const streamResponse = res as StreamableResponse;

    streamResponse.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    streamResponse.flushHeaders?.();

    let cleanup: () => void;
    const pressureController = createStatsStreamPressureController(
      streamResponse,
      (summary: unknown) => writeSummaryStatsEvent(streamResponse, summary),
      () => {
        cleanup();
        streamResponse.destroy();
      },
    );

    pressureController.enqueueSnapshot(aggregator.getCurrent());

    const unsubscribe = aggregator.subscribe((summary) => {
      pressureController.enqueueSnapshot(summary);
    });

    const heartbeatInterval = globalThis.setInterval(() => {
      pressureController.writeHeartbeat();
    }, STATS_STREAM_HEARTBEAT_INTERVAL_MS);

    let disconnected = false;
    let streamClient: SummaryStatsStreamClient;
    cleanup = () => {
      if (disconnected) {
        return;
      }
      disconnected = true;
      runtime.clients.delete(streamClient);
      stopSummaryStatsStaleSweepIfIdle(runtime);
      pressureController.cleanup();
      try {
        globalThis.clearInterval(heartbeatInterval);
      } catch (error: unknown) {
        log.debug(
          `Failed to clear stats summary stream heartbeat interval (${getErrorMessage(error)})`,
        );
      }
      try {
        unsubscribe();
      } catch (error: unknown) {
        log.debug(
          `Failed to unsubscribe stats summary stream listener (${getErrorMessage(error)})`,
        );
      }
    };

    streamClient = { response: streamResponse, cleanup };
    runtime.clients.add(streamClient);
    startSummaryStatsStaleSweepIfNeeded(runtime);

    req.on('close', cleanup);
    req.on('aborted', cleanup);
    streamResponse.on('close', cleanup);
    streamResponse.on('error', cleanup);
  };
}

export function createSummaryStatsHandlers(dependencies: SummaryStatsHandlerDependencies) {
  const streamRuntime: SummaryStatsStreamRuntime = {
    clients: new Set(),
  };

  return {
    getStatsSummary: createGetStatsSummaryHandler(dependencies),
    streamStatsSummary: createStreamStatsSummaryHandler(dependencies, streamRuntime),
  };
}

export function createStatsHandlers(dependencies: StatsHandlerDependencies) {
  return {
    getContainerStats: createGetContainerStatsHandler(dependencies),
    streamContainerStats: createStreamContainerStatsHandler(dependencies),
  };
}
