#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function usage(message) {
  if (message) {
    console.error(message);
    console.error('');
  }
  console.error(
    'Usage: node scripts/aggregate-stryker-score.mjs --input <dir> [--expected-count <n>] [--allow-missing] --summary-out <file> --score-out <file>',
  );
  console.error('       node scripts/aggregate-stryker-score.mjs --summarize <summary.json>');
  process.exit(1);
}

function summarizeToMarkdown(summaryPath) {
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const totals = summary.totals;
  const expectedLabel =
    summary.expectedReportCount != null ? ` / ${summary.expectedReportCount} expected` : '';
  const lines = [
    '### Aggregate Mutation Score',
    `- Reports aggregated: ${summary.mutationReportCount}${expectedLabel}.`,
    `- Mutation score: ${totals.mutationScore.toFixed(2)}%.`,
    `- Detected / valid: ${totals.detected} / ${totals.valid}.`,
    `- Undetected: ${totals.undetected}.`,
    `- Invalid: ${totals.invalid}.`,
    `- Ignored: ${totals.ignored}.`,
  ];
  if (summary.isComplete === false && summary.missingReportCount > 0) {
    lines.push(`- Status: PARTIAL (${summary.missingReportCount} reports missing).`);
  }
  console.log(lines.join('\n'));
}

function requireArgValue(argv, index, argName, usage) {
  const value = argv[index + 1];
  if (!value) {
    usage(`Missing value for ${argName}`);
  }
  return value;
}

function setParsedArg(args, arg, value) {
  switch (arg) {
    case '--expected-count':
      args.expectedCount = Number.parseInt(value, 10);
      return;
    case '--input':
      args.input = value;
      return;
    case '--score-out':
      args.scoreOut = value;
      return;
    case '--summarize':
      args.summarize = value;
      return;
    case '--summary-out':
      args.summaryOut = value;
      return;
    default:
      throw new Error(`Unknown argument: ${arg}`);
  }
}

function parseArgs(argv) {
  const args = {
    allowMissing: false,
    expectedCount: null,
    input: null,
    scoreOut: null,
    summarize: null,
    summaryOut: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--allow-missing') {
      args.allowMissing = true;
      continue;
    }

    if (!arg.startsWith('--')) {
      usage(`Unknown argument: ${arg}`);
    }

    const next = requireArgValue(argv, index, arg, usage);
    setParsedArg(args, arg, next);
    index += 1;
  }

  if (args.summarize) {
    return args;
  }

  if (!args.input || !args.scoreOut || !args.summaryOut) {
    usage('Missing one or more required arguments');
  }

  if (
    args.expectedCount !== null &&
    (!Number.isInteger(args.expectedCount) || args.expectedCount < 1)
  ) {
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
  counts.mutationScore =
    counts.valid === 0 ? 0 : Number(((counts.detected / counts.valid) * 100).toFixed(2));
  counts.coveredMutationScore =
    counts.covered === 0 ? 0 : Number(((counts.detected / counts.covered) * 100).toFixed(2));
  return counts;
}

const MUTANT_STATUS_TO_COUNT = {
  CompileError: 'compileErrors',
  Ignored: 'ignored',
  Killed: 'killed',
  NoCoverage: 'noCoverage',
  Pending: 'pending',
  RuntimeError: 'runtimeErrors',
  Survived: 'survived',
  Timeout: 'timeout',
};

function addMutantStatus(counts, mutantStatus, reportPath) {
  const key = MUTANT_STATUS_TO_COUNT[mutantStatus];
  if (!key) {
    throw new Error(`Unknown mutant status "${mutantStatus}" in ${reportPath}`);
  }
  counts[key] += 1;
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

function summarizeCountsFromMutants(counts, file, reportPath) {
  for (const mutant of file.mutants ?? []) {
    counts.total += 1;
    addMutantStatus(counts, mutant.status, reportPath);
  }
}

function buildReportSummary(raw, counts, reportPath) {
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

function summarizeReport(reportPath) {
  const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const counts = createCounts();

  for (const file of Object.values(raw.files ?? {})) {
    summarizeCountsFromMutants(counts, file, reportPath);
  }

  finalizeCounts(counts);

  return buildReportSummary(raw, counts, reportPath);
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.summarize) {
    summarizeToMarkdown(path.resolve(args.summarize));
    return;
  }

  const inputPath = path.resolve(args.input);

  if (!fs.existsSync(inputPath)) {
    usage(`Input path does not exist: ${inputPath}`);
  }

  const mutationReports = collectMutationReports(inputPath);
  if (mutationReports.length === 0 && !args.allowMissing) {
    throw new Error(`No mutation.json files found under ${inputPath}`);
  }

  if (
    args.expectedCount !== null &&
    mutationReports.length !== args.expectedCount &&
    !args.allowMissing
  ) {
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

  const missingReportCount =
    args.expectedCount !== null ? Math.max(args.expectedCount - mutationReports.length, 0) : 0;

  const summaryOutput = {
    generatedAt: new Date().toISOString(),
    input: inputPath,
    mutationReportCount: mutationReports.length,
    ...(args.expectedCount !== null && {
      expectedReportCount: args.expectedCount,
      missingReportCount,
      isComplete: missingReportCount === 0,
    }),
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
