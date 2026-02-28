import { createCounter } from './counter-factory.js';

const legacyInputCounter = createCounter(
  'dd_legacy_input_total',
  'Total number of legacy compatibility fallbacks consumed',
  ['source', 'key'],
);

const legacyInputCounts: Record<'env' | 'label', Map<string, number>> = {
  env: new Map<string, number>(),
  label: new Map<string, number>(),
};

interface LegacyInputSourceSummary {
  total: number;
  keys: string[];
}

interface LegacyInputSummary {
  total: number;
  env: LegacyInputSourceSummary;
  label: LegacyInputSourceSummary;
}

function incrementLegacyInputCount(source: 'env' | 'label', key: string) {
  const sourceCounts = legacyInputCounts[source];
  sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
}

function buildSourceSummary(source: 'env' | 'label'): LegacyInputSourceSummary {
  const entries = Array.from(legacyInputCounts[source].entries()).sort(([a], [b]) => a.localeCompare(b));
  return {
    total: entries.reduce((count, [, value]) => count + value, 0),
    keys: entries.map(([key]) => key),
  };
}

export function init() {
  legacyInputCounter.init();
  const counter = legacyInputCounter.getCounter();
  if (!counter) {
    return;
  }
  (['env', 'label'] as const).forEach((source) => {
    legacyInputCounts[source].forEach((count, key) => {
      counter.inc({ source, key }, count);
    });
  });
}

export function getLegacyInputCounter() {
  return legacyInputCounter.getCounter();
}

export function getLegacyInputSummary(): LegacyInputSummary {
  const env = buildSourceSummary('env');
  const label = buildSourceSummary('label');
  return {
    total: env.total + label.total,
    env,
    label,
  };
}

export function recordLegacyInput(source: 'env' | 'label', key: string) {
  incrementLegacyInputCount(source, key);
  const counter = getLegacyInputCounter();
  if (!counter) {
    return;
  }
  counter.inc({ source, key });
}
