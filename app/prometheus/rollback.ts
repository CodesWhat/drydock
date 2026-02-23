import { createCounter } from './counter-factory.js';

const { init, getCounter: getRollbackCounter } = createCounter(
  'dd_trigger_rollback_total',
  'Total count of trigger rollback outcomes',
  ['type', 'name', 'outcome', 'reason'],
);

export { init, getRollbackCounter };
