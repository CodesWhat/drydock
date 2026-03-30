import * as registry from './registry.js';

test('registry histogram should be properly configured', async () => {
  registry.init();
  const summary = registry.getSummaryTags();
  expect(summary.name).toStrictEqual('dd_registry_response');
  expect(summary.labelNames).toStrictEqual(['type', 'name']);
  const digestCacheHitsCounter = registry.getDigestCacheHitsCounter();
  expect(digestCacheHitsCounter.name).toStrictEqual('drydock_digest_cache_hits_total');
  const digestCacheMissesCounter = registry.getDigestCacheMissesCounter();
  expect(digestCacheMissesCounter.name).toStrictEqual('drydock_digest_cache_misses_total');
});

test('registry init should replace existing metric when called twice', async () => {
  registry.init();
  const first = registry.getSummaryTags();
  const firstHitsCounter = registry.getDigestCacheHitsCounter();
  const firstMissesCounter = registry.getDigestCacheMissesCounter();
  registry.init();
  const second = registry.getSummaryTags();
  const secondHitsCounter = registry.getDigestCacheHitsCounter();
  const secondMissesCounter = registry.getDigestCacheMissesCounter();
  expect(second.name).toStrictEqual('dd_registry_response');
  // The second call should create a new summary (not the same object)
  expect(second).not.toBe(first);
  expect(secondHitsCounter).not.toBe(firstHitsCounter);
  expect(secondMissesCounter).not.toBe(firstMissesCounter);
});

test('getSummaryTags should return undefined before init', async () => {
  // Fresh import to check state before init
  vi.resetModules();
  const fresh = await import('./registry.js');
  expect(fresh.getSummaryTags()).toBeUndefined();
  expect(fresh.getDigestCacheHitsCounter()).toBeUndefined();
  expect(fresh.getDigestCacheMissesCounter()).toBeUndefined();
});
