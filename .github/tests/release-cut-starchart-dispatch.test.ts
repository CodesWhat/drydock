import { fileURLToPath } from 'node:url';

import { loadWorkflow, type WorkflowStep } from './workflow-test-utils';

// starchart.yml's `release: types: [published]` trigger can never fire:
// release-cut.yml creates the GitHub release with `GH_TOKEN: ${{ github.token
// }}`, and GitHub suppresses workflow runs for events caused by GITHUB_TOKEN.
// workflow_dispatch is one of the two documented exceptions (the other is
// repository_dispatch), so release-cut.yml dispatches the refresh explicitly
// after publishing the release. These tests pin that shape so a future edit
// can't silently regress either half of the fix.
const releaseCutPath = fileURLToPath(new URL('../workflows/release-cut.yml', import.meta.url));
const starchartPath = fileURLToPath(new URL('../workflows/starchart.yml', import.meta.url));

const DISPATCH_STEP_NAME = 'Dispatch starchart refresh';

function releaseSteps(): WorkflowStep[] {
  return loadWorkflow(releaseCutPath).jobs?.release?.steps ?? [];
}

function dispatchStep(): WorkflowStep | undefined {
  return releaseSteps().find((step) => step.name === DISPATCH_STEP_NAME);
}

test('release-cut grants actions: write for the starchart dispatch', () => {
  const permissions = loadWorkflow(releaseCutPath).jobs?.release?.permissions as
    | Record<string, string>
    | undefined;

  expect(permissions?.actions).toBe('write');
});

test('release-cut dispatches the starchart refresh after publishing the release', () => {
  const step = dispatchStep();
  expect(step).toBeDefined();
  expect(step?.env?.GH_TOKEN).toBe('${{ github.token }}');
  expect(step?.env?.RELEASE_TAG).toBe('${{ steps.next.outputs.release_tag }}');

  const run = step?.run ?? '';
  expect(run).toContain('dev_branch="dev/v${minor}"');
  expect(run).toContain('gh workflow run starchart.yml --ref "${dev_branch}"');
  // No `|| true`: a failed dispatch has to redden the run so a human notices —
  // the release itself has already published by this point.
  expect(run).not.toContain('|| true');

  const names = releaseSteps().map((step) => step.name);
  const indexOf = (name: string) => {
    const index = names.indexOf(name);
    expect(index, `release-cut has no step named "${name}"`).toBeGreaterThanOrEqual(0);
    return index;
  };
  expect(indexOf(DISPATCH_STEP_NAME)).toBeGreaterThan(indexOf('Publish GitHub Release'));
  expect(indexOf(DISPATCH_STEP_NAME)).toBeLessThan(indexOf('Release summary'));
});

test('the starchart dispatch is skipped on a maintenance cut', () => {
  // A maintenance dev/vX.Y branch doesn't carry starchart.yml (dispatching there
  // would fail on a missing workflow and redden an otherwise-good maintenance GA),
  // and a maintenance line never owns the published README anyway since GitHub
  // renders main's, so a refresh there would update a page nobody sees.
  const step = dispatchStep();
  expect(step?.if).toBe("steps.source_ref.outputs.is_maintenance_cut != 'true'");
});

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
