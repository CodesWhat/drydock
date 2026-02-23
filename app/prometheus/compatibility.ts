import { createCounter } from './counter-factory.js';

const { init, getCounter: getLegacyInputCounter } = createCounter(
  'dd_legacy_input_total',
  'Total number of legacy compatibility fallbacks consumed',
  ['source', 'key'],
);

export { init, getLegacyInputCounter };

export function recordLegacyInput(source: 'env' | 'label', key: string) {
  const counter = getLegacyInputCounter();
  if (!counter) {
    return;
  }
  counter.inc({ source, key });
}
