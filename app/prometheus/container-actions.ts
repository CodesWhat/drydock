import { Counter, register } from 'prom-client';

var containerActionsCounter;

export function init() {
  if (containerActionsCounter) {
    register.removeSingleMetric(containerActionsCounter.name);
  }
  containerActionsCounter = new Counter({
    name: 'dd_container_actions_total',
    help: 'Total count of container action operations',
    labelNames: ['action'],
  });
}

export function getContainerActionsCounter() {
  return containerActionsCounter;
}
