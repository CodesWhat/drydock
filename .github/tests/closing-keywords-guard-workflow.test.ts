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

test('closing keywords guard also scans the commit messages that build the squash message', () => {
  const steps = loadWorkflow(workflowPath).jobs?.['closing-keywords']?.steps ?? [];
  const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  expect(checkout?.with?.['fetch-depth']).toBe(0);
  const guard = steps.find((step) => step.run?.includes('scripts/closing-keywords.mjs'));
  expect(guard?.env?.BASE_SHA).toBe('${{ github.event.pull_request.base.sha }}');
  expect(guard?.env?.HEAD_SHA).toBe('${{ github.event.pull_request.head.sha }}');
  expect(guard?.run).toContain('git log --format=%B "${BASE_SHA}..${HEAD_SHA}"');
  expect(guard?.run).toContain('PR commits=');
  expect(guard?.run).not.toContain('${{');
});
