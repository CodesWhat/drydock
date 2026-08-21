import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

// This test extracts and EXECUTES the real polling `run:` block from the
// composite action (rather than a copy pasted into the test), so the
// allow-dispatch-events gate can't drift from what actually ships. Maintenance
// cuts build from a named dev branch, which ci-verify.yml's push trigger never
// covers (push is main-only) — the CI evidence there is a workflow_dispatch
// run instead, which this input opts into accepting. Normal cuts must see
// byte-identical push-only behavior when the input is left at its 'false'
// default.
const actionPath = fileURLToPath(
  new URL('../actions/wait-for-successful-branch-ci/action.yml', import.meta.url),
);

interface CompositeStep {
  name?: string;
  shell?: string;
  env?: Record<string, string>;
  run?: string;
}

interface CompositeAction {
  runs?: { steps?: CompositeStep[] };
}

function loadPollRunBlock(): string {
  const action = yaml.parse(readFileSync(actionPath, 'utf8')) as CompositeAction;
  const step = action.runs?.steps?.find(
    (candidate) => candidate.name === 'Wait for successful branch CI on target SHA',
  );
  if (!step?.run) {
    throw new Error(
      "Expected wait-for-successful-branch-ci/action.yml to include a 'Wait for successful branch CI on target SHA' step with a run block",
    );
  }
  return step.run;
}

const TARGET_SHA = 'a'.repeat(40);

function runsJsonWith(
  event: string,
  conclusion: string | null,
  headSha: string = TARGET_SHA,
): string {
  return JSON.stringify({
    workflow_runs: [
      {
        head_sha: headSha,
        event,
        head_branch: 'dev/v1.6',
        status: conclusion ? 'completed' : 'in_progress',
        conclusion,
        id: 1,
        html_url: 'https://example.invalid/run/1',
      },
    ],
  });
}

// Stub 'curl' for the poll script under test. Only implements the one GET the
// script issues per attempt: the workflow-runs listing endpoint.
const stubCurlScript = `#!/usr/bin/env bash
printf '%s' "\${FAKE_RUNS_JSON:?FAKE_RUNS_JSON not set}"
exit 0
`;

interface PollResult {
  status: number;
  stdout: string;
}

function runPoll(options: { allowDispatchEvents: string; runsJson: string }): PollResult {
  const workdir = mkdtempSync(join(tmpdir(), 'wait-for-ci-dispatch-events-'));
  try {
    const stubDir = join(workdir, 'bin');
    mkdirSync(stubDir);
    writeFileSync(join(stubDir, 'curl'), stubCurlScript, { mode: 0o755 });
    chmodSync(join(stubDir, 'curl'), 0o755);

    const scriptPath = join(workdir, 'poll.sh');
    writeFileSync(scriptPath, loadPollRunBlock());

    const env: NodeJS.ProcessEnv = {
      PATH: `${stubDir}:${process.env.PATH ?? ''}`,
      GH_TOKEN: 'test-token',
      GITHUB_API_URL: 'https://api.example.invalid',
      GITHUB_REPOSITORY: 'CodesWhat/drydock',
      TARGET_SHA,
      MAX_ATTEMPTS: '1',
      SLEEP_SECONDS: '0',
      ALLOW_DISPATCH_EVENTS: options.allowDispatchEvents,
      // Set as plain env vars: the real second step reads these as ordinary
      // shell variables populated via GITHUB_ENV by the first ("Resolve
      // workflow reference") step, which this test does not also execute.
      workflow_id: '123',
      workflow_name: 'CI Verify',
      FAKE_RUNS_JSON: options.runsJson,
    };

    let status = 0;
    let stdout = '';
    try {
      stdout = execFileSync('bash', [scriptPath], { env, encoding: 'utf8' });
    } catch (error) {
      const execError = error as { status?: number; stdout?: string };
      status = execError.status ?? 1;
      stdout = execError.stdout ?? '';
    }

    return { status, stdout };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

test('a successful workflow_dispatch run is ignored by default (allow-dispatch-events=false)', () => {
  const result = runPoll({
    allowDispatchEvents: 'false',
    runsJson: runsJsonWith('workflow_dispatch', 'success'),
  });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('Timed out waiting for successful');
});

test('a successful workflow_dispatch run counts as CI evidence when allow-dispatch-events=true', () => {
  const result = runPoll({
    allowDispatchEvents: 'true',
    runsJson: runsJsonWith('workflow_dispatch', 'success'),
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Found successful CI Verify branch push run');
});

test('a successful push run still counts with allow-dispatch-events=false (unchanged default behavior)', () => {
  const result = runPoll({
    allowDispatchEvents: 'false',
    runsJson: runsJsonWith('push', 'success'),
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Found successful CI Verify branch push run');
});

test('a successful push run still counts with allow-dispatch-events=true (no regression)', () => {
  const result = runPoll({
    allowDispatchEvents: 'true',
    runsJson: runsJsonWith('push', 'success'),
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Found successful CI Verify branch push run');
});

test('a failed workflow_dispatch run fails fast even with allow-dispatch-events=true', () => {
  const result = runPoll({
    allowDispatchEvents: 'true',
    runsJson: runsJsonWith('workflow_dispatch', 'failure'),
  });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('completed without success');
});

test('a pull_request-triggered run is never accepted as evidence, dispatch flag or not', () => {
  const result = runPoll({
    allowDispatchEvents: 'true',
    runsJson: runsJsonWith('pull_request', 'success'),
  });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('Timed out waiting for successful');
});

// P3-5: the tests above set ALLOW_DISPATCH_EVENTS directly as a plain env var
// and always target a matching SHA. That would stay green even if the input
// stopped being wired to that env var, if the default silently flipped to
// 'true', or if the head_sha predicate were dropped — none of those would be
// caught by a test that only ever exercises the env var and a matching SHA
// directly. These two close that gap.
test('allow-dispatch-events input defaults to false and is wired verbatim into the poll step env', () => {
  const action = yaml.parse(readFileSync(actionPath, 'utf8')) as {
    inputs?: Record<string, { default?: string }>;
    runs?: { steps?: CompositeStep[] };
  };

  expect(action.inputs?.['allow-dispatch-events']?.default).toBe('false');

  const pollStep = action.runs?.steps?.find(
    (candidate) => candidate.name === 'Wait for successful branch CI on target SHA',
  );
  expect(pollStep?.env).toMatchObject({
    ALLOW_DISPATCH_EVENTS: '${{ inputs.allow-dispatch-events }}',
  });
});

test('a matching event/conclusion at a DIFFERENT SHA is rejected even with allow-dispatch-events=true', () => {
  const otherSha = 'b'.repeat(40);
  const result = runPoll({
    allowDispatchEvents: 'true',
    runsJson: runsJsonWith('workflow_dispatch', 'success', otherSha),
  });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('Timed out waiting for successful');
});
