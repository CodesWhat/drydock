import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { decideBuild } from './vercel-ignore-build.mjs';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'vercel-ignore-build.mjs');
const preview = { VERCEL_ENV: 'preview' };

test('production always builds', () => {
  for (const project of ['web', 'demo']) {
    const result = decideBuild({
      project,
      env: { VERCEL_ENV: 'production' },
      changedFiles: ['app/foo.ts'],
    });
    assert.equal(result.build, true);
  }
});

test('preview with only backend changes skips both projects', () => {
  for (const project of ['web', 'demo']) {
    const result = decideBuild({
      project,
      env: preview,
      changedFiles: ['app/api/foo.ts', 'package-lock.json'],
    });
    assert.equal(result.build, false);
  }
});

test('apps/web change builds web and skips demo', () => {
  const changedFiles = ['apps/web/src/app/page.tsx'];
  assert.equal(decideBuild({ project: 'web', env: preview, changedFiles }).build, true);
  assert.equal(decideBuild({ project: 'demo', env: preview, changedFiles }).build, false);
});

test('ui change builds demo and skips web', () => {
  const changedFiles = ['ui/src/App.vue'];
  assert.equal(decideBuild({ project: 'demo', env: preview, changedFiles }).build, true);
  assert.equal(decideBuild({ project: 'web', env: preview, changedFiles }).build, false);
});

test('apps/demo change builds demo and skips web', () => {
  const changedFiles = ['apps/demo/src/main.ts'];
  assert.equal(decideBuild({ project: 'demo', env: preview, changedFiles }).build, true);
  assert.equal(decideBuild({ project: 'web', env: preview, changedFiles }).build, false);
});

test('docs content builds web only', () => {
  const changedFiles = ['content/docs/current/index.mdx'];
  assert.equal(decideBuild({ project: 'web', env: preview, changedFiles }).build, true);
  assert.equal(decideBuild({ project: 'demo', env: preview, changedFiles }).build, false);
});

// Nearly every PR adds a CHANGELOG line, so counting it would preview the site on
// almost every push. The changelog page still ships with each production build.
test('a CHANGELOG-only change skips both previews', () => {
  const changedFiles = ['CHANGELOG.md', 'app/api/container.ts'];
  assert.equal(decideBuild({ project: 'web', env: preview, changedFiles }).build, false);
  assert.equal(decideBuild({ project: 'demo', env: preview, changedFiles }).build, false);
});

test('script or vercel.json changes build both projects', () => {
  for (const file of [
    'scripts/vercel-ignore-build.mjs',
    'apps/web/vercel.json',
    'apps/demo/vercel.json',
  ]) {
    for (const project of ['web', 'demo']) {
      assert.equal(decideBuild({ project, env: preview, changedFiles: [file] }).build, true, file);
    }
  }
});

test('unknown or empty diff builds', () => {
  for (const changedFiles of [null, undefined, []]) {
    for (const project of ['web', 'demo']) {
      assert.equal(decideBuild({ project, env: preview, changedFiles }).build, true);
    }
  }
});

test('unknown project builds', () => {
  assert.equal(
    decideBuild({ project: 'nope', env: preview, changedFiles: ['app/x.ts'] }).build,
    true,
  );
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'vercel-ignore-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'one');
  return dir;
}

function commit(dir, file) {
  writeFileSync(join(dir, file), `${Math.random()}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'next');
}

function runCli(dir, project, env) {
  return spawnSync('node', [scriptPath, project], {
    cwd: join(dir, 'apps', 'web'),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
}

test('CLI exits 0 (skip) or 1 (build) from the diff since the previous SHA', () => {
  const dir = makeRepo();
  try {
    const first = git(dir, 'rev-parse', 'HEAD');
    commit(dir, 'app/a.ts');
    const skip = runCli(dir, 'web', { VERCEL_ENV: 'preview', VERCEL_GIT_PREVIOUS_SHA: first });
    assert.equal(skip.status, 0, skip.stdout + skip.stderr);
    assert.match(skip.stdout, /skip/i);

    commit(dir, 'apps/web/b.ts');
    const build = runCli(dir, 'web', { VERCEL_ENV: 'preview', VERCEL_GIT_PREVIOUS_SHA: first });
    assert.equal(build.status, 1, build.stdout + build.stderr);
    assert.match(build.stdout, /build/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI falls back to HEAD~1 when the previous SHA is missing', () => {
  const dir = makeRepo();
  const missing = '0123456789abcdef0123456789abcdef01234567';
  try {
    commit(dir, 'app/a.ts');
    const skip = runCli(dir, 'web', { VERCEL_ENV: 'preview', VERCEL_GIT_PREVIOUS_SHA: missing });
    assert.equal(skip.status, 0, skip.stdout + skip.stderr);

    commit(dir, 'apps/web/b.ts');
    const build = runCli(dir, 'web', { VERCEL_ENV: 'preview', VERCEL_GIT_PREVIOUS_SHA: missing });
    assert.equal(build.status, 1, build.stdout + build.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI builds when no diff can be computed (single commit, no previous SHA)', () => {
  const dir = makeRepo();
  try {
    const result = runCli(dir, 'web', { VERCEL_ENV: 'preview' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI builds on production regardless of diff', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'app/a.ts');
    const result = runCli(dir, 'web', { VERCEL_ENV: 'production' });
    assert.equal(result.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
