import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

import type { WorkflowDefinition, WorkflowStep } from './workflow-test-utils';

const workflowsDir = fileURLToPath(new URL('../workflows', import.meta.url));

function loadWorkflowFiles(): Array<{ file: string; workflow: WorkflowDefinition }> {
  return readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .sort()
    .map((file) => {
      const source = readFileSync(join(workflowsDir, file), 'utf8');
      return { file, workflow: yaml.parse(source) as WorkflowDefinition };
    });
}

// A step runs `npm ci` either directly (`run:`) or through a wrapper like
// nick-fields/retry, which shells out via `with.command`.
function stepRunsNpmCi(step: WorkflowStep): boolean {
  const command = step.run ?? (step.with?.command as string | undefined) ?? '';
  return /npm ci\b/.test(command);
}

// `docker run ... sh -c "npm ci && ..."` (e2e-playwright's Playwright job)
// installs inside an isolated container filesystem that never shares the
// runner's actions/setup-node cache, so there is no lockfile path to check
// it against.
function isNpmCiInsideDockerRun(command: string): boolean {
  return /^\s*docker run\b/.test(command);
}

// Resolves the directory an `npm ci` step installs into: an explicit
// `working-directory`, a `cd <dir> &&` prefix on the same command line, an
// `npm ci --prefix <dir>`, or the repo root (`null`) if none apply.
//
// A matrix-driven dir like `${{ matrix.package }}` is returned verbatim
// (unevaluated) rather than resolved against `strategy.matrix`: the
// cache-dependency-path entry it must match is written with the identical
// expression, so comparing the raw strings is sufficient and simpler than
// enumerating matrix values.
function resolveInstallDir(step: WorkflowStep, command: string): string | null {
  const workingDirectory = step['working-directory'];
  if (workingDirectory) {
    return workingDirectory;
  }

  const cdMatch = command.match(/cd\s+(.+?)\s*&&\s*npm ci\b/);
  if (cdMatch) {
    return cdMatch[1].trim();
  }

  const prefixMatch = command.match(/npm ci\b[^\n]*--prefix[ =]+(\S+)/);
  if (prefixMatch) {
    return prefixMatch[1];
  }

  return null;
}

interface NpmCiInstall {
  jobId: string;
  stepIndex: number;
  installDir: string | null;
}

// Every real (non-Docker-isolated) `npm ci` in a job, with the directory it
// installs into resolved.
function findNpmCiInstalls(jobId: string, job: WorkflowJob): NpmCiInstall[] {
  const steps = job.steps ?? [];
  const installs: NpmCiInstall[] = [];

  steps.forEach((step, stepIndex) => {
    const command = step.run ?? (step.with?.command as string | undefined) ?? '';
    if (!/npm ci\b/.test(command) || isNpmCiInsideDockerRun(command)) {
      return;
    }
    installs.push({ jobId, stepIndex, installDir: resolveInstallDir(step, command) });
  });

  return installs;
}

// The nearest `actions/setup-node` step before `beforeIndex`, or undefined
// if the install has no setup-node step ahead of it in the job.
function findPrecedingSetupNodeStep(
  steps: WorkflowStep[],
  beforeIndex: number,
): WorkflowStep | undefined {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (steps[index].uses?.startsWith('actions/setup-node@')) {
      return steps[index];
    }
  }
  return undefined;
}

// `cache-dependency-path` may be a single path or a multi-line block
// listing one per line; normalize both to a trimmed list of paths.
function cacheDependencyPaths(setupNodeStep: WorkflowStep): string[] {
  const raw = setupNodeStep.with?.['cache-dependency-path'];
  if (typeof raw !== 'string') {
    return [];
  }
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

// CI-2: every `npm ci` install is covered by a preceding `actions/setup-node`
// step that caches the npm download and lists that install's own lockfile in
// `cache-dependency-path` -- not just any non-empty path, which a job could
// satisfy while naming the wrong package's lockfile.
test('every npm ci install has a preceding setup-node step caching its own lockfile', () => {
  const violations: string[] = [];

  for (const { file, workflow } of loadWorkflowFiles()) {
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      const steps = job.steps ?? [];
      const installs = findNpmCiInstalls(jobId, job);
      const key = `${file}/${jobId}`;

      for (const install of installs) {
        const expectedPath = install.installDir
          ? `${install.installDir}/package-lock.json`
          : 'package-lock.json';

        const setupNodeStep = findPrecedingSetupNodeStep(steps, install.stepIndex);
        if (!setupNodeStep) {
          violations.push(
            `${key}: npm ci at step ${install.stepIndex} has no preceding actions/setup-node step`,
          );
          continue;
        }

        if (setupNodeStep.with?.['package-manager-cache'] !== true) {
          violations.push(
            `${key}: npm ci at step ${install.stepIndex} is preceded by setup-node with package-manager-cache not 'true'`,
          );
          continue;
        }

        const paths = cacheDependencyPaths(setupNodeStep);
        if (!paths.includes(expectedPath)) {
          violations.push(
            `${key}: npm ci at step ${install.stepIndex} installs in '${install.installDir ?? '.'}' but cache-dependency-path is missing '${expectedPath}' (got: ${paths.join(', ') || '(empty)'})`,
          );
        }
      }
    }
  }

  expect(violations).toStrictEqual([]);
});

// The mutation workflow's aggregate job only downloads artifacts and never
// installs npm dependencies; it should keep caching off rather than carry a
// dependency path that names a lockfile it never reads.
test('setup-node steps in jobs that never run npm ci leave caching off', () => {
  const violations: string[] = [];

  for (const { file, workflow } of loadWorkflowFiles()) {
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      const steps = job.steps ?? [];
      const jobRunsNpmCi = steps.some(stepRunsNpmCi);
      if (jobRunsNpmCi) {
        continue;
      }

      const setupNodeStep = steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
      if (!setupNodeStep) {
        continue;
      }

      if (setupNodeStep.with?.['package-manager-cache'] !== false) {
        violations.push(`${file}/${jobId}: expected package-manager-cache 'false'`);
      }
    }
  }

  expect(violations).toStrictEqual([]);
});
