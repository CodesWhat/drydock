import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadWorkflow as loadWorkflowFrom } from './workflow-test-utils';

const workflowPath = fileURLToPath(new URL('../workflows/ci-verify.yml', import.meta.url));
const playwrightConfigPath = fileURLToPath(
  new URL('../../apps/web/playwright.config.ts', import.meta.url),
);
const webPackagePath = fileURLToPath(new URL('../../apps/web/package.json', import.meta.url));

const webJob = () => loadWorkflowFrom(workflowPath).jobs?.web;
const browserStep = () =>
  webJob()?.steps?.find((step) => step.name === 'Browser checks (chromium, firefox, webkit)');

test('the required web check keeps its name and still builds the site', () => {
  expect(webJob()?.name).toBe('Web: Site Build & Scripts Tests');
  const names = (webJob()?.steps ?? []).map((step) => step.name);
  expect(names).toContain('Build site (Next.js)');
  expect(names.indexOf('Browser checks (chromium, firefox, webkit)')).toBeGreaterThan(
    names.indexOf('Build site (Next.js)'),
  );
});

test('the web job runs the browser checks in the required job, not alongside it', () => {
  const step = browserStep();
  expect(step?.run).toContain('npx playwright test');
  expect(step?.run).toContain('--retries=1');
  expect(step?.run).toContain('--network host');
});

test('no web job step can swallow a browser failure', () => {
  const job = webJob();
  expect(job?.['continue-on-error' as keyof typeof job]).toBeUndefined();
  for (const step of job?.steps ?? []) {
    expect(step['continue-on-error'], step.name).toBeUndefined();
    expect(step.with?.continue_on_error, step.name).toBeUndefined();
  }
  expect(browserStep()?.if).toBeUndefined();
  expect(browserStep()?.run).not.toMatch(/\|\|\s*true/);
});

test('the browser run covers chromium, firefox and webkit', () => {
  const config = readFileSync(playwrightConfigPath, 'utf8');
  for (const engine of ['chromium', 'firefox', 'webkit']) {
    expect(config).toMatch(new RegExp(`name: "${engine}"`));
  }
  // A --project filter on the command would silently drop engines.
  expect(browserStep()?.run).not.toMatch(/--project|--grep/);
});

test('the Playwright image is pinned by digest and tracks the package version', () => {
  const image = webJob()?.env?.PLAYWRIGHT_IMAGE ?? '';
  const match = image.match(/:v(\d+\.\d+\.\d+)-noble@sha256:[0-9a-f]{64}$/);
  expect(match, image).not.toBeNull();
  const pkg = JSON.parse(readFileSync(webPackagePath, 'utf8'));
  expect(pkg.devDependencies['@playwright/test']).toBe(match?.[1]);
});

test('the browser job has a bound timeout and uploads its report on failure', () => {
  expect(webJob()?.['timeout-minutes']).toBeGreaterThan(15);
  expect(webJob()?.['timeout-minutes']).toBeLessThanOrEqual(35);
  expect(browserStep()?.['timeout-minutes' as keyof ReturnType<typeof browserStep>]).toBe(12);
  const upload = webJob()?.steps?.find((step) => step.name === 'Upload browser check report');
  expect(upload?.if).toContain('failure()');
  expect(upload?.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
});

test('egress adds only the registry hosts the image pull needs', () => {
  const harden = webJob()?.steps?.find((step) => step.name === 'Harden Runner');
  const endpoints = String(harden?.with?.['allowed-endpoints'] ?? '').split(/\s+/);
  expect(endpoints).toEqual(
    expect.arrayContaining(['mcr.microsoft.com:443', '*.data.mcr.microsoft.com:443']),
  );
  expect(endpoints.filter((endpoint) => /playwright|azureedge|ubuntu/.test(endpoint))).toEqual([]);
  expect(harden?.with?.['egress-policy']).toBe('block');
  expect(harden?.with?.['disable-sudo']).toBe(true);
});
