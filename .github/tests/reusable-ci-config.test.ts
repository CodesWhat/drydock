import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

interface ReusableCallerJob {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
  secrets?: string | Record<string, unknown>;
  permissions?: Record<string, string>;
}

interface WorkflowWithReusableJobs {
  jobs?: Record<string, ReusableCallerJob>;
}

// The go-ci.yml SHA every CodesWhat/.github reusable-workflow caller in this
// repo must be pinned to. Bumping the reusable workflow means bumping this
// constant and re-verifying every caller in the same change.
const frozenGoCiSha = '47820bd85d49eb6cd0a935c31789c7d7ce037401';
const goCiUses = `CodesWhat/.github/.github/workflows/go-ci.yml@${frozenGoCiSha}`;

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

test('every CodesWhat/.github reusable-workflow caller is pinned to the frozen SHA', () => {
  const violations = reusableCallerJobs()
    .filter(({ job }) => job.uses !== goCiUses)
    .map(({ file, jobId, job }) => `${file}/${jobId} uses ${job.uses}`);

  expect(violations).toStrictEqual([]);
});

test('no CodesWhat/.github uses ref in source is unpinned or off the frozen SHA', () => {
  const violations = loadWorkflowFiles().flatMap(({ file, source }) =>
    source
      .split('\n')
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter(({ line }) => line.includes('CodesWhat/.github/'))
      .filter(
        ({ line }) =>
          !line.includes(`CodesWhat/.github/.github/workflows/go-ci.yml@${frozenGoCiSha}`),
      )
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
