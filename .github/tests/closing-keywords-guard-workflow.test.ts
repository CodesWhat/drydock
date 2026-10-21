import { fileURLToPath } from 'node:url';

import { loadWorkflow } from './workflow-test-utils';

const workflowPath = fileURLToPath(
  new URL('../workflows/closing-keywords-guard.yml', import.meta.url),
);

test('closing keywords guard runs on PRs into main and re-runs when the body is edited', () => {
  const workflow = loadWorkflow(workflowPath);
  const pullRequest = (workflow.on as Record<string, { branches?: string[]; types?: string[] }>)
    .pull_request;
  expect(pullRequest.branches).toStrictEqual(['main']);
  expect(pullRequest.types).toContain('edited');
});

test('closing keywords guard passes the PR text through env, not interpolation', () => {
  const steps = loadWorkflow(workflowPath).jobs?.['closing-keywords']?.steps ?? [];
  const guard = steps.find((step) => step.run?.includes('scripts/closing-keywords.mjs'));
  expect(guard).toBeDefined();
  expect(guard?.env?.PR_TITLE).toBe('${{ github.event.pull_request.title }}');
  expect(guard?.env?.PR_BODY).toBe('${{ github.event.pull_request.body }}');
  expect(guard?.run).not.toContain('${{');
});
