import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

interface WorkflowJob {
  name?: string;
  steps?: WorkflowJobStep[];
  'timeout-minutes'?: number;
  if?: string;
  needs?: string[];
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
  env?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
}

interface LefthookCommand {
  priority?: number;
  run?: string;
}

interface LefthookDefinition {
  'pre-push'?: {
    commands?: Record<string, LefthookCommand>;
  };
}

const workflowPath = fileURLToPath(new URL('../.github/workflows/ci-verify.yml', import.meta.url));
const lefthookPath = fileURLToPath(new URL('../lefthook.yml', import.meta.url));
const processorPath = fileURLToPath(new URL('../test/load-test.processor.cjs', import.meta.url));
const emojiPrefix = /^\p{Extended_Pictographic}/u;

function loadWorkflow(): WorkflowDefinition {
  return yaml.parse(readFileSync(workflowPath, 'utf8')) as WorkflowDefinition;
}

function loadLefthook(): LefthookDefinition {
  return yaml.parse(readFileSync(lefthookPath, 'utf8')) as LefthookDefinition;
}

function getTestJobStep(name: string): WorkflowJobStep | undefined {
  const workflow = loadWorkflow();
  return workflow.jobs?.test?.steps?.find((step) => step.name === name);
}

function getWorkflowStep(jobId: string, name: string): WorkflowJobStep | undefined {
  const workflow = loadWorkflow();
  return workflow.jobs?.[jobId]?.steps?.find((step) => step.name === name);
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

test('script node tests are wired into local and CI gates', () => {
  expect(getTestJobStep('Run scripts tests')).toMatchObject({
    run: 'node --test scripts/*.test.mjs',
  });

  expect(loadLefthook()['pre-push']?.commands?.['scripts-test']).toMatchObject({
    run: 'node --test scripts/*.test.mjs',
  });
});

test('ci-verify skips Playwright browser downloads for non-Playwright e2e installs', () => {
  const workflow = loadWorkflow();

  expect(workflow.env).toMatchObject({
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  });

  for (const jobId of ['e2e', 'load-test-ci', 'load-test-behavior', 'load-test-stress']) {
    expect(getWorkflowStep(jobId, 'Install e2e dependencies')).toBeDefined();
  }
});

test('load-test workflow runs load profiles in parallel jobs', () => {
  const workflow = loadWorkflow();
  const pushOnlyCondition =
    "github.event_name == 'push' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/heads/release/'))";

  expect(workflow.jobs?.['load-test-ci']).toMatchObject({
    name: '⚡ Load Test: CI',
    if: pushOnlyCondition,
    needs: ['build'],
    'timeout-minutes': expect.any(Number),
  });
  expect(workflow.jobs?.['load-test-behavior']).toMatchObject({
    name: '⚡ Load Test: Behavior',
    if: pushOnlyCondition,
    needs: ['build'],
    'timeout-minutes': expect.any(Number),
  });
  expect(workflow.jobs?.['load-test-stress']).toMatchObject({
    name: '⚡ Load Test: Stress (Advisory)',
    if: pushOnlyCondition,
    needs: ['build'],
    'timeout-minutes': expect.any(Number),
  });

  for (const jobId of ['load-test-ci', 'load-test-behavior', 'load-test-stress']) {
    expect(workflow.jobs?.[jobId]?.['timeout-minutes']).toBeLessThanOrEqual(30);
  }

  expect(getWorkflowStep('load-test-ci', 'Run Artillery behavior test')).toBeUndefined();
  expect(getWorkflowStep('load-test-ci', 'Run Artillery stress test (advisory)')).toBeUndefined();

  expect(getWorkflowStep('load-test-behavior', 'Run Artillery behavior test')).toMatchObject({
    id: 'run-load-test-behavior',
    env: {
      ARTILLERY_FILE: './test/test-behavior.yml',
      ARTILLERY_ENV: 'behavior',
      DD_LOAD_TEST_ARTIFACT_DIR: 'artifacts/load-test/behavior',
    },
  });

  expect(getWorkflowStep('load-test-stress', 'Run Artillery stress test (advisory)')).toMatchObject(
    {
      id: 'run-load-test-stress',
      'continue-on-error': true,
      env: {
        ARTILLERY_ENV: 'stress',
        DD_LOAD_TEST_ARTIFACT_DIR: 'artifacts/load-test/stress',
      },
    },
  );

  expect(
    getWorkflowStep('load-test-stress', 'Summarize load test metrics (stress)')?.run,
  ).toContain('artifacts/load-test/stress');

  const behaviorBaselineStep = getWorkflowStep(
    'load-test-behavior',
    'Resolve committed load test baseline (behavior)',
  );
  expect(behaviorBaselineStep).toMatchObject({
    id: 'load-test-baseline-behavior',
    if: "${{ always() && steps.run-load-test-behavior.conclusion == 'success' }}",
  });
  expect(behaviorBaselineStep?.run).toContain('test/load-test-baselines/behavior.json');

  expect(
    getWorkflowStep(
      'load-test-behavior',
      'Regression check against committed baseline (behavior, advisory)',
    ),
  ).toMatchObject({
    if: "${{ always() && steps.run-load-test-behavior.conclusion == 'success' }}",
    env: {
      BASELINE_REPORT: '${{ steps.load-test-baseline-behavior.outputs.baseline_report }}',
      DD_LOAD_TEST_REGRESSION_ENFORCE: 'false',
    },
  });

  expect(getWorkflowStep('load-test-stress', 'Correctness check (stress, advisory)')).toMatchObject(
    {
      if: 'always()',
      env: {
        DD_LOAD_TEST_CORRECTNESS_ENFORCE: 'false',
        DD_LOAD_TEST_MAX_VUSERS_FAILED: '0',
      },
    },
  );

  expect(getWorkflowStep('load-test-stress', 'Upload load test artifact (stress)')).toMatchObject({
    uses: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
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
