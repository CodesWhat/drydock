import * as registry from './registry.js';

test('registry histogram should be properly configured', async () => {
  registry.init();
  const summary = registry.getSummaryTags();
  expect(summary.name).toStrictEqual('dd_registry_response');
  expect(summary.labelNames).toStrictEqual(['type', 'name']);
});

test('registry init should replace existing metric when called twice', async () => {
  registry.init();
  const first = registry.getSummaryTags();
  registry.init();
  const second = registry.getSummaryTags();
  expect(second.name).toStrictEqual('dd_registry_response');
  // The second call should create a new summary (not the same object)
  expect(second).not.toBe(first);
});

test('getSummaryTags should return undefined before init', async () => {
  // Fresh import to check state before init
  vi.resetModules();
  const fresh = await import('./registry.js');
  expect(fresh.getSummaryTags()).toBeUndefined();
});
