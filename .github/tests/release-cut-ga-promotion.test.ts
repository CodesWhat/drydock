import { fileURLToPath } from 'node:url';

import { loadWorkflow, type WorkflowStep } from './workflow-test-utils';

const workflowPath = fileURLToPath(new URL('../workflows/release-cut.yml', import.meta.url));

const prereleaseOnlySignSteps = [
  'Sign release artifact',
  'Verify release artifact signature',
  'Attest release artifact provenance',
  'Export release provenance asset',
  'Verify release artifact provenance attestation',
];

const gaPromotionSteps = [
  'Download candidate release artifact for promotion',
  'Verify downloaded candidate artifact checksum',
  'Verify candidate artifact provenance attestation',
  'Verify candidate artifact signature',
  'Verify candidate artifact is reproducible from source SHA',
  'Promote candidate artifact to GA release filenames',
];

const assetSuffixes = [
  'tar.gz',
  'tar.gz.sha256',
  'tar.gz.bundle',
  'tar.gz.sig',
  'tar.gz.pem',
  'tar.gz.intoto.jsonl',
];

function loadReleaseSteps(): WorkflowStep[] {
  const workflow = loadWorkflow(workflowPath);
  return workflow.jobs?.release?.steps ?? [];
}

function getStep(name: string): WorkflowStep | undefined {
  return loadReleaseSteps().find((step) => step.name === name);
}

test('release-cut captures a CHANGELOG snapshot from the target SHA', () => {
  const step = getStep('Capture CHANGELOG snapshot from target SHA');

  expect(step?.id).toBe('target_changelog');
  expect(step?.run).toContain('git show "${TARGET_SHA}:CHANGELOG.md"');
});

test('release-cut reads CHANGELOG from the target-sha snapshot, not the checked-out tree', () => {
  const validateStep = getStep('Validate CHANGELOG entry for release tag');
  const notesStep = getStep('Generate release notes from changelog');

  for (const step of [validateStep, notesStep]) {
    expect(step?.env).toMatchObject({
      CHANGELOG_PATH: '${{ steps.target_changelog.outputs.path }}',
    });
    expect(step?.run).toContain('--file "${CHANGELOG_PATH}"');
    expect(step?.run).not.toContain('--file CHANGELOG.md');
  }
});

test('release-cut gates artifact sign/attest/verify steps to prereleases only', () => {
  for (const stepName of prereleaseOnlySignSteps) {
    const step = getStep(stepName);

    expect(step?.if).toBe("steps.tag.outputs.is_prerelease == 'true'");
  }
});

test('release-cut promotes the candidate artifact at GA in a fixed step order, each GA-gated', () => {
  const steps = loadReleaseSteps();
  const indexOf = (name: string) => steps.findIndex((step) => step.name === name);

  for (const stepName of gaPromotionSteps) {
    const step = getStep(stepName);

    expect(step, `expected step "${stepName}" to exist`).toBeDefined();
    expect(step?.if).toBe("steps.tag.outputs.is_prerelease == 'false'");
  }

  const indices = gaPromotionSteps.map(indexOf);
  for (let i = 1; i < indices.length; i += 1) {
    expect(indices[i]).toBeGreaterThan(indices[i - 1]);
  }
});

test('release-cut downloads and promotes exactly the six candidate asset suffixes', () => {
  const downloadStep = getStep('Download candidate release artifact for promotion');
  const promoteStep = getStep('Promote candidate artifact to GA release filenames');

  // The download runs under the pinned retry wrapper (transient GitHub API /
  // asset-CDN failures must not abort a GA run), so its script lives in
  // `with.command`, not `run`.
  expect(downloadStep?.uses).toContain('nick-fields/retry@');
  const downloadCommand = String(downloadStep?.with?.command ?? '');
  for (const suffix of assetSuffixes) {
    expect(downloadCommand).toContain(`--pattern "drydock-\${CANDIDATE_TAG}.${suffix}"`);
  }

  expect(promoteStep?.run).toContain(
    'for ext in tar.gz tar.gz.sha256 tar.gz.bundle tar.gz.sig tar.gz.pem tar.gz.intoto.jsonl',
  );
});

test('release-cut verifies candidate provenance against SOURCE_SHA, keeping TARGET_SHA for prereleases', () => {
  const candidateStep = getStep('Verify candidate artifact provenance attestation');
  const prereleaseStep = getStep('Verify release artifact provenance attestation');

  expect(candidateStep?.env).toMatchObject({
    SOURCE_SHA: '${{ steps.source.outputs.source_sha }}',
  });
  expect(candidateStep?.run).toContain('--source-digest "${SOURCE_SHA}"');
  expect(candidateStep?.run).not.toContain('--source-digest "${TARGET_SHA}"');

  expect(prereleaseStep?.env).toMatchObject({
    TARGET_SHA: '${{ steps.target.outputs.sha }}',
  });
  expect(prereleaseStep?.run).toContain('--source-digest "${TARGET_SHA}"');
});

test('release-cut compares decompressed tar streams for reproducibility, not raw gzip bytes', () => {
  const reproStep = getStep('Verify candidate artifact is reproducible from source SHA');

  expect(reproStep?.run).toContain('gzip -dc "${rebuilt}"');
  expect(reproStep?.run).toContain('gzip -dc "${downloaded}"');
});

test('release-cut builds the GA-day release artifact under the candidate tag prefix', () => {
  const buildStep = getStep('Build release artifact');

  expect(buildStep?.env).toMatchObject({
    CANDIDATE_TAG: '${{ inputs.candidate_tag }}',
    IS_PRERELEASE: '${{ steps.tag.outputs.is_prerelease }}',
  });
  expect(buildStep?.run).toContain('if [ "${IS_PRERELEASE}" = "true" ]; then');
  expect(buildStep?.run).toContain('archive_tag="${RELEASE_TAG}"');
  expect(buildStep?.run).toContain('archive_tag="${CANDIDATE_TAG}"');
  expect(buildStep?.run).toContain('artifact="dist/drydock-${archive_tag}.tar.gz"');
});
