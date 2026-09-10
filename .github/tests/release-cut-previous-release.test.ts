import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorkflow } from './workflow-test-utils';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const workflowPath = join(repoRoot, '.github/workflows/release-cut.yml');

// Keep the selector in the real workflow: the boundary stub executes its
// --jq expression against fixture API data, rather than supplying a chosen tag.
const stubGh = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > "\${GH_ARGS_PATH}"
if [ "$1" != release ] || [ "$2" != list ]; then exit 97; fi
if [ "\${LOOKUP_FAIL}" = true ]; then exit 1; fi
fields=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = --json ]; then fields="$2"; shift; fi
  if [ "$1" = --jq ]; then
    jq --arg fields "$fields" \\
      'map(with_entries(select(.key as $key | $fields | split(",") | index($key))))' \\
      "\${RELEASES_PATH}" | jq -r "$2"
    exit 0
  fi
  shift
done
exit 98
`;

function release(
  tagName: string,
  createdAt: string,
  isDraft = false,
  publishedAt: string | null = isDraft ? null : createdAt,
) {
  return { tagName, createdAt, publishedAt, isDraft };
}

function runNotes(releaseTag: string, releases: ReturnType<typeof release>[], lookupFail = false) {
  const step = loadWorkflow(workflowPath).jobs?.release?.steps?.find(
    (candidate) => candidate.id === 'release_notes',
  );
  if (!step?.run) throw new Error('Missing release notes run block');
  const workdir = mkdtempSync(join(tmpdir(), 'release-cut-previous-release-'));
  try {
    mkdirSync(join(workdir, 'bin'));
    mkdirSync(join(workdir, 'dist'));
    writeFileSync(join(workdir, 'bin/gh'), stubGh, { mode: 0o755 });
    cpSync(join(repoRoot, 'scripts'), join(workdir, 'scripts'), { recursive: true });
    cpSync(join(repoRoot, 'UPGRADE-NOTES.md'), join(workdir, 'UPGRADE-NOTES.md'));
    const changelogPath = join(workdir, 'changelog.md');
    writeFileSync(
      changelogPath,
      `## [${releaseTag.slice(1)}] - 2026-09-09\n\n### Fixed\n\n- Preserved release entry.\n`,
    );
    const releasesPath = join(workdir, 'releases.json');
    writeFileSync(releasesPath, JSON.stringify(releases));
    const argsPath = join(workdir, 'gh-args');
    const outputPath = join(workdir, 'output');
    execFileSync('bash', ['-c', step.run], {
      cwd: workdir,
      encoding: 'utf8',
      env: {
        PATH: `${join(workdir, 'bin')}:${process.env.PATH ?? ''}`,
        RELEASE_TAG: releaseTag,
        REPO: 'CodesWhat/drydock',
        CHANGELOG_PATH: changelogPath,
        EXTRACT_SCRIPT: join(repoRoot, 'scripts/extract-changelog-entry.mjs'),
        IS_MAINTENANCE_CUT: 'false',
        SOAK_OVERRIDE_USED: 'false',
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: join(workdir, 'summary'),
        RELEASES_PATH: releasesPath,
        GH_ARGS_PATH: argsPath,
        LOOKUP_FAIL: String(lookupFail),
      },
    });
    const notesPath = join(workdir, 'dist', `release-notes-${releaseTag}.md`);
    expect(readFileSync(outputPath, 'utf8')).toBe(`path=dist/release-notes-${releaseTag}.md\n`);
    const args = readFileSync(argsPath, 'utf8').trim().split('\n');
    expect(args.slice(0, 6)).toEqual([
      'release',
      'list',
      '--repo',
      'CodesWhat/drydock',
      '--limit',
      '100',
    ]);
    expect(args[args.indexOf('--json') + 1].split(',')).toEqual([
      'tagName',
      'publishedAt',
      'isDraft',
    ]);
    const notes = readFileSync(notesPath, 'utf8');
    expect(notes).toContain('- Preserved release entry.');
    return notes;
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

test.each([
  ['v1.7.0-rc.14', 'v1.7.0-rc.13', 'v1.6.1-rc.12'],
  ['v1.6.1-rc.12', 'v1.6.1-rc.11', 'v1.7.0-rc.14'],
])(
  'compares %s with its own line despite a newer release on another line',
  (target, previous, other) => {
    const notes = runNotes(target, [
      release(other, '2026-09-08T23:16:33Z'),
      release(previous, '2026-09-07T18:55:42Z'),
    ]);
    expect(notes).toContain(
      `**Full Changelog**: https://github.com/CodesWhat/drydock/compare/${previous}...${target}`,
    );
    expect(notes).not.toContain(`${other}...`);
  },
);

test.each([
  ['v1.7.2-rc.1', 'v1.7.1'],
  ['v1.7.0', 'v1.7.0-rc.14'],
  ['v1.6.1', 'v1.6.1-rc.12'],
  ['v1.7.2', 'v1.7.1-rc.1'],
])(
  'keeps chronological same-line selection across patch/GA/RC transitions for %s',
  (target, previous) => {
    const notes = runNotes(target, [
      release(previous, '2026-09-08T00:00:00Z'),
      release(`${target}-older`, '2026-09-07T00:00:00Z'),
    ]);
    expect(notes).toContain(`/compare/${previous}...${target}`);
  },
);

test('excludes drafts and the current tag on a partial-release rerun', () => {
  const notes = runNotes('v1.7.0-rc.14', [
    release('v1.7.0-rc.15', '2026-09-10T00:00:00Z', true),
    release('v1.7.0-rc.14', '2026-09-09T00:00:00Z'),
    release('v1.7.0-rc.13', '2026-09-08T00:00:00Z'),
  ]);
  expect(notes).toContain('/compare/v1.7.0-rc.13...v1.7.0-rc.14');
});

test('selects the latest publication even when its draft was created earlier', () => {
  const notes = runNotes('v1.7.0-rc.15', [
    release('v1.7.0-rc.14', '2026-09-07T00:00:00Z', false, '2026-09-09T00:00:00Z'),
    release('v1.7.0-rc.13', '2026-09-08T00:00:00Z', false, '2026-09-08T00:00:00Z'),
    release('v1.7.0-rc.16', '2026-09-10T00:00:00Z', true, null),
  ]);
  expect(notes).toContain('/compare/v1.7.0-rc.14...v1.7.0-rc.15');
  expect(notes).not.toContain('/compare/v1.7.0-rc.13...');
  expect(notes).not.toContain('/compare/v1.7.0-rc.16...');
});

test('matches both major and minor exactly rather than a partial prefix', () => {
  const notes = runNotes('v1.7.0-rc.14', [
    release('v1.70.0', '2026-09-10T00:00:00Z'),
    release('v11.7.0', '2026-09-09T00:00:00Z'),
    release('v1.7.0-rc.13', '2026-09-08T00:00:00Z'),
  ]);
  expect(notes).toContain('/compare/v1.7.0-rc.13...v1.7.0-rc.14');
});

test.each([
  { releases: [] },
  { releases: [release('v1.7.0', '2026-09-08T00:00:00Z')] },
  { releases: [release('v1.8.0-rc.1', '2026-09-08T00:00:00Z')] },
  { releases: [release('v1.8.0-rc.0', '2026-09-08T00:00:00Z', true)] },
])('omits the comparison when no published predecessor exists: %j', ({ releases }) => {
  expect(runNotes('v1.8.0-rc.1', releases)).not.toContain('Full Changelog');
});

test('keeps release notes without a comparison when the lookup fails', () => {
  expect(runNotes('v1.7.0', [release('v1.7.0-rc.14', '2026-09-08T00:00:00Z')], true)).not.toContain(
    'Full Changelog',
  );
});

test('still appends standing upgrade notes through the real script', () => {
  const notes = runNotes('v1.5.2', [release('v1.5.1', '2026-09-08T00:00:00Z')]);
  expect(notes).toContain('/compare/v1.5.1...v1.5.2');
  expect(notes).toContain('<!-- upgrade-notes-marker -->');
});
