import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadWorkflow, type WorkflowStep } from './workflow-test-utils';

const workflowPath = fileURLToPath(new URL('../workflows/release-cut.yml', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const changelogExtractorPath = fileURLToPath(
  new URL('../../scripts/extract-changelog-entry.mjs', import.meta.url),
);
const changelogPath = fileURLToPath(new URL('../../CHANGELOG.md', import.meta.url));
const gitignorePath = fileURLToPath(new URL('../../.gitignore', import.meta.url));
const retryAction = 'nick-fields/retry@ad984534de44a9489a53aefd81eb77f87c70dc60';
const metadataAction = 'docker/metadata-action@80c7e94dd9b9319bd5eb7a0e0fe9291e23a2a2e9';
const transientRetryStepNames = [
  'Retry GHCR login',
  'Retry Docker Hub login',
  'Retry Quay.io login',
  'Retry manifest publish on transient registry failure',
  'Verify container image signatures',
  'Sign release artifact',
  'Prepare draft GitHub Release and upload signed assets',
  'Publish release image tags',
  'Publish GitHub Release',
];

function loadReleaseSteps(): WorkflowStep[] {
  const workflow = loadWorkflow(workflowPath);
  return workflow.jobs?.release?.steps ?? [];
}

function getStep(name: string): WorkflowStep | undefined {
  return loadReleaseSteps().find((step) => step.name === name);
}

function blockLines(value: string | undefined): string[] {
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

test('release-cut uses multi-attempt retry action steps for transient release operations', () => {
  for (const stepName of transientRetryStepNames) {
    const step = getStep(stepName);
    const maxAttempts = Number(step?.with?.max_attempts);

    expect(step?.uses).toBe(retryAction);
    expect(Number.isInteger(maxAttempts)).toBe(true);
    expect(maxAttempts).toBeGreaterThanOrEqual(2);
  }
});

test('release-cut has no hand-rolled fixed retry loops', () => {
  const handRolledRetrySteps = loadReleaseSteps()
    .filter((step) => step.run && /for (attempt|i) in 1 2 3/.test(step.run))
    .map((step) => step.name);

  expect(handRolledRetrySteps).toStrictEqual([]);
});

test('release-cut gates on Playwright for the exact release source SHA', () => {
  const workflow = loadWorkflow(workflowPath);
  const step = getStep('Wait for successful E2E Playwright on release source SHA');

  expect(workflow.env?.E2E_PLAYWRIGHT_WORKFLOW_FILE).toBe('e2e-playwright.yml');
  expect(step).toMatchObject({
    uses: './.github/actions/wait-for-successful-branch-ci',
    with: {
      'workflow-file': '${{ env.E2E_PLAYWRIGHT_WORKFLOW_FILE }}',
      'target-sha': '${{ steps.source.outputs.source_sha }}',
    },
  });
});

test('release-cut asserts package and lockfile versions for every workspace package', () => {
  const versionStep = getStep('Assert tag version matches package versions');
  const expectedVersionFiles = [
    'package.json',
    'package-lock.json',
    'app/package.json',
    'app/package-lock.json',
    'ui/package.json',
    'ui/package-lock.json',
    'e2e/package.json',
    'e2e/package-lock.json',
  ];

  for (const versionFile of expectedVersionFiles) {
    expect(versionStep?.run).toContain(versionFile);
  }
});

test('release-cut requires exact changelog entries for prerelease tags', () => {
  const validateStep = getStep('Validate CHANGELOG entry for release tag');
  const notesStep = getStep('Generate release notes from changelog');

  for (const step of [validateStep, notesStep]) {
    expect(step?.run).toContain('--version "${RELEASE_TAG}"');
    expect(step?.run).not.toContain('--version "Unreleased"');
    expect(step?.run).not.toMatch(/used_unreleased_fallback|Using \[Unreleased\]/);
  }

  expect(validateStep?.run).toContain('CHANGELOG entry for ${RELEASE_TAG} missing');
  expect(notesStep?.run).toContain('Release notes generation failed');
});

test('release-cut can extract the apparent next prerelease changelog entry', () => {
  const entry = execFileSync(
    process.execPath,
    [changelogExtractorPath, '--version', 'v1.5.0-rc.34', '--file', changelogPath],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );

  expect(entry).toContain('## [1.5.0-rc.34]');
});

test('internal Codex review artifacts are ignored', () => {
  const gitignore = readFileSync(gitignorePath, 'utf8');

  expect(gitignore).toMatch(/^\.codex\/$/m);
});

test('release-cut delegates image tags and labels to docker metadata-action', () => {
  const metadataStep = getStep('Docker metadata');

  expect(metadataStep).toMatchObject({
    id: 'meta',
    uses: metadataAction,
  });
  expect(blockLines(metadataStep?.with?.images)).toStrictEqual([
    'ghcr.io/${{ steps.target.outputs.repo_lower }}',
    '${{ env.DOCKERHUB_REPO }}',
    '${{ env.QUAY_REPO }}',
  ]);
  expect(metadataStep?.with?.flavor?.trim()).toBe('latest=false');
  expect(blockLines(metadataStep?.with?.tags)).toStrictEqual([
    'type=semver,pattern={{version}},value=${{ steps.next.outputs.release_tag }}',
    'type=match,pattern=^v(\\d+\\.\\d+)\\.\\d+-rc\\.\\d+$,group=1,suffix=-rc,value=${{ steps.next.outputs.release_tag }}',
    "type=semver,pattern={{major}}.{{minor}},value=${{ steps.next.outputs.release_tag }},enable=${{ steps.tag.outputs.is_prerelease == 'false' }}",
    "type=semver,pattern={{major}},value=${{ steps.next.outputs.release_tag }},enable=${{ steps.tag.outputs.is_prerelease == 'false' }}",
    "type=raw,value=latest,enable=${{ steps.tag.outputs.is_prerelease == 'false' }}",
  ]);

  expect(getStep('Build and push staging image')?.with).toMatchObject({
    tags: '${{ steps.staging_meta.outputs.tags }}',
    labels: '${{ steps.meta.outputs.labels }}',
  });
  expect(getStep('Compute image tags')).toBeUndefined();

  const shellTagComputations = loadReleaseSteps()
    .filter((step) => step.run && /(^|\n)\s*(IMAGE_TAGS|image_tags|tags)=/.test(step.run))
    .map((step) => step.name);
  expect(shellTagComputations).toStrictEqual([]);
});

test('release-cut defines external registry repositories once at job scope', () => {
  const workflow = loadWorkflow(workflowPath);
  const releaseJob = workflow.jobs?.release;

  expect(releaseJob?.env).toMatchObject({
    DOCKERHUB_REPO: 'docker.io/codeswhat/drydock',
    QUAY_REPO: 'quay.io/codeswhat/drydock',
  });
  const releaseStepText = JSON.stringify(loadReleaseSteps());
  expect(releaseStepText).not.toContain('docker.io/codeswhat/drydock');
  expect(releaseStepText).not.toContain('quay.io/codeswhat/drydock');
  expect(blockLines(getStep('Docker metadata')?.with?.images)).toContain(
    '${{ env.DOCKERHUB_REPO }}',
  );
  expect(blockLines(getStep('Docker metadata')?.with?.images)).toContain('${{ env.QUAY_REPO }}');
  expect(getStep('Validate GA candidate digest in every registry')?.run).toContain(
    '${DOCKERHUB_REPO}:${CANDIDATE_TAG#v}',
  );
  expect(getStep('Validate GA candidate digest in every registry')?.run).toContain(
    '${QUAY_REPO}:${CANDIDATE_TAG#v}',
  );
  expect(getStep('Retry manifest publish on transient registry failure')?.with?.command).toContain(
    '${DOCKERHUB_REPO}@${BUILD_DIGEST}',
  );
  expect(getStep('Retry manifest publish on transient registry failure')?.with?.command).toContain(
    '${QUAY_REPO}@${BUILD_DIGEST}',
  );
  expect(getStep('Resolve image source references')?.run).toContain(
    '${DOCKERHUB_REPO}:${CANDIDATE_TAG#v}',
  );
  expect(getStep('Resolve image source references')?.run).toContain(
    '${QUAY_REPO}:${CANDIDATE_TAG#v}',
  );
});

test('release-cut requires an exact, seven-day-old RC candidate for GA promotion', () => {
  const workflow = loadWorkflow(workflowPath);
  const inputs = workflow.on?.workflow_dispatch?.inputs;
  const sourceStep = getStep('Resolve release source and validate GA candidate');

  expect(inputs).toMatchObject({
    candidate_tag: {
      required: false,
      type: 'string',
    },
    candidate_digest: {
      required: false,
      type: 'string',
    },
  });
  expect(sourceStep?.id).toBe('source');
  expect(sourceStep?.run).toContain('publishedAt');
  expect(sourceStep?.run).toContain('isPrerelease');
  expect(sourceStep?.run).toContain('604800');
  expect(sourceStep?.run).toContain('^{commit}');
  expect(sourceStep?.run).toContain('^sha256:[0-9a-f]{64}$');
  expect(sourceStep?.run).toContain('source_sha=');
  expect(sourceStep?.run).toContain('image_digest=');
});

test('release-cut validates the promoted digest in every registry', () => {
  const validationStep = getStep('Validate GA candidate digest in every registry');

  expect(validationStep?.if).toContain("steps.tag.outputs.is_prerelease == 'false'");
  expect(validationStep?.run).toContain('ghcr.io/${GHCR_REPO}:${CANDIDATE_TAG#v}');
  expect(validationStep?.run).toContain('${DOCKERHUB_REPO}:${CANDIDATE_TAG#v}');
  expect(validationStep?.run).toContain('${QUAY_REPO}:${CANDIDATE_TAG#v}');
  expect(validationStep?.run).toContain('raw_manifest');
  expect(validationStep?.run).toContain('computed_digest');
  expect(validationStep?.run).toContain('CANDIDATE_DIGEST');
});

test('release-cut builds prereleases under staging tags and promotes final tags by digest', () => {
  const stagingMetadata = getStep('Docker staging metadata');
  const buildStep = getStep('Build and push staging image');
  const publishStep = getStep('Publish release image tags');

  expect(stagingMetadata).toMatchObject({
    id: 'staging_meta',
    uses: metadataAction,
  });
  expect(stagingMetadata?.with?.tags).toContain(
    'release-staging-${{ github.run_id }}-${{ github.run_attempt }}',
  );
  expect(buildStep?.if).toContain("steps.tag.outputs.is_prerelease == 'true'");
  expect(buildStep?.with?.tags).toBe('${{ steps.staging_meta.outputs.tags }}');
  expect(publishStep?.env).toMatchObject({
    DIGEST: '${{ steps.digest.outputs.value }}',
    TAGS: '${{ steps.meta.outputs.tags }}',
  });
  expect(publishStep?.with?.command).toContain('docker buildx imagetools create');
  expect(publishStep?.with?.command).toContain('${source_ref}');
  expect(publishStep?.with?.command).toContain('${DIGEST}');
});

test('release-cut prepares a draft before its recoverable public finalization sequence', () => {
  const steps = loadReleaseSteps();
  const indexOf = (name: string) => steps.findIndex((step) => step.name === name);
  const draftStep = getStep('Prepare draft GitHub Release and upload signed assets');
  const tagStep = getStep('Push release tag');
  const publishStep = getStep('Publish GitHub Release');

  expect(draftStep?.with?.command).toContain('--draft');
  expect(draftStep?.with?.command).toContain('--target "${SOURCE_SHA}"');
  expect(tagStep?.env).toMatchObject({
    SOURCE_SHA: '${{ steps.source.outputs.source_sha }}',
  });
  expect(tagStep?.run).toContain('"${SOURCE_SHA}"');
  expect(publishStep?.with?.command).toContain('gh release edit "${RELEASE_TAG}" --draft=false');

  expect(indexOf('Prepare draft GitHub Release and upload signed assets')).toBeLessThan(
    indexOf('Publish release image tags'),
  );
  expect(indexOf('Publish release image tags')).toBeLessThan(indexOf('Push release tag'));
  expect(indexOf('Push release tag')).toBeLessThan(indexOf('Publish GitHub Release'));
});

test('release-cut generates the container SBOM with a pinned Trivy image', () => {
  const sbomStep = getStep('Generate container SBOM');

  expect(sbomStep?.env).toMatchObject({
    TRIVY_IMAGE:
      'aquasec/trivy@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f',
  });
  expect(sbomStep?.run).toContain('"${TRIVY_IMAGE}"');
  expect(sbomStep?.run).not.toContain('--entrypoint trivy');
  expect(sbomStep?.run).not.toContain('"${image_ref}" \\\n            image');
});
