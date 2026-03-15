import { createCounter } from './counter-factory.js';

const { init, getCounter: getTriggerCounter } = createCounter(
  'dd_trigger_count',
  'Total count of trigger events',
  ['type', 'name', 'status'],
);

export { getTriggerCounter, init };
