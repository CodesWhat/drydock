// @ts-nocheck
import * as watcher from './watcher.js';

test('watcher counter should be properly configured', async () => {
  watcher.init();
  const gauge = watcher.getWatchContainerGauge();
  expect(gauge.name).toStrictEqual('dd_watcher_total');
  expect(gauge.labelNames).toStrictEqual(['type', 'name']);
});

test('maintenance skip counter should be properly configured', async () => {
  watcher.init();
  const counter = watcher.getMaintenanceSkipCounter();
  expect(counter.name).toStrictEqual('dd_watcher_maintenance_skip_total');
  expect(counter.labelNames).toStrictEqual(['type', 'name']);
});

test('logger init failure counter should be properly configured', async () => {
  watcher.init();
  const counter = watcher.getLoggerInitFailureCounter();
  expect(counter.name).toStrictEqual('dd_watcher_logger_init_failures_total');
  expect(counter.labelNames).toStrictEqual(['type', 'name']);
});
