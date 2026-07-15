import { createCounter } from './counter-factory.js';

const legacyInputCounter = createCounter(
  'dd_legacy_input_total',
  'Total number of legacy compatibility fallbacks consumed',
  ['source', 'key'],
);

type LegacyInputSource = 'env' | 'label' | 'api';

const LEGACY_INPUT_SOURCES: readonly LegacyInputSource[] = ['env', 'label', 'api'];

const legacyInputCounts: Record<LegacyInputSource, Map<string, number>> = {
  env: new Map<string, number>(),
  label: new Map<string, number>(),
  api: new Map<string, number>(),
};

interface LegacyInputSourceSummary {
  total: number;
  keys: string[];
}

interface LegacyInputSummary {
  total: number;
  env: LegacyInputSourceSummary;
  label: LegacyInputSourceSummary;
  api: LegacyInputSourceSummary;
}

function incrementLegacyInputCount(source: LegacyInputSource, key: string) {
  const sourceCounts = legacyInputCounts[source];
  sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
}

function buildSourceSummary(source: LegacyInputSource): LegacyInputSourceSummary {
  const entries = Array.from(legacyInputCounts[source].entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
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
  LEGACY_INPUT_SOURCES.forEach((source) => {
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
  const api = buildSourceSummary('api');
  return {
    total: env.total + label.total + api.total,
    env,
    label,
    api,
  };
}

export function recordLegacyInput(source: LegacyInputSource, key: string) {
  incrementLegacyInputCount(source, key);
  const counter = getLegacyInputCounter();
  if (!counter) {
    return;
  }
  counter.inc({ source, key });
}
