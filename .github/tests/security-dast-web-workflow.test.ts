// Regression guard for security-dast-web.yml's ZAP/Nuclei job split.
//
// Before v1.7.0-rc.6, ZAP and Nuclei ran as steps inside one job sharing a
// single 40-minute budget. The ZAP full active scan alone regularly takes
// ~39m46s against the live site, so it consumed the whole budget and Nuclei's
// steps never got a turn: the Nuclei report file was never written, and the
// severity-gate and SARIF-upload steps ran (or were skipped) against a file
// that did not exist. This had never once completed successfully.
//
// The failure was silent: the workflow only runs on a Wednesday cron with no
// pull_request trigger, so nothing forced anyone to look at it, and it stayed
// broken for an unknown number of weeks before anyone noticed. A green run of
// this test suite does not prove ZAP/Nuclei themselves still work -- it only
// pins the job shape (separate jobs, no cross-job `needs`, each with its own
// timeout and its own report file) that made the original bug possible to
// reintroduce silently. If this file is ever deleted because "the workflow
// passes fine," that is exactly the blind spot it exists to close.

import { fileURLToPath } from 'node:url';

import {
  getWorkflowStep as getWorkflowStepFrom,
  loadWorkflow as loadWorkflowFrom,
} from './workflow-test-utils';

const workflowPath = fileURLToPath(new URL('../workflows/security-dast-web.yml', import.meta.url));
const loadWorkflow = loadWorkflowFrom.bind(undefined, workflowPath);
const getWorkflowStep = getWorkflowStepFrom.bind(undefined, workflowPath);

const ZAP_JOB = 'dast-web-zap';
const NUCLEI_JOB = 'dast-web-nuclei';

test('ZAP and Nuclei run as separate top-level jobs, not steps in one job', () => {
  const workflow = loadWorkflow();

  expect(workflow.jobs?.[ZAP_JOB]).toBeDefined();
  expect(workflow.jobs?.[NUCLEI_JOB]).toBeDefined();
  expect(workflow.jobs?.[ZAP_JOB]).not.toBe(workflow.jobs?.[NUCLEI_JOB]);
});

test('neither DAST job depends on the other, so they run in parallel', () => {
  const workflow = loadWorkflow();

  // A `needs` edge between these two would recreate the sequential-budget
  // failure even with separate timeouts: a slow ZAP run would still delay
  // Nuclei past a scheduled window instead of the two racing independently.
  //
  // Only the edge BETWEEN them matters. A shared prerequisite (say both
  // needing a `prepare-dast` job) still lets them run in parallel, so assert
  // the sibling is absent rather than that `needs` is unset. `needs` is a
  // string when there is one dependency and an array when there are several.
  const dependenciesOf = (jobId: string): string[] => {
    const needs = workflow.jobs?.[jobId]?.needs;
    if (needs === undefined) {
      return [];
    }
    return Array.isArray(needs) ? needs : [needs];
  };

  expect(dependenciesOf(ZAP_JOB)).not.toContain(NUCLEI_JOB);
  expect(dependenciesOf(NUCLEI_JOB)).not.toContain(ZAP_JOB);
});

test("ZAP's own budget exceeds the measured full-scan duration", () => {
  const workflow = loadWorkflow();

  const zapTimeout = workflow.jobs?.[ZAP_JOB]?.['timeout-minutes'];
  const nucleiTimeout = workflow.jobs?.[NUCLEI_JOB]?.['timeout-minutes'];

  // Measured full active scan against getdrydock.com: ~39m46s. Floor of 45
  // (not a pin on the current 60) so raising the budget later doesn't fail
  // this test, but lowering it back under the known scan duration does.
  expect(zapTimeout).toBeGreaterThanOrEqual(45);
  expect(typeof nucleiTimeout).toBe('number');
});

test('Nuclei steps live in the Nuclei job, not the ZAP job', () => {
  const nucleiScanStep = getWorkflowStep(NUCLEI_JOB, 'Run Nuclei scan');
  expect(nucleiScanStep?.uses).toContain('projectdiscovery/nuclei-action');
  expect(nucleiScanStep?.id).toBe('nuclei_scan');

  expect(getWorkflowStep(ZAP_JOB, 'Run Nuclei scan')).toBeUndefined();

  const zapSteps = loadWorkflow().jobs?.[ZAP_JOB]?.steps ?? [];
  expect(zapSteps.some((step) => step.uses?.includes('nuclei-action'))).toBe(false);

  const nucleiSteps = loadWorkflow().jobs?.[NUCLEI_JOB]?.steps ?? [];
  expect(
    nucleiSteps.some(
      (step) =>
        step.uses?.includes('zaproxy/action-full-scan') ||
        step.uses?.includes('zaproxy/action-baseline'),
    ),
  ).toBe(false);
});

test("each scanner's gate reads a report file produced in its own job, never the sibling's", () => {
  // ZAP: the SARIF conversion step in the ZAP job reads the file ZAP's own
  // scan step produces (report_json.json is zaproxy/action-full-scan's fixed
  // output name).
  const zapConvertStep = getWorkflowStep(ZAP_JOB, 'Convert ZAP JSON report to SARIF');
  expect(zapConvertStep?.if).toContain("hashFiles('report_json.json')");
  expect(zapConvertStep?.run).toContain('--input=report_json.json');

  // The ZAP job must never reference the Nuclei job's report -- that's the
  // exact shape of the original bug (a gate reading a sibling job's file
  // that a cancelled/starved job never wrote).
  // Serialize the whole step rather than naming fields. A report path reaches
  // the shell just as well through `env:` as through `run:`, so an allow-list
  // of fields passes while the sibling reference is still live.
  const zapSteps = loadWorkflow().jobs?.[ZAP_JOB]?.steps ?? [];
  const zapReferencesNucleiReport = zapSteps.some((step) =>
    JSON.stringify(step).includes('nuclei-report'),
  );
  expect(zapReferencesNucleiReport).toBe(false);

  // Nuclei: extract the export path the scan step writes and assert the
  // severity gate in the same job reads that exact path.
  const nucleiScanStep = getWorkflowStep(NUCLEI_JOB, 'Run Nuclei scan');
  const exportMatch = nucleiScanStep?.with?.args?.toString().match(/-json-export\s+(\S+)/u);
  expect(exportMatch?.[1]).toBe('artifacts/dast/nuclei-report.json');

  const nucleiGateStep = getWorkflowStep(NUCLEI_JOB, 'Enforce Nuclei severity gate (medium+)');
  expect(nucleiGateStep?.run).toContain(`report="${exportMatch?.[1]}"`);

  // The Nuclei job must never reference the ZAP job's report file either.
  const nucleiSteps = loadWorkflow().jobs?.[NUCLEI_JOB]?.steps ?? [];
  const nucleiReferencesZapReport = nucleiSteps.some(
    (step) =>
      step.run?.includes('report_json.json') ||
      step.if?.includes('report_json.json') ||
      JSON.stringify(step.with ?? {}).includes('report_json.json'),
  );
  expect(nucleiReferencesZapReport).toBe(false);
});
