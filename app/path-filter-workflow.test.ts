import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

interface WorkflowStep {
  id?: string;
  uses?: string;
  with?: Record<string, string>;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface WorkflowDefinition {
  jobs?: Record<string, WorkflowJob>;
}

interface RuntimeFilterDefinition {
  runtime?: string[];
}

const ciVerifyWorkflowPath = fileURLToPath(
  new URL('../.github/workflows/ci-verify.yml', import.meta.url),
);
const e2ePlaywrightWorkflowPath = fileURLToPath(
  new URL('../.github/workflows/e2e-playwright.yml', import.meta.url),
);
const runtimeFiltersPath = fileURLToPath(
  new URL('../.github/filters/runtime.yml', import.meta.url),
);

function loadWorkflow(path: string): WorkflowDefinition {
  return yaml.parse(readFileSync(path, 'utf8')) as WorkflowDefinition;
}

function getPathFilterStep(path: string): WorkflowStep | undefined {
  const workflow = loadWorkflow(path);
  return Object.values(workflow.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .find((step) => step.uses?.startsWith('dorny/paths-filter@') && step.id === 'filter');
}

test('runtime path filters are shared by CI and Playwright workflows', () => {
  expect(getPathFilterStep(ciVerifyWorkflowPath)?.with?.filters).toBe(
    '.github/filters/runtime.yml',
  );
  expect(getPathFilterStep(e2ePlaywrightWorkflowPath)?.with?.filters).toBe(
    '.github/filters/runtime.yml',
  );
});

test('runtime path filter covers both CI workflow entrypoints symmetrically', () => {
  const filters = yaml.parse(readFileSync(runtimeFiltersPath, 'utf8')) as RuntimeFilterDefinition;

  expect(filters.runtime).toEqual(
    expect.arrayContaining([
      '.github/filters/runtime.yml',
      '.github/workflows/ci-verify.yml',
      '.github/workflows/e2e-playwright.yml',
    ]),
  );
});
