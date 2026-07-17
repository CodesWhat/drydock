import { fileURLToPath } from 'node:url';

import {
  getWorkflowStep as getWorkflowStepFrom,
  loadWorkflow as loadWorkflowFrom,
} from './workflow-test-utils';

const workflowPath = fileURLToPath(new URL('../workflows/e2e-playwright.yml', import.meta.url));
const loadWorkflow = loadWorkflowFrom.bind(undefined, workflowPath);
const getWorkflowStep = getWorkflowStepFrom.bind(undefined, workflowPath);

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

test('Playwright can be dispatched against a frozen release candidate', () => {
  const workflow = loadWorkflow();

  expect(workflow.on).toHaveProperty('workflow_dispatch');
  expect(getWorkflowStep('changes', 'Filter paths')?.with?.base).toContain(
    "github.event_name == 'workflow_dispatch'",
  );
  expect(workflow.jobs?.playwright?.if).toContain("github.event_name == 'workflow_dispatch'");
  expect(workflow.jobs?.changes?.if).toBeUndefined();
  expect(workflow.jobs?.playwright?.needs).toStrictEqual(['changes']);
});
