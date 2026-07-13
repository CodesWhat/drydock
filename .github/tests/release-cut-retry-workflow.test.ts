import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

interface WorkflowStep {
  env?: Record<string, string>;
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface WorkflowDefinition {
  jobs?: Record<string, WorkflowJob>;
}

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
  'Create GitHub Release and upload signed assets',
];

function loadReleaseSteps(): WorkflowStep[] {
  const workflow = yaml.parse(readFileSync(workflowPath, 'utf8')) as WorkflowDefinition;
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
    'docker.io/codeswhat/drydock',
    'quay.io/codeswhat/drydock',
  ]);
  expect(metadataStep?.with?.flavor?.trim()).toBe('latest=false');
  expect(blockLines(metadataStep?.with?.tags)).toStrictEqual([
    'type=semver,pattern={{version}},value=${{ steps.next.outputs.release_tag }}',
    'type=match,pattern=^v(\\d+\\.\\d+)\\.\\d+-rc\\.\\d+$,group=1,suffix=-rc,value=${{ steps.next.outputs.release_tag }}',
    "type=semver,pattern={{major}}.{{minor}},value=${{ steps.next.outputs.release_tag }},enable=${{ steps.tag.outputs.is_prerelease == 'false' }}",
    "type=semver,pattern={{major}},value=${{ steps.next.outputs.release_tag }},enable=${{ steps.tag.outputs.is_prerelease == 'false' }}",
    "type=raw,value=latest,enable=${{ steps.tag.outputs.is_prerelease == 'false' }}",
  ]);

  expect(getStep('Build and push')?.with).toMatchObject({
    tags: '${{ steps.meta.outputs.tags }}',
    labels: '${{ steps.meta.outputs.labels }}',
  });
  expect(getStep('Compute image tags')).toBeUndefined();

  const shellTagComputations = loadReleaseSteps()
    .filter((step) => step.run && /(^|\n)\s*(IMAGE_TAGS|image_tags|tags)=/.test(step.run))
    .map((step) => step.name);
  expect(shellTagComputations).toStrictEqual([]);
});

test('release-cut generates the container SBOM with a pinned Trivy image', () => {
  const sbomStep = getStep('Generate container SBOM');

  expect(sbomStep?.env).toMatchObject({
    TRIVY_IMAGE:
      'aquasec/trivy@sha256:bcc376de8d77cfe086a917230e818dc9f8528e3c852f7b1aff648949b6258d1c',
  });
  expect(sbomStep?.run).toContain('"${TRIVY_IMAGE}"');
  expect(sbomStep?.run).not.toContain('--entrypoint trivy');
  expect(sbomStep?.run).not.toContain('"${image_ref}" \\\n            image');
});
