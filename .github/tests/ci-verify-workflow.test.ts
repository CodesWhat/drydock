import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

import { expectedActionUse } from './github-action-pins';
import {
  getWorkflowStep as getWorkflowStepFrom,
  loadWorkflow as loadWorkflowFrom,
  type WorkflowStep,
} from './workflow-test-utils';

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
const secretScanScriptPath = fileURLToPath(
  new URL('../../scripts/scan-secrets.sh', import.meta.url),
);
const gitleaksConfigPath = fileURLToPath(new URL('../../.gitleaks.toml', import.meta.url));
const gitleaksIgnorePath = fileURLToPath(new URL('../../.gitleaksignore', import.meta.url));
const workflowTestsCommand = 'npm run test:workflows';
const loadWorkflow = loadWorkflowFrom.bind(undefined, workflowPath);
const getWorkflowStep = getWorkflowStepFrom.bind(undefined, workflowPath);

function loadLefthook(): LefthookDefinition {
  return yaml.parse(readFileSync(lefthookPath, 'utf8')) as LefthookDefinition;
}

function getTestJobStep(name: string): WorkflowStep | undefined {
  const workflow = loadWorkflow();
  return workflow.jobs?.test?.steps?.find((step) => step.name === name);
}

test('required ci-verify jobs publish stable plain-text check names', () => {
  const workflow = loadWorkflow();

  expect(workflow.jobs?.lint?.name).toBe('Quality: Lint');
  expect(workflow.jobs?.test?.name).toBe('Quality: Test & Coverage');
  expect(workflow.jobs?.build?.name).toBe('Build');
  expect(workflow.jobs?.e2e?.name).toBe('E2E: Cucumber');
});

test('the retired "legacy-security-actions" bridge job and its plain check name stay removed', () => {
  const workflow = loadWorkflow();
  const source = readFileSync(workflowPath, 'utf8');

  // Ruleset 13077055 was narrowed to require the composite "Security: Actions
  // / Workflow Security" context directly, so the fail-closed bridge that
  // republished the old plain "Security: Actions" context is gone.
  expect(workflow.jobs?.['legacy-security-actions']).toBeUndefined();

  // No job may republish the retired plain "Security: Actions" context. The
  // security-actions caller's own name: field legitimately reads "Security:
  // Actions" too -- for a `uses:` job GitHub only ever consumes it as the
  // "<caller name> / <called job name>" composite prefix, never as a
  // standalone check -- so it's the one expected exception here.
  const otherJobsWithBareName = Object.entries(workflow.jobs ?? {}).filter(
    ([jobId, job]) => jobId !== 'security-actions' && job?.name === 'Security: Actions',
  );
  expect(otherJobsWithBareName).toStrictEqual([]);

  // Anchored to `name:` at (optionally indented) line-start with optional
  // quotes so this can't false-positive on an input key that merely ends in
  // "name:", e.g. `workflow-security-check-name: Security: Actions`.
  const bareNameLines = [...source.matchAll(/^[ \t]*name:\s*["']?Security: Actions["']?\s*$/gmu)];
  expect(bareNameLines).toHaveLength(1);
});

test('security-actions calls the reusable go-ci workflow-security gate', () => {
  const workflow = loadWorkflow();
  const job = workflow.jobs?.['security-actions'] as
    | { uses?: string; with?: Record<string, unknown>; name?: string }
    | undefined;

  expect(job?.name).toBe('Security: Actions');
  expect(job?.uses).toBe(
    'CodesWhat/.github/.github/workflows/go-ci.yml@47820bd85d49eb6cd0a935c31789c7d7ce037401',
  );
  expect(job?.with?.['run-workflow-security']).toBe(true);
  expect(job?.with?.['workflow-security-egress-policy']).toBe('block');
  expect(job?.with?.['workflow-security-allowed-endpoints']).toBe(
    'ghcr.io:443 github.com:443 pkg-containers.githubusercontent.com:443',
  );
  // drydock is Go-less, so both Go jobs go-ci.yml gained must stay disabled.
  expect(job?.with?.['run-test']).toBe(false);
  expect(job?.with?.['run-lint']).toBe(false);

  const runFlags = Object.keys(job?.with ?? {}).filter(
    (key) =>
      key.startsWith('run-') && !['run-workflow-security', 'run-test', 'run-lint'].includes(key),
  );
  expect(runFlags).toStrictEqual([]);
});

test('script node tests are wired into local and CI gates', () => {
  expect(getTestJobStep('Checkout')).toMatchObject({
    with: {
      'fetch-depth': 0,
      'persist-credentials': false,
    },
  });
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
    priority: 8,
  });
});

test('demo mock contracts and production build are first-class CI gates', () => {
  expect(getTestJobStep('Install demo dependencies')).toMatchObject({
    with: {
      command: 'cd apps/demo && npm ci --ignore-scripts',
    },
  });
  expect(getTestJobStep('Run demo contract and security tests')).toMatchObject({
    run: 'npm test',
    'working-directory': 'apps/demo',
  });
  expect(getWorkflowStep('build', 'Build demo')).toMatchObject({
    run: 'npm run build',
    'working-directory': 'apps/demo',
  });
});

test('secret scanning gates full history and the tracked working tree', () => {
  const workflow = loadWorkflow();
  const job = workflow.jobs?.secrets;

  expect(job).toMatchObject({
    name: 'Security: Secrets',
    needs: ['security-actions'],
    'runs-on': 'ubuntu-24.04',
    'timeout-minutes': 10,
  });
  expect(getWorkflowStep('secrets', 'Checkout')).toMatchObject({
    with: {
      'fetch-depth': 0,
      'persist-credentials': false,
    },
  });
  expect(getWorkflowStep('secrets', 'Install Gitleaks')).toMatchObject({
    env: {
      GITLEAKS_VERSION: '8.30.1',
      GITLEAKS_LINUX_X64_SHA256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
    },
  });
  expect(getWorkflowStep('secrets', 'Scan secrets')).toMatchObject({
    run: 'scripts/scan-secrets.sh',
  });

  const scanScript = readFileSync(secretScanScriptPath, 'utf8');
  expect(scanScript).toContain('gitleaks git');
  expect(scanScript).toContain('gitleaks dir');
  expect(scanScript).toContain('git -C "${repo_root}" ls-files -z');
  expect(scanScript).toContain('--redact');

  const gitleaksConfig = readFileSync(gitleaksConfigPath, 'utf8');
  expect(gitleaksConfig).toContain('useDefault = true');
  expect(gitleaksConfig).not.toContain('paths =');

  const baselineEntries = readFileSync(gitleaksIgnorePath, 'utf8').trim().split('\n');
  expect(baselineEntries.length).toBeGreaterThan(400);
  expect(
    baselineEntries.every((entry) =>
      /^(?:[0-9a-f]{40}:)?[^:]+:(?:generic-api-key|private-key|curl-auth-header|telegram-bot-api-token):\d+$/u.test(
        entry,
      ),
    ),
  ).toBe(true);
});

test('a pull request cannot weaken the secrets gate that scans it', () => {
  const workflow = loadWorkflow();
  const steps = workflow.jobs?.secrets?.steps ?? [];

  const checkoutIndex = steps.findIndex((step) => step.name === 'Checkout');
  const restoreIndex = steps.findIndex(
    (step) => step.name === 'Restore scanner policy from the base ref',
  );
  const installGitleaksIndex = steps.findIndex((step) => step.name === 'Install Gitleaks');
  const scanIndex = steps.findIndex((step) => step.name === 'Scan secrets');

  // The restore must run after the checkout gives it something to restore
  // into, and strictly before anything that installs or invokes the scanner,
  // otherwise a PR-modified script or policy file could still be read.
  expect(checkoutIndex).toBeGreaterThanOrEqual(0);
  expect(restoreIndex).toBeGreaterThan(checkoutIndex);
  expect(installGitleaksIndex).toBeGreaterThan(restoreIndex);
  expect(scanIndex).toBeGreaterThan(restoreIndex);

  const restoreStep = getWorkflowStep('secrets', 'Restore scanner policy from the base ref');
  expect(restoreStep).toMatchObject({
    if: "github.event_name == 'pull_request'",
    env: {
      BASE_REF: '${{ github.base_ref }}',
    },
  });

  // Only pull_request has a meaningful base_ref/head divergence -- push,
  // schedule, workflow_dispatch, and workflow_call all run trusted content
  // already, so gating any wider would be a no-op at best.
  expect(restoreStep?.if).not.toContain('push');
  expect(restoreStep?.if).not.toContain('schedule');
  expect(restoreStep?.if).not.toContain('workflow_dispatch');

  const run = restoreStep?.run ?? '';
  expect(run).toContain('set -euo pipefail');
  // Depth-1 fetch of just the base branch tip -- cheap, and the restore only
  // ever needs the current state of those three files on base, not history.
  expect(run).toContain('git fetch --no-tags --depth=1 origin "refs/heads/${BASE_REF}"');
  expect(run).toContain(
    'git checkout FETCH_HEAD -- scripts/scan-secrets.sh .gitleaks.toml .gitleaksignore',
  );
});

test('ci-verify can dispatch the complete release-candidate matrix manually', () => {
  const workflow = loadWorkflow();

  expect(workflow.on).toHaveProperty('workflow_dispatch');
  expect(getWorkflowStep('changes', 'Filter paths')?.with?.base).toContain(
    "github.event_name == 'workflow_dispatch'",
  );

  for (const jobId of [
    'codeql',
    'fuzz',
    'web',
    'dast-zap-baseline',
    'e2e',
    'load-test-ci',
    'load-test-behavior',
  ]) {
    expect(workflow.jobs?.[jobId]?.if).toContain("github.event_name == 'workflow_dispatch'");
  }

  for (const jobId of ['security-actions', 'changes', 'lint', 'test', 'build']) {
    expect(workflow.jobs?.[jobId]?.if).toBeUndefined();
  }

  expect(workflow.jobs?.codeql?.needs).toStrictEqual(['security-actions']);
  expect(workflow.jobs?.fuzz?.needs).toStrictEqual(['security-actions']);
  expect(workflow.jobs?.web?.needs).toStrictEqual(['changes']);
  expect(workflow.jobs?.['dast-zap-baseline']?.needs).toStrictEqual(['build']);
  expect(workflow.jobs?.e2e?.needs).toStrictEqual(['build', 'changes']);
  expect(workflow.jobs?.['load-test-ci']?.needs).toStrictEqual(['build']);
  expect(workflow.jobs?.['load-test-behavior']?.needs).toStrictEqual(['build']);
});

test('ci-verify keeps Cucumber browser-free and retries only dependency installation', () => {
  const workflow = loadWorkflow();
  // Worst-case bounded retries plus readiness leave enough time for the
  // suite and post-failure artifact handling.
  expect(workflow.jobs?.e2e?.['timeout-minutes']).toBe(40);
  expect(workflow.jobs?.e2e?.permissions).toStrictEqual({
    actions: 'read',
    contents: 'read',
  });

  // Cucumber owns API/WebSocket contracts. Browser behavior is covered by the
  // separately release-gated Playwright workflow.
  expect(workflow.env?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).toBeUndefined();

  for (const jobId of ['load-test-ci', 'load-test-behavior']) {
    expect(workflow.jobs?.[jobId]?.env?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).toBe('1');
    expect(getWorkflowStep(jobId, 'Install e2e dependencies')).toBeDefined();
  }

  expect(workflow.jobs?.e2e?.env).toStrictEqual({
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  });
  expect(getWorkflowStep('e2e', 'Cache Playwright browsers')).toBeUndefined();
  expect(getWorkflowStep('e2e', 'Verify Playwright image matches package')).toBeUndefined();
  expect(getWorkflowStep('e2e', 'Pull Playwright container')).toBeUndefined();
  expect(getWorkflowStep('e2e', 'Download QA image')).toMatchObject({
    uses: expectedActionUse('actions/download-artifact'),
    with: {
      name: 'qa-image-${{ github.run_id }}',
      path: 'artifacts/qa',
    },
  });
  expect(getWorkflowStep('e2e', 'Load QA image')?.run).toBe(
    'docker load < artifacts/qa/drydock-dev-image.tar.gz',
  );

  expect(getWorkflowStep('e2e', 'Start drydock')).toMatchObject({
    env: {
      DD_E2E_IMAGE: 'drydock:dev',
      DD_E2E_SKIP_BUILD: 'true',
    },
  });

  const install = getWorkflowStep('e2e', 'Install e2e dependencies');
  expect(install).toMatchObject({
    uses: expectedActionUse('nick-fields/retry'),
    with: {
      timeout_minutes: 3,
      max_attempts: 3,
    },
  });
  expect(install?.with?.command).toBe('cd e2e && npm ci --no-audit --no-fund');
  expect(install?.with?.command).not.toContain('npm run cucumber');
  expect(getWorkflowStep('e2e', 'Run Cucumber support tests')).toMatchObject({
    run: 'npm run test:support',
    'working-directory': 'e2e',
  });
  expect(getWorkflowStep('e2e', 'Setup test containers')).toMatchObject({
    with: {
      timeout_minutes: 6,
      max_attempts: 2,
    },
  });

  const cucumber = getWorkflowStep('e2e', 'Run Cucumber e2e tests');
  expect(cucumber?.['working-directory']).toBe('e2e');
  expect(cucumber?.env?.DD_PORT).toBe('${{ steps.drydock.outputs.dd_port }}');
  expect(cucumber?.run).toContain('npm run cucumber -- --tags "not @requires_gitlab"');
  expect(cucumber?.run).not.toContain('docker run');
  expect(cucumber?.run).not.toContain('npm ci');
  expect(cucumber?.run).not.toContain('--retry');
  expect(cucumber?.run).toContain('--format json:reports/cucumber.json');
  expect(cucumber?.run).toContain('--format junit:reports/cucumber.xml');
  expect(cucumber?.run).toContain('--format html:reports/cucumber.html');

  const diagnostics = getWorkflowStep('e2e', 'Collect Cucumber diagnostics');
  expect(diagnostics).toMatchObject({
    if: 'failure() || cancelled()',
    env: {
      DD_PASSWORD: 'doe',
      DD_USERNAME: 'john',
    },
  });
  expect(diagnostics?.run).toContain('--user "${DD_USERNAME}:${DD_PASSWORD}"');
  expect(diagnostics?.run?.match(/--max-time 10/g)).toHaveLength(2);
  expect(diagnostics?.run).not.toContain('Authorization: Basic');
  expect(getWorkflowStep('e2e', 'Upload Cucumber diagnostics')).toMatchObject({
    if: 'always()',
    uses: expectedActionUse('actions/upload-artifact'),
    with: {
      path: expect.stringContaining('e2e/reports'),
      'if-no-files-found': 'warn',
    },
  });
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
  const releaseMatrixCondition =
    "github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/heads/release/')))";

  expect(workflow.jobs?.['load-test-ci']).toMatchObject({
    name: 'Load Test: CI',
    if: releaseMatrixCondition,
    needs: ['build'],
    'timeout-minutes': expect.any(Number),
  });
  expect(workflow.jobs?.['load-test-behavior']).toMatchObject({
    name: 'Load Test: Behavior + Stress (Advisory)',
    if: releaseMatrixCondition,
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

test('build job checks base image pins before building, for the platforms it smoke-builds', () => {
  const workflow = loadWorkflow();
  const steps = workflow.jobs?.build?.steps ?? [];
  const guardIndex = steps.findIndex(
    (step) => step.name === 'Verify base image pins are multi-arch indexes',
  );
  const guard = steps[guardIndex];
  const smokeBuild = getWorkflowStep('build', 'Docker build (multi-arch smoke)');
  const smokePlatforms = /--platform ([^\s\\]+)/u.exec(String(smokeBuild?.with?.command))?.[1];

  expect(guardIndex).toBeGreaterThan(-1);
  expect(guardIndex).toBeLessThan(
    steps.findIndex((step) => step.name === 'Docker build (QA image + smoke test)'),
  );
  expect(guardIndex).toBeLessThan(
    steps.findIndex((step) => step.name === 'Docker build (multi-arch smoke)'),
  );
  // The smoke build cannot catch a per-platform manifest pin on its own: a
  // digest resolves the same for every --platform, so the arm64 stage builds
  // green on an amd64 rootfs (#1021). Both must cover the same platforms.
  expect(smokePlatforms).toBe('linux/amd64,linux/arm64');
  expect(guard?.with?.command).toBe(
    `scripts/check-dockerfile-base-indexes.sh Dockerfile ${smokePlatforms}`,
  );
});
