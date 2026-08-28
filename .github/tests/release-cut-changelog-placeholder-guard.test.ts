import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorkflow } from './workflow-test-utils';

// This test extracts and EXECUTES the real `run:` block of the "Validate
// CHANGELOG entry for release tag" step so the placeholder guard can't drift
// from what actually ships. It's a sibling of
// release-cut-changelog-conflict-markers.test.ts, which covers the same
// run: block's merge-conflict-marker grep. Kept as a separate file — with a
// deliberate near-duplicate of that file's step-loading helper below, rather
// than a shared one — because the two greps guard unrelated defect classes,
// and that file's own name and top comment are scoped specifically to
// conflict markers; folding this in would make its scope misleading.
//
// Incident: PR #906 shipped the literal string `(PR_LINK_PLACEHOLDER)` in a
// CHANGELOG bullet where a real `([#906](.../pull/906))` citation belonged —
// someone wrote the placeholder intending to fill in the PR number once it
// existed, and never did. It read as an ordinary citation to the pre-push
// gate, to CI, and to two human reviewers. The guard under test greps
// CHANGELOG_PATH for an ALL-CAPS `_PLACEHOLDER` token (or the bare ALL-CAPS
// word) and for an empty markdown link target (`[text]()`) before letting a
// cut proceed.
const workflowPath = fileURLToPath(new URL('../workflows/release-cut.yml', import.meta.url));
const extractScriptPath = fileURLToPath(
  new URL('../../scripts/extract-changelog-entry.mjs', import.meta.url),
);

const RELEASE_TAG = 'v1.7.0-rc.4';

function loadValidateStepRunBlock(): string {
  const workflow = loadWorkflow(workflowPath);
  const step = workflow.jobs?.release?.steps?.find(
    (candidate) => candidate.name === 'Validate CHANGELOG entry for release tag',
  );

  if (!step?.run) {
    throw new Error(
      "Expected release-cut.yml's release job to include a step named " +
        "'Validate CHANGELOG entry for release tag' with a run block",
    );
  }

  return step.run;
}

interface ValidateResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runValidateStep(changelogContent: string): ValidateResult {
  const workdir = mkdtempSync(join(tmpdir(), 'release-cut-changelog-placeholder-guard-'));
  try {
    const changelogPath = join(workdir, 'target-sha-changelog.md');
    writeFileSync(changelogPath, changelogContent);

    const scriptPath = join(workdir, 'validate-step.sh');
    writeFileSync(scriptPath, loadValidateStepRunBlock());

    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '',
      CHANGELOG_PATH: changelogPath,
      EXTRACT_SCRIPT: extractScriptPath,
      RELEASE_TAG,
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

    return { status, stdout, stderr };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

// A CHANGELOG shaped like the repo's real house style: bold lead, prose, and
// a filled-in `([#NNN](.../pull/NNN))` citation at the end of every bullet.
// Exercises both guarded patterns' negative case at once — a real citation
// is neither an ALL-CAPS `_PLACEHOLDER` token nor an empty link target.
const cleanChangelog = `# Changelog

## [1.7.0-rc.4] - 2026-08-20

### Fixed

- **First fix.** Description of the first bug fix in this release. ([#901](https://github.com/CodesWhat/drydock/pull/901))
- **Second fix.** Description of the second bug fix in this release. ([#902](https://github.com/CodesWhat/drydock/pull/902))

## [1.7.0-rc.3] - 2026-08-13

### Fixed

- **Older fix.** Description of an older bug fix. ([#899](https://github.com/CodesWhat/drydock/pull/899))
`;

test('a clean CHANGELOG with real citations passes with exit 0', () => {
  const result = runValidateStep(cleanChangelog);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`Validated CHANGELOG entry for ${RELEASE_TAG}.`);
});

test('the PR #906 shape — an unfilled PR_LINK_PLACEHOLDER token — fails the step and names it', () => {
  const changelog = `# Changelog

## [1.7.0-rc.4] - 2026-08-20

### Fixed

- **First fix.** Description of the first bug fix in this release. ([#901](https://github.com/CodesWhat/drydock/pull/901))
- **Second fix.** Description of the second bug fix in this release. (PR_LINK_PLACEHOLDER)
`;

  const result = runValidateStep(changelog);

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('::error::CHANGELOG contains an unfilled placeholder');
  // grep -n prints the offending line (with its line number) before the step
  // emits the ::error:: line, so the placeholder itself is visible in the log.
  expect(result.stdout).toContain('(PR_LINK_PLACEHOLDER)');
});

test('a bare ALL-CAPS PLACEHOLDER token also fails the step', () => {
  const changelog = `# Changelog

## [1.7.0-rc.4] - 2026-08-20

### Fixed

- **First fix.** Description of the first bug fix in this release. PLACEHOLDER
`;

  const result = runValidateStep(changelog);

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('::error::CHANGELOG contains an unfilled placeholder');
});

test('an empty markdown link target fails the step and names it', () => {
  const changelog = `# Changelog

## [1.7.0-rc.4] - 2026-08-20

### Fixed

- **First fix.** Description of the first bug fix in this release. ([#901]())
`;

  const result = runValidateStep(changelog);

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('::error::CHANGELOG contains an unfilled placeholder');
  expect(result.stdout).toContain('([#901]())');
});

test('an empty angle-bracket link target fails the step too', () => {
  // `[text](<>)` is the angle-bracket destination form and is equally valid
  // CommonMark, rendering exactly like `[text]()`. A guard that only knew the
  // bare form would let an unfilled citation through in the one shape nobody
  // writes on purpose.
  const changelog = `# Changelog

## [1.7.0-rc.4] - 2026-08-20

### Fixed

- **First fix.** Description of the first bug fix in this release. ([#901](<>))
`;

  const result = runValidateStep(changelog);

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('::error::CHANGELOG contains an unfilled placeholder');
  expect(result.stdout).toContain('([#901](<>))');
});

test('lowercase "placeholder" used correctly in prose does not fail', () => {
  // This repo uses the word legitimately and often — e.g. "served a
  // placeholder ... SVG at HTTP 200 instead of erroring". Only an ALL-CAPS
  // `_PLACEHOLDER` token (or the bare ALL-CAPS word) is a defect; the guard
  // must not fire on ordinary lowercase usage.
  const changelog = `# Changelog

## [1.7.0-rc.4] - 2026-08-20

### Fixed

- **A route served a placeholder image at HTTP 200 instead of erroring.** Fixed. ([#901](https://github.com/CodesWhat/drydock/pull/901))
`;

  const result = runValidateStep(changelog);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`Validated CHANGELOG entry for ${RELEASE_TAG}.`);
});

test('a generic ALL-CAPS example token that is not a _PLACEHOLDER shape does not fail', () => {
  // content/docs uses tokens like `YOUR_QUAY_ROBOT_TOKEN` as deliberate
  // fill-in-the-blank example values. The guard only matches a token ending
  // in the literal word PLACEHOLDER, so this convention is unaffected.
  const changelog = `# Changelog

## [1.7.0-rc.4] - 2026-08-20

### Fixed

- **Docs now show YOUR_QUAY_ROBOT_TOKEN as the example value.** Fixed. ([#901](https://github.com/CodesWhat/drydock/pull/901))
`;

  const result = runValidateStep(changelog);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`Validated CHANGELOG entry for ${RELEASE_TAG}.`);
});
