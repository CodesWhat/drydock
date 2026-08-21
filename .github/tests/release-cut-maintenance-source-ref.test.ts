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

// The real active line, per main's own package.json — the authoritative
// source the guard now uses. Matches DEV_BRANCHES' "highest name" (dev/v1.7)
// by default so existing branch-name-based expectations still line up; tests
// that need to prove the fix (P1-4) deliberately make these two disagree.
const DEFAULT_MAIN_VERSION = '1.7.0';

interface GuardResult {
  status: number;
  stdout: string;
  output: Record<string, string>;
}

function runGuard(options: {
  releaseTag: string;
  sourceRef: string;
  lsRemoteOutput?: string;
  lsRemoteExit?: number;
  mainVersion?: string | null;
}): GuardResult {
  const workdir = mkdtempSync(join(tmpdir(), 'release-cut-source-ref-'));
  try {
    const stubDir = join(workdir, 'bin');
    mkdirSync(stubDir);
    writeFileSync(join(stubDir, 'git'), stubGitScript, { mode: 0o755 });
    chmodSync(join(stubDir, 'git'), 0o755);

    // The guard reads package.json (relative path) to derive main's active
    // line, so the script runs with workdir as cwd and a controlled file.
    if (options.mainVersion !== null) {
      writeFileSync(
        join(workdir, 'package.json'),
        JSON.stringify({ version: options.mainVersion ?? DEFAULT_MAIN_VERSION }),
      );
    }

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
    if (options.lsRemoteExit !== undefined) {
      env.FAKE_GIT_LS_REMOTE_EXIT = String(options.lsRemoteExit);
    }

    let status = 0;
    let stdout = '';
    try {
      stdout = execFileSync('bash', [scriptPath], { cwd: workdir, env, encoding: 'utf8' });
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

test("rejects source_ref matching main's active line (package.json-derived)", () => {
  const result = runGuard({
    releaseTag: 'v1.7.1',
    sourceRef: 'dev/v1.7',
    mainVersion: '1.7.0',
  });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain(
    "dev/v1.7 matches main's active line (package.json version 1.7.0)",
  );
  expect(result.stdout).toContain('leave source_ref empty and cut from main');
});

// P1-4 regression: the active line must come from main's package.json, not
// from "the highest dev/vX.Y branch name on origin" — that namespace is
// writable by anyone with push access. A decoy dev/v999.0 branch must not let
// the true active line (dev/v1.7, per package.json) slip past as "not
// highest" and skip the drift guard.
test('a decoy highest-numbered branch cannot mask the true active line', () => {
  const branchesWithDecoy = [DEV_BRANCHES, 'eeeeeee\trefs/heads/dev/v999.0'].join('\n');

  const result = runGuard({
    releaseTag: 'v1.7.1',
    sourceRef: 'dev/v1.7',
    lsRemoteOutput: branchesWithDecoy,
    mainVersion: '1.7.0',
  });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain("dev/v1.7 matches main's active line");
});

// The same decoy must not block a GENUINELY inactive line either — the
// package.json check should only reject an exact line match, not merely "a
// higher-numbered decoy branch exists somewhere".
test('a decoy branch does not block a legitimate maintenance cut on an inactive line', () => {
  const branchesWithDecoy = [DEV_BRANCHES, 'eeeeeee\trefs/heads/dev/v999.0'].join('\n');

  const result = runGuard({
    releaseTag: 'v1.6.1',
    sourceRef: 'dev/v1.6',
    lsRemoteOutput: branchesWithDecoy,
    mainVersion: '1.7.0',
  });

  expect(result.status).toBe(0);
  expect(result.output.is_maintenance_cut).toBe('true');
});

test('fails closed when package.json on main has no readable version', () => {
  const result = runGuard({
    releaseTag: 'v1.6.1',
    sourceRef: 'dev/v1.6',
    // package.json exists (valid JSON) but carries no .version — the
    // realistic broken-checkout shape; jq itself would abort the script
    // before this branch on a genuinely missing file, which is covered by
    // the ambient shell's own exit-nonzero behavior, not this message.
    mainVersion: '',
  });

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain(
    'Could not read .version from package.json on main to determine the active line',
  );
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

test('an unanswerable remote query (empty but successful) fails the guard instead of silently passing', () => {
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

// P3-6: a previously failing command must fail closed, not just an empty
// (but successful) result — this exercises the real `git ls-remote` exit
// code, not a stand-in for it.
test('a genuinely failing ls-remote propagates and fails closed', () => {
  const result = runGuard({
    releaseTag: 'v1.6.1',
    sourceRef: 'dev/v1.6',
    lsRemoteExit: 128,
  });

  expect(result.status).not.toBe(0);
  expect(result.output.is_maintenance_cut).toBeUndefined();
});

test('release-cut skips the main-sync drift guard exactly when the maintenance cut is validated', () => {
  const syncStep = getStep('Assert main is in sync with the active dev branch');
  expect(syncStep?.if).toBe("steps.source_ref.outputs.is_maintenance_cut != 'true'");
});

test('release-cut resolves target SHA from the maintenance branch tip when set, via an unambiguous fully-qualified ref', () => {
  const targetStep = getStep('Resolve target SHA and lowercase repository');

  expect(targetStep?.env).toMatchObject({
    IS_MAINTENANCE_CUT: '${{ steps.source_ref.outputs.is_maintenance_cut }}',
    SOURCE_BRANCH: '${{ steps.source_ref.outputs.source_branch }}',
  });
  // P1-3: fetch into an explicit remote-tracking ref and resolve that exact
  // fully-qualified path — never the "origin/${SOURCE_BRANCH}" shorthand,
  // which a colliding tag can outrank per gitrevisions' disambiguation order.
  expect(targetStep?.run).toContain(
    'git fetch --quiet origin "refs/heads/${SOURCE_BRANCH}:refs/remotes/origin/${SOURCE_BRANCH}"',
  );
  expect(targetStep?.run).toContain(
    'sha="$(git rev-parse --verify --end-of-options "refs/remotes/origin/${SOURCE_BRANCH}^{commit}")"',
  );
  expect(targetStep?.run).not.toContain('git rev-parse "origin/${SOURCE_BRANCH}"');
  expect(targetStep?.run).toContain('sha="$(git rev-parse HEAD)"');
});

test('release-cut threads the maintenance flag into both CI-wait steps, positioned before the detached checkout', () => {
  const steps = releaseSteps();
  const indexOf = (name: string) => steps.findIndex((step) => step.name === name);

  const ciWaitStep = getStep('Wait for successful branch CI on release source SHA');
  const e2eWaitStep = getStep('Wait for successful E2E Playwright on release source SHA');

  for (const step of [ciWaitStep, e2eWaitStep]) {
    expect(step?.with).toMatchObject({
      'allow-dispatch-events': '${{ steps.source_ref.outputs.is_maintenance_cut }}',
    });
  }

  // P1-2: `uses: ./.github/actions/...` resolves from whatever is on disk in
  // the runner workspace. Both waits must run BEFORE "Checkout exact release
  // source" (a literal `git checkout --detach`), or a maintenance cut would
  // resolve the composite action from the old copy on the maintenance
  // branch — one that predates allow-dispatch-events entirely — and the wait
  // would filter push-only forever.
  const checkoutIndex = indexOf('Checkout exact release source');
  expect(checkoutIndex).toBeGreaterThanOrEqual(0);
  expect(indexOf('Wait for successful branch CI on release source SHA')).toBeLessThan(
    checkoutIndex,
  );
  expect(indexOf('Wait for successful E2E Playwright on release source SHA')).toBeLessThan(
    checkoutIndex,
  );
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

// P1-1: provenance/attestation steps must never run for a maintenance cut —
// they would publish a false "built from main" claim (see the "Defect 3"
// comment in the workflow). Cosign signing steps are NOT gated the same way:
// they only assert identity, which stays true regardless of source_ref.
const provenanceOnlySteps = [
  'Attest container build provenance',
  'Verify container build provenance attestation',
  'Attest container SBOM',
  'Verify container SBOM attestation',
  'Attest release artifact provenance',
  'Export release provenance asset',
  'Verify release artifact provenance attestation',
  'Verify candidate artifact provenance attestation',
];

const cosignOnlySteps = [
  'Sign container images',
  'Verify container image signatures',
  'Sign release artifact',
  'Verify release artifact signature',
  'Verify candidate artifact signature',
];

test('every provenance attestation step is skipped for a maintenance cut', () => {
  for (const stepName of provenanceOnlySteps) {
    const step = getStep(stepName);
    expect(step, `expected step "${stepName}" to exist`).toBeDefined();
    expect(step?.if, `expected step "${stepName}" to gate on is_maintenance_cut`).toContain(
      "steps.source_ref.outputs.is_maintenance_cut != 'true'",
    );
  }
});

test('cosign signing/verification steps are never gated on maintenance-cut status', () => {
  for (const stepName of cosignOnlySteps) {
    const step = getStep(stepName);
    expect(step, `expected step "${stepName}" to exist`).toBeDefined();
    expect(step?.if ?? '').not.toContain('is_maintenance_cut');
  }
});

test('the release-notes and job-summary steps record the true maintenance source SHA', () => {
  const notesStep = getStep('Generate release notes from changelog');
  const summaryStep = getStep('Release summary');

  expect(notesStep?.env).toMatchObject({
    IS_MAINTENANCE_CUT: '${{ steps.source_ref.outputs.is_maintenance_cut }}',
    SOURCE_BRANCH: '${{ steps.source_ref.outputs.source_branch }}',
  });
  expect(notesStep?.run).toContain('maintenance cut, built from');
  expect(notesStep?.run).toContain('no SLSA build-provenance attestation');

  expect(summaryStep?.env).toMatchObject({
    IS_MAINTENANCE_CUT: '${{ steps.source_ref.outputs.is_maintenance_cut }}',
  });
  expect(summaryStep?.run).toContain('Maintenance cut: built from');
});

test('the GA promotion download/promote steps omit the intoto.jsonl asset for a maintenance cut', () => {
  const downloadStep = getStep('Download candidate release artifact for promotion');
  const promoteStep = getStep('Promote candidate artifact to GA release filenames');

  expect(downloadStep?.env).toMatchObject({
    IS_MAINTENANCE_CUT: '${{ steps.source_ref.outputs.is_maintenance_cut }}',
  });
  const downloadCommand = String(downloadStep?.with?.command ?? '');
  expect(downloadCommand).toContain('"drydock-${CANDIDATE_TAG}.tar.gz.intoto.jsonl"');
  expect(downloadCommand).toContain('if [ "${IS_MAINTENANCE_CUT}" != "true" ]; then');

  expect(promoteStep?.env).toMatchObject({
    IS_MAINTENANCE_CUT: '${{ steps.source_ref.outputs.is_maintenance_cut }}',
  });
  expect(promoteStep?.run).toContain('exts+=(tar.gz.intoto.jsonl)');
});

test('the release upload step omits the intoto.jsonl asset for a maintenance cut', () => {
  const uploadStep = getStep('Prepare draft GitHub Release and upload signed assets');

  expect(uploadStep?.env).toMatchObject({
    IS_MAINTENANCE_CUT: '${{ steps.source_ref.outputs.is_maintenance_cut }}',
  });
  const uploadCommand = String(uploadStep?.with?.command ?? '');
  expect(uploadCommand).toContain('"dist/drydock-${RELEASE_TAG}.tar.gz.intoto.jsonl"');
  expect(uploadCommand).toContain('if [ "${IS_MAINTENANCE_CUT}" != "true" ]; then');
});
