import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadWorkflow, type WorkflowStep } from './workflow-test-utils';

const workflowPath = fileURLToPath(new URL('../workflows/release-cut.yml', import.meta.url));
const baseIndexScriptPath = fileURLToPath(
  new URL('../../scripts/check-dockerfile-base-indexes.sh', import.meta.url),
);
const imageArchScriptPath = fileURLToPath(
  new URL('../../scripts/check-image-arch.sh', import.meta.url),
);

function loadReleaseSteps(): WorkflowStep[] {
  return loadWorkflow(workflowPath).jobs?.release?.steps ?? [];
}

function getStep(name: string): WorkflowStep | undefined {
  return loadReleaseSteps().find((step) => step.name === name);
}

function indexOf(name: string): number {
  return loadReleaseSteps().findIndex((step) => step.name === name);
}

test('release-cut checks base image pins against the platforms it builds for', () => {
  const step = getStep('Verify base image pins are multi-arch indexes');

  expect(loadWorkflow(workflowPath).env?.DOCKER_PLATFORMS).toBe('linux/amd64,linux/arm64');
  // GA promotes an existing digest instead of building, so the Dockerfile it
  // would check is not the one the promoted image came from.
  expect(step?.if).toContain("steps.tag.outputs.is_prerelease == 'true'");
  expect(step?.run).toContain('scripts/check-dockerfile-base-indexes.sh Dockerfile');
  expect(step?.run).toContain('"${DOCKER_PLATFORMS}"');
});

test('release-cut checks base image pins before it builds anything', () => {
  const guardIndex = indexOf('Verify base image pins are multi-arch indexes');

  expect(guardIndex).toBeGreaterThan(-1);
  expect(guardIndex).toBeLessThan(indexOf('Build and push staging image'));
});

test('release-cut reads the shipped binaries of every platform it publishes', () => {
  const step = getStep('Verify image binaries match their platform');

  expect(step?.env).toMatchObject({
    DIGEST: '${{ steps.digest.outputs.value }}',
    TAGS: '${{ steps.image_refs.outputs.tags }}',
  });
  expect(step?.run).toContain('scripts/check-image-arch.sh "${image_ref}" "${platform}"');
  expect(step?.run).toContain("${DOCKER_PLATFORMS//,/$'\\n'}");
  expect(step?.run).toContain('"${tag}@${DIGEST}"');
  // #1021 shipped x86-64 arm64 images for seven release candidates. A GA
  // promotes an RC digest without rebuilding, so this guard has to run on the
  // promotion path too or the broken digest walks straight through.
  expect(step?.if).toBeUndefined();
});

test('release-cut verifies platform binaries after the build and before it publishes anything', () => {
  const guardIndex = indexOf('Verify image binaries match their platform');

  expect(guardIndex).toBeGreaterThan(indexOf('Build and push staging image'));
  expect(guardIndex).toBeGreaterThan(indexOf('Retry full build on total build failure'));
  expect(guardIndex).toBeGreaterThan(
    indexOf('Retry manifest publish on transient registry failure'),
  );
  expect(guardIndex).toBeGreaterThan(indexOf('Resolve image digest'));
  expect(guardIndex).toBeGreaterThan(indexOf('Resolve image source references'));
  expect(guardIndex).toBeLessThan(indexOf('Sign container images'));
  expect(guardIndex).toBeLessThan(indexOf('Publish release image tags'));
  expect(guardIndex).toBeLessThan(indexOf('Push release tag'));
  expect(guardIndex).toBeLessThan(indexOf('Publish GitHub Release'));
});

test('both platform guards are committed executable', () => {
  for (const scriptPath of [baseIndexScriptPath, imageArchScriptPath]) {
    expect(statSync(scriptPath).mode & 0o111).toBeGreaterThan(0);
  }
});
