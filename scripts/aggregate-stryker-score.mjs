#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function usage(message) {
  if (message) {
    console.error(message);
    console.error('');
  }
  console.error(
    'Usage: node scripts/aggregate-stryker-score.mjs --input <dir> [--expected-count <n>] --summary-out <file> --score-out <file>',
  );
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    expectedCount: null,
    input: null,
    scoreOut: null,
    summaryOut: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--expected-count':
        if (!next) {
          usage('Missing value for --expected-count');
        }
        args.expectedCount = Number.parseInt(next, 10);
        index += 1;
        break;
      case '--input':
        if (!next) {
          usage('Missing value for --input');
        }
        args.input = next;
        index += 1;
        break;
      case '--score-out':
        if (!next) {
          usage('Missing value for --score-out');
        }
        args.scoreOut = next;
        index += 1;
        break;
      case '--summary-out':
        if (!next) {
          usage('Missing value for --summary-out');
        }
        args.summaryOut = next;
        index += 1;
        break;
      default:
        usage(`Unknown argument: ${arg}`);
    }
  }

  if (!args.input || !args.scoreOut || !args.summaryOut) {
    usage('Missing one or more required arguments');
  }

  if (args.expectedCount !== null && (!Number.isInteger(args.expectedCount) || args.expectedCount < 1)) {
    usage('--expected-count must be a positive integer');
  }

  return args;
}

function createCounts() {
  return {
    compileErrors: 0,
    covered: 0,
    detected: 0,
    ignored: 0,
    invalid: 0,
    killed: 0,
    noCoverage: 0,
    pending: 0,
    runtimeErrors: 0,
    survived: 0,
    timeout: 0,
    total: 0,
    undetected: 0,
    valid: 0,
  };
}

function addCounts(target, source) {
  for (const key of Object.keys(target)) {
    const value = source[key];
    if (typeof value === 'number') {
      target[key] += value;
    }
  }
}

function finalizeCounts(counts) {
  counts.detected = counts.killed + counts.timeout;
  counts.undetected = counts.survived + counts.noCoverage;
  counts.covered = counts.detected + counts.survived;
  counts.invalid = counts.runtimeErrors + counts.compileErrors;
  counts.valid = counts.detected + counts.undetected;
  counts.mutationScore = counts.valid === 0 ? 0 : Number(((counts.detected / counts.valid) * 100).toFixed(2));
  counts.coveredMutationScore =
    counts.covered === 0 ? 0 : Number(((counts.detected / counts.covered) * 100).toFixed(2));
  return counts;
}

function collectMutationReports(root) {
  const reports = [];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.pop();
    const stat = fs.statSync(current);

    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        queue.push(path.join(current, entry.name));
      }
      continue;
    }

    if (path.basename(current) === 'mutation.json') {
      reports.push(current);
    }
  }

  return reports.sort((left, right) => left.localeCompare(right));
}

function summarizeReport(reportPath) {
  const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const counts = createCounts();

  for (const file of Object.values(raw.files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      counts.total += 1;

      switch (mutant.status) {
        case 'Killed':
          counts.killed += 1;
          break;
        case 'Survived':
          counts.survived += 1;
          break;
        case 'NoCoverage':
          counts.noCoverage += 1;
          break;
        case 'Timeout':
          counts.timeout += 1;
          break;
        case 'RuntimeError':
          counts.runtimeErrors += 1;
          break;
        case 'CompileError':
          counts.compileErrors += 1;
          break;
        case 'Ignored':
          counts.ignored += 1;
          break;
        case 'Pending':
          counts.pending += 1;
          break;
        default:
          throw new Error(`Unknown mutant status "${mutant.status}" in ${reportPath}`);
      }
    }
  }

  finalizeCounts(counts);

  return {
    file: reportPath,
    framework: raw.framework?.name ?? null,
    mutationScore: counts.mutationScore,
    mutationScoreBasedOnCoveredCode: counts.coveredMutationScore,
    projectRoot: raw.projectRoot ?? null,
    reportType: raw.config?.dashboard?.reportType ?? null,
    thresholds: raw.thresholds ?? null,
    ...counts,
  };
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);

  if (!fs.existsSync(inputPath)) {
    usage(`Input path does not exist: ${inputPath}`);
  }

  const mutationReports = collectMutationReports(inputPath);
  if (mutationReports.length === 0) {
    throw new Error(`No mutation.json files found under ${inputPath}`);
  }

  if (args.expectedCount !== null && mutationReports.length !== args.expectedCount) {
    throw new Error(
      `Expected ${args.expectedCount} mutation reports under ${inputPath}, but found ${mutationReports.length}`,
    );
  }

  const totals = createCounts();
  const reports = mutationReports.map((reportPath) => {
    const summary = summarizeReport(reportPath);
    addCounts(totals, summary);
    return {
      file: summary.file,
      mutationScore: summary.mutationScore,
      mutationScoreBasedOnCoveredCode: summary.mutationScoreBasedOnCoveredCode,
      projectRoot: summary.projectRoot,
      total: summary.total,
      valid: summary.valid,
      detected: summary.detected,
      undetected: summary.undetected,
      ignored: summary.ignored,
      runtimeErrors: summary.runtimeErrors,
      compileErrors: summary.compileErrors,
    };
  });

  finalizeCounts(totals);

  const summaryOutput = {
    generatedAt: new Date().toISOString(),
    input: inputPath,
    mutationReportCount: mutationReports.length,
    totals,
    reports,
  };
  const scoreOutput = {
    mutationScore: totals.mutationScore,
  };

  const summaryOutPath = path.resolve(args.summaryOut);
  const scoreOutPath = path.resolve(args.scoreOut);
  ensureDirectory(summaryOutPath);
  ensureDirectory(scoreOutPath);
  fs.writeFileSync(summaryOutPath, `${JSON.stringify(summaryOutput, null, 2)}\n`);
  fs.writeFileSync(scoreOutPath, `${JSON.stringify(scoreOutput, null, 2)}\n`);

  console.log(
    `Aggregated ${mutationReports.length} reports. Mutation score ${totals.mutationScore.toFixed(2)} (${totals.detected}/${totals.valid}).`,
  );
}

main();
