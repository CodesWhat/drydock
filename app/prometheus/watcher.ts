import { Counter, Gauge, register } from 'prom-client';

let watchContainerGauge;
let maintenanceSkipCounter;

export function init() {
  // Replace gauge if init is called more than once
  if (watchContainerGauge) {
    register.removeSingleMetric(watchContainerGauge.name);
  }
  watchContainerGauge = new Gauge({
    name: 'dd_watcher_total',
    help: 'The number of watched containers',
    labelNames: ['type', 'name'],
  });

  if (maintenanceSkipCounter) {
    register.removeSingleMetric(maintenanceSkipCounter.name);
  }
  maintenanceSkipCounter = new Counter({
    name: 'dd_watcher_maintenance_skip_total',
    help: 'The number of watch cycles skipped due to maintenance window',
    labelNames: ['type', 'name'],
  });
}

export function getWatchContainerGauge() {
  return watchContainerGauge;
}

export function getMaintenanceSkipCounter() {
  return maintenanceSkipCounter;
}
