import * as trigger from './trigger.js';

test('trigger counter should be properly configured', async () => {
  trigger.init();
  const summary = trigger.getTriggerCounter();
  expect(summary.name).toStrictEqual('dd_trigger_count');
  expect(summary.labelNames).toStrictEqual(['type', 'name', 'status']);
});

test('trigger init should replace existing counter when called twice', async () => {
  trigger.init();
  const first = trigger.getTriggerCounter();
  trigger.init();
  const second = trigger.getTriggerCounter();
  expect(second.name).toStrictEqual('dd_trigger_count');
  expect(second).not.toBe(first);
});

test('getTriggerCounter should return undefined before init', async () => {
  vi.resetModules();
  const fresh = await import('./trigger.js');
  expect(fresh.getTriggerCounter()).toBeUndefined();
});
