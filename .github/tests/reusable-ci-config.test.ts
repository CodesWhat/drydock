import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

interface ReusableCallerJob {
  name?: string;
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  secrets?: string | Record<string, unknown>;
  permissions?: Record<string, string>;
}

interface WorkflowWithReusableJobs {
  jobs?: Record<string, ReusableCallerJob>;
}

// The SHAs every CodesWhat/.github reusable-workflow caller in this repo
// must be pinned to, one per reusable workflow. Bumping a reusable workflow
// means bumping its constant here and re-verifying every caller of it in
// the same change.
const frozenGoCiSha = '47820bd85d49eb6cd0a935c31789c7d7ce037401';
const goCiUses = `CodesWhat/.github/.github/workflows/go-ci.yml@${frozenGoCiSha}`;

const frozenGreptileSummonSha = 'bbc181dc4d462f673dac2dff5f88a8408dd9c763';
const greptileSummonUses = `CodesWhat/.github/.github/workflows/greptile-summon.yml@${frozenGreptileSummonSha}`;

const frozenStarchartRefreshSha = '11004e42d7d19e86eb3b7777c467ec9522b784e1';
const starchartRefreshUses = `CodesWhat/.github/.github/workflows/starchart-refresh.yml@${frozenStarchartRefreshSha}`;

const frozenMainIsReleasedSha = '11004e42d7d19e86eb3b7777c467ec9522b784e1';
const mainIsReleasedUses = `CodesWhat/.github/.github/workflows/main-is-released.yml@${frozenMainIsReleasedSha}`;

const frozenReusableWorkflowUses = [
  goCiUses,
  greptileSummonUses,
  starchartRefreshUses,
  mainIsReleasedUses,
];

const workflowsDir = fileURLToPath(new URL('../workflows', import.meta.url));

function loadWorkflowFiles(): Array<{
  file: string;
  path: string;
  source: string;
  workflow: WorkflowWithReusableJobs;
}> {
  return readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .sort()
    .map((file) => {
      const path = join(workflowsDir, file);
      const source = readFileSync(path, 'utf8');
      return {
        file,
        path,
        source,
        workflow: yaml.parse(source) as WorkflowWithReusableJobs,
      };
    });
}

function reusableCallerJobs(): Array<{
  file: string;
  jobId: string;
  job: ReusableCallerJob;
}> {
  return loadWorkflowFiles().flatMap(({ file, workflow }) =>
    Object.entries(workflow.jobs ?? {})
      .filter(
        ([, job]) => typeof job.uses === 'string' && job.uses.startsWith('CodesWhat/.github/'),
      )
      .map(([jobId, job]) => ({ file, jobId, job })),
  );
}

test('every CodesWhat/.github reusable-workflow caller is pinned to a frozen SHA', () => {
  const violations = reusableCallerJobs()
    .filter(({ job }) => !frozenReusableWorkflowUses.includes(job.uses ?? ''))
    .map(({ file, jobId, job }) => `${file}/${jobId} uses ${job.uses}`);

  expect(violations).toStrictEqual([]);
});

test('no CodesWhat/.github uses ref in source is unpinned or off a frozen SHA', () => {
  const violations = loadWorkflowFiles().flatMap(({ file, source }) =>
    source
      .split('\n')
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter(({ line }) => line.includes('CodesWhat/.github/'))
      .filter(({ line }) => !frozenReusableWorkflowUses.some((uses) => line.includes(uses)))
      .map(({ lineNumber }) => `${file}:${lineNumber}`),
  );

  expect(violations).toStrictEqual([]);
});

test('CodesWhat/.github reusable-workflow callers do not inherit secrets', () => {
  const violations = reusableCallerJobs()
    .filter(({ job }) => job.secrets !== undefined)
    .map(({ file, jobId, job }) => `${file}/${jobId} secrets=${JSON.stringify(job.secrets)}`);

  expect(violations).toStrictEqual([]);

  const inheritLines = loadWorkflowFiles().flatMap(({ file, source }) =>
    source
      .split('\n')
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter(({ line }) => /secrets:\s*inherit\b/.test(line))
      .map(({ lineNumber }) => `${file}:${lineNumber}`),
  );

  expect(inheritLines).toStrictEqual([]);
});

test('security-actions caller grants exactly the statically-validated permission set', () => {
  const job = reusableCallerJobs().find(
    ({ file, jobId }) => file === 'ci-verify.yml' && jobId === 'security-actions',
  )?.job;

  expect(job).toBeDefined();
  // security-events: write is required even though run-codeql is unset:
  // GitHub validates the called workflow's job-level permissions statically
  // (go-ci.yml's nested codeql job declares it), regardless of if: gating.
  // Granting less makes every CI Verify run end in startup_failure.
  expect(job?.permissions).toStrictEqual({
    actions: 'read',
    contents: 'read',
    'security-events': 'write',
  });
});

test('security-actions caller disables the Go test and lint jobs', () => {
  const job = reusableCallerJobs().find(
    ({ file, jobId }) => file === 'ci-verify.yml' && jobId === 'security-actions',
  )?.job;

  expect(job).toBeDefined();
  // drydock is Go-less: go-ci.yml's run-test/run-lint jobs have nothing to
  // run here and must be disabled, or CI Verify would fail on a repo with no
  // Go module.
  expect(job?.with?.['run-test']).toBe(false);
  expect(job?.with?.['run-lint']).toBe(false);
});

test('greptile summon caller only fires on the second-opinion label', () => {
  const job = reusableCallerJobs().find(
    ({ file, jobId }) => file === 'greptile.yml' && jobId === 'summon',
  )?.job;

  expect(job).toBeDefined();
  expect(job?.if).toBe("github.event.label.name == 'second-opinion'");
});

test('greptile summon caller grants only pull-requests: write', () => {
  const job = reusableCallerJobs().find(
    ({ file, jobId }) => file === 'greptile.yml' && jobId === 'summon',
  )?.job;

  expect(job).toBeDefined();
  expect(job?.permissions).toStrictEqual({ 'pull-requests': 'write' });
});

test('greptile summon caller forwards the exact PR number and head SHA', () => {
  const job = reusableCallerJobs().find(
    ({ file, jobId }) => file === 'greptile.yml' && jobId === 'summon',
  )?.job;

  expect(job).toBeDefined();
  expect(job?.with).toStrictEqual({
    pr_number: '${{ github.event.pull_request.number }}',
    head_sha: '${{ github.event.pull_request.head.sha }}',
  });
});
