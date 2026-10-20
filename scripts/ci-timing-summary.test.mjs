import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  buildJobTable,
  buildSlowestSteps,
  buildSummary,
  compareWeeks,
  durationSeconds,
  fetchJobs,
  fetchRecentRuns,
  formatDuration,
  main,
  median,
} from './ci-timing-summary.mjs';

const load = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const now = new Date('2026-10-19T12:00:00Z');

test('duration helpers', () => {
  assert.equal(durationSeconds('2026-10-19T00:00:00Z', '2026-10-19T00:01:05Z'), 65);
  assert.equal(durationSeconds('2026-10-19T00:00:00Z', null), null);
  assert.equal(formatDuration(65), '1m 05s');
  assert.equal(formatDuration(9), '9s');
  assert.equal(formatDuration(null), '-');
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test('job table sorts by duration, keeps skipped jobs and drops the timing job itself', async () => {
  const { jobs } = await load('ci-timing-jobs.json');
  const table = buildJobTable(jobs, 'CI timing');
  const lines = table.split('\n');
  assert.match(lines[2], /Quality: Test & Coverage \| success \| 18m 30s/);
  assert.match(lines[3], /Build \| success \| 9m 05s/);
  assert.match(lines[5], /Security: Secrets \| skipped \| -/);
  assert.ok(!table.includes('CI timing'));
});

test('slowest steps skip skipped steps, escape pipes and cap the list', async () => {
  const { jobs } = await load('ci-timing-jobs.json');
  const table = buildSlowestSteps(jobs, 'CI timing', 3).split('\n');
  assert.equal(table.length, 5);
  assert.match(table[2], /Run unit tests \| Quality: Test & Coverage \| 13m 10s/);
  assert.ok(!table.join('\n').includes('Upload coverage'));
  assert.ok(buildSlowestSteps(jobs, 'CI timing').includes('Run e2e \\| cucumber'));
});

test('week over week flags a regression over 20 percent', async () => {
  const { workflow_runs } = await load('ci-timing-runs.json');
  const result = compareWeeks(workflow_runs, now);
  assert.equal(result.recentCount, 5);
  assert.equal(result.previousCount, 5);
  assert.equal(result.recentMedian, 25 * 60);
  assert.equal(result.previousMedian, 19 * 60);
  assert.ok(Math.abs(result.deltaPct - 31.58) < 0.01);
  assert.equal(result.regression, true);
});

test('week over week stays quiet under the threshold and with too little data', async () => {
  const { workflow_runs } = await load('ci-timing-runs.json');
  const flat = workflow_runs.map((run) => ({ ...run, updated_at: run.created_at }));
  assert.equal(compareWeeks(flat, now).regression, false);
  const sparse = compareWeeks(workflow_runs.slice(0, 2), now);
  assert.equal(sparse.enoughData, false);
  assert.equal(sparse.regression, false);
});

test('fetch helpers page with a bound', async () => {
  const calls = [];
  const full = { workflow_runs: Array.from({ length: 50 }, () => ({})) };
  const runs = await fetchRecentRuns('o/r', 'main', async (endpoint) => {
    calls.push(endpoint);
    return JSON.stringify(full);
  });
  assert.equal(calls.length, 2);
  assert.equal(runs.length, 100);
  assert.match(calls[0], /branch=main&status=success&per_page=50&page=1/);
  const jobs = await fetchJobs('o/r', '7', async () => JSON.stringify({ jobs: [{ name: 'a' }] }));
  assert.equal(jobs.length, 1);
});

test('main writes the summary and emits the regression warning', async (t) => {
  const jobs = await load('ci-timing-jobs.json');
  const runs = await load('ci-timing-runs.json');
  const logs = [];
  t.mock.method(console, 'log', (line) => logs.push(line));
  const writes = [];
  t.mock.method(process.stdout, 'write', (chunk) => {
    writes.push(String(chunk));
    return true;
  });
  const fetchPage = async (endpoint) => JSON.stringify(endpoint.includes('/jobs?') ? jobs : runs);
  await main(
    {
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_RUN_ID: '1',
      GITHUB_REF_NAME: 'main',
      GITHUB_EVENT_NAME: 'schedule',
    },
    fetchPage,
    now,
  );
  assert.ok(
    logs.some((line) => line.startsWith('::warning::CI median duration on main rose 31.6%')),
  );
  const summary = writes.join('');
  t.mock.restoreAll();
  console.log(summary);
  assert.match(summary, /## CI timing/);
  assert.match(summary, /Delta: \+31\.6% \(over the 20% regression threshold\)/);
});

test('pull requests skip the week-over-week section', async () => {
  const jobs = await load('ci-timing-jobs.json');
  const summary = buildSummary({
    jobs: jobs.jobs,
    comparison: null,
    branch: 'x',
    selfName: 'CI timing',
  });
  assert.ok(!summary.includes('Week over week'));
});

test('table cells escape backslashes before pipes', () => {
  const jobs = [
    {
      name: 'a\\|b',
      conclusion: 'success',
      started_at: '2026-10-19T00:00:00Z',
      completed_at: '2026-10-19T00:00:10Z',
    },
  ];
  const row = buildJobTable(jobs, 'CI timing').split('\n')[2];
  assert.equal(row, '| a\\\\\\|b | success | 10s |');
});
