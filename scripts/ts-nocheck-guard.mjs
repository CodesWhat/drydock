import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const TS_FILE_GLOBS = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mts', '*.cts', '*.vue'];

export function parseAllowlist(content) {
  return Array.from(
    new Set(
      content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#')),
    ),
  ).sort();
}

export function compareTsNoCheckSets({ allowlist, current }) {
  const allowlistSet = new Set(allowlist);
  const currentSet = new Set(current);

  const unexpected = Array.from(currentSet)
    .filter((file) => !allowlistSet.has(file))
    .sort();
  const retired = Array.from(allowlistSet)
    .filter((file) => !currentSet.has(file))
    .sort();

  return {
    ok: unexpected.length === 0,
    unexpected,
    retired,
  };
}

export function listCurrentTsNoCheckFiles(cwd = process.cwd()) {
  const result = spawnSync('git', ['grep', '-l', '@ts-nocheck', '--', ...TS_FILE_GLOBS], {
    cwd,
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status === 1) {
    return [];
  }

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'git grep failed while scanning for @ts-nocheck');
  }

  return Array.from(
    new Set(
      result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ).sort();
}

export function readAllowlistFile(allowlistPath) {
  return parseAllowlist(readFileSync(allowlistPath, 'utf8'));
}
