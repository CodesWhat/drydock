// CI-9a-FOLLOWUP: a stalled external transfer must fail its own attempt, not hold the job
// until the job timeout. Every curl that reaches a non-local host carries a per-attempt
// --max-time and --connect-timeout, and idempotent GETs also carry curl's own --retry.
// Writes (POST/PATCH/PUT/DELETE) are bounded but never auto-retried, so a retry can't
// duplicate an issue comment or a Crowdin delete. Retries are also capped in total time
// (--retry-max-time), since a long Retry-After would otherwise outlast every per-attempt
// bound, and a retried curl writes to a file rather than stdout, because curl appends a
// successful retry to the partial body a timed-out attempt already printed.
//
// Already bounded by other means, deliberately not covered here:
// - gitleaks install: curl with --max-time 60 and --retry 3 (matched by this test too).
// - `gh release download` / `docker pull` / `docker buildx` / `npm ci` inside
//   nick-fields/retry steps, which carry timeout_minutes and max_attempts.
// - bare `npm ci` steps and the Syft `docker run` pull: bounded by the job timeout and
//   npm's own fetch retries; wrapping them is a separate change.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function ciFiles(): string[] {
  const workflows = readdirSync(`${repoRoot}/.github/workflows`)
    .filter((name) => name.endsWith('.yml'))
    .map((name) => `.github/workflows/${name}`);
  const actions = readdirSync(`${repoRoot}/.github/actions`).map(
    (name) => `.github/actions/${name}/action.yml`,
  );
  return [...workflows, ...actions];
}

interface CurlCall {
  file: string;
  line: number;
  command: string;
}

function curlCalls(): CurlCall[] {
  const calls: CurlCall[] = [];
  for (const file of ciFiles()) {
    const lines = readFileSync(`${repoRoot}/${file}`, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i];
      if (text.trimStart().startsWith('#')) continue;
      if (!/(^|[\s$(`|;&"])curl\s/.test(text)) continue;
      let command = text;
      let j = i;
      while (lines[j].trimEnd().endsWith('\\') && j + 1 < lines.length) {
        j += 1;
        command += `\n${lines[j]}`;
      }
      calls.push({ file, line: i + 1, command });
    }
  }
  return calls;
}

const externalCalls = curlCalls().filter(({ command }) => !/localhost|127\.0\.0\.1/.test(command));

test('the audit finds the external curl calls it is meant to bound', () => {
  expect(externalCalls.length).toBeGreaterThanOrEqual(10);
});

test.each(externalCalls.map((call) => [`${call.file}:${call.line}`, call] as const))(
  '%s bounds each attempt',
  (_where, { command }) => {
    expect(command).toContain('--max-time');
    expect(command).toContain('--connect-timeout');
  },
);

function optionValue(command: string, option: string): number | undefined {
  const tokens = command.replace(/\\\n/g, ' ').split(/\s+/);
  const at = tokens.indexOf(option);
  if (at === -1) return undefined;
  return Number(tokens[at + 1]);
}

const retriedCalls = externalCalls
  .filter(({ command }) => !/(-X\s|--request|--data|-d\s)/.test(command))
  .filter(({ file }) => !file.endsWith('quality-mutation-monthly.yml'))
  .map((call) => [`${call.file}:${call.line}`, call] as const);

test.each(retriedCalls)('%s retries an idempotent GET', (_where, { command }) => {
  // --retry-all-errors contains "--retry" as a substring, so read the effective value.
  expect(optionValue(command, '--retry')).toBeGreaterThan(0);
});

test.each(retriedCalls)('%s caps total retry time', (_where, { command }) => {
  const cap = optionValue(command, '--retry-max-time');
  expect(cap).toBeGreaterThan(0);
  expect(cap).toBeLessThanOrEqual(180);
});

test.each(retriedCalls)('%s writes its response to a file, not stdout', (_where, { command }) => {
  expect(command).toMatch(/(\s-o\s|--output\s)/);
});
