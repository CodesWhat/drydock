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

test('getLegacyInputSummary should include tracked env and label keys', () => {
  const uniqueSuffix = Date.now().toString();
  const envKey = `WUD_SUMMARY_${uniqueSuffix}`;
  const labelKey = `wud.summary.${uniqueSuffix}`;

  compatibility.recordLegacyInput('env', envKey);
  compatibility.recordLegacyInput('label', labelKey);

  const summary = compatibility.getLegacyInputSummary();

  expect(summary.total).toBeGreaterThanOrEqual(2);
  expect(summary.env.keys).toContain(envKey);
  expect(summary.label.keys).toContain(labelKey);
});
