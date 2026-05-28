import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

import { expectedActionUse } from './github-action-pins';

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

const workflowPath = fileURLToPath(new URL('../workflows/ci-verify.yml', import.meta.url));
const lefthookPath = fileURLToPath(new URL('../../lefthook.yml', import.meta.url));
const processorPath = fileURLToPath(new URL('../../test/load-test.processor.cjs', import.meta.url));
const emojiPrefix = /^\p{Extended_Pictographic}/u;
const workflowTestsCommand = 'npm run test:workflows';

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

test('workflow tests are wired outside the app coverage suite', () => {
  expect(getTestJobStep('Install repository dependencies')).toMatchObject({
    with: {
      command: 'npm ci --ignore-scripts',
    },
  });

  expect(getTestJobStep('Run workflow tests')).toMatchObject({
    run: workflowTestsCommand,
  });

  expect(loadLefthook()['pre-push']?.commands?.['workflow-tests']).toMatchObject({
    run: workflowTestsCommand,
    priority: 7,
  });
});

test('ci-verify skips Playwright browser downloads on load-test jobs but not cucumber', () => {
  const workflow = loadWorkflow();

  // Workflow-level skip would break the cucumber job, which actually launches
  // a browser via @playwright/test. Scope the skip to load-test jobs only.
  expect(workflow.env?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).toBeUndefined();

  for (const jobId of ['load-test-ci', 'load-test-behavior', 'load-test-stress']) {
    expect(workflow.jobs?.[jobId]?.env?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).toBe('1');
    expect(getWorkflowStep(jobId, 'Install e2e dependencies')).toBeDefined();
  }

  // Cucumber needs the browser, so it must not inherit the skip, and it gets
  // a cache step so the postinstall fetch survives CDN throttling.
  expect(workflow.jobs?.e2e?.env?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).toBeUndefined();
  expect(getWorkflowStep('e2e', 'Cache Playwright browsers')).toBeDefined();
  expect(getWorkflowStep('e2e', 'Install e2e dependencies')).toBeDefined();
});

test('DAST auth steps mask derived basic auth credentials', () => {
  for (const [jobId, stepName] of [
    ['dast-zap-baseline', 'Create ZAP authenticated session'],
    ['dast-nuclei', 'Create Nuclei authenticated session'],
  ]) {
    const run = getWorkflowStep(jobId, stepName)?.run;

    expect(run).toContain('basic_auth="$(printf');
    expect(run).toMatch(/basic_auth=.*\n\s*echo "::add-mask::\$\{basic_auth\}"/u);
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
    uses: expectedActionUse('actions/upload-artifact'),
    with: {
      path: 'artifacts/load-test/stress/*.json',
      'if-no-files-found': 'warn',
    },
  });
});

test('load-test behavior profile has an advisory regression baseline', () => {
  const baseline = JSON.parse(
    readFileSync(new URL('../../test/load-test-baselines/behavior.json', import.meta.url), 'utf8'),
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
