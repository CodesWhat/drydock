import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

// npm ci refuses to install when package.json and package-lock.json disagree:
//   npm error code EUSAGE
//   `npm ci` can only install packages when your package.json and package-lock.json
//   or npm-shrinkwrap.json are in sync.
// The check it makes is this one — the lockfile's root entry, packages[""], mirrors
// package.json's dependency blocks.
const DEPENDENCY_BLOCKS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

// Derived from what is committed, never a hardcoded list: a seventh package root added
// later is covered the day its lockfile lands, with nothing to remember to update.
function packageRoots() {
  return execFileSync('git', ['ls-files', '--', '*package-lock.json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .map((lockPath) => ({ lockPath, dir: dirname(lockPath) }))
    .sort((a, b) => a.lockPath.localeCompare(b.lockPath));
}

function drift({ lockPath, dir }) {
  const manifest = JSON.parse(readFileSync(join(repositoryRoot, dir, 'package.json'), 'utf8'));
  const lockRoot = JSON.parse(readFileSync(join(repositoryRoot, lockPath), 'utf8')).packages?.[''];

  // Only lockfileVersion >= 2 records the root manifest. v1 predates the `packages` map,
  // and silently reporting "no drift" for one would defeat the whole check.
  assert.ok(
    lockRoot,
    `${lockPath} has no packages[""] entry — lockfileVersion is too old to verify`,
  );

  const differences = [];
  for (const block of DEPENDENCY_BLOCKS) {
    const declared = manifest[block] ?? {};
    const locked = lockRoot[block] ?? {};

    for (const [name, range] of Object.entries(declared)) {
      if (locked[name] !== range) {
        differences.push(
          `${block}.${name}: package.json=${range} lockfile=${locked[name] ?? '(absent)'}`,
        );
      }
    }
    for (const name of Object.keys(locked)) {
      if (!(name in declared)) {
        differences.push(`${block}.${name}: in lockfile, dropped from package.json`);
      }
    }
  }
  return differences;
}

// Renovate bumped ui/package.json and apps/web/package.json in July 2026 without writing
// either lockfile. Every workflow that installs those workspaces died at its own `npm ci`
// step — Test & Coverage, Playwright, Cucumber, and the site build — so one broken
// lockfile read as four unrelated CI failures, each minutes deep into a job. This runs in
// the pre-push hook and again as the first CI step after the root install, ahead of every
// workspace install, and names the drifted packages outright.
test('every committed lockfile is in sync with its package.json', () => {
  const roots = packageRoots();
  assert.ok(roots.length > 0, 'found no committed package-lock.json to check');

  const broken = roots
    .map((root) => ({ dir: root.dir, differences: drift(root) }))
    .filter(({ differences }) => differences.length > 0);

  const report = broken
    .map(({ dir, differences }) => `  ${dir}\n${differences.map((d) => `    ${d}`).join('\n')}`)
    .join('\n');

  assert.deepEqual(
    broken,
    [],
    `npm ci will fail with EUSAGE in these workspaces:\n${report}\n` +
      'Regenerate each one with `npm install --package-lock-only` in that directory and commit the result.',
  );
});
