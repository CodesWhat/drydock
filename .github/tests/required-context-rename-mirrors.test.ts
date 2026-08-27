import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadWorkflow } from './workflow-test-utils';

// Step 1 of the four-step required-context rename. Five required contexts carry
// an emoji; a required name that no job produces leaves every PR pending
// forever, so the new name has to exist and be green BEFORE either ruleset can
// be moved onto it. These mirrors publish the emoji-free name while the real
// job keeps publishing the emoji one.
//
// The whole block is temporary and deletes at step 4. These tests exist because
// the two ways it can go wrong are both silent: a mirror that reports SKIPPED
// on a real failure (skipped satisfies a ruleset, #798) fails the gate open,
// and a mirror whose name doesn't exactly match what the ruleset requires
// leaves PRs pending with no obvious cause.
const workflowPath = fileURLToPath(new URL('../workflows/ci-verify.yml', import.meta.url));

// mirror job key -> [real job key, context name the rulesets will require]
const MIRRORS: Record<string, [string, string]> = {
  'renamed-secrets': ['secrets', 'Security: Secrets'],
  'renamed-codeql': ['codeql', 'SAST: CodeQL'],
  'renamed-dependency-review': ['dependency-review', 'Security: Dependency Review'],
  'renamed-web': ['web', 'Web: Site Build & Scripts Tests'],
  'renamed-grype-image': ['grype-image', 'Security: Grype Image'],
};

const mirrorEntries = Object.entries(MIRRORS);

test.each(mirrorEntries)(
  '%s mirrors its real job and publishes the emoji-free name',
  (mirrorId, [realId, expectedName]) => {
    const workflow = loadWorkflow(workflowPath);
    const mirror = workflow.jobs?.[mirrorId];
    const real = workflow.jobs?.[realId];

    expect(mirror?.name).toBe(expectedName);
    expect(mirror?.needs).toStrictEqual([realId]);

    // Step 1 is additive: the real job must still publish the OLD name, or both
    // rulesets go unsatisfiable the moment this merges.
    expect(real?.name).toBeDefined();
    expect(real?.name).not.toBe(expectedName);
    // The pairing is right: stripping the leading emoji off the real name yields
    // exactly the mirror's name. Catches a mirror wired to the wrong job.
    expect((real?.name ?? '').replace(/^\P{ASCII}+\s*/u, '')).toBe(expectedName);
  },
);

test.each(mirrorEntries)('%s runs even when its dependency failed', (mirrorId) => {
  const workflow = loadWorkflow(workflowPath);

  // Without this, GitHub skips a job whose `needs` dependency was skipped —
  // and that cascade fires identically when the dependency FAILED. The mirror
  // would report SKIPPED on a real failure, which satisfies a ruleset, so a
  // red security scan would merge silently. This is the fail-open guard.
  expect(workflow.jobs?.[mirrorId]?.if).toBe('${{ always() }}');
});

test('the CodeQL mirror carries the same matrix as the real job', () => {
  const workflow = loadWorkflow(workflowPath);

  // The required context is `SAST: CodeQL (javascript-typescript)`. GitHub
  // appends that suffix from the matrix, so the mirror needs the same matrix
  // rather than the suffix baked into its name.
  const realMatrix = (workflow.jobs?.codeql?.strategy?.matrix ?? {}) as { language?: string[] };
  const mirrorMatrix = (workflow.jobs?.['renamed-codeql']?.strategy?.matrix ?? {}) as {
    language?: string[];
  };

  expect(realMatrix.language).toStrictEqual(['javascript-typescript']);
  expect(mirrorMatrix.language).toStrictEqual(realMatrix.language);
});

function runVerdict(mirrorId: string, result: string): number {
  const workflow = loadWorkflow(workflowPath);
  const step = workflow.jobs?.[mirrorId]?.steps?.find((s) => s.name === 'Mirror verdict');
  if (!step?.run) {
    throw new Error(`Expected ${mirrorId} to have a 'Mirror verdict' step with a run block`);
  }

  try {
    // `-eo pipefail` is what GitHub gives a `run:` block with no shell override.
    execFileSync('bash', ['-eo', 'pipefail', '-c', step.run], {
      env: { PATH: process.env.PATH ?? '', RESULT: result },
      encoding: 'utf8',
    });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

test.each(mirrorEntries)(
  "%s's verdict passes on success and skipped, fails otherwise",
  (mirrorId) => {
    // Executed rather than pattern-matched, so the verdict can't drift from what
    // actually runs. `skipped` passing is deliberate and not a loosened gate:
    // four of the five real jobs are path- or event-filtered, and a skipped real
    // job has always satisfied these rulesets. The mirror has to be
    // behaviour-identical to the name it replaces, not stricter.
    expect(runVerdict(mirrorId, 'success')).toBe(0);
    expect(runVerdict(mirrorId, 'skipped')).toBe(0);

    expect(runVerdict(mirrorId, 'failure')).not.toBe(0);
    expect(runVerdict(mirrorId, 'cancelled')).not.toBe(0);
    expect(runVerdict(mirrorId, '')).not.toBe(0);
  },
);
