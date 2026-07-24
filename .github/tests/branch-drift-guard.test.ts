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
  expect(run).toContain('refs="$(git ls-remote --heads origin "refs/heads/${dev_branch}")"');
  // Absent dev branch is a clean no-op, not a failed cut.
  expect(run).toContain('if [ -z "${refs}" ]; then');
  expect(run).toContain('exit 0');
});

test('an unanswerable remote query fails the cut instead of skipping the guard', () => {
  // --exit-code collapses "no such branch" and "could not reach origin" into the same
  // non-zero status, so a network blip would silently take the retired-branch path and
  // let a drifted main be tagged. Only empty output on a *successful* query may skip.
  const run = syncStep()?.run ?? '';
  expect(run).not.toContain('git ls-remote --exit-code');
  expect(run).toContain('::error::Could not query origin for ${dev_branch}');

  const queryIndex = run.indexOf('if ! refs="$(git ls-remote');
  const skipIndex = run.indexOf('if [ -z "${refs}" ]; then');
  expect(queryIndex).toBeGreaterThanOrEqual(0);
  expect(skipIndex).toBeGreaterThan(queryIndex);
});

test('the drift guard runs before any tagging or publishing work', () => {
  const names = releaseSteps().map((step) => step.name);
  const indexOfStep = (name: string) => {
    const index = names.indexOf(name);
    // A missing step would make the ordering assertions below pass vacuously against -1.
    expect(index, `release-cut has no step named "${name}"`).toBeGreaterThanOrEqual(0);
    return index;
  };

  const guardIndex = indexOfStep(SYNC_STEP_NAME);

  expect(guardIndex).toBeGreaterThan(indexOfStep('Checkout'));
  expect(guardIndex).toBeLessThan(indexOfStep('Resolve target SHA and lowercase repository'));
  // The steps that actually publish or sign something, so the guard can't be reordered
  // past the point where a drifted cut has already left the runner.
  expect(guardIndex).toBeLessThan(indexOfStep('Log in to GHCR'));
  expect(guardIndex).toBeLessThan(indexOfStep('Build and push staging image'));
  expect(guardIndex).toBeLessThan(indexOfStep('Sign container images'));
  expect(guardIndex).toBeLessThan(indexOfStep('Verify release artifact signature'));
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
