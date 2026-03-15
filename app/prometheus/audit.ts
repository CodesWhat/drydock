import { createCounter } from './counter-factory.js';

const { init, getCounter: getAuditCounter } = createCounter(
  'dd_audit_entries_total',
  'Total count of audit log entries',
  ['action'],
);

export { getAuditCounter, init };
