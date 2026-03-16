#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const PATCH_TYPES = new Set([
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'chore',
  'security',
  'deps',
  'revert',
]);

const conventionalSubjectRegex =
  /^(?:\S+\s+)?(?<type>feat|fix|docs|style|refactor|perf|test|chore|security|deps|revert)(?<breakingA>!)?(?:\([^)]+\))?(?<breakingB>!)?:\s.+$/u;

export function inferReleaseLevel(commits) {
  let hasFeat = false;
  let hasPatch = false;

  for (const commit of commits) {
    const message = String(commit ?? '').trim();
    if (!message) {
      continue;
    }

    if (/\bBREAKING[ -]CHANGE:/iu.test(message)) {
      return 'major';
    }

    const subject = message.split(/\r?\n/u, 1)[0] ?? '';
    const match = subject.match(conventionalSubjectRegex);
    if (!match?.groups) {
      continue;
    }

    const type = match.groups.type;
    if (match.groups.breakingA === '!' || match.groups.breakingB === '!') {
      return 'major';
    }

    if (type === 'feat') {
      hasFeat = true;
      continue;
    }

    if (PATCH_TYPES.has(type)) {
      hasPatch = true;
    }
  }

  if (hasFeat) {
    return 'minor';
  }
  if (hasPatch) {
    return 'patch';
  }
  return null;
}

export function bumpSemver(currentVersion, level) {
  const match = String(currentVersion ?? '').trim().match(/^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u);
  if (!match?.groups) {
    throw new Error(`Invalid current version: ${currentVersion}`);
  }

  const major = Number(match.groups.major);
  const minor = Number(match.groups.minor);
  const patch = Number(match.groups.patch);

  if (level === 'major') {
    return `${major + 1}.0.0`;
  }
  if (level === 'minor') {
    return `${major}.${minor + 1}.0`;
  }
  if (level === 'patch') {
    return `${major}.${minor}.${patch + 1}`;
  }

  throw new Error(`Invalid release level: ${level}`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--')) {
      continue;
    }
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for argument: ${key}`);
    }
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function getCommitMessages(fromRef, toRef) {
  const range = `${fromRef}..${toRef}`;
  const output = execFileSync('git', ['log', '--format=%B%x00', range], {
    encoding: 'utf8',
  });

  return output
    .split('\0')
    .map((message) => message.trim())
    .filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const bump = args.bump ?? 'auto';
  const current = args.current;

  if (!current) {
    throw new Error('--current is required');
  }

  let releaseLevel = bump;
  if (bump === 'auto') {
    const fromRef = args.from;
    const toRef = args.to ?? 'HEAD';
    if (!fromRef) {
      throw new Error('--from is required when --bump auto');
    }
    const commits = getCommitMessages(fromRef, toRef);
    releaseLevel = inferReleaseLevel(commits);
    if (!releaseLevel) {
      throw new Error('No releasable commits found between refs');
    }
  }

  const nextVersion = bumpSemver(current, releaseLevel);
  console.log(`release_level=${releaseLevel}`);
  console.log(`next_version=${nextVersion}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
