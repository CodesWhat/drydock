import * as rollback from './rollback.js';

test('rollback counter should be properly configured', async () => {
  rollback.init();
  const counter = rollback.getRollbackCounter();
  expect(counter.name).toStrictEqual('dd_trigger_rollback_total');
  expect(counter.labelNames).toStrictEqual(['type', 'name', 'outcome', 'reason']);
});
