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

// Reconstructs logical shell lines from a `run:` block by folding backslash
// continuations, so a site reformatted across `\` line breaks is still
// discovered by the single-line FIND_ASSIGNMENT_LINE regex below. A line
// ending in a trailing `\` (optionally followed by trailing whitespace)
// continues onto the next physical line.
function joinContinuations(run: string): string[] {
  const logicalLines: string[] = [];
  let pending = '';

  for (const rawLine of run.split('\n')) {
    const continued = /\\\s*$/.test(rawLine);
    const chunk = continued ? rawLine.replace(/\\\s*$/, '') : rawLine;
    pending += (pending ? ' ' : '') + chunk.trim();

    if (!continued) {
      logicalLines.push(pending);
      pending = '';
    }
  }

  if (pending) logicalLines.push(pending);

  return logicalLines;
}

function findFindAssignmentSites(): FindAssignmentSite[] {
  const workflow = loadWorkflow();
  const sites: FindAssignmentSite[] = [];

  for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (!step.run) continue;

      for (const line of joinContinuations(step.run)) {
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

// Pinned to the current count of guarded find-into-assignment sites in
// ci-verify.yml. This must be bumped deliberately, in either direction, when
// a site is added or removed -- a plain `> 0` sanity check would let the
// sweep silently drop sites (e.g. a regex that stops matching a reformatted
// site) without failing.
const EXPECTED_FIND_ASSIGNMENT_SITE_COUNT = 8;

test('ci-verify.yml has find-into-variable assignments to guard against pipefail', () => {
  // Sanity check on the sweep itself: pinned to the exact expected count
  // rather than `> 0` so a drop in EITHER direction fails loudly -- including
  // a site silently falling out of the sweep (e.g. reformatted across a
  // backslash continuation that the regex no longer matches).
  expect(findFindAssignmentSites().length).toBe(EXPECTED_FIND_ASSIGNMENT_SITE_COUNT);
});

test('every find-into-variable pipeline in ci-verify.yml is guarded against a missing-directory exit', () => {
  const unguarded = findFindAssignmentSites().filter(
    (site) =>
      !GUARDED_FIND_PREFIX.test(site.inner) ||
      // GUARDED_FIND_PREFIX only anchors the *first* stage, so a pipeline like
      // `{ find a || true; } | find b ...` would otherwise pass with its second
      // find still able to abort under pipefail. Rather than try to parse each
      // stage, require exactly one find per assignment: every site here has one,
      // and a second one should fail this test so someone has to look at it.
      (site.inner.match(/\bfind\b/g) ?? []).length !== 1,
  );

  expect(unguarded).toStrictEqual([]);
});
