import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorkflow, type WorkflowStep } from './workflow-test-utils';

// This test extracts and EXECUTES the real `run:` block of the "Validate
// maintenance source_ref input" step (id: source_ref) so the guard behavior
// can't drift from what actually ships — same pattern already used for the
// GA soak-override gate and the Crowdin branch resolver.
const workflowPath = fileURLToPath(new URL('../workflows/release-cut.yml', import.meta.url));

function releaseSteps(): WorkflowStep[] {
  return loadWorkflow(workflowPath).jobs?.release?.steps ?? [];
}

function getStep(name: string): WorkflowStep | undefined {
  return releaseSteps().find((step) => step.name === name);
}

function getStepById(id: string): WorkflowStep | undefined {
  return releaseSteps().find((step) => step.id === id);
}

function loadGuardRunBlock(): string {
  const step = getStepById('source_ref');
  if (!step?.run) {
    throw new Error(
      "Expected release-cut.yml's release job to include a step with id 'source_ref' and a run block",
    );
  }
  return step.run;
}

// Stub 'git' for the guard script under test. Only implements the one
// subcommand it calls: 'ls-remote --heads origin <pattern>'.
const stubGitScript = `#!/usr/bin/env bash
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

const DEV_BRANCHES = [
  'aaaaaaa\trefs/heads/dev/v1.5',
  'bbbbbbb\trefs/heads/dev/v1.6',
  'ccccccc\trefs/heads/dev/v1.7',
  'ddddddd\trefs/heads/not-a-dev-branch',
].join('\n');

interface GuardResult {
  status: number;
  stdout: string;
  output: Record<string, string>;
}

function runGuard(options: {
  releaseTag: string;
  sourceRef: string;
  lsRemoteOutput?: string;
}): GuardResult {
  const workdir = mkdtempSync(join(tmpdir(), 'release-cut-source-ref-'));
  try {
    const stubDir = join(workdir, 'bin');
    mkdirSync(stubDir);
    writeFileSync(join(stubDir, 'git'), stubGitScript, { mode: 0o755 });
    chmodSync(join(stubDir, 'git'), 0o755);

    const scriptPath = join(workdir, 'guard.sh');
    writeFileSync(scriptPath, loadGuardRunBlock());

    const outputPath = join(workdir, 'github_output');
    writeFileSync(outputPath, '');

    const env: NodeJS.ProcessEnv = {
      PATH: `${stubDir}:${process.env.PATH ?? ''}`,
      RELEASE_TAG: options.releaseTag,
      SOURCE_REF: options.sourceRef,
      GITHUB_OUTPUT: outputPath,
      FAKE_GIT_LS_REMOTE_OUTPUT: options.lsRemoteOutput ?? DEV_BRANCHES,
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

    const output: Record<string, string> = {};
    for (const line of readFileSync(outputPath, 'utf8').split('\n')) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      output[line.slice(0, eq)] = line.slice(eq + 1);
    }

    return { status, stdout, output };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

test('empty source_ref is a clean no-op: normal cut from main', () => {
  const result = runGuard({ releaseTag: 'v1.7.0', sourceRef: '' });

  expect(result.status).toBe(0);
  expect(result.output.is_maintenance_cut).toBe('false');
  expect(result.output.source_branch).toBe('');
});

test('rejects a source_ref that is not in dev/vX.Y form', () => {
  for (const badRef of ['feature/foo', 'dev/v1', 'v1.6', 'dev/1.6', 'dev/v1.6.0', 'main']) {
    const result = runGuard({ releaseTag: 'v1.6.1', sourceRef: badRef });

    expect(result.status, `expected '${badRef}' to be rejected`).not.toBe(0);
    expect(result.stdout).toContain(
      `source_ref '${badRef}' is not in the required 'dev/vX.Y' form`,
    );
  }
});

test("rejects when the tag's line does not match source_ref's line", () => {
  const result = runGuard({ releaseTag: 'v1.7.0', sourceRef: 'dev/v1.6' });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain(
    "release_tag 'v1.7.0' is on line 1.7, but source_ref 'dev/v1.6' is line 1.6",
  );
});

test('rejects a source_ref that does not exist on origin', () => {
  const result = runGuard({ releaseTag: 'v1.4.1', sourceRef: 'dev/v1.4' });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain("source_ref 'dev/v1.4' does not exist as a branch on origin");
});

test('rejects source_ref naming the active (highest) dev line', () => {
  const result = runGuard({ releaseTag: 'v1.7.1', sourceRef: 'dev/v1.7' });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('dev/v1.7 is still the active line');
  expect(result.stdout).toContain('leave source_ref empty and cut from main');
});

test('rejects a patch-zero release_tag even when the line and branch are otherwise valid', () => {
  const result = runGuard({ releaseTag: 'v1.6.0', sourceRef: 'dev/v1.6' });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain("release_tag 'v1.6.0' has patch version 0");
});

test('rejects a patch-zero prerelease release_tag the same way', () => {
  const result = runGuard({ releaseTag: 'v1.6.0-rc.1', sourceRef: 'dev/v1.6' });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('has patch version 0');
});

test('accepts a valid maintenance GA cut', () => {
  const result = runGuard({ releaseTag: 'v1.6.1', sourceRef: 'dev/v1.6' });

  expect(result.status).toBe(0);
  expect(result.output.is_maintenance_cut).toBe('true');
  expect(result.output.source_branch).toBe('dev/v1.6');
});

test('accepts a valid maintenance prerelease cut', () => {
  const result = runGuard({ releaseTag: 'v1.6.1-rc.1', sourceRef: 'dev/v1.6' });

  expect(result.status).toBe(0);
  expect(result.output.is_maintenance_cut).toBe('true');
  expect(result.output.source_branch).toBe('dev/v1.6');
});

test('an unanswerable remote query fails the guard instead of silently passing', () => {
  const result = runGuard({
    releaseTag: 'v1.6.1',
    sourceRef: 'dev/v1.6',
    lsRemoteOutput: '',
  });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain(
    'Could not list any dev/vX.Y branch on origin to validate source_ref',
  );
});

test('release-cut skips the main-sync drift guard exactly when the maintenance cut is validated', () => {
  const syncStep = getStep('Assert main is in sync with the active dev branch');
  expect(syncStep?.if).toBe("steps.source_ref.outputs.is_maintenance_cut != 'true'");
});

test('release-cut resolves target SHA from the maintenance branch tip when set', () => {
  const targetStep = getStep('Resolve target SHA and lowercase repository');

  expect(targetStep?.env).toMatchObject({
    IS_MAINTENANCE_CUT: '${{ steps.source_ref.outputs.is_maintenance_cut }}',
    SOURCE_BRANCH: '${{ steps.source_ref.outputs.source_branch }}',
  });
  expect(targetStep?.run).toContain('git fetch --quiet origin "${SOURCE_BRANCH}"');
  expect(targetStep?.run).toContain('sha="$(git rev-parse "origin/${SOURCE_BRANCH}")"');
  expect(targetStep?.run).toContain('sha="$(git rev-parse HEAD)"');
});

test('release-cut threads the maintenance flag into both CI-wait steps', () => {
  const ciWaitStep = getStep('Wait for successful branch CI on release source SHA');
  const e2eWaitStep = getStep('Wait for successful E2E Playwright on release source SHA');

  for (const step of [ciWaitStep, e2eWaitStep]) {
    expect(step?.with).toMatchObject({
      'allow-dispatch-events': '${{ steps.source_ref.outputs.is_maintenance_cut }}',
    });
  }
});

test('source_ref input defaults empty and documents the maintenance-only scope', () => {
  const workflow = loadWorkflow(workflowPath) as unknown as {
    on?: {
      workflow_dispatch?: { inputs?: Record<string, { default?: string; description?: string }> };
    };
  };
  const input = workflow.on?.workflow_dispatch?.inputs?.source_ref;

  expect(input?.default).toBe('');
  expect(input?.description).toContain('Maintenance cuts only');
  expect(input?.description).toContain('dev/v1.6');
});
