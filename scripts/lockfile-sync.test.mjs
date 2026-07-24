import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

// npm ci refuses to install when package.json and package-lock.json disagree:
//   npm error code EUSAGE
//   `npm ci` can only install packages when your package.json and package-lock.json
//   or npm-shrinkwrap.json are in sync.
//
// An earlier version of this file reimplemented that comparison by diffing each
// lockfile's packages[""] entry against package.json's dependency blocks. That
// reimplementation had a blind spot: npm does not mirror the root `overrides` block into
// packages[""], so a version bumped only in overrides never showed up as drift. It
// shipped invisibly on Renovate PR #563 — e2e/package.json's overrides moved
// fast-xml-parser and minimatch forward, e2e/package-lock.json never got the matching
// write, and this test reported "in sync" while `npm ci` in that workspace failed with
// EUSAGE (Missing: fast-xml-parser@5.10.1 from lock file, Missing: minimatch@10.2.5 from
// lock file, ...).
//
// A hand-rolled comparison invites the next blind spot the same way — some other field
// npm consults that a diff doesn't know to check. So this runs npm's own validation
// instead of reimplementing it: for each committed lockfile, `npm ci --dry-run` in that
// directory. That is npm performing the exact comparison the real install does — deps
// blocks, overrides, everything — so if it exits 0 here, `npm ci` will not hit EUSAGE in
// CI either. `--dry-run` reports what it would do without writing anything; `--ignore-
// scripts --no-audit --no-fund` keep it to the sync check alone.
const NPM_CI_DRY_RUN_ARGS = ['ci', '--dry-run', '--ignore-scripts', '--no-audit', '--no-fund'];

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

function runNpmCiDryRun(dir) {
  return execFileAsync('npm', NPM_CI_DRY_RUN_ARGS, {
    cwd: join(repositoryRoot, dir),
    encoding: 'utf8',
  }).then(
    () => ({ ok: true }),
    (error) => ({
      ok: false,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      message: error.message,
    }),
  );
}

// npm appends its full `npm ci --help` text after every EUSAGE report, and that dump is
// also `npm error`-prefixed, so it survives a naive filter. Cut it at the boundary line
// npm always prints right before it, keeping only the actual EUSAGE code, blurb, and the
// Missing:/Invalid: lines that name the offending packages.
function usefulLines(output) {
  if (!output) return '';
  const lines = output.split('\n');
  const helpDumpStart = lines.findIndex((line) =>
    /^npm error (Usage:|Clean install a project)$/.test(line),
  );
  const relevant = helpDumpStart === -1 ? lines : lines.slice(0, helpDumpStart);
  const useful = relevant.filter((line) => line.trim().length > 0);
  return (useful.length > 0 ? useful : lines).join('\n').trim();
}

function formatFailure(dir, result) {
  const label = dir === '.' ? 'repo root' : dir;
  const detail = usefulLines(result.stderr) || usefulLines(result.stdout) || result.message;
  return (
    `npm ci --dry-run failed in ${label}:\n${detail}\n` +
    'Regenerate with `npm install --package-lock-only` in that directory and commit the result.'
  );
}

// Renovate bumped ui/package.json and apps/web/package.json in July 2026 without writing
// either lockfile. Every workflow that installs those workspaces died at its own `npm ci`
// step — Test & Coverage, Playwright, Cucumber, and the site build — so one broken
// lockfile read as four unrelated CI failures, each minutes deep into a job. This runs in
// the pre-push hook and again as the first CI step after the root install, ahead of every
// workspace install, and names the drifted workspace outright.
const roots = packageRoots();

// Kick off every workspace's npm ci --dry-run immediately, before any test() body runs.
// node:test executes tests serially, but nothing stops the underlying npm processes from
// overlapping on the wall clock — six sequential `npm ci --dry-run` calls easily clear a
// minute, run concurrently they finish in the time of the slowest one. Each test below
// just awaits its own workspace's already-in-flight result, so a failure still names its
// workspace directly instead of one combined check swallowing which directory broke.
const checks = new Map(roots.map((root) => [root.dir, runNpmCiDryRun(root.dir)]));

test('found at least one committed lockfile to verify', () => {
  assert.ok(roots.length > 0, 'found no committed package-lock.json to check');
});

for (const root of roots) {
  test(`npm ci --dry-run is clean in ${root.dir === '.' ? 'repo root' : root.dir}`, async () => {
    const result = await checks.get(root.dir);
    assert.equal(result.ok, true, result.ok ? undefined : formatFailure(root.dir, result));
  });
}
