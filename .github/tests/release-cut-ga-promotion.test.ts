import { fileURLToPath } from 'node:url';

import { loadWorkflow, type WorkflowStep } from './workflow-test-utils';

const workflowPath = fileURLToPath(new URL('../workflows/release-cut.yml', import.meta.url));

// Cosign-only: these steps only assert signing identity, which stays true
// regardless of source_ref, so they gate on is_prerelease alone.
const prereleaseOnlyCosignSteps = ['Sign release artifact', 'Verify release artifact signature'];

// Provenance/attestation steps additionally skip maintenance cuts: publishing
// them would claim the artifact was built from main HEAD (the OIDC sha
// claim), which is false whenever source_ref names a maintenance branch. See
// the "Defect 3" comment above the container-image attestation steps.
const prereleaseOnlyAttestationSteps = [
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

// Of the GA-promotion steps, only this one re-verifies a cryptographic
// build-provenance claim; it must additionally skip maintenance cuts (the
// candidate RC never carried one — see "Defect 3"). The rest are GA-gated
// only.
const gaPromotionAttestationStep = 'Verify candidate artifact provenance attestation';

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
  // The extractor must be snapshotted as the whole scripts/ tree, not a single
  // file: it imports relative siblings (./lib/parse-args.mjs), which Node
  // resolves against the script's own location.
  expect(step?.run).toContain('git archive "${TARGET_SHA}" scripts | tar -x -C');
  expect(step?.run).not.toContain('git show "${TARGET_SHA}:scripts/');
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

test('release-cut gates cosign-only artifact steps to prereleases only, with no maintenance-cut exception', () => {
  for (const stepName of prereleaseOnlyCosignSteps) {
    const step = getStep(stepName);

    expect(step?.if).toBe("steps.tag.outputs.is_prerelease == 'true'");
  }
});

test('release-cut additionally gates artifact provenance attestation steps off maintenance cuts', () => {
  for (const stepName of prereleaseOnlyAttestationSteps) {
    const step = getStep(stepName);

    expect(
      step?.if,
      `expected step "${stepName}" to require is_prerelease AND skip maintenance cuts`,
    ).toBe(
      "steps.tag.outputs.is_prerelease == 'true' && steps.source_ref.outputs.is_maintenance_cut != 'true'",
    );
  }
});

test('release-cut promotes the candidate artifact at GA in a fixed step order, each GA-gated', () => {
  const steps = loadReleaseSteps();
  const indexOf = (name: string) => steps.findIndex((step) => step.name === name);

  for (const stepName of gaPromotionSteps) {
    const step = getStep(stepName);

    expect(step, `expected step "${stepName}" to exist`).toBeDefined();
    if (stepName === gaPromotionAttestationStep) {
      expect(step?.if).toBe(
        "steps.tag.outputs.is_prerelease == 'false' && steps.source_ref.outputs.is_maintenance_cut != 'true'",
      );
    } else {
      expect(step?.if).toBe("steps.tag.outputs.is_prerelease == 'false'");
    }
  }

  const indices = gaPromotionSteps.map(indexOf);
  for (let i = 1; i < indices.length; i += 1) {
    expect(indices[i]).toBeGreaterThan(indices[i - 1]);
  }
});

test('release-cut downloads and promotes the five always-present candidate assets, plus intoto.jsonl unless it is a maintenance cut', () => {
  const downloadStep = getStep('Download candidate release artifact for promotion');
  const promoteStep = getStep('Promote candidate artifact to GA release filenames');

  // The download runs under the pinned retry wrapper (transient GitHub API /
  // asset-CDN failures must not abort a GA run), so its script lives in
  // `with.command`, not `run`.
  expect(downloadStep?.uses).toContain('nick-fields/retry@');
  expect(downloadStep?.env).toMatchObject({
    IS_MAINTENANCE_CUT: '${{ steps.source_ref.outputs.is_maintenance_cut }}',
  });
  const downloadCommand = String(downloadStep?.with?.command ?? '');
  const alwaysPresentSuffixes = assetSuffixes.filter((suffix) => suffix !== 'tar.gz.intoto.jsonl');
  for (const suffix of alwaysPresentSuffixes) {
    expect(downloadCommand).toContain(`"drydock-\${CANDIDATE_TAG}.${suffix}"`);
  }
  // intoto.jsonl is conditionally appended, not part of the unconditional
  // patterns array — a maintenance-cut RC never produced one to download.
  expect(downloadCommand).toContain('if [ "${IS_MAINTENANCE_CUT}" != "true" ]; then');
  expect(downloadCommand).toContain('patterns+=("drydock-${CANDIDATE_TAG}.tar.gz.intoto.jsonl")');
  expect(downloadCommand).toMatch(/for pattern in "\$\{patterns\[@\]\}"/);

  expect(promoteStep?.env).toMatchObject({
    IS_MAINTENANCE_CUT: '${{ steps.source_ref.outputs.is_maintenance_cut }}',
  });
  expect(promoteStep?.run).toContain(
    'exts=(tar.gz tar.gz.sha256 tar.gz.bundle tar.gz.sig tar.gz.pem)',
  );
  expect(promoteStep?.run).toContain('if [ "${IS_MAINTENANCE_CUT}" != "true" ]; then');
  expect(promoteStep?.run).toContain('exts+=(tar.gz.intoto.jsonl)');
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
