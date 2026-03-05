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

test('init should replay accumulated legacy counts into counter metrics', async () => {
  vi.resetModules();
  const counterInc = vi.fn();
  vi.doMock('./counter-factory.js', () => ({
    createCounter: () => {
      let counter: { inc: ReturnType<typeof vi.fn> } | undefined;
      return {
        init: vi.fn(() => {
          counter = { inc: counterInc };
        }),
        getCounter: vi.fn(() => counter),
      };
    },
  }));

  const fresh = await import('./compatibility.js');
  fresh.recordLegacyInput('env', 'WUD_REPLAY_ENV');
  fresh.recordLegacyInput('label', 'wud.replay.label');
  fresh.recordLegacyInput('label', 'wud.replay.label');
  fresh.init();

  expect(counterInc).toHaveBeenCalledWith({ source: 'env', key: 'WUD_REPLAY_ENV' }, 1);
  expect(counterInc).toHaveBeenCalledWith({ source: 'label', key: 'wud.replay.label' }, 2);
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

test('init and recordLegacyInput should be no-ops when counter factory returns no counter', async () => {
  vi.resetModules();
  vi.doMock('./counter-factory.js', () => ({
    createCounter: () => ({
      init: vi.fn(),
      getCounter: vi.fn(() => undefined),
    }),
  }));

  const fresh = await import('./compatibility.js');
  expect(() => fresh.init()).not.toThrow();
  expect(() => fresh.recordLegacyInput('env', 'WUD_FALLBACK_ONLY')).not.toThrow();
  expect(fresh.getLegacyInputSummary().env.keys).toContain('WUD_FALLBACK_ONLY');
});
