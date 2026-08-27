import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorkflow } from './workflow-test-utils';

// This test extracts and EXECUTES the real `run:` block from the workflow
// (rather than a copy pasted into the test) so it can't drift from what
// actually ships, and so it fails outright if someone reverts the step to the
// broken pre-2ad6c5c9 form: a no-match `grep` under `pipefail` used to exit 1
// and abort the assignment before the `if [ -z "${base}" ]` fallback could
// ever run.
const workflowPath = fileURLToPath(new URL('../workflows/i18n-crowdin.yml', import.meta.url));

const stubGitScript = `#!/usr/bin/env bash
# Stub 'git' for the resolver script under test. Only implements the one
# subcommand the resolver calls: 'ls-remote --heads origin <pattern>'.
if [ "\${1:-}" = "ls-remote" ]; then
  if [ -n "\${FAKE_GIT_LS_REMOTE_EXIT:-}" ] && [ "\${FAKE_GIT_LS_REMOTE_EXIT}" != "0" ]; then
    echo "fatal: unable to access 'origin': stubbed network failure" >&2
    exit "\${FAKE_GIT_LS_REMOTE_EXIT}"
  fi
  printf '%s' "\${FAKE_GIT_LS_REMOTE_OUTPUT:-}"
  exit 0
fi
echo "stub git: unsupported invocation: $*" >&2
exit 127
`;

function loadResolverRunBlock(): string {
  const workflow = loadWorkflow(workflowPath);
  const step = workflow.jobs?.sync?.steps?.find((candidate) => candidate.id === 'base');

  if (!step?.run) {
    throw new Error(
      "Expected i18n-crowdin.yml's sync job to include a step with id 'base' and a run block",
    );
  }

  return step.run;
}

interface ResolverResult {
  status: number;
  stdout: string;
  stderr: string;
  output: Record<string, string>;
}

function runResolver(options: {
  lsRemoteOutput?: string;
  lsRemoteExit?: number;
  defaultBranch?: string;
  eventName?: string;
  refName?: string;
}): ResolverResult {
  const workdir = mkdtempSync(join(tmpdir(), 'crowdin-base-resolver-'));
  try {
    const stubDir = join(workdir, 'bin');
    mkdirSync(stubDir);
    writeFileSync(join(stubDir, 'git'), stubGitScript, { mode: 0o755 });
    chmodSync(join(stubDir, 'git'), 0o755);

    const scriptPath = join(workdir, 'resolve-base.sh');
    writeFileSync(scriptPath, loadResolverRunBlock());

    const outputPath = join(workdir, 'github_output');
    writeFileSync(outputPath, '');

    const env: NodeJS.ProcessEnv = {
      PATH: `${stubDir}:${process.env.PATH ?? ''}`,
      DEFAULT_BRANCH: options.defaultBranch ?? 'main',
      GITHUB_OUTPUT: outputPath,
      // Default to an event with no meaningful branch context, matching the
      // pre-existing tests below that exercise the highest-wins/default-branch
      // fallback without caring which event triggered it.
      GITHUB_EVENT_NAME: options.eventName ?? 'schedule',
      GITHUB_REF_NAME: options.refName ?? 'main',
      FAKE_GIT_LS_REMOTE_OUTPUT: options.lsRemoteOutput ?? '',
    };
    if (options.lsRemoteExit !== undefined) {
      env.FAKE_GIT_LS_REMOTE_EXIT = String(options.lsRemoteExit);
    }

    let status = 0;
    let stdout = '';
    let stderr = '';
    try {
      stdout = execFileSync('bash', [scriptPath], { env, encoding: 'utf8' });
    } catch (error) {
      const execError = error as { status?: number; stdout?: string; stderr?: string };
      status = execError.status ?? 1;
      stdout = execError.stdout ?? '';
      stderr = execError.stderr ?? '';
    }

    const output: Record<string, string> = {};
    for (const line of readFileSync(outputPath, 'utf8').split('\n')) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      output[line.slice(0, eq)] = line.slice(eq + 1);
    }

    return { status, stdout, stderr, output };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

test('falls back to the default branch when origin has no dev/vX.Y branches', () => {
  const result = runResolver({
    lsRemoteOutput: 'deadbeef\trefs/heads/main\ncafef00d\trefs/heads/feature/something\n',
    defaultBranch: 'main',
  });

  expect(result.status).toBe(0);
  expect(result.output.name).toBe('main');
});

test('picks the highest dev/vX.Y branch numerically, not lexically', () => {
  const result = runResolver({
    lsRemoteOutput: [
      'aaaaaaa\trefs/heads/dev/v1.6',
      'bbbbbbb\trefs/heads/dev/v1.9',
      'ccccccc\trefs/heads/dev/v1.10',
      'ddddddd\trefs/heads/not-a-dev-branch',
    ].join('\n'),
  });

  expect(result.status).toBe(0);
  expect(result.output.name).toBe('dev/v1.10');
});

test('a genuinely failing ls-remote propagates and does not silently fall back to main', () => {
  const result = runResolver({ lsRemoteExit: 128, defaultBranch: 'main' });

  expect(result.status).not.toBe(0);
  // The step must die before it ever reaches the fallback assignment — no
  // output should have been written at all.
  expect(result.output.name).toBeUndefined();
  expect(result.stdout).not.toContain('main');
});

test('a push to dev/v1.6 targets dev/v1.6 directly, even when a higher dev/vX.Y branch exists on origin', () => {
  const result = runResolver({
    eventName: 'push',
    refName: 'dev/v1.6',
    lsRemoteOutput: ['aaaaaaa\trefs/heads/dev/v1.6', 'bbbbbbb\trefs/heads/dev/v1.7'].join('\n'),
  });

  expect(result.status).toBe(0);
  expect(result.output.name).toBe('dev/v1.6');
});

test('a push to dev/v1.7 targets dev/v1.7 directly', () => {
  const result = runResolver({
    eventName: 'push',
    refName: 'dev/v1.7',
    lsRemoteOutput: 'aaaaaaa\trefs/heads/dev/v1.6\n',
  });

  expect(result.status).toBe(0);
  expect(result.output.name).toBe('dev/v1.7');
});

test('a run with no branch context (schedule) still resolves highest-wins with the default-branch fallback', () => {
  const result = runResolver({
    eventName: 'schedule',
    lsRemoteOutput: 'deadbeef\trefs/heads/main\ncafef00d\trefs/heads/feature/something\n',
    defaultBranch: 'main',
  });

  expect(result.status).toBe(0);
  expect(result.output.name).toBe('main');
});
