import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadWorkflow, type WorkflowStep } from './workflow-test-utils';

// main is never an independent commit target — it only advances by merging from
// dev/vX.Y right before a cut, and release-cut now refuses to tag a drifted main.
// Anything that opens a PR or gates a merge therefore has to point at the
// integration branch, or the automation itself recreates the drift it blocks.

const crowdinPath = fileURLToPath(new URL('../workflows/i18n-crowdin.yml', import.meta.url));
const playwrightPath = fileURLToPath(new URL('../workflows/e2e-playwright.yml', import.meta.url));
const releaseCutPath = fileURLToPath(new URL('../workflows/release-cut.yml', import.meta.url));
const grypePath = fileURLToPath(new URL('../workflows/security-grype.yml', import.meta.url));
const renovatePath = fileURLToPath(new URL('../../renovate.json', import.meta.url));

function releaseSteps(): WorkflowStep[] {
  return loadWorkflow(releaseCutPath).jobs?.release?.steps ?? [];
}

interface BranchFilter {
  branches?: string[];
}

function triggers(path: string): Record<string, BranchFilter | undefined> {
  return (loadWorkflow(path).on ?? {}) as Record<string, BranchFilter | undefined>;
}

function crowdinStep(name: string): WorkflowStep {
  const step = loadWorkflow(crowdinPath).jobs?.sync?.steps?.find(
    (candidate) => candidate.name === name || candidate.uses?.startsWith(name),
  );

  if (!step) {
    throw new Error(`Expected i18n-crowdin.yml to include a "${name}" step`);
  }

  return step;
}

test('Renovate opens dependency PRs against exactly one integration branch', () => {
  const config = JSON.parse(readFileSync(renovatePath, 'utf8')) as {
    baseBranchPatterns?: string[];
    baseBranches?: string[];
  };

  // `baseBranches` is the pre-rename name; the config validator migrates it, and
  // keeping both would leave two sources of truth for the cut-time check to read.
  expect(config.baseBranches).toBeUndefined();

  // Exactly one branch, never a pattern. Renovate expands a pattern into every
  // matching branch and opens a full PR set against each, so a dev branch that
  // outlives its GA would silently double every dependency PR.
  expect(config.baseBranchPatterns).toHaveLength(1);
  const [base] = config.baseBranchPatterns ?? [];
  expect(base).toMatch(/^dev\/v\d+\.\d+$/);
  expect(base?.startsWith('/')).toBe(false);
});

test('release-cut fails when the Renovate target no longer matches the branch being cut', () => {
  // The single branch above has to be rotated at each cut. This is what stops it
  // going stale unnoticed and aiming the bot at a dead branch.
  const run = releaseSteps().find((step) => step.name?.startsWith('Assert main is in sync'))?.run;

  expect(run).toBeDefined();
  expect(run).toContain('.baseBranchPatterns // .baseBranches // []');
  expect(run).toContain('if [ "${renovate_base}" != "${dev_branch}" ]; then');
  expect(run).toContain('::error::renovate.json targets');
});

test('Crowdin resolves its PR base at run time instead of hardcoding a branch', () => {
  const resolve = crowdinStep('Resolve the integration branch to open the translation PR against');
  const run = resolve.run ?? '';

  expect(resolve.id).toBe('base');
  expect(run).toContain("git ls-remote --heads origin 'refs/heads/dev/v*'");
  // -V sorts numerically, so dev/v1.10 wins over dev/v1.9 instead of losing on
  // a lexical compare.
  expect(run).toContain('sort -t/ -k2 -V');
  expect(run).toContain("grep -E '^dev/v[0-9]+\\.[0-9]+$'");
  // Between GA and the next dev branch there is no integration branch to target,
  // and translations must not be stranded.
  expect(run).toContain('base="${DEFAULT_BRANCH}"');
  expect(resolve.env?.DEFAULT_BRANCH).toBe('${{ github.event.repository.default_branch }}');

  const action = crowdinStep('crowdin/github-action@');
  expect(action.with?.pull_request_base_branch_name).toBe('${{ steps.base.outputs.name }}');

  // ls-remote needs real history, and the default shallow clone has none.
  expect(crowdinStep('actions/checkout@').with?.['fetch-depth']).toBe(0);
});

test('Crowdin uploads source strings from the integration branch', () => {
  const branches = triggers(crowdinPath).push?.branches ?? [];

  expect(branches).toContain('dev/**');
  expect(branches).toContain('main');
});

test('Grype scans pull requests into the integration branch, not just main', () => {
  const pr = triggers(grypePath).pull_request as (BranchFilter & { paths?: string[] }) | undefined;

  // main-only left every dev/vX.Y dependency or Dockerfile PR unscanned until
  // the pre-cut sync — the scan has to run where the change actually lands.
  expect(pr?.branches).toStrictEqual(['main', 'dev/**']);
  expect(pr?.paths).toContain('Dockerfile');
});

test('Playwright gates pull requests into the integration branch, not just main', () => {
  const on = triggers(playwrightPath);

  // Until now a dev PR ran no browser suite at all, so the first signal was
  // release-cut polling for a successful E2E run on the release source SHA.
  expect(on.pull_request?.branches).toStrictEqual(['main', 'dev/**']);
  expect(on.merge_group?.branches).toStrictEqual(['main', 'dev/**']);
});
