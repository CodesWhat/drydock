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
const stableVersionRegex = /^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u;
const explicitReleaseVersionRegex = /(?:^|[/: \t])v(?<version>\d+\.\d+\.\d+)(?![0-9A-Za-z.-])/u;

function parseStableVersion(version) {
  const match = String(version ?? '')
    .trim()
    .match(stableVersionRegex);
  if (!match?.groups) {
    throw new Error(`Invalid current version: ${version}`);
  }

  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
  };
}

function getCommitMessage(commit) {
  return String(commit ?? '').trim();
}

function getCommitSubject(message) {
  return message.split(/\r?\n/u, 1)[0] ?? '';
}

function classifyCommitSubject(subject) {
  const match = subject.match(conventionalSubjectRegex);
  if (!match?.groups) {
    return null;
  }

  if (match.groups.breakingA === '!' || match.groups.breakingB === '!') {
    return 'major';
  }

  return match.groups.type;
}

function getCommitSignal(commit) {
  const message = getCommitMessage(commit);
  if (!message) {
    return null;
  }

  if (/\bBREAKING[ -]CHANGE:/iu.test(message)) {
    return 'major';
  }

  return classifyCommitSubject(getCommitSubject(message));
}

function hasCommitSignal(commits, signal) {
  return commits.some((commit) => getCommitSignal(commit) === signal);
}

function hasPatchCommit(commits) {
  return commits.some((commit) => PATCH_TYPES.has(getCommitSignal(commit) ?? ''));
}

function parseNextArgValue(argv, index, key) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for argument: ${key}`);
  }
  return value;
}

function setParsedArg(args, key, value) {
  switch (key) {
    case '--bump':
      args.bump = value;
      return;
    case '--current':
      args.current = value;
      return;
    case '--from':
      args.from = value;
      return;
    case '--to':
      args.to = value;
      return;
    default:
      throw new Error(`Unknown argument: ${key}`);
  }
}

export function inferReleaseLevel(commits) {
  if (hasCommitSignal(commits, 'major')) {
    return 'major';
  }

  if (hasCommitSignal(commits, 'feat')) {
    return 'minor';
  }

  if (hasPatchCommit(commits)) {
    return 'patch';
  }

  return null;
}

export function bumpSemver(currentVersion, level) {
  const { major, minor, patch } = parseStableVersion(currentVersion);

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

function inferExplicitReleaseVersion(commits) {
  for (const commit of commits) {
    const message = getCommitMessage(commit);
    if (!message) {
      continue;
    }

    const match = getCommitSubject(message).match(explicitReleaseVersionRegex);
    if (match?.groups?.version) {
      return match.groups.version;
    }
  }

  return null;
}

function inferReleaseLevelFromVersions(currentVersion, nextVersion) {
  const current = parseStableVersion(currentVersion);
  const next = parseStableVersion(nextVersion);

  if (next.major > current.major) {
    return 'major';
  }
  if (next.major === current.major && next.minor > current.minor) {
    return 'minor';
  }
  if (next.major === current.major && next.minor === current.minor && next.patch > current.patch) {
    return 'patch';
  }

  throw new Error(
    `Explicit release version ${nextVersion} is not newer than current version ${currentVersion}`,
  );
}

export function resolveAutoRelease(currentVersion, commits) {
  const explicitReleaseVersion = inferExplicitReleaseVersion(commits);
  if (explicitReleaseVersion) {
    return {
      releaseLevel: inferReleaseLevelFromVersions(currentVersion, explicitReleaseVersion),
      nextVersion: explicitReleaseVersion,
    };
  }

  const releaseLevel = inferReleaseLevel(commits);
  if (!releaseLevel) {
    return null;
  }

  return {
    releaseLevel,
    nextVersion: bumpSemver(currentVersion, releaseLevel),
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) {
      continue;
    }
    const value = parseNextArgValue(argv, i, key);
    setParsedArg(args, key, value);
    i += 1;
  }
  return args;
}

function emitReleaseInfo(releaseLevel, nextVersion) {
  console.log(`release_level=${releaseLevel}`);
  console.log(`next_version=${nextVersion}`);
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
    const resolved = resolveAutoRelease(current, commits);
    if (!resolved) {
      throw new Error('No releasable commits found between refs');
    }

    releaseLevel = resolved.releaseLevel;
    emitReleaseInfo(releaseLevel, resolved.nextVersion);
    return;
  }

  const nextVersion = bumpSemver(current, releaseLevel);
  emitReleaseInfo(releaseLevel, nextVersion);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
