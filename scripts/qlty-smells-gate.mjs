#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function parseArgs(argv) {
  const defaults = {
    scope: 'changed',
    upstream: 'origin/main',
    enforce: false,
    maxTotal: 0,
    sarifOutput: '',
    summaryOutput: '',
  };

  return argv.reduce((acc, arg) => {
    if (!arg.startsWith('--')) {
      return acc;
    }

    const [key, rawValue] = arg.slice(2).split('=', 2);
    const value = rawValue ?? 'true';

    if (key === 'scope') {
      acc.scope = value;
      return acc;
    }
    if (key === 'upstream') {
      acc.upstream = value;
      return acc;
    }
    if (key === 'enforce') {
      acc.enforce = value === 'true';
      return acc;
    }
    if (key === 'max-total') {
      acc.maxTotal = Number(value);
      return acc;
    }
    if (key === 'sarif-output') {
      acc.sarifOutput = value;
      return acc;
    }
    if (key === 'summary-output') {
      acc.summaryOutput = value;
      return acc;
    }
    return acc;
  }, defaults);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function buildQltyArgs({ scope, upstream }) {
  if (scope !== 'changed' && scope !== 'all') {
    fail(`Unsupported --scope value: ${scope}. Expected "changed" or "all".`);
  }

  const args = ['smells', '--quiet', '--sarif'];
  if (scope === 'all') {
    args.push('--all');
  } else if (upstream) {
    args.push('--upstream', upstream);
  }
  return args;
}

function parseSarif(stdout) {
  const trimmed = stdout.trimStart();
  if (!trimmed) {
    return { runs: [] };
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    fail(
      `Failed to parse qlty smells SARIF output: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function summarizeResults(results) {
  const counts = new Map();
  for (const result of results) {
    const ruleId = result.ruleId ?? 'unknown';
    counts.set(ruleId, (counts.get(ruleId) ?? 0) + 1);
  }
  return counts;
}

function appendSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }
  appendFileSync(summaryPath, `${lines.join('\n')}\n`);
}

function writeOutputFile(path, content) {
  if (!path) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!Number.isInteger(options.maxTotal) || options.maxTotal < 0) {
    fail(`--max-total must be a non-negative integer. Received: ${options.maxTotal}`);
  }

  const qltyArgs = buildQltyArgs(options);
  const run = spawnSync('qlty', qltyArgs, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 25,
  });

  if (run.error) {
    fail(`Failed to execute qlty: ${run.error.message}`);
  }

  if ((run.status ?? 1) !== 0) {
    process.stderr.write(run.stderr || run.stdout || '');
    process.exit(run.status ?? 1);
  }

  const sarif = parseSarif(run.stdout);
  writeOutputFile(options.sarifOutput, `${JSON.stringify(sarif, null, 2)}\n`);
  const results = sarif.runs?.flatMap((runEntry) => runEntry.results ?? []) ?? [];
  const total = results.length;
  const ruleCounts = summarizeResults(results);

  const header = `Qlty smells (${options.scope}) found ${total} issue${total === 1 ? '' : 's'}.`;
  console.log(header);

  const sortedRules = [...ruleCounts.entries()].sort((left, right) => right[1] - left[1]);
  for (const [rule, count] of sortedRules) {
    console.log(`- ${rule}: ${count}`);
  }

  const summaryLines = [
    '### Qlty Smells',
    `- Scope: \`${options.scope}\``,
    `- Total findings: **${total}**`,
  ];
  for (const [rule, count] of sortedRules) {
    summaryLines.push(`- \`${rule}\`: ${count}`);
  }
  appendSummary(summaryLines);
  writeOutputFile(options.summaryOutput, `${summaryLines.join('\n')}\n`);

  if (options.enforce && total > options.maxTotal) {
    console.error(
      `AI_ACTION_REQUIRED: qlty smells limit exceeded (${total} > ${options.maxTotal}).`,
    );
    process.exit(1);
  }
}

main();
