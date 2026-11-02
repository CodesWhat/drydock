import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import test from 'node:test';

// Vercel counts every git-triggered deployment toward the Hobby plan's daily cap,
// including builds an ignore step cancels, so the only lever is not creating the
// deployment. Vercel deploys a branch when any matching deploymentEnabled rule is
// true (vercel.com/docs/project-configuration/git-configuration).
function deploys(rules, branch) {
  const matched = Object.entries(rules).filter(([pattern]) => matchesGlob(branch, pattern));
  if (matched.length === 0) return true;
  return matched.some(([, enabled]) => enabled === true);
}

function rulesFor(project) {
  const config = JSON.parse(
    readFileSync(new URL(`../apps/${project}/vercel.json`, import.meta.url)),
  );
  return config.git.deploymentEnabled;
}

const quiet = [
  'dev/v1.8',
  'renovate/npm-minor-patch',
  'dependabot/npm_and_yarn/ui/vite-8.3.6',
  'fix/v1.8-demo-mocks-data',
  'fix/v1.8-ci-download-timeouts',
  'release/v1.8-rc9-main',
  'feat/v1.9-webhook-retries',
];

for (const project of ['web', 'demo']) {
  test(`${project} deploys production main only, including rejecting former preview opt-ins`, () => {
    const rules = rulesFor(project);
    assert.deepEqual(rules, { '**': false, main: true });
    assert.equal(deploys(rules, 'main'), true);
    for (const branch of [
      ...quiet,
      'dev/website',
      'feat/website-redesign',
      'fix/v1.8-web-mobile-nav',
      'feat/v1.9-web',
      'fix/v1.8-demo-csp-www',
      'feat/v1.9-demo',
      'main-web',
      'main/release',
    ]) {
      assert.equal(deploys(rules, branch), false, branch);
    }
  });
}

test('neither project relies on an ignore step, which would still count as a deployment', () => {
  for (const project of ['web', 'demo']) {
    const config = JSON.parse(
      readFileSync(new URL(`../apps/${project}/vercel.json`, import.meta.url)),
    );
    assert.equal(config.ignoreCommand, undefined, project);
  }
});
