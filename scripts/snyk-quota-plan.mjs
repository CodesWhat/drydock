#!/usr/bin/env node

import fs from 'node:fs';

const PRODUCT_KEYS = ['openSource', 'code', 'container', 'iac'];
export const DEFAULT_CONFIG_PATH = new URL('./snyk-quota-config.json', import.meta.url);

function toPositiveInt(value, name) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return numeric;
}

function normalizeQuotas(quotas) {
  return {
    openSource: toPositiveInt(quotas?.openSource, 'quotas.openSource'),
    code: toPositiveInt(quotas?.code, 'quotas.code'),
    container: toPositiveInt(quotas?.container, 'quotas.container'),
    iac: toPositiveInt(quotas?.iac, 'quotas.iac'),
  };
}

function normalizeTestsPerRun(testsPerRun) {
  return {
    openSource: toPositiveInt(testsPerRun?.openSource, 'testsPerRun.openSource'),
    code: toPositiveInt(testsPerRun?.code, 'testsPerRun.code'),
    container: toPositiveInt(testsPerRun?.container, 'testsPerRun.container'),
    iac: toPositiveInt(testsPerRun?.iac, 'testsPerRun.iac'),
  };
}

function normalizeQuotaConfig(config) {
  return {
    runsPerMonth: toPositiveInt(config?.runsPerMonth, 'runsPerMonth'),
    testsPerRun: normalizeTestsPerRun(config?.testsPerRun),
    quotas: normalizeQuotas(config?.quotas),
  };
}

export function loadQuotaConfig(configPath = DEFAULT_CONFIG_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Unable to read quota config at ${String(configPath)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Quota config is not valid JSON at ${String(configPath)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return normalizeQuotaConfig(parsed);
}

export function evaluateQuotaPlan({
  runsPerMonth,
  openSourceTestsPerRun,
  codeTestsPerRun,
  containerTestsPerRun,
  iacTestsPerRun,
  quotas,
}) {
  const normalizedQuotas = normalizeQuotas(quotas);
  const normalizedRunsPerMonth = toPositiveInt(runsPerMonth, 'runsPerMonth');
  const monthly = {
    openSource: normalizedRunsPerMonth * toPositiveInt(openSourceTestsPerRun, 'openSourceTestsPerRun'),
    code: normalizedRunsPerMonth * toPositiveInt(codeTestsPerRun, 'codeTestsPerRun'),
    container: normalizedRunsPerMonth * toPositiveInt(containerTestsPerRun, 'containerTestsPerRun'),
    iac: normalizedRunsPerMonth * toPositiveInt(iacTestsPerRun, 'iacTestsPerRun'),
  };

  const violations = [];
  for (const product of PRODUCT_KEYS) {
    const monthlyTests = monthly[product];
    const quota = normalizedQuotas[product];
    if (monthlyTests > quota) {
      violations.push(
        `${product} exceeds monthly quota: ${monthlyTests}/${quota}`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    monthly,
    violations,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) {
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for argument: ${key}`);
    }
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadQuotaConfig(args.config);
  const plan = evaluateQuotaPlan({
    runsPerMonth: args.runsPerMonth ?? config.runsPerMonth,
    openSourceTestsPerRun: args.openSourceTestsPerRun ?? config.testsPerRun.openSource,
    codeTestsPerRun: args.codeTestsPerRun ?? config.testsPerRun.code,
    containerTestsPerRun: args.containerTestsPerRun ?? config.testsPerRun.container,
    iacTestsPerRun: args.iacTestsPerRun ?? config.testsPerRun.iac,
    quotas: config.quotas,
  });

  const payload = {
    ok: plan.ok,
    monthly: plan.monthly,
    quotas: config.quotas,
    violations: plan.violations,
  };

  console.log(JSON.stringify(payload, null, 2));
  if (!plan.ok) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
