import { fileURLToPath } from 'node:url';

import { loadWorkflow } from './workflow-test-utils';

// Required status checks that depend on the non-required `changes` job. If
// `changes` fails, a plain `needs` + `if` skips them, and a skipped required
// check counts as passing, so the gate would fail open.
const requiredJobsNeedingChanges = [
  { file: 'ci-verify.yml', id: 'web', name: 'Web: Site Build & Scripts Tests', needsBuild: false },
  { file: 'ci-verify.yml', id: 'grype-image', name: 'Security: Grype Image', needsBuild: true },
  { file: 'ci-verify.yml', id: 'e2e', name: 'E2E: Cucumber', needsBuild: true },
  { file: 'e2e-playwright.yml', id: 'playwright', name: 'E2E: Playwright', needsBuild: false },
];

function workflowPath(file: string): string {
  return fileURLToPath(new URL(`../workflows/${file}`, import.meta.url));
}

function asList(needs: string | string[] | undefined): string[] {
  return Array.isArray(needs) ? needs : needs ? [needs] : [];
}

describe.each(requiredJobsNeedingChanges)('$file $id fails closed on changes', (spec) => {
  const job = loadWorkflow(workflowPath(spec.file)).jobs?.[spec.id];

  test('is the required check name and still needs changes', () => {
    expect(job?.name).toBe(spec.name);
    expect(asList(job?.needs)).toContain('changes');
  });

  test('runs when changes did not succeed, without running on cancellation', () => {
    const condition = String(job?.if ?? '');
    expect(condition).toContain('!cancelled()');
    expect(condition).not.toMatch(/\balways\(\)/);
    expect(condition).toContain("needs.changes.result != 'success'");
    // The normal path-filter skip is still expressed.
    expect(condition).toContain('needs.changes.outputs.');
  });

  test('keeps the other needs results respected', () => {
    const condition = String(job?.if ?? '');
    if (spec.needsBuild) {
      expect(asList(job?.needs)).toContain('build');
      expect(condition).toContain("needs.build.result == 'success'");
    }
  });

  test('errors out right after Harden Runner when changes did not succeed', () => {
    expect(job?.steps?.[0]?.uses).toMatch(/^step-security\/harden-runner@/);
    const first = job?.steps?.[1];
    expect(first?.if).toBe("needs.changes.result != 'success'");
    expect(first?.run).toContain('exit 1');
    expect(first?.run).toContain('::error::');
  });
});
