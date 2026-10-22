import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorkflow } from './workflow-test-utils';

const workflowPath = fileURLToPath(
  new URL('../workflows/closing-keywords-guard.yml', import.meta.url),
);

test('closing keywords guard runs on PRs into main and re-runs when the body is edited', () => {
  const workflow = loadWorkflow(workflowPath);
  const pullRequest = (workflow.on as Record<string, { branches?: string[]; types?: string[] }>)
    .pull_request;
  expect(pullRequest.branches).toStrictEqual(['main']);
  expect(pullRequest.types).toContain('edited');
});

test('closing keywords guard passes the PR text through env, not interpolation', () => {
  const steps = loadWorkflow(workflowPath).jobs?.['closing-keywords']?.steps ?? [];
  const guard = steps.find((step) => step.run?.includes('scripts/closing-keywords.mjs'));
  expect(guard).toBeDefined();
  expect(guard?.env?.PR_TITLE).toBe('${{ github.event.pull_request.title }}');
  expect(guard?.env?.PR_BODY).toBe('${{ github.event.pull_request.body }}');
  expect(guard?.run).not.toContain('${{');
});

test('closing keywords guard also scans the commit messages that build the squash message', () => {
  const steps = loadWorkflow(workflowPath).jobs?.['closing-keywords']?.steps ?? [];
  const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  expect(checkout?.with?.['fetch-depth']).toBe(0);
  const guard = steps.find((step) => step.run?.includes('scripts/closing-keywords.mjs'));
  expect(guard?.env?.BASE_SHA).toBe('${{ github.event.pull_request.base.sha }}');
  expect(guard?.env?.HEAD_SHA).toBe('${{ github.event.pull_request.head.sha }}');
  expect(guard?.run).toContain('git log --format=%B "${BASE_SHA}..${HEAD_SHA}"');
  expect(guard?.run).toContain('PR commits=');
  expect(guard?.run).not.toContain('${{');
});

describe('closing keywords guard commit range', () => {
  const steps = loadWorkflow(workflowPath).jobs?.['closing-keywords']?.steps ?? [];
  const guard = steps.find((step) => step.run?.includes('scripts/closing-keywords.mjs'));
  const commitScript = (guard?.run ?? '').split('node scripts/closing-keywords.mjs')[0];

  test('scans only the sync commit when the head is a merge with the base as first parent', () => {
    expect(commitScript).toContain('git rev-list --parents -n 1 "${HEAD_SHA}"');
    expect(commitScript).toContain('git rev-parse "${HEAD_SHA}^1"');
    expect(commitScript).toContain('git log -1 --format=%B "${HEAD_SHA}"');
  });

  // Git hooks (the pre-push gate runs this suite) export GIT_DIR, GIT_INDEX_FILE
  // and friends; inherited, they point every temp-repo command at the real repo.
  const cleanEnv = () =>
    Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

  const git = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...cleanEnv(),
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        ...env,
      },
    }).trim();

  const runStep = (cwd: string, baseSha: string, headSha: string) => {
    const runnerTemp = mkdtempSync(join(tmpdir(), 'ckg-run-'));
    execFileSync('bash', ['-eo', 'pipefail', '-c', commitScript], {
      cwd,
      env: {
        ...cleanEnv(),
        RUNNER_TEMP: runnerTemp,
        PR_TITLE: 't',
        PR_BODY: 'b',
        BASE_SHA: baseSha,
        HEAD_SHA: headSha,
      },
    });
    return readFileSync(join(runnerTemp, 'pr-commits.txt'), 'utf8');
  };

  const makeRepo = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ckg-repo-'));
    const id = ['-c', 'user.name=t', '-c', 'user.email=t@example.com'];
    git(dir, ['init', '-q', '-b', 'main']);
    const commit = (msg: string) => {
      git(dir, [...id, 'commit', '-q', '--allow-empty', '-m', msg]);
      return git(dir, ['rev-parse', 'HEAD']);
    };
    return { dir, id, commit };
  };

  test('sync shape: ignores old dev commits and reads only the sync commit message', () => {
    const { dir, id, commit } = makeRepo();
    commit('chore: root');
    git(dir, ['checkout', '-q', '-b', 'dev']);
    commit('fix: old thing\n\nFixes #1');
    commit('fix: another\n\nCloses #2');
    const dev = git(dir, ['rev-parse', 'HEAD']);
    git(dir, ['checkout', '-q', 'main']);
    const main = commit('chore: main only');
    const tree = git(dir, ['rev-parse', `${dev}^{tree}`]);
    const sync = git(dir, [
      ...id,
      'commit-tree',
      tree,
      '-p',
      main,
      '-p',
      dev,
      '-m',
      'chore: sync dev',
    ]);

    const text = runStep(dir, main, sync);
    expect(text).toContain('chore: sync dev');
    expect(text).not.toMatch(/Fixes #1|Closes #2/);
  });

  test('linear PR: still scans every commit in BASE..HEAD', () => {
    const { dir, commit } = makeRepo();
    const base = commit('chore: root');
    commit('fix: one\n\nFixes #7');
    const head = commit('fix: two');

    const text = runStep(dir, base, head);
    expect(text).toContain('Fixes #7');
    expect(text).toContain('fix: two');
  });
});
