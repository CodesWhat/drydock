import { fileURLToPath } from 'node:url';

import { loadWorkflow, type WorkflowStep } from './workflow-test-utils';

const releaseCutPath = fileURLToPath(new URL('../workflows/release-cut.yml', import.meta.url));
const ciVerifyPath = fileURLToPath(new URL('../workflows/ci-verify.yml', import.meta.url));

const SYNC_STEP_NAME = 'Assert main is in sync with the active dev branch';

function releaseSteps(): WorkflowStep[] {
  return loadWorkflow(releaseCutPath).jobs?.release?.steps ?? [];
}

function syncStep(): WorkflowStep | undefined {
  return releaseSteps().find((step) => step.name === SYNC_STEP_NAME);
}

test('release-cut refuses to tag when main has drifted from the active dev branch', () => {
  const step = syncStep();
  expect(step).toBeDefined();
  expect(step?.env?.RELEASE_TAG).toBe('${{ inputs.release_tag }}');

  const run = step?.run ?? '';
  // Derives dev/vX.Y from the release tag rather than hardcoding a version.
  expect(run).toContain('dev_branch="dev/v${minor}"');
  expect(run).toContain('git fetch --quiet origin "${dev_branch}"');
  // Fails the cut, rather than warning, when content differs.
  expect(run).toContain('git diff --quiet HEAD "origin/${dev_branch}"');
  expect(run).toContain('::error::main has drifted');
  expect(run).toContain('exit 1');
});

test('the drift guard compares trees, not commit ancestry', () => {
  // The repo allows squash merges only, so every dev -> main sync creates a commit
  // dev lacks. An ancestry check would fail on every cut after the first and would
  // have to be disabled, which defeats the guard. Tree equality is the real invariant.
  const run = syncStep()?.run ?? '';
  expect(run).toContain('git diff');
  expect(run).not.toContain('--is-ancestor');
  expect(run).not.toContain('merge-base');
});

test('the drift guard is skipped once the dev branch is retired after GA', () => {
  const run = syncStep()?.run ?? '';
  expect(run).toContain('git ls-remote --exit-code --heads origin "${dev_branch}"');
  // Absent dev branch is a clean no-op, not a failed cut.
  expect(run).toContain('exit 0');
});

test('the drift guard runs before any tagging or publishing work', () => {
  const names = releaseSteps().map((step) => step.name);
  const guardIndex = names.indexOf(SYNC_STEP_NAME);
  const checkoutIndex = names.indexOf('Checkout');
  const resolveIndex = names.indexOf('Resolve target SHA and lowercase repository');

  expect(guardIndex).toBeGreaterThan(checkoutIndex);
  expect(guardIndex).toBeLessThan(resolveIndex);
});

test('ci-verify gates pull requests into the integration branch, not just main', () => {
  const on = loadWorkflow(ciVerifyPath).on as
    | { pull_request?: { branches?: string[] } }
    | undefined;
  const branches = on?.pull_request?.branches ?? [];

  expect(branches).toContain('main');
  // v1.6 work landed on dev/v1.6 through PRs that ran no backend/frontend CI at all.
  expect(branches).toContain('dev/**');
});
