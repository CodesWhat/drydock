import { fileURLToPath } from 'node:url';

import { loadWorkflow as loadWorkflowFrom } from './workflow-test-utils';

// GitHub runs every `run:` step without an explicit `shell:` under
// `bash -eo pipefail`. `find <dir> ...` exits 0 when `<dir>` exists but is
// empty, but exits 1 when `<dir>` itself is MISSING (verified on this
// machine). ci-verify.yml's load-test steps create their artifact directory
// only on a successful run (scripts/run-load-test.sh), so a failed load test
// leaves the directory absent. Piping that failing `find` straight into
// `sort | head | cut` inside `report="$(...)"` aborts the step under
// pipefail before the deliberate `if [ -z "${report}" ]` empty-report
// handling in scripts/summarize-load-test-report.sh and
// scripts/check-load-test-correctness.sh ever runs -- the same "pipefail
// dead-fallback" class as the i18n-crowdin.yml grep bug covered by
// crowdin-base-branch-resolver.test.ts. The fix wraps the `find` in
// `{ find ... || true; }` so a missing directory yields an empty result
// instead of aborting the step.
//
// Actually executing these steps needs docker + real Artillery artifacts, so
// this is a static assertion over the workflow's `run:` text rather than a
// behavioral test. That's a deliberate tradeoff: it can't prove the guarded
// form behaves correctly end to end, but it can prove -- and keep proving --
// that no `find` piped into a variable assignment ships unguarded.
//
// The sites are discovered dynamically by walking every job/step and
// regex-matching the find-into-assignment shape, rather than pinned to the
// current 8 line numbers or step names. That's the point: it also catches a
// brand new unguarded `find` added later, not just a revert of today's fix.

const workflowPath = fileURLToPath(new URL('../workflows/ci-verify.yml', import.meta.url));
const loadWorkflow = loadWorkflowFrom.bind(undefined, workflowPath);

// Matches a whole-line shell assignment that captures a command
// substitution's output, e.g.:
//   report="$({ find ... || true; } | sort -rn | head -n1 | cut -d' ' -f2-)"
//   current_report="$(find ... | sort -rn | head -n1 | cut -d' ' -f2-)"
const FIND_ASSIGNMENT_LINE = /^\s*\w+="\$\((.*)\)"\s*$/;

// A guarded `find` invocation is wrapped so a non-zero exit (missing
// directory) is swallowed before it can hit the pipe: `{ find ... || true; }`.
const GUARDED_FIND_PREFIX = /^\{\s*find\b[\s\S]*?\|\|\s*true;\s*\}/;

interface FindAssignmentSite {
  jobId: string;
  stepName: string;
  inner: string;
  line: string;
}

function findFindAssignmentSites(): FindAssignmentSite[] {
  const workflow = loadWorkflow();
  const sites: FindAssignmentSite[] = [];

  for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (!step.run) continue;

      for (const line of step.run.split('\n')) {
        const match = line.match(FIND_ASSIGNMENT_LINE);
        if (!match) continue;

        const inner = match[1].trim();
        if (!/\bfind\b/.test(inner)) continue;

        sites.push({
          jobId,
          stepName: step.name ?? '(unnamed step)',
          inner,
          line: line.trim(),
        });
      }
    }
  }

  return sites;
}

test('ci-verify.yml has find-into-variable assignments to guard against pipefail', () => {
  // Sanity check on the sweep itself: if this ever drops to zero, the regex
  // above stopped matching the workflow's actual shape and the guard test
  // below would be vacuously true.
  expect(findFindAssignmentSites().length).toBeGreaterThan(0);
});

test('every find-into-variable pipeline in ci-verify.yml is guarded against a missing-directory exit', () => {
  const unguarded = findFindAssignmentSites().filter(
    (site) => !GUARDED_FIND_PREFIX.test(site.inner),
  );

  expect(unguarded).toStrictEqual([]);
});
