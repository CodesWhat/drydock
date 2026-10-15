import { fileURLToPath } from 'node:url';

import { loadWorkflow } from './workflow-test-utils';

// starchart.yml's `release: types: [published]` trigger can never fire:
// release-cut.yml creates the GitHub release with GITHUB_TOKEN, and GitHub
// suppresses workflow runs for events caused by it. On this line the cut no
// longer dispatches the refresh, so starchart.yml stays manual-only. These
// tests pin its shape.
const starchartPath = fileURLToPath(new URL('../workflows/starchart.yml', import.meta.url));

test('starchart.yml only accepts workflow_dispatch, not a release event', () => {
  const on = loadWorkflow(starchartPath).on as
    | { release?: unknown; workflow_dispatch?: unknown }
    | undefined;

  expect(on?.workflow_dispatch).toBeDefined();
  expect(on?.release).toBeUndefined();
});

test('starchart.yml derives its target branch from the dispatch ref, not a hardcoded value', () => {
  const job = loadWorkflow(starchartPath).jobs?.starchart as
    | { with?: Record<string, unknown> }
    | undefined;

  expect(job?.with?.branch).toBe('${{ github.ref_name }}');
});
