import express from 'express';
import nocache from 'nocache';
import * as registry from '../registry/index.js';
import { createContainerStatsAggregator } from '../stats/aggregator.js';
import * as storeContainer from '../store/container.js';
import { createSummaryStatsHandlers } from './container/stats.js';

const router = express.Router();

const containerStatsAggregator = createContainerStatsAggregator({
  getContainers: () => storeContainer.getContainers(),
  getWatchers: () => registry.getState().watcher || {},
});
containerStatsAggregator.start();

const summaryStatsHandlers = createSummaryStatsHandlers({
  aggregator: containerStatsAggregator,
});

export function init() {
  router.use(nocache());
  router.get('/summary', summaryStatsHandlers.getStatsSummary);
  router.get('/summary/stream', summaryStatsHandlers.streamStatsSummary);
  return router;
}
