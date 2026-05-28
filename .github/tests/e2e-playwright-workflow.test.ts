import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

interface WorkflowStep {
  name?: string;
  uses?: string;
  with?: Record<string, string>;
}

interface WorkflowJob {
  env?: Record<string, string>;
  steps?: WorkflowStep[];
}

interface WorkflowDefinition {
  env?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
}

const workflowPath = fileURLToPath(new URL('../workflows/e2e-playwright.yml', import.meta.url));

function loadWorkflow(): WorkflowDefinition {
  return yaml.parse(readFileSync(workflowPath, 'utf8')) as WorkflowDefinition;
}

function getWorkflowStep(jobId: string, name: string): WorkflowStep | undefined {
  return loadWorkflow().jobs?.[jobId]?.steps?.find((step) => step.name === name);
}

test('Playwright workflow disables browser downloads for host-side npm installs', () => {
  const workflow = loadWorkflow();

  expect(workflow.env).toMatchObject({
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  });
  expect(getWorkflowStep('playwright', 'Install ui dependencies')).toMatchObject({
    uses: 'nick-fields/retry@ad984534de44a9489a53aefd81eb77f87c70dc60',
    with: {
      command: 'cd ui && npm ci',
    },
  });
});
