import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

interface WorkflowJob {
  name?: string;
  steps?: WorkflowJobStep[];
  'timeout-minutes'?: number;
}

interface WorkflowJobStep {
  name?: string;
  id?: string;
  run?: string;
  if?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
  'continue-on-error'?: boolean;
}

interface WorkflowDefinition {
  jobs?: Record<string, WorkflowJob>;
}

const workflowPath = fileURLToPath(new URL('../.github/workflows/ci-verify.yml', import.meta.url));
const processorPath = fileURLToPath(new URL('../test/load-test.processor.cjs', import.meta.url));
const emojiPrefix = /^\p{Extended_Pictographic}/u;

function loadWorkflow(): WorkflowDefinition {
  return yaml.parse(readFileSync(workflowPath, 'utf8')) as WorkflowDefinition;
}

function getLoadTestStep(name: string): WorkflowJobStep | undefined {
  const workflow = loadWorkflow();
  return workflow.jobs?.['load-test-ci']?.steps?.find((step) => step.name === name);
}

test('ci-verify job names are emoji-prefixed for GitHub checks readability', () => {
  const workflow = loadWorkflow();

  const jobsWithoutEmoji = Object.entries(workflow.jobs ?? {})
    .map(([jobId, job]) => ({
      jobId,
      name: job.name ?? '',
    }))
    .filter(({ name }) => !emojiPrefix.test(name));

  expect(jobsWithoutEmoji).toStrictEqual([]);
});

test('load-test workflow wires advisory behavior and stress coverage', () => {
  const workflow = loadWorkflow();
  const loadTestJob = workflow.jobs?.['load-test-ci'];

  expect(loadTestJob?.['timeout-minutes']).toBeGreaterThanOrEqual(45);

  expect(getLoadTestStep('Run Artillery behavior test')).toMatchObject({
    id: 'run-load-test-behavior',
    env: {
      ARTILLERY_FILE: './test/test-behavior.yml',
      ARTILLERY_ENV: 'behavior',
      DD_LOAD_TEST_ARTIFACT_DIR: 'artifacts/load-test/behavior',
    },
  });

  expect(getLoadTestStep('Run Artillery stress test (advisory)')).toMatchObject({
    id: 'run-load-test-stress',
    'continue-on-error': true,
    env: {
      ARTILLERY_ENV: 'stress',
      DD_LOAD_TEST_ARTIFACT_DIR: 'artifacts/load-test/stress',
    },
  });

  expect(getLoadTestStep('Summarize load test metrics (stress)')?.run).toContain(
    'artifacts/load-test/stress',
  );

  const behaviorBaselineStep = getLoadTestStep('Resolve committed load test baseline (behavior)');
  expect(behaviorBaselineStep).toMatchObject({
    id: 'load-test-baseline-behavior',
    if: "${{ always() && steps.run-load-test-behavior.conclusion == 'success' }}",
  });
  expect(behaviorBaselineStep?.run).toContain('test/load-test-baselines/behavior.json');

  expect(
    getLoadTestStep('Regression check against committed baseline (behavior, advisory)'),
  ).toMatchObject({
    if: "${{ always() && steps.run-load-test-behavior.conclusion == 'success' }}",
    env: {
      BASELINE_REPORT: '${{ steps.load-test-baseline-behavior.outputs.baseline_report }}',
      DD_LOAD_TEST_REGRESSION_ENFORCE: 'false',
    },
  });

  expect(getLoadTestStep('Correctness check (stress, advisory)')).toMatchObject({
    if: 'always()',
    env: {
      DD_LOAD_TEST_CORRECTNESS_ENFORCE: 'false',
      DD_LOAD_TEST_MAX_VUSERS_FAILED: '0',
    },
  });

  expect(getLoadTestStep('Upload load test artifact (stress)')).toMatchObject({
    uses: 'actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f',
    with: {
      path: 'artifacts/load-test/stress/*.json',
      'if-no-files-found': 'warn',
    },
  });
});

test('load-test behavior profile has an advisory regression baseline', () => {
  const baseline = JSON.parse(
    readFileSync(new URL('../test/load-test-baselines/behavior.json', import.meta.url), 'utf8'),
  ) as {
    aggregate?: {
      summaries?: Record<string, { p95?: number; p99?: number }>;
      rates?: Record<string, number>;
    };
  };

  expect(baseline.aggregate?.summaries?.['http.response_time']?.p95).toBeGreaterThan(0);
  expect(baseline.aggregate?.summaries?.['http.response_time']?.p99).toBeGreaterThan(0);
  expect(baseline.aggregate?.rates?.['http.request_rate']).toBeGreaterThan(0);
});

test('load-test processor only exports Artillery hooks used by scenarios', () => {
  const processorSource = readFileSync(processorPath, 'utf8');

  expect(processorSource).not.toContain('ensureContainerId');
});
