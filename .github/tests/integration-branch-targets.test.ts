import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadWorkflow, type WorkflowStep } from './workflow-test-utils';

// main is never an independent commit target — it only advances by merging from
// dev/vX.Y right before a cut, and release-cut now refuses to tag a drifted main.
// Anything that opens a PR or gates a merge therefore has to point at the
// integration branch, or the automation itself recreates the drift it blocks.

const crowdinPath = fileURLToPath(new URL('../workflows/i18n-crowdin.yml', import.meta.url));
const playwrightPath = fileURLToPath(new URL('../workflows/e2e-playwright.yml', import.meta.url));
const renovatePath = fileURLToPath(new URL('../../renovate.json', import.meta.url));

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

test('Renovate opens dependency PRs against the integration branch, not the default branch', () => {
  const config = JSON.parse(readFileSync(renovatePath, 'utf8')) as { baseBranches?: string[] };

  // A pattern rather than a pinned version, so it follows dev/v1.6 -> dev/v1.7
  // without an edit that would otherwise be forgotten at every minor.
  expect(config.baseBranches).toStrictEqual(['/^dev\\/v\\d+\\.\\d+$/']);

  const pattern = new RegExp(config.baseBranches?.[0]?.slice(1, -1) ?? '(?!)');
  expect(pattern.test('dev/v1.6')).toBe(true);
  expect(pattern.test('dev/v1.10')).toBe(true);
  expect(pattern.test('main')).toBe(false);
  expect(pattern.test('dev/v1.6.1')).toBe(false);
  expect(pattern.test('release/v1.6')).toBe(false);
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

test('Playwright gates pull requests into the integration branch, not just main', () => {
  const on = triggers(playwrightPath);

  // Until now a dev PR ran no browser suite at all, so the first signal was
  // release-cut polling for a successful E2E run on the release source SHA.
  expect(on.pull_request?.branches).toStrictEqual(['main', 'dev/**']);
  expect(on.merge_group?.branches).toStrictEqual(['main', 'dev/**']);
});
