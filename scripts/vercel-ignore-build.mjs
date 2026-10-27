#!/usr/bin/env node

// Vercel `ignoreCommand` for the site (apps/web) and the demo (apps/demo).
// Vercel semantics: exit 0 skips the build, exit 1 builds. When unsure, build.
// Production deploys (from main) always build.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SHARED_INPUTS = [
  'scripts/vercel-ignore-build.mjs',
  'apps/web/vercel.json',
  'apps/demo/vercel.json',
];

// apps/web/scripts/sync-docs.mjs copies content/docs/** and generates the
// changelog page from CHANGELOG.md. apps/web/scripts/analytics-routes.mjs
// walks content/docs/** for the route manifest.
// CHANGELOG.md also feeds the site (sync-docs builds the changelog page), but
// it is left out on purpose: nearly every PR adds a line, so it would preview the
// site on almost every push. Production always builds, so the page still ships.
export const WEB_INPUTS = ['apps/web/', 'content/docs/', ...SHARED_INPUTS];

// apps/demo/vite.config.ts and tsconfig.json alias "@" to ui/src, and
// apps/demo/src/demo.css has an @source on ui/src.
export const DEMO_INPUTS = ['apps/demo/', 'ui/', ...SHARED_INPUTS];

const INPUTS = { web: WEB_INPUTS, demo: DEMO_INPUTS };

function matches(file, input) {
  return input.endsWith('/') ? file.startsWith(input) : file === input;
}

export function decideBuild({ project, env, changedFiles }) {
  const inputs = INPUTS[project];
  if (!inputs) {
    return { build: true, reason: `unknown project "${project}"` };
  }
  if (env?.VERCEL_ENV === 'production') {
    return { build: true, reason: 'production deploy' };
  }
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return { build: true, reason: 'could not determine changed files' };
  }
  const hit = changedFiles.find((file) => inputs.some((input) => matches(file, input)));
  if (hit) {
    return { build: true, reason: `${hit} is an input of ${project}` };
  }
  return { build: false, reason: `no ${project} inputs changed` };
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function diffNames(cwd, base) {
  return git(cwd, ['diff', '--name-only', base, 'HEAD'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasCommit(cwd, sha) {
  try {
    git(cwd, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export function gatherChangedFiles(env, cwd = process.cwd()) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']).trim();
  const previous = env.VERCEL_GIT_PREVIOUS_SHA;
  if (previous && hasCommit(root, previous)) {
    try {
      return diffNames(root, previous);
    } catch {
      // fall through to HEAD~1
    }
  }
  try {
    return diffNames(root, 'HEAD~1');
  } catch {
    return null;
  }
}

function main() {
  const project = process.argv[2];
  let decision;
  try {
    decision = decideBuild({
      project,
      env: process.env,
      changedFiles:
        process.env.VERCEL_ENV === 'production' ? null : gatherChangedFiles(process.env),
    });
  } catch (error) {
    decision = { build: true, reason: `error: ${error.message}` };
  }
  console.log(
    `vercel-ignore-build ${project}: ${decision.build ? 'build' : 'skip'} (${decision.reason})`,
  );
  process.exit(decision.build ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
