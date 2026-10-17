import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getWorkflowStep, loadWorkflow } from './workflow-test-utils';

const workflowPath = fileURLToPath(new URL('../workflows/ci-verify.yml', import.meta.url));
const job = 'dast-zap-baseline';
const step = (name: string) => getWorkflowStep(workflowPath, job, name);
const contexts = ['authenticated', 'exposure'];

function withReports(run: (root: string, reports: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'dd-nuclei-'));
  const reports = join(root, 'artifacts/dast');
  mkdirSync(reports, { recursive: true });
  try {
    run(root, reports);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runMerge(root: string) {
  const command = step('Merge Nuclei scan reports')?.run;
  expect(command).toBeTruthy();
  return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', command ?? ''], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000,
  });
}

function runGate(root: string, outcome = 'success') {
  return spawnSync(
    'bash',
    ['-e', '-o', 'pipefail', '-c', step('Enforce Nuclei severity gate (medium+)')?.run ?? ''],
    { cwd: root, env: { ...process.env, SCAN_OUTCOME: outcome }, encoding: 'utf8', timeout: 5000 },
  );
}

test('the metrics exposure template runs without credentials and remains covered', () => {
  const exposure = step('Run unauthenticated metrics exposure scan');
  const authenticated = step('Run Nuclei scan');
  expect(exposure?.uses).toBe(authenticated?.uses);
  expect(exposure?.with?.version).toBe(authenticated?.with?.version);
  expect(exposure?.with?.args).toContain('-id prometheus-metrics');
  expect(exposure?.with?.args).not.toMatch(/Cookie:|-H\s|Authorization:/u);
  expect(authenticated?.with?.args).toContain('-H "Cookie:');
  expect(String(authenticated?.with?.args).match(/-exclude-id\s+(\S+)/u)?.[1]).toBe(
    'prometheus-metrics',
  );
  expect(authenticated?.with?.args).not.toContain('-exclude-tags');
  for (const scan of [authenticated, exposure]) {
    expect(scan?.with?.args).toContain('-severity medium,high,critical');
    expect(scan?.with?.args).toContain('-type http');
  }
  const steps = loadWorkflow(workflowPath).jobs?.[job]?.steps ?? [];
  const exposureIndex = steps.findIndex(
    (entry) => entry.name === 'Run unauthenticated metrics exposure scan',
  );
  expect(exposureIndex).toBeGreaterThanOrEqual(0);
  expect(exposureIndex).toBeLessThan(
    steps.findIndex((entry) => entry.name === 'Create Nuclei authenticated session'),
  );
});

test('a failure of either scan or report merge fails the existing gate', () => {
  for (const name of ['Enforce Nuclei severity gate (medium+)', 'Prepare Nuclei SARIF report']) {
    const outcome = step(name)?.env?.SCAN_OUTCOME ?? '';
    for (const id of ['nuclei_auth', 'nuclei_scan', 'nuclei_exposure_scan', 'nuclei_reports']) {
      expect(outcome).toContain(`steps.${id}.outcome == 'success'`);
    }
  }
});

test.each(contexts)('a medium finding from %s remains blocking after merge', (context) => {
  withReports((root, reports) => {
    writeFileSync(
      join(reports, `nuclei-${context}-report.json`),
      JSON.stringify([{ 'template-id': 'prometheus-metrics', info: { severity: 'medium' } }]),
    );
    expect(runMerge(root).status).toBe(0);
    expect(runGate(root).status).toBe(1);
    const combined = JSON.parse(readFileSync(join(reports, 'nuclei-report.json'), 'utf8'));
    expect(combined).toHaveLength(1);
  });
});

test('array and JSONL findings merge while SARIF contexts stay separate', () => {
  withReports((root, reports) => {
    for (const [index, context] of contexts.entries()) {
      const finding = { 'template-id': context, info: { severity: 'high' } };
      writeFileSync(
        join(reports, `nuclei-${context}-report.json`),
        JSON.stringify(index === 0 ? [finding] : finding),
      );
      writeFileSync(
        join(reports, `nuclei-${context}-report.sarif`),
        JSON.stringify({
          version: '2.1.0',
          runs: [{ tool: { driver: { name: 'Nuclei' } }, properties: { context }, results: [] }],
        }),
      );
    }
    expect(runMerge(root).status).toBe(0);
    expect(JSON.parse(readFileSync(join(reports, 'nuclei-report.json'), 'utf8'))).toHaveLength(2);
    const sarif = JSON.parse(readFileSync(join(reports, 'nuclei-report.sarif'), 'utf8'));
    expect(sarif.runs[0].properties.context).toBe('authenticated');
    expect(sarif.runs).toHaveLength(1);
    const exposure = JSON.parse(
      readFileSync(join(reports, 'nuclei-exposure-report.sarif'), 'utf8'),
    );
    expect(exposure.runs[0].properties.context).toBe('exposure');
  });
});

test('both SARIF contexts have distinct Code Scanning uploads', () => {
  const authenticated = step('Upload Nuclei SARIF to code scanning');
  const exposure = step('Upload unauthenticated metrics SARIF');
  expect(exposure?.with?.sarif_file).toBe('artifacts/dast/nuclei-exposure-report.sarif');
  expect(exposure?.with?.category).toBe('nuclei-metrics-unauthenticated');
  expect(exposure?.with?.category).not.toBe(authenticated?.with?.category);
  expect(exposure?.if).toContain("steps.nuclei_reports.outcome == 'success'");
});

test.each([
  { version: '2.0.0', runs: [] },
  { version: '2.1.0', runs: {} },
])('invalid SARIF structure stays blocking: %j', (sarif) => {
  withReports((root, reports) => {
    writeFileSync(join(reports, 'nuclei-exposure-report.sarif'), JSON.stringify(sarif));
    expect(runMerge(root).status).not.toBe(0);
    expect(runGate(root, 'failure').status).toBe(1);
  });
});

test.each(['json', 'sarif'])('malformed %s cannot become a successful merged scan', (extension) => {
  withReports((root, reports) => {
    writeFileSync(join(reports, `nuclei-exposure-report.${extension}`), '{');
    expect(runMerge(root).status).not.toBe(0);
    expect(runGate(root, 'failure').status).toBe(1);
  });
});

test('successful no-match scans remain clean while a failed empty scan stays blocked', () => {
  withReports((root) => {
    expect(runMerge(root).status).toBe(0);
    expect(runGate(root).status).toBe(0);
    expect(runGate(root, 'failure').status).toBe(1);
  });
});

test('successful empty SARIF outputs become valid empty analyses for both categories', () => {
  withReports((root, reports) => {
    for (const context of contexts) {
      writeFileSync(join(reports, `nuclei-${context}-report.sarif`), '');
    }
    expect(runMerge(root).status).toBe(0);
    for (const context of contexts) {
      const report = JSON.parse(
        readFileSync(join(reports, `nuclei-${context}-report.sarif`), 'utf8'),
      );
      expect(report.version).toBe('2.1.0');
      expect(report.runs[0].tool.driver.name).toBe('Nuclei');
      expect(report.runs[0].results).toEqual([]);
    }
    expect(runGate(root).status).toBe(0);
  });
});
