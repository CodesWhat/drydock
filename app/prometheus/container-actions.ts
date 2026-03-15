import { createCounter } from './counter-factory.js';

const { init, getCounter: getContainerActionsCounter } = createCounter(
  'dd_container_actions_total',
  'Total count of container action operations',
  ['action'],
);

export { getContainerActionsCounter, init };
