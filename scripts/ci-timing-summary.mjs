import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const SLOWEST_STEP_COUNT = 10;
export const REGRESSION_THRESHOLD_PCT = 20;
export const MIN_RUNS_PER_WINDOW = 3;
export const RUNS_PER_PAGE = 50;
export const MAX_RUN_PAGES = 2;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function durationSeconds(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const ms = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null;
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const cell = (text) =>
  String(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function buildJobTable(jobs, excludeName) {
  const rows = jobs
    .filter((job) => job.name !== excludeName)
    .map((job) => ({
      name: job.name,
      conclusion: job.conclusion ?? job.status ?? 'unknown',
      seconds: durationSeconds(job.started_at, job.completed_at),
    }))
    .sort((a, b) => (b.seconds ?? -1) - (a.seconds ?? -1));
  const lines = ['| Job | Result | Duration |', '| --- | --- | --- |'];
  for (const row of rows) {
    lines.push(`| ${cell(row.name)} | ${cell(row.conclusion)} | ${formatDuration(row.seconds)} |`);
  }
  return lines.join('\n');
}

export function buildSlowestSteps(jobs, excludeName, count = SLOWEST_STEP_COUNT) {
  const steps = [];
  for (const job of jobs) {
    if (job.name === excludeName) continue;
    for (const step of job.steps ?? []) {
      if (step.conclusion === 'skipped') continue;
      const seconds = durationSeconds(step.started_at, step.completed_at);
      if (seconds === null) continue;
      steps.push({ job: job.name, step: step.name, seconds });
    }
  }
  steps.sort((a, b) => b.seconds - a.seconds);
  const lines = ['| Step | Job | Duration |', '| --- | --- | --- |'];
  for (const s of steps.slice(0, count)) {
    lines.push(`| ${cell(s.step)} | ${cell(s.job)} | ${formatDuration(s.seconds)} |`);
  }
  return lines.join('\n');
}

export function runDurationSeconds(run) {
  return durationSeconds(run.run_started_at ?? run.created_at, run.updated_at);
}

export function compareWeeks(runs, now) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const recent = [];
  const previous = [];
  for (const run of runs) {
    const created = Date.parse(run.created_at);
    const seconds = runDurationSeconds(run);
    if (!Number.isFinite(created) || seconds === null) continue;
    const age = nowMs - created;
    if (age < 0) continue;
    if (age < WINDOW_MS) recent.push(seconds);
    else if (age < 2 * WINDOW_MS) previous.push(seconds);
  }
  const result = {
    recentCount: recent.length,
    previousCount: previous.length,
    recentMedian: median(recent),
    previousMedian: median(previous),
    deltaPct: null,
    regression: false,
    enoughData: recent.length >= MIN_RUNS_PER_WINDOW && previous.length >= MIN_RUNS_PER_WINDOW,
  };
  if (result.enoughData && result.previousMedian > 0) {
    result.deltaPct = ((result.recentMedian - result.previousMedian) / result.previousMedian) * 100;
    result.regression = result.deltaPct > REGRESSION_THRESHOLD_PCT;
  }
  return result;
}

export function buildTrendSection(comparison, branch) {
  const lines = [`### Week over week (median total duration, \`${cell(branch)}\`)`, ''];
  if (!comparison.enoughData) {
    lines.push(
      `Not enough successful runs to compare (last 7 days: ${comparison.recentCount}, previous 7 days: ${comparison.previousCount}, need ${MIN_RUNS_PER_WINDOW} each).`,
    );
    return lines.join('\n');
  }
  const sign = comparison.deltaPct >= 0 ? '+' : '';
  lines.push(
    '| Window | Runs | Median |',
    '| --- | --- | --- |',
    `| Last 7 days | ${comparison.recentCount} | ${formatDuration(Math.round(comparison.recentMedian))} |`,
    `| Previous 7 days | ${comparison.previousCount} | ${formatDuration(Math.round(comparison.previousMedian))} |`,
    '',
    `Delta: ${sign}${comparison.deltaPct.toFixed(1)}%${comparison.regression ? ` (over the ${REGRESSION_THRESHOLD_PCT}% regression threshold)` : ''}`,
  );
  return lines.join('\n');
}

export function buildSummary({ jobs, comparison, branch, selfName }) {
  const parts = [
    '## CI timing',
    '',
    '### Jobs',
    '',
    buildJobTable(jobs, selfName),
    '',
    `### ${SLOWEST_STEP_COUNT} slowest steps`,
    '',
    buildSlowestSteps(jobs, selfName),
  ];
  if (comparison) parts.push('', buildTrendSection(comparison, branch));
  return `${parts.join('\n')}\n`;
}

async function ghLines(endpoint) {
  const { stdout } = await execFileAsync('gh', ['api', endpoint, '--jq', '.'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

export async function fetchJobs(repo, runId, fetchPage = ghLines) {
  const jobs = [];
  for (let page = 1; page <= 10; page += 1) {
    const body = JSON.parse(
      await fetchPage(`repos/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`),
    );
    jobs.push(...(body.jobs ?? []));
    if ((body.jobs ?? []).length < 100) break;
  }
  return jobs;
}

export async function fetchRecentRuns(repo, branch, fetchPage = ghLines) {
  const runs = [];
  const qs = `branch=${encodeURIComponent(branch)}&status=success&per_page=${RUNS_PER_PAGE}`;
  for (let page = 1; page <= MAX_RUN_PAGES; page += 1) {
    const body = JSON.parse(
      await fetchPage(`repos/${repo}/actions/workflows/ci-verify.yml/runs?${qs}&page=${page}`),
    );
    const batch = body.workflow_runs ?? [];
    runs.push(...batch);
    if (batch.length < RUNS_PER_PAGE) break;
  }
  return runs;
}

export async function main(env = process.env, fetchPage = ghLines, now = new Date()) {
  const repo = env.GITHUB_REPOSITORY;
  const runId = env.GITHUB_RUN_ID;
  if (!repo || !runId) throw new Error('GITHUB_REPOSITORY and GITHUB_RUN_ID are required');
  const branch = env.TIMING_BRANCH || env.GITHUB_REF_NAME || 'main';
  const selfName = env.TIMING_JOB_NAME || 'CI timing';

  const jobs = await fetchJobs(repo, runId, fetchPage);
  let comparison = null;
  // Pull request branches rarely have a week of history, so only compare
  // runs of long-lived branches.
  if (env.GITHUB_EVENT_NAME !== 'pull_request') {
    try {
      comparison = compareWeeks(await fetchRecentRuns(repo, branch, fetchPage), now);
    } catch (error) {
      console.log(`::notice::Week-over-week comparison skipped: ${error.message}`);
    }
  }
  if (comparison?.regression) {
    console.log(
      `::warning::CI median duration on ${branch} rose ${comparison.deltaPct.toFixed(1)}% week over week (${formatDuration(Math.round(comparison.previousMedian))} to ${formatDuration(Math.round(comparison.recentMedian))})`,
    );
  }
  const summary = buildSummary({ jobs, comparison, branch, selfName });
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
  else process.stdout.write(summary);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.log(`::warning::CI timing summary failed: ${error.message}`);
  });
}
