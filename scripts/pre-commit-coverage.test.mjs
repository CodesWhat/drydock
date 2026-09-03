import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('pre-commit-coverage.sh', import.meta.url));

// Git hooks (this repo's own pre-commit/pre-push included) invoke their
// commands with GIT_DIR/GIT_WORK_TREE/etc. set so the hook script's git
// commands land on the real repo regardless of its own cwd tricks. Those
// vars are inherited by any child process that doesn't override them, so
// when this test's setup runs *under* a git hook (e.g. this very suite
// running inside the pre-push gate), an unguarded `git init` in a temp
// directory would silently operate on the real repository instead. Strip
// them so every git command below is genuinely confined to `workdir`.
function isolatedGitEnv() {
  const env = { ...process.env };
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CEILING_DIRECTORIES',
    'GIT_PREFIX',
  ]) {
    delete env[key];
  }
  return env;
}

function makeRepo() {
  const workdir = mkdtempSync(join(tmpdir(), 'drydock-pre-commit-coverage-'));
  const run = (cmd, args) =>
    execFileSync(cmd, args, { cwd: workdir, encoding: 'utf8', env: isolatedGitEnv() });
  // Pin the initial branch name so the test doesn't depend on the runner's
  // init.defaultBranch config.
  run('git', ['init', '--quiet', '--initial-branch=main']);
  run('git', ['config', 'user.email', 'test@example.com']);
  run('git', ['config', 'user.name', 'Test']);
  writeFileSync(join(workdir, 'README.md'), 'placeholder\n');
  run('git', ['add', 'README.md']);
  run('git', ['commit', '--quiet', '-m', 'init']);
  return { workdir, run };
}

function runScript(workdir, args) {
  return execFileSync('bash', [scriptPath, ...args], {
    cwd: workdir,
    encoding: 'utf8',
    env: isolatedGitEnv(),
  });
}

test('a merge in progress (MERGE_HEAD present) skips the test gate without invoking vitest', () => {
  const { workdir, run } = makeRepo();
  try {
    // Diverge two branches so merging them leaves a real MERGE_HEAD rather
    // than fast-forwarding, matching what happens merging a dev branch into
    // a feature branch.
    run('git', ['checkout', '--quiet', '-b', 'feature']);
    writeFileSync(join(workdir, 'feature.txt'), 'feature\n');
    run('git', ['add', 'feature.txt']);
    run('git', ['commit', '--quiet', '-m', 'feature change']);

    run('git', ['checkout', '--quiet', 'main']);
    writeFileSync(join(workdir, 'base.txt'), 'base\n');
    run('git', ['add', 'base.txt']);
    run('git', ['commit', '--quiet', '-m', 'base change']);

    // --no-commit --no-ff leaves MERGE_HEAD set without completing the
    // merge, which is exactly the state lefthook's pre-commit hook runs in.
    run('git', ['merge', '--quiet', '--no-commit', '--no-ff', 'feature']);

    // Pass a staged app/ file that would normally trigger vitest, to prove
    // the merge guard exits before workspace detection ever runs.
    const stdout = runScript(workdir, ['app/src/index.ts']);

    assert.match(
      stdout,
      /Merge commit; skipping pre-commit tests \(pre-push coverage and CI cover merged commits\)\.$/m,
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('no merge in progress and no app/ or ui/ files staged reaches workspace detection', () => {
  const { workdir } = makeRepo();
  try {
    const stdout = runScript(workdir, []);

    assert.match(stdout, /No app\/ or ui\/ files staged; skipping tests\.$/m);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});
