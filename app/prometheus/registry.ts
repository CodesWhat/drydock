import { Counter, register, Summary } from 'prom-client';

let summaryGetTags;
let digestCacheHitsCounter;
let digestCacheMissesCounter;

export function init() {
  // Replace summary if init is called more than once
  if (summaryGetTags) {
    register.removeSingleMetric(summaryGetTags.name);
  }
  summaryGetTags = new Summary({
    name: 'dd_registry_response',
    help: 'The Registry response time (in second)',
    labelNames: ['type', 'name'],
  });

  if (digestCacheHitsCounter) {
    register.removeSingleMetric(digestCacheHitsCounter.name);
  }
  digestCacheHitsCounter = new Counter({
    name: 'drydock_digest_cache_hits_total',
    help: 'Total number of digest cache hits',
  });

  if (digestCacheMissesCounter) {
    register.removeSingleMetric(digestCacheMissesCounter.name);
  }
  digestCacheMissesCounter = new Counter({
    name: 'drydock_digest_cache_misses_total',
    help: 'Total number of digest cache misses',
  });
}

export function getSummaryTags() {
  return summaryGetTags;
}

export function getDigestCacheHitsCounter() {
  return digestCacheHitsCounter;
}

export function getDigestCacheMissesCounter() {
  return digestCacheMissesCounter;
}
