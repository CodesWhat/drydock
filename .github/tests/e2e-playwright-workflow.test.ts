import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

import {
  getWorkflowStep as getWorkflowStepFrom,
  loadWorkflow as loadWorkflowFrom,
} from './workflow-test-utils';

const workflowPath = fileURLToPath(new URL('../workflows/e2e-playwright.yml', import.meta.url));
const qaComposePath = fileURLToPath(new URL('../../test/qa-compose.yml', import.meta.url));
const playwrightConfigPath = fileURLToPath(
  new URL('../../e2e/playwright.config.ts', import.meta.url),
);
const authSetupPath = fileURLToPath(new URL('../../e2e/playwright/auth.setup.ts', import.meta.url));
const loadWorkflow = loadWorkflowFrom.bind(undefined, workflowPath);
const getWorkflowStep = getWorkflowStepFrom.bind(undefined, workflowPath);

test('Playwright workflow disables browser downloads for host-side npm installs', () => {
  const workflow = loadWorkflow();

  expect(workflow.env).toMatchObject({
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  });
  expect(getWorkflowStep('playwright', 'Install ui dependencies')).toMatchObject({
    uses: 'nick-fields/retry@ad984534de44a9489a53aefd81eb77f87c70dc60',
    with: {
      command: 'cd ui && npm ci',
    },
  });
});

test('Playwright can be dispatched against a frozen release candidate', () => {
  const workflow = loadWorkflow();

  expect(workflow.on).toHaveProperty('workflow_dispatch');
  expect(getWorkflowStep('changes', 'Filter paths')?.with?.base).toContain(
    "github.event_name == 'workflow_dispatch'",
  );
  expect(workflow.jobs?.playwright?.if).toContain("github.event_name == 'workflow_dispatch'");
  expect(workflow.jobs?.changes?.if).toBeUndefined();
  expect(workflow.jobs?.playwright?.needs).toStrictEqual(['changes']);
});

test('Playwright QA isolates the full browser suite from the production API request budget', () => {
  const qaCompose = readFileSync(qaComposePath, 'utf8');

  expect(qaCompose).toMatch(/^\s*-\s+DD_SERVER_RATELIMIT_MAX=10000\s*$/mu);
  expect(qaCompose).toMatch(/^\s*-\s+DD_ICON_PROXY_RATE_LIMIT_MAX=1000\s*$/mu);
});

test('Playwright QA fails closed when required remote fixtures cannot be seeded', () => {
  const qaCompose = yaml.parse(readFileSync(qaComposePath, 'utf8')) as {
    services?: Record<
      string,
      {
        command?: string[];
        depends_on?: Record<string, { condition?: string }>;
        volumes?: string[];
      }
    >;
  };

  expect(qaCompose.services?.drydock?.depends_on?.['remote-bootstrap']).toStrictEqual({
    condition: 'service_completed_successfully',
  });
  const remoteBootstrap = qaCompose.services?.['remote-bootstrap'];
  expect(remoteBootstrap?.volumes).toContain('/var/run/docker.sock:/var/run/docker-host.sock');
  const bootstrapCommand = remoteBootstrap?.command?.join('\n') ?? '';
  expect(bootstrapCommand).toContain('set -eu');
  expect(bootstrapCommand).toContain('pull_with_retry');
  expect(bootstrapCommand).toMatch(/\[\s*"\$\$attempt"\s+-ge\s+3\s*\]/u);
  expect(bootstrapCommand).toContain('docker --host "$$host_docker" pull');
  expect(bootstrapCommand).toContain('docker --host "$$host_docker" save --output "$$archive"');
  expect(bootstrapCommand).toContain('docker load --input "$$archive"');
});

test('Playwright waits for one complete QA scan before browser tests and parks background scans', () => {
  const workflow = loadWorkflow();
  const steps = workflow.jobs?.playwright?.steps ?? [];
  const authSetup = readFileSync(authSetupPath, 'utf8');
  const healthIndex = steps.findIndex((step) => step.name === 'Wait for QA health');
  const playwrightIndex = steps.findIndex((step) => step.name === 'Run Playwright tests');
  const loginIndex = authSetup.indexOf('await loginWithBasicAuth(page, credentials)');
  const readinessIndex = authSetup.indexOf('.poll(');

  expect(healthIndex).toBeGreaterThan(-1);
  expect(playwrightIndex).toBeGreaterThan(healthIndex);
  expect(getWorkflowStep('playwright', 'Wait for QA fixture readiness')).toBeUndefined();
  expect(loginIndex).toBeGreaterThan(-1);
  expect(readinessIndex).toBeGreaterThan(loginIndex);
  expect(authSetup).toContain('/api/v1/containers?limit=100');
  expect(authSetup).not.toContain('/api/v1/containers/watch');
  expect(authSetup).toContain('page.request.get');
  expect(authSetup).toContain('180_000');
  expect(authSetup).toContain('Nginx (Hooked)');
  expect(authSetup).toContain("container.labels?.['dd.group'] === 'web-stack'");
  expect(authSetup).toContain('container.result');
  expect(authSetup).toContain('container.updateAvailable === true');

  const qaCompose = yaml.parse(readFileSync(qaComposePath, 'utf8')) as {
    services?: Record<string, { environment?: string[] }>;
  };
  const environment = qaCompose.services?.drydock?.environment ?? [];
  expect(environment).toContain('DD_WATCHER_LOCAL_CRON=0 0 29 2 *');
  expect(environment).toContain('DD_WATCHER_REMOTE_CRON=0 0 29 2 *');
  expect(environment).toContain('DD_WATCHER_LOCAL_JITTER=0');
  expect(environment).toContain('DD_WATCHER_REMOTE_JITTER=0');
  expect(environment).toContain('DD_WATCHER_LOCAL_WATCHEVENTS=false');
  expect(environment).toContain('DD_WATCHER_REMOTE_WATCHEVENTS=false');
});

test('Playwright health fixture waits until Docker observes the unhealthy transition', () => {
  const qaCompose = yaml.parse(readFileSync(qaComposePath, 'utf8')) as {
    services?: Record<
      string,
      {
        command?: string[];
        healthcheck?: { test?: string[] };
      }
    >;
  };

  const fixture = qaCompose.services?.['health-transition'];
  const fixtureCommand = fixture?.command?.join('\n') ?? '';
  const healthcheck = fixture?.healthcheck?.test?.join('\n') ?? '';

  expect(fixtureCommand).toContain('/state/observed-unhealthy');
  expect(fixtureCommand).toContain('healthcheck did not observe unhealthy state');
  expect(healthcheck).toContain('touch /state/observed-unhealthy');
});

test('Playwright preserves first-failure evidence without retrying the whole suite', () => {
  const playwrightConfig = readFileSync(playwrightConfigPath, 'utf8');

  expect(playwrightConfig).toMatch(/^\s*retries:\s*0,\s*$/mu);
  expect(playwrightConfig).toContain("trace: 'retain-on-failure'");
});
