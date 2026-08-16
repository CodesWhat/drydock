import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

import type { WorkflowDefinition } from './workflow-test-utils';

const workflowsDir = fileURLToPath(new URL('../workflows', import.meta.url));
const hardenRunnerRef = 'step-security/harden-runner@bf7454d06d71f1098171f2acdf0cd4708d7b5920';
const hardenRunnerVersion = 'v2.20.0';

function loadWorkflowFiles(): Array<{
  file: string;
  source: string;
  workflow: WorkflowDefinition;
}> {
  return readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .sort()
    .map((file) => {
      const source = readFileSync(join(workflowsDir, file), 'utf8');
      return {
        file,
        source,
        workflow: yaml.parse(source) as WorkflowDefinition,
      };
    });
}

// legacy-security-actions is a temporary fail-closed bridge job: it only
// republishes ci-verify.yml's security-actions result under the old plain
// check name and makes no outbound calls of its own, so it runs with
// egress-policy: block instead of the audit policy every other job uses.
const blockEgressJobs = new Set(['ci-verify.yml/legacy-security-actions']);

test('GitHub-hosted workflow jobs start with current pinned Harden Runner', () => {
  const violations: string[] = [];

  for (const { file, workflow } of loadWorkflowFiles()) {
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      if (!job['runs-on'] || !job.steps?.length) {
        continue;
      }

      const firstStep = job.steps[0];
      if (firstStep.uses !== hardenRunnerRef) {
        violations.push(`${file}/${jobId}`);
        continue;
      }

      const expectedEgressPolicy = blockEgressJobs.has(`${file}/${jobId}`) ? 'block' : 'audit';
      if (firstStep.with?.['egress-policy'] !== expectedEgressPolicy) {
        violations.push(`${file}/${jobId} missing ${expectedEgressPolicy} egress policy`);
      }
    }
  }

  expect(violations).toStrictEqual([]);
});

test('legacy-security-actions bridge runs Harden Runner in fail-closed mode', () => {
  const ciVerify = loadWorkflowFiles().find(({ file }) => file === 'ci-verify.yml');
  const job = ciVerify?.workflow.jobs?.['legacy-security-actions'];
  const firstStep = job?.steps?.[0];

  expect(firstStep?.uses).toBe(hardenRunnerRef);
  expect(firstStep?.with?.['egress-policy']).toBe('block');

  // Fail-closed contract: the bridge must always run (even when the caller
  // fails or is skipped) and must convert anything but caller success into
  // its own failure, so the plain "Security: Actions" context never goes
  // green on a failed or skipped security scan.
  expect(job?.needs).toBe('security-actions');
  expect(job?.if).toBe('${{ always() }}');
  const gateStep = job?.steps?.find((step) => step.run?.includes('test "${RESULT}"'));
  expect(gateStep?.env?.RESULT).toBe('${{ needs.security-actions.result }}');
  expect(gateStep?.run?.trim()).toBe('test "${RESULT}" = "success"');
});

test('Harden Runner comments match the pinned release version', () => {
  const stalePins = loadWorkflowFiles()
    .flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, index) => ({ file, line, lineNumber: index + 1 }))
        .filter(({ line }) => line.includes('step-security/harden-runner@')),
    )
    .filter(({ line }) => !line.includes(`# ${hardenRunnerVersion}`))
    .map(({ file, lineNumber }) => `${basename(file)}:${lineNumber}`);

  expect(stalePins).toStrictEqual([]);
});
