import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const scriptPath = path.join(process.cwd(), 'scripts', 'aggregate-stryker-score.mjs');

function createMutationReport(rootDir, artifactName, mutantStatuses) {
  const reportDir = path.join(rootDir, artifactName, 'mutation');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, 'mutation.json'),
    `${JSON.stringify(
      {
        files: {
          'src/example.ts': {
            mutants: mutantStatuses.map((status, index) => ({
              id: String(index),
              mutatorName: 'ArithmeticOperator',
              replacement: '0',
              status,
            })),
          },
        },
        framework: {
          name: 'vitest',
        },
        thresholds: {
          break: 65,
          high: 80,
          low: 70,
        },
      },
      null,
      2,
    )}\n`,
  );
}

function runScript(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  });
}

test('allows partial aggregation when missing reports are explicitly allowed', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aggregate-stryker-score-'));
  const inputDir = path.join(tmpDir, 'artifacts', 'mutation');
  const summaryOut = path.join(tmpDir, 'artifacts', 'aggregate', 'summary.json');
  const scoreOut = path.join(tmpDir, 'artifacts', 'aggregate', 'mutation-score.json');

  createMutationReport(inputDir, 'mutation-report-app-ops-1', ['Killed', 'Killed', 'Survived']);

  const result = runScript([
    '--input',
    inputDir,
    '--expected-count',
    '2',
    '--allow-missing',
    '--summary-out',
    summaryOut,
    '--score-out',
    scoreOut,
  ]);

  assert.equal(result.status, 0, result.stderr);

  const summary = JSON.parse(fs.readFileSync(summaryOut, 'utf8'));
  assert.equal(summary.expectedReportCount, 2);
  assert.equal(summary.missingReportCount, 1);
  assert.equal(summary.isComplete, false);
  assert.equal(summary.mutationReportCount, 1);
  assert.equal(summary.totals.detected, 2);
  assert.equal(summary.totals.valid, 3);
  assert.equal(summary.totals.mutationScore, 66.67);
});

test('markdown summary calls out partial aggregates', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aggregate-stryker-summary-'));
  const inputDir = path.join(tmpDir, 'artifacts', 'mutation');
  const summaryOut = path.join(tmpDir, 'artifacts', 'aggregate', 'summary.json');
  const scoreOut = path.join(tmpDir, 'artifacts', 'aggregate', 'mutation-score.json');

  createMutationReport(inputDir, 'mutation-report-app-ops-1', ['Killed', 'Survived']);

  const aggregate = runScript([
    '--input',
    inputDir,
    '--expected-count',
    '3',
    '--allow-missing',
    '--summary-out',
    summaryOut,
    '--score-out',
    scoreOut,
  ]);

  assert.equal(aggregate.status, 0, aggregate.stderr);

  const summarize = runScript(['--summarize', summaryOut]);

  assert.equal(summarize.status, 0, summarize.stderr);
  assert.match(summarize.stdout, /Reports aggregated: 1 \/ 3 expected\./);
  assert.match(summarize.stdout, /Status: PARTIAL \(2 reports missing\)\./);
});

test('writes a partial summary when no reports are available but missing reports are allowed', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aggregate-stryker-empty-'));
  const inputDir = path.join(tmpDir, 'artifacts', 'mutation');
  const summaryOut = path.join(tmpDir, 'artifacts', 'aggregate', 'summary.json');
  const scoreOut = path.join(tmpDir, 'artifacts', 'aggregate', 'mutation-score.json');

  fs.mkdirSync(inputDir, { recursive: true });

  const result = runScript([
    '--input',
    inputDir,
    '--expected-count',
    '4',
    '--allow-missing',
    '--summary-out',
    summaryOut,
    '--score-out',
    scoreOut,
  ]);

  assert.equal(result.status, 0, result.stderr);

  const summary = JSON.parse(fs.readFileSync(summaryOut, 'utf8'));
  assert.equal(summary.mutationReportCount, 0);
  assert.equal(summary.expectedReportCount, 4);
  assert.equal(summary.missingReportCount, 4);
  assert.equal(summary.isComplete, false);
  assert.equal(summary.totals.mutationScore, 0);
});
