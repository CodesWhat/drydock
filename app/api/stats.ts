import express from 'express';
import nocache from 'nocache';
import * as registry from '../registry/index.js';
import {
  type ContainerStatsAggregator,
  createContainerStatsAggregator,
} from '../stats/aggregator.js';
import * as storeContainer from '../store/container.js';
import { createSummaryStatsHandlers } from './container/stats.js';

let containerStatsAggregator: ContainerStatsAggregator | undefined;
let statsAggregationStarted = false;

function getContainerStatsAggregator(): ContainerStatsAggregator {
  containerStatsAggregator ??= createContainerStatsAggregator({
    getContainers: () => storeContainer.getContainers(),
    getWatchers: () => registry.getState().watcher || {},
  });
  return containerStatsAggregator;
}

function startStatsAggregation(): ContainerStatsAggregator {
  const aggregator = getContainerStatsAggregator();
  if (!statsAggregationStarted) {
    aggregator.start();
    statsAggregationStarted = true;
  }
  return aggregator;
}

export function stopStatsAggregation() {
  if (!containerStatsAggregator) {
    return;
  }
  containerStatsAggregator.stop();
  containerStatsAggregator = undefined;
  statsAggregationStarted = false;
}

export function init() {
  const router = express.Router();
  const containerStatsAggregator = startStatsAggregation();
  const summaryStatsHandlers = createSummaryStatsHandlers({
    aggregator: containerStatsAggregator,
  });

  router.use(nocache());
  router.get('/summary', summaryStatsHandlers.getStatsSummary);
  router.get('/summary/stream', summaryStatsHandlers.streamStatsSummary);
  return router;
}
