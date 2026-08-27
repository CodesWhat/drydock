import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorkflow } from './workflow-test-utils';

// This test extracts and EXECUTES the real `run:` block of the "Validate
// CHANGELOG entry for release tag" step so the merge-conflict-marker guard
// can't drift from what actually ships.
//
// Incident: v1.7.0-rc.4 shipped with two literal `||||||| parent of ...`
// lines in its CHANGELOG entry. A hand-resolved merge conflict left the
// diff3 middle marker behind, and because it read as ordinary prose, it
// passed the pre-push gate, CI, and human review undetected. The guard
// under test greps CHANGELOG_PATH for `<<<<<<<`, `|||||||`, and `>>>>>>>`
// line-start markers before letting a cut proceed.
const workflowPath = fileURLToPath(new URL('../workflows/release-cut.yml', import.meta.url));
const extractScriptPath = fileURLToPath(
  new URL('../../scripts/extract-changelog-entry.mjs', import.meta.url),
);

const RELEASE_TAG = 'v1.7.0-rc.4';

// Fixture markers are built with repeat() rather than written out, so this
// file never contains a line-initial marker of its own. Writing them literally
// makes scripts/conflict-markers.test.mjs flag this very file — which it did,
// on the first run after that guard started scanning.
const OURS_MARKER = '<'.repeat(7);
const MIDDLE_MARKER = '|'.repeat(7);
const THEIRS_MARKER = '>'.repeat(7);

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
  const workdir = mkdtempSync(join(tmpdir(), 'release-cut-changelog-conflict-markers-'));
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

// The real rc.4 shape: a diff3 middle marker sitting between two ordinary
// `- **Bold thing.** text` bullets inside the version's `### Fixed` section,
// so it reads as prose rather than as a leftover conflict marker.
const cleanChangelog = `# Changelog

## [1.7.0-rc.4] - 2026-08-20

### Fixed

- **First fix.** Description of the first bug fix in this release.
- **Second fix.** Description of the second bug fix in this release.

## [1.7.0-rc.3] - 2026-08-13

### Fixed

- **Older fix.** Description of an older bug fix.
`;

const conflictMiddleMarkerChangelog = `# Changelog

## [1.7.0-rc.4] - 2026-08-20

### Fixed

- **First fix.** Description of the first bug fix in this release.
${MIDDLE_MARKER} parent of a1b2c3d4e5f6 (fix: earlier resolution of the same bug)
- **Second fix.** Description of the second bug fix in this release.

## [1.7.0-rc.3] - 2026-08-13

### Fixed

- **Older fix.** Description of an older bug fix.
`;

test('a CHANGELOG with a diff3 middle marker fails the step and names the marker', () => {
  const result = runValidateStep(conflictMiddleMarkerChangelog);

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain(
    `::error::CHANGELOG contains merge conflict markers (listed above). Resolve them before cutting ${RELEASE_TAG}.`,
  );
  // grep -n prints the offending line (with its line number) before the step
  // emits the ::error:: line, so the marker itself is visible in the log.
  expect(result.stdout).toContain(`${MIDDLE_MARKER} parent of a1b2c3d4e5f6`);
});

test('a clean CHANGELOG passes with exit 0', () => {
  // The important negative case: `grep` exits 1 when it finds nothing, and
  // this step runs under `set -euo pipefail`, so a naive `if grep ...; then`
  // guard with the wrong polarity — or a bare `grep ...` outside an `if` —
  // would abort the step on every clean file. Prove it doesn't.
  const result = runValidateStep(cleanChangelog);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`Validated CHANGELOG entry for ${RELEASE_TAG}.`);
});

test.each([
  ['ours', `${OURS_MARKER} HEAD`],
  ['theirs', `${THEIRS_MARKER} feature-branch`],
])('a CHANGELOG with a %s marker also fails the step', (_label, markerLine) => {
  const changelog = `# Changelog

## [1.7.0-rc.4] - 2026-08-20

### Fixed

- **First fix.** Description of the first bug fix in this release.
${markerLine}
- **Second fix.** Description of the second bug fix in this release.
`;

  const result = runValidateStep(changelog);

  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('CHANGELOG contains merge conflict markers');
  expect(result.stdout).toContain(markerLine);
});

test('a line that merely starts with ======= does not fail', () => {
  // ======= alone is a Markdown setext H1 underline, not a diff3 marker on
  // its own (diff3 always pairs it with a preceding ||||||| or a following
  // <<<<<<</>>>>>>>). The guard deliberately omits it from its pattern so
  // legitimate prose isn't flagged; this pins that omission as intentional.
  const changelog = `# Changelog

## [1.7.0-rc.4] - 2026-08-20

### Fixed

Some Heading
=======

- **First fix.** Description of the first bug fix in this release.
`;

  const result = runValidateStep(changelog);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`Validated CHANGELOG entry for ${RELEASE_TAG}.`);
});
