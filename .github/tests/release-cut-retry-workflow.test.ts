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
