import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorkflow } from './workflow-test-utils';

// This test extracts and EXECUTES the real `run:` block of the "Resolve
// release source and validate GA candidate" step (id: source) so the
// soak_override_reason behavior can't drift from what actually ships.
const workflowPath = fileURLToPath(new URL('../workflows/release-cut.yml', import.meta.url));

const CANDIDATE_TAG = 'v1.6.0-rc.13';
const RELEASE_TAG = 'v1.6.0';
const CANDIDATE_DIGEST = `sha256:${'0'.repeat(64)}`;
const SEVEN_DAYS = 604800;
const THREE_DAYS = 3 * 86400;

// Stub 'gh' for the step under test. Only implements the one subcommand it
// calls: `release view <tag> --repo ... --json isPrerelease,publishedAt,tagName`.
const stubGhScript = `#!/usr/bin/env bash
if [ "\${1:-}" = "release" ] && [ "\${2:-}" = "view" ]; then
  printf '%s' "\${FAKE_GH_RELEASE_JSON:?FAKE_GH_RELEASE_JSON not set}"
  exit 0
fi
echo "stub gh: unsupported invocation: $*" >&2
exit 127
`;

// Stub 'date' for deterministic epoch math. The real script only ever calls
// `date -u -d "<published_at>" +%s` and `date -u +%s`; special-casing exactly
// those two invocations (rather than parsing arbitrary date strings) also
// sidesteps GNU-vs-BSD `date -d` incompatibility on developer machines.
const stubDateScript = `#!/usr/bin/env bash
if [ "\${1:-}" = "-u" ] && [ "\${2:-}" = "-d" ]; then
  printf '%s\\n' "\${FAKE_PUBLISHED_EPOCH:?FAKE_PUBLISHED_EPOCH not set}"
  exit 0
fi
if [ "\${1:-}" = "-u" ] && [ "\${2:-}" = "+%s" ]; then
  printf '%s\\n' "\${FAKE_NOW_EPOCH:?FAKE_NOW_EPOCH not set}"
  exit 0
fi
echo "stub date: unsupported invocation: $*" >&2
exit 127
`;

function loadSourceStepRunBlock(): string {
  const workflow = loadWorkflow(workflowPath);
  const step = workflow.jobs?.release?.steps?.find((candidate) => candidate.id === 'source');

  if (!step?.run) {
    throw new Error(
      "Expected release-cut.yml's release job to include a step with id 'source' and a run block",
    );
  }

  return step.run;
}

interface SourceResult {
  status: number;
  stdout: string;
  stderr: string;
  output: Record<string, string>;
  summary: string;
  reasonFileContent: string | undefined;
}

function runSourceStep(options: {
  isPrerelease: boolean;
  ageSeconds: number;
  soakOverrideReason?: string;
  candidateTag?: string;
  candidateDigest?: string;
  createCandidateTag?: boolean;
}): SourceResult {
  const workdir = mkdtempSync(join(tmpdir(), 'release-cut-soak-override-'));
  try {
    // A real git repo so `git rev-parse --verify refs/tags/...^{commit}`
    // behaves exactly as it does against the real checkout.
    const run = (cmd: string, args: string[]) =>
      execFileSync(cmd, args, { cwd: workdir, encoding: 'utf8' });
    run('git', ['init', '--quiet']);
    run('git', ['config', 'user.email', 'test@example.com']);
    run('git', ['config', 'user.name', 'Test']);
    writeFileSync(join(workdir, 'README.md'), 'placeholder\n');
    run('git', ['add', 'README.md']);
    run('git', ['commit', '--quiet', '-m', 'init']);

    const candidateTag = options.candidateTag ?? CANDIDATE_TAG;
    if (options.createCandidateTag !== false) {
      run('git', ['tag', candidateTag]);
    }

    const stubDir = join(workdir, 'bin');
    mkdirSync(stubDir);
    writeFileSync(join(stubDir, 'gh'), stubGhScript, { mode: 0o755 });
    chmodSync(join(stubDir, 'gh'), 0o755);
    writeFileSync(join(stubDir, 'date'), stubDateScript, { mode: 0o755 });
    chmodSync(join(stubDir, 'date'), 0o755);

    const scriptPath = join(workdir, 'source-step.sh');
    writeFileSync(scriptPath, loadSourceStepRunBlock());

    const outputPath = join(workdir, 'github_output');
    writeFileSync(outputPath, '');
    const summaryPath = join(workdir, 'github_step_summary');
    writeFileSync(summaryPath, '');
    const runnerTemp = join(workdir, 'runner_temp');
    mkdirSync(runnerTemp);

    const nowEpoch = 2_000_000_000;
    const publishedEpoch = nowEpoch - options.ageSeconds;

    const env: NodeJS.ProcessEnv = {
      PATH: `${stubDir}:${process.env.PATH ?? ''}`,
      CANDIDATE_DIGEST: options.candidateDigest ?? CANDIDATE_DIGEST,
      CANDIDATE_TAG: candidateTag,
      GH_TOKEN: 'test-token',
      GITHUB_REPOSITORY: 'CodesWhat/drydock',
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      IS_PRERELEASE: options.isPrerelease ? 'true' : 'false',
      RELEASE_TAG,
      RUNNER_TEMP: runnerTemp,
      SOAK_OVERRIDE_REASON: options.soakOverrideReason ?? '',
      TARGET_SHA: '0'.repeat(40),
      FAKE_GH_RELEASE_JSON: JSON.stringify({
        isPrerelease: true,
        publishedAt: '2020-01-01T00:00:00Z',
        tagName: candidateTag,
      }),
      FAKE_NOW_EPOCH: String(nowEpoch),
      FAKE_PUBLISHED_EPOCH: String(publishedEpoch),
    };

    let status = 0;
    let stdout = '';
    let stderr = '';
    try {
      stdout = execFileSync('bash', [scriptPath], { cwd: workdir, env, encoding: 'utf8' });
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

    const summary = readFileSync(summaryPath, 'utf8');
    // Read the reason file (if the step wrote one) before the workdir under
    // `finally` gets torn down, so callers can assert on it after return.
    const reasonFileContent = output.soak_override_reason_path
      ? readFileSync(output.soak_override_reason_path, 'utf8')
      : undefined;

    return { status, stdout, stderr, output, summary, reasonFileContent };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

test('a blank soak_override_reason still hard-fails with the unchanged error message', () => {
  const result = runSourceStep({
    isPrerelease: false,
    ageSeconds: THREE_DAYS,
    soakOverrideReason: '',
  });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain(
    `::error::Candidate ${CANDIDATE_TAG} is only ${THREE_DAYS}s old; GA promotion requires seven full days (${SEVEN_DAYS}s).`,
  );
  expect(result.output.soak_override_used).toBeUndefined();
});

test('a whitespace-only soak_override_reason does not open the gate', () => {
  const result = runSourceStep({
    isPrerelease: false,
    ageSeconds: THREE_DAYS,
    soakOverrideReason: '   \t  ',
  });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('GA promotion requires seven full days');
  expect(result.stdout).not.toContain('must be at least 20 characters');
});

test('a too-short soak_override_reason hard-fails with a clear error', () => {
  const result = runSourceStep({
    isPrerelease: false,
    ageSeconds: THREE_DAYS,
    soakOverrideReason: 'x',
  });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('soak_override_reason must be at least 20 characters');
});

test('a real soak_override_reason bypasses the age gate with an auditable warning and summary', () => {
  const reason = 'rc.13 fleet soak passed on 2026-08-09; owner approved early GA ship.';
  const ageSeconds = THREE_DAYS + 3600;
  const result = runSourceStep({ isPrerelease: false, ageSeconds, soakOverrideReason: reason });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('::warning::');
  expect(result.stdout).toContain(CANDIDATE_TAG);
  expect(result.stdout).toContain(`${ageSeconds}s`);
  expect(result.stdout).toContain(reason);

  expect(result.output.soak_override_used).toBe('true');
  expect(result.output.soak_override_age_seconds).toBe(String(ageSeconds));
  expect(result.output.soak_override_reason_path).toBeTruthy();
  expect(result.reasonFileContent).toBe(reason);

  expect(result.summary).toContain('Seven-day soak overridden');
  expect(result.summary).toContain(CANDIDATE_TAG);
  expect(result.summary).toContain(reason);
});

test('a candidate that already cleared seven days needs no reason at all', () => {
  const result = runSourceStep({
    isPrerelease: false,
    ageSeconds: SEVEN_DAYS + 3600,
    soakOverrideReason: '',
  });

  expect(result.status).toBe(0);
  expect(result.output.soak_override_used).toBe('false');
  expect(result.summary).not.toContain('Seven-day soak overridden');
});

test('soak_override_reason is rejected outright for a prerelease cut, matching candidate_tag/candidate_digest', () => {
  const result = runSourceStep({
    isPrerelease: true,
    ageSeconds: 0,
    soakOverrideReason: 'this justification is long enough to pass the length gate',
    candidateTag: '',
    candidateDigest: '',
    createCandidateTag: false,
  });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('::error::soak_override_reason is a GA-only input');
});
