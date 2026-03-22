#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { formatValidationFailure, validateCommitMessage } from './commit-message.mjs';

function getCommitSubject(rawMessage) {
  const message = (rawMessage ?? '').trim();
  return message.split(/\r?\n/u, 1)[0] ?? '';
}

function escapeGithubActionsCommand(value) {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

export function parseArgs(args) {
  let baseSha = '';
  let headSha = '';
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--base') {
      baseSha = args[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--head') {
      headSha = args[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    positionals.push(arg);
  }

  if (!baseSha && positionals[0]) {
    baseSha = positionals[0];
  }

  if (!headSha && positionals[1]) {
    headSha = positionals[1];
  }

  if (!baseSha || !headSha) {
    throw new Error('Missing required arguments: --base <sha> --head <sha>');
  }

  return { baseSha, headSha };
}

export function findInvalidCommitMessages(commits) {
  const failures = [];

  for (const commit of commits) {
    const result = validateCommitMessage(commit.message);
    if (!result.valid) {
      failures.push({
        sha: commit.sha,
        message: commit.message,
        errors: result.errors,
      });
    }
  }

  return failures;
}

export function listCommitsInRange(baseSha, headSha, { execFile = execFileSync } = {}) {
  const range = `${baseSha}..${headSha}`;
  const output = execFile('git', ['log', '--reverse', '--format=%H%x00%B%x00', range], {
    encoding: 'utf8',
  });
  return parseGitLogOutput(output);
}

function parseGitLogOutput(output) {
  const tokens = output.split('\0');
  const commits = [];

  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const sha = tokens[index]?.trim() ?? '';
    if (!sha) {
      continue;
    }

    commits.push({
      sha,
      message: tokens[index + 1] ?? '',
    });
  }

  return commits;
}

function printFailure(failure, stderr) {
  const subject = getCommitSubject(failure.message) || '<empty>';

  stderr(`\nCommit ${failure.sha}: ${subject}\n`);
  stderr(formatValidationFailure(failure.message, failure.errors));

  if (process.env.GITHUB_ACTIONS === 'true') {
    const summary = escapeGithubActionsCommand(`${failure.sha} ${subject}`);
    stderr(`::error title=Invalid commit message::${summary}`);
  }
}

export function main(
  args = process.argv.slice(2),
  {
    getCommits = listCommitsInRange,
    getGitLogOutput,
    stdout = console.log,
    stderr = console.error,
  } = {},
) {
  let baseSha;
  let headSha;
  try {
    ({ baseSha, headSha } = parseArgs(args));
  } catch (error) {
    stderr('❌ Missing commit range arguments.');
    stderr(error instanceof Error ? error.message : String(error));
    stderr('Usage: node scripts/validate-commit-range.mjs --base <base-sha> --head <head-sha>');
    return 1;
  }

  let commits;
  try {
    if (typeof getGitLogOutput === 'function') {
      commits = parseGitLogOutput(getGitLogOutput(baseSha, headSha));
    } else {
      commits = getCommits(baseSha, headSha);
    }
  } catch (error) {
    stderr(`❌ Failed to read commits in range ${baseSha}..${headSha}`);
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (commits.length === 0) {
    stdout(`No commits found in range ${baseSha}..${headSha}.`);
    return 0;
  }

  const failures = findInvalidCommitMessages(commits);
  if (failures.length === 0) {
    stdout(`✅ Validated ${commits.length} commit message(s) in range ${baseSha}..${headSha}.`);
    return 0;
  }

  for (const failure of failures) {
    printFailure(failure, stderr);
  }

  stderr(`\n❌ ${failures.length} of ${commits.length} commit message(s) failed validation.`);
  return 1;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  process.exit(main());
}
