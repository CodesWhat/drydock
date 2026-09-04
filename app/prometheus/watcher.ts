import { Counter, Gauge, register } from 'prom-client';

let watchContainerGauge;
let maintenanceSkipCounter;
let maintenanceDeferredUpdateCounter;
let loggerInitFailureCounter;

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

  if (maintenanceDeferredUpdateCounter) {
    register.removeSingleMetric(maintenanceDeferredUpdateCounter.name);
  }
  maintenanceDeferredUpdateCounter = new Counter({
    name: 'dd_watcher_maintenance_deferred_updates_total',
    help: 'The number of automatic updates deferred by a maintenance window, one per container per dispatch evaluation, including containers deferred because a dependency was deferred',
    labelNames: ['type', 'name'],
  });

  if (loggerInitFailureCounter) {
    register.removeSingleMetric(loggerInitFailureCounter.name);
  }
  loggerInitFailureCounter = new Counter({
    name: 'dd_watcher_logger_init_failures_total',
    help: 'The number of watcher logger initialization failures',
    labelNames: ['type', 'name'],
  });
}

export function getWatchContainerGauge() {
  return watchContainerGauge;
}

export function getMaintenanceSkipCounter() {
  return maintenanceSkipCounter;
}

export function getMaintenanceDeferredUpdateCounter() {
  return maintenanceDeferredUpdateCounter;
}

export function getLoggerInitFailureCounter() {
  return loggerInitFailureCounter;
}
