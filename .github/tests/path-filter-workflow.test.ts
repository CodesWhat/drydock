import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

import { loadWorkflow, type WorkflowStep } from './workflow-test-utils';

interface RuntimeFilterDefinition {
  runtime?: string[];
}

const ciVerifyWorkflowPath = fileURLToPath(new URL('../workflows/ci-verify.yml', import.meta.url));
const e2ePlaywrightWorkflowPath = fileURLToPath(
  new URL('../workflows/e2e-playwright.yml', import.meta.url),
);
const runtimeFiltersPath = fileURLToPath(new URL('../filters/runtime.yml', import.meta.url));

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
