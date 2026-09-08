import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

import type { WorkflowDefinition, WorkflowStep } from './workflow-test-utils';

const workflowsDir = fileURLToPath(new URL('../workflows', import.meta.url));

function loadWorkflowFiles(): Array<{ file: string; workflow: WorkflowDefinition }> {
  return readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .sort()
    .map((file) => {
      const source = readFileSync(join(workflowsDir, file), 'utf8');
      return { file, workflow: yaml.parse(source) as WorkflowDefinition };
    });
}

// A step runs `npm ci` either directly (`run:`) or through a wrapper like
// nick-fields/retry, which shells out via `with.command`.
function stepRunsNpmCi(step: WorkflowStep): boolean {
  const command = step.run ?? (step.with?.command as string | undefined) ?? '';
  return /npm ci\b/.test(command);
}

// CI-2: every `actions/setup-node` step that precedes an `npm ci` in the same
// job caches the npm download instead of installing cold on every run.
test('setup-node steps ahead of npm ci enable package-manager-cache with a dependency path', () => {
  const violations: string[] = [];

  for (const { file, workflow } of loadWorkflowFiles()) {
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      const steps = job.steps ?? [];
      const jobRunsNpmCi = steps.some(stepRunsNpmCi);
      if (!jobRunsNpmCi) {
        continue;
      }

      const setupNodeStep = steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
      const key = `${file}/${jobId}`;
      if (!setupNodeStep) {
        violations.push(`${key}: runs npm ci but has no actions/setup-node step`);
        continue;
      }

      if (setupNodeStep.with?.['package-manager-cache'] !== true) {
        violations.push(`${key}: package-manager-cache is not 'true'`);
      }

      const dependencyPath = setupNodeStep.with?.['cache-dependency-path'];
      if (typeof dependencyPath !== 'string' || dependencyPath.trim() === '') {
        violations.push(`${key}: cache-dependency-path is missing or empty`);
      }
    }
  }

  expect(violations).toStrictEqual([]);
});

// The mutation workflow's aggregate job only downloads artifacts and never
// installs npm dependencies; it should keep caching off rather than carry a
// dependency path that names a lockfile it never reads.
test('setup-node steps in jobs that never run npm ci leave caching off', () => {
  const violations: string[] = [];

  for (const { file, workflow } of loadWorkflowFiles()) {
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      const steps = job.steps ?? [];
      const jobRunsNpmCi = steps.some(stepRunsNpmCi);
      if (jobRunsNpmCi) {
        continue;
      }

      const setupNodeStep = steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
      if (!setupNodeStep) {
        continue;
      }

      if (setupNodeStep.with?.['package-manager-cache'] !== false) {
        violations.push(`${file}/${jobId}: expected package-manager-cache 'false'`);
      }
    }
  }

  expect(violations).toStrictEqual([]);
});
