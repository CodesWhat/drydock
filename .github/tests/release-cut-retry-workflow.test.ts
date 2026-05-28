import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

interface WorkflowStep {
  env?: Record<string, string>;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface WorkflowDefinition {
  jobs?: Record<string, WorkflowJob>;
}

const workflowPath = fileURLToPath(new URL('../workflows/release-cut.yml', import.meta.url));
const retryAction = 'nick-fields/retry@ad984534de44a9489a53aefd81eb77f87c70dc60';

function loadReleaseSteps(): WorkflowStep[] {
  const workflow = yaml.parse(readFileSync(workflowPath, 'utf8')) as WorkflowDefinition;
  return workflow.jobs?.release?.steps ?? [];
}

function getStep(name: string): WorkflowStep | undefined {
  return loadReleaseSteps().find((step) => step.name === name);
}

test('release-cut uses the shared retry action for transient release operations', () => {
  expect(getStep('Retry GHCR login')?.uses).toBe(retryAction);
  expect(getStep('Retry Docker Hub login')?.uses).toBe(retryAction);
  expect(getStep('Retry Quay.io login')?.uses).toBe(retryAction);
  expect(getStep('Retry manifest publish on transient registry failure')?.uses).toBe(retryAction);
  expect(getStep('Verify container image signatures')?.uses).toBe(retryAction);
  expect(getStep('Sign release artifact')?.uses).toBe(retryAction);
  expect(getStep('Create GitHub Release and upload signed assets')?.uses).toBe(retryAction);
});

test('release-cut has no hand-rolled fixed retry loops', () => {
  const handRolledRetrySteps = loadReleaseSteps()
    .filter((step) => step.run && /for (attempt|i) in 1 2 3/.test(step.run))
    .map((step) => step.name);

  expect(handRolledRetrySteps).toStrictEqual([]);
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
