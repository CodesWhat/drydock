import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkflow } from './workflow-test-utils';

const workflowPath = fileURLToPath(new URL('../workflows/release-cut.yml', import.meta.url));
const extractor = fileURLToPath(
  new URL('../../scripts/extract-changelog-entry.mjs', import.meta.url),
);
const heading = '## [1.8.0-rc.1] - 2026-10-17';

function validate(changelog: string) {
  const steps = loadWorkflow(workflowPath).jobs?.release?.steps ?? [];
  const validation = steps.findIndex(
    (step) => step.name === 'Validate CHANGELOG entry for release tag',
  );
  const buildSetup = steps.findIndex((step) => step.name === 'Set up QEMU');
  expect(validation).toBeGreaterThanOrEqual(0);
  expect(validation).toBeLessThan(buildSetup);
  const run = steps[validation].run;
  if (!run) throw new Error('Missing changelog validation run block');
  const dir = mkdtempSync(join(tmpdir(), 'release-summary-validation-'));
  try {
    const file = join(dir, 'CHANGELOG.md');
    writeFileSync(file, changelog);
    return spawnSync('bash', ['-c', run], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        RELEASE_TAG: 'v1.8.0-rc.1',
        CHANGELOG_PATH: file,
        EXTRACT_SCRIPT: extractor,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('oversized unmarked release notes fail before image build setup', () => {
  const result = validate(`${heading}\n\n${'x'.repeat(100001)}`);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain(
    'Release notes summary is invalid or exceeds its publication budget',
  );
});

test('a compact explicit summary permits the complete detailed changelog to remain', () => {
  const result = validate(`${heading}

> [!WARNING]
> Back up the complete store.

<!-- release-summary:start -->
- Compact summary with the full notes linked.
<!-- release-summary:end -->

${'Detailed change.\n'.repeat(10000)}`);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Validated CHANGELOG entry for v1.8.0-rc.1.');
});

test('an incomplete summary fails the early release gate', () => {
  const result = validate(`${heading}\n\n<!-- release-summary:start -->\n- Summary`);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('Release notes summary is invalid');
});
