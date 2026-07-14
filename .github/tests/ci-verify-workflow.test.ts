import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

import { expectedActionUse } from './github-action-pins';

interface WorkflowJob {
  env?: Record<string, string>;
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
  'working-directory'?: string;
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

test('ci-verify runs Cucumber in the pinned Playwright browser image', () => {
  const workflow = loadWorkflow();
  const playwrightImage =
    'mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48';

  // Keep host-side installs from downloading a browser. The Cucumber browser
  // comes from the same immutable image used by the dedicated Playwright gate.
  expect(workflow.env?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).toBeUndefined();

  for (const jobId of ['load-test-ci', 'load-test-behavior']) {
    expect(workflow.jobs?.[jobId]?.env?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).toBe('1');
    expect(getWorkflowStep(jobId, 'Install e2e dependencies')).toBeDefined();
  }

  expect(workflow.jobs?.e2e?.env).toMatchObject({
    PLAYWRIGHT_IMAGE: playwrightImage,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  });
  expect(getWorkflowStep('e2e', 'Cache Playwright browsers')).toBeUndefined();
  expect(getWorkflowStep('e2e', 'Install e2e dependencies')).toBeUndefined();

  const verifyImage = getWorkflowStep('e2e', 'Verify Playwright image matches package')?.run;
  expect(verifyImage).toContain(
    "require('./e2e/package.json').devDependencies['@playwright/test']",
  );
  expect(verifyImage).toContain('PLAYWRIGHT_IMAGE uses $image_version');

  expect(getWorkflowStep('e2e', 'Pull Playwright container')).toMatchObject({
    with: {
      command: 'docker pull "$PLAYWRIGHT_IMAGE"',
    },
  });

  const cucumber = getWorkflowStep('e2e', 'Run Cucumber e2e tests');
  expect(cucumber?.['working-directory']).toBeUndefined();
  expect(cucumber?.run).toContain('docker run --rm');
  expect(cucumber?.run).toContain('--network host');
  expect(cucumber?.run).toContain('--user 1001:1001');
  expect(cucumber?.run).toContain('-e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright');
  expect(cucumber?.run).toContain('-e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD');
  expect(cucumber?.run).not.toContain('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1');
  expect(cucumber?.env?.DD_PORT).toBe('${{ steps.drydock.outputs.dd_port }}');
  expect(cucumber?.run).toContain('-e DD_PORT');
  expect(cucumber?.run).toContain('-v "${{ github.workspace }}:/work"');
  expect(cucumber?.run).toContain('-w /work/e2e');
  expect(cucumber?.run).toContain('"$PLAYWRIGHT_IMAGE"');
  expect(cucumber?.run).toContain(
    'npm ci --no-audit --no-fund && npm run cucumber -- --tags "not @requires_gitlab" --retry 1',
  );
});

test('DAST auth steps mask derived basic auth credentials', () => {
  for (const [jobId, stepName] of [
    ['dast-zap-baseline', 'Create ZAP authenticated session'],
    ['dast-zap-baseline', 'Create Nuclei authenticated session'],
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
    name: '⚡ Load Test: Behavior + Stress (Advisory)',
    if: pushOnlyCondition,
    needs: ['build'],
    'timeout-minutes': expect.any(Number),
  });

  for (const jobId of ['load-test-ci', 'load-test-behavior']) {
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

  expect(
    getWorkflowStep('load-test-behavior', 'Run Artillery stress test (advisory)'),
  ).toMatchObject({
    id: 'run-load-test-stress',
    'continue-on-error': true,
    env: {
      ARTILLERY_ENV: 'stress',
      DD_LOAD_TEST_ARTIFACT_DIR: 'artifacts/load-test/stress',
    },
  });

  expect(
    getWorkflowStep('load-test-behavior', 'Summarize load test metrics (stress)')?.run,
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

  expect(
    getWorkflowStep('load-test-behavior', 'Correctness check (stress, advisory)'),
  ).toMatchObject({
    if: 'always()',
    env: {
      DD_LOAD_TEST_CORRECTNESS_ENFORCE: 'false',
      DD_LOAD_TEST_MAX_VUSERS_FAILED: '0',
    },
  });

  expect(getWorkflowStep('load-test-behavior', 'Upload load test artifact (stress)')).toMatchObject(
    {
      uses: expectedActionUse('actions/upload-artifact'),
      with: {
        path: 'artifacts/load-test/stress/*.json',
        'if-no-files-found': 'warn',
      },
    },
  );
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
