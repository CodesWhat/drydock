import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

import type { WorkflowDefinition } from './workflow-test-utils';

const workflowsDir = fileURLToPath(new URL('../workflows', import.meta.url));
const hardenRunnerRef = 'step-security/harden-runner@b09bb98e06d4d774595224525879c09bc6e98c40';
const hardenRunnerVersion = 'v2.20.1';

type EgressPolicy = 'audit' | 'block';

// Stage 1 of the audit->block migration (.planning/roadmap/h2-harden-runner-block-plan.md
// §2). Any job not listed here defaults to 'audit'. This map is the migration
// checklist — each stage's PR adds exactly the jobs it flips to 'block'.
const expectedPolicy: Record<string, EgressPolicy> = {
  'ci-verify.yml/changes': 'block',
  'ci-verify.yml/dependency-review': 'block',
  'ci-verify.yml/secrets': 'block',
  'ci-verify.yml/fuzz': 'block',
  'ci-verify.yml/test': 'block',
  'ci-verify.yml/web': 'block',
  'ci-verify.yml/grype-image': 'block',
  // Required-context rename mirrors. They run one `test` against a `needs`
  // result and touch no network at all, so they start at 'block' rather than
  // joining the audit->block migration. Deleted with the rest of that block
  // when the rename collapses.
  'ci-verify.yml/renamed-secrets': 'block',
  'ci-verify.yml/renamed-codeql': 'block',
  'ci-verify.yml/renamed-dependency-review': 'block',
  'ci-verify.yml/renamed-web': 'block',
  'ci-verify.yml/renamed-grype-image': 'block',
  'e2e-playwright.yml/changes': 'block',
  'quality-mutation-monthly.yml/stryker': 'block',
  'quality-mutation-monthly.yml/aggregate': 'block',
  'quality-portwing-fleet-soak.yml/fleet-soak': 'block',
  'security-grype.yml/grype-deps': 'block',
};

function loadWorkflowFiles(): Array<{
  file: string;
  source: string;
  workflow: WorkflowDefinition;
}> {
  return readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .sort()
    .map((file) => {
      const source = readFileSync(join(workflowsDir, file), 'utf8');
      return {
        file,
        source,
        workflow: yaml.parse(source) as WorkflowDefinition,
      };
    });
}

test('GitHub-hosted workflow jobs start with current pinned Harden Runner', () => {
  const violations: string[] = [];

  for (const { file, workflow } of loadWorkflowFiles()) {
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      if (!job['runs-on'] || !job.steps?.length) {
        // Reusable-workflow calls (e.g. ci-verify.yml's security-actions, via
        // go-ci.yml) have no local steps to inspect — their harden-runner
        // policy is asserted where the call sets workflow-security-* inputs.
        continue;
      }

      const key = `${file}/${jobId}`;
      const policy = expectedPolicy[key] ?? 'audit';

      const firstStep = job.steps[0];
      if (firstStep.uses !== hardenRunnerRef) {
        violations.push(key);
        continue;
      }

      if (firstStep.with?.['egress-policy'] !== policy) {
        violations.push(`${key} expected egress-policy '${policy}'`);
      }
    }
  }

  expect(violations).toStrictEqual([]);
});

test('Every expectedPolicy key maps to a real local job', () => {
  const knownKeys = new Set<string>();
  for (const { file, workflow } of loadWorkflowFiles()) {
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      if (!job['runs-on'] || !job.steps?.length) {
        continue;
      }
      knownKeys.add(`${file}/${jobId}`);
    }
  }

  const staleKeys = Object.keys(expectedPolicy).filter((key) => !knownKeys.has(key));
  expect(staleKeys).toStrictEqual([]);
});

test('Block-mode jobs carry a non-empty allowed-endpoints list and disable-sudo', () => {
  const violations: string[] = [];

  for (const { file, workflow } of loadWorkflowFiles()) {
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      if (!job['runs-on'] || !job.steps?.length) {
        continue;
      }

      const key = `${file}/${jobId}`;
      if ((expectedPolicy[key] ?? 'audit') !== 'block') {
        continue;
      }

      const firstStep = job.steps[0];
      const allowedEndpoints = firstStep.with?.['allowed-endpoints'];
      if (typeof allowedEndpoints !== 'string' || allowedEndpoints.trim() === '') {
        violations.push(key);
      }
      if (firstStep.with?.['disable-sudo'] !== true) {
        violations.push(`${key} missing disable-sudo: true`);
      }
    }
  }

  expect(violations).toStrictEqual([]);
});

test('Block-mode allowed-endpoints entries are host:443 (optionally wildcard-subdomain)', () => {
  const endpointPattern = /^(\*\.)?[A-Za-z0-9.-]+:443$/;
  const violations: string[] = [];

  for (const { file, workflow } of loadWorkflowFiles()) {
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      if (!job['runs-on'] || !job.steps?.length) {
        continue;
      }

      const key = `${file}/${jobId}`;
      if ((expectedPolicy[key] ?? 'audit') !== 'block') {
        continue;
      }

      const firstStep = job.steps[0];
      const allowedEndpoints = firstStep.with?.['allowed-endpoints'];
      if (typeof allowedEndpoints !== 'string') {
        continue;
      }

      // Folded `>` block scalars join their source lines with spaces (not
      // newlines) once parsed, so split on any whitespace run rather than '\n'.
      const entries = allowedEndpoints
        .split(/\s+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');

      for (const entry of entries) {
        if (!endpointPattern.test(entry)) {
          violations.push(`${key}: ${entry}`);
        }
      }
    }
  }

  expect(violations).toStrictEqual([]);
});

test('Harden Runner comments match the pinned release version', () => {
  const stalePins = loadWorkflowFiles()
    .flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, index) => ({ file, line, lineNumber: index + 1 }))
        .filter(({ line }) => line.includes('step-security/harden-runner@')),
    )
    .filter(({ line }) => !line.includes(`# ${hardenRunnerVersion}`))
    .map(({ file, lineNumber }) => `${basename(file)}:${lineNumber}`);

  expect(stalePins).toStrictEqual([]);
});
