import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

interface WorkflowJobStep {
  uses?: string;
  with?: Record<string, string>;
}

interface WorkflowJob {
  'runs-on'?: string | string[];
  steps?: WorkflowJobStep[];
}

interface WorkflowDefinition {
  jobs?: Record<string, WorkflowJob>;
}

const workflowsDir = fileURLToPath(new URL('../.github/workflows', import.meta.url));
const hardenRunnerRef = 'step-security/harden-runner@9af89fc71515a100421586dfdb3dc9c984fbf411';
const hardenRunnerVersion = 'v2.19.4';

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

      if (firstStep.with?.['egress-policy'] !== 'audit') {
        violations.push(`${file}/${jobId} missing audit egress policy`);
      }
    }
  }

  expect(violations).toStrictEqual([]);
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
