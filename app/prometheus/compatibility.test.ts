import * as compatibility from './compatibility.js';

test('legacy input counter should be properly configured', () => {
  compatibility.init();
  const counter = compatibility.getLegacyInputCounter();
  expect(counter.name).toStrictEqual('dd_legacy_input_total');
  expect(counter.labelNames).toStrictEqual(['source', 'key']);
});

test('recordLegacyInput should increment counter labels', () => {
  compatibility.init();
  const counter = compatibility.getLegacyInputCounter();
  const incSpy = vi.spyOn(counter, 'inc');

  compatibility.recordLegacyInput('env', 'WUD_EXAMPLE');

  expect(incSpy).toHaveBeenCalledWith({ source: 'env', key: 'WUD_EXAMPLE' });
});
