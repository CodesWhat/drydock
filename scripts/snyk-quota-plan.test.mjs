import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateQuotaPlan, loadQuotaConfig } from './snyk-quota-plan.mjs';

test('default config plan stays within configured Snyk quotas', () => {
  const config = loadQuotaConfig();
  const result = evaluateQuotaPlan({
    runsPerMonth: config.runsPerMonth,
    openSourceTestsPerRun: config.testsPerRun.openSource,
    codeTestsPerRun: config.testsPerRun.code,
    containerTestsPerRun: config.testsPerRun.container,
    iacTestsPerRun: config.testsPerRun.iac,
    quotas: config.quotas,
  });

  assert.equal(result.ok, true);
  assert.equal(result.monthly.openSource, 16);
  assert.equal(result.monthly.code, 4);
  assert.equal(result.monthly.container, 4);
  assert.equal(result.monthly.iac, 4);
  assert.equal(config.quotas.code, 100);
});

test('fails plan when code scans exceed monthly quota', () => {
  const config = loadQuotaConfig();
  const result = evaluateQuotaPlan({
    runsPerMonth: 40,
    openSourceTestsPerRun: 1,
    codeTestsPerRun: 3,
    containerTestsPerRun: 1,
    iacTestsPerRun: 1,
    quotas: config.quotas,
  });

  assert.equal(result.ok, false);
  assert.match(result.violations.join(' '), /code/i);
});

test('loads quota and cadence values from a custom config file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snyk-quota-plan-'));
  const configPath = path.join(tmpDir, 'config.json');

  fs.writeFileSync(
    configPath,
    JSON.stringify({
      runsPerMonth: 2,
      testsPerRun: {
        openSource: 5,
        code: 1,
        container: 2,
        iac: 3,
      },
      quotas: {
        openSource: 10,
        code: 2,
        container: 4,
        iac: 6,
      },
    }),
  );

  const config = loadQuotaConfig(configPath);
  const result = evaluateQuotaPlan({
    runsPerMonth: config.runsPerMonth,
    openSourceTestsPerRun: config.testsPerRun.openSource,
    codeTestsPerRun: config.testsPerRun.code,
    containerTestsPerRun: config.testsPerRun.container,
    iacTestsPerRun: config.testsPerRun.iac,
    quotas: config.quotas,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.monthly, {
    openSource: 10,
    code: 2,
    container: 4,
    iac: 6,
  });
});
