import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

import { loadWorkflow, type WorkflowStep } from './workflow-test-utils';

interface CrowdinConfig {
  files?: Array<{
    languages_mapping?: {
      locale?: Record<string, string>;
    };
  }>;
}

const workflowPath = fileURLToPath(new URL('../workflows/i18n-crowdin.yml', import.meta.url));
const crowdinConfigPath = fileURLToPath(new URL('../../crowdin.yml', import.meta.url));
const crowdinActionRef = 'crowdin/github-action@52aa776766211d83d975df51f3b9c53c2f8ba35f';
const integrationBranchCheckoutStepName =
  'Check out the integration branch so l10n_crowdin forks from it';

function loadCrowdinWorkflowStep(): WorkflowStep {
  const workflow = loadWorkflow(workflowPath);
  const step = workflow.jobs?.sync?.steps?.find((step) =>
    step.uses?.startsWith('crowdin/github-action@'),
  );

  if (!step) {
    throw new Error('Expected i18n-crowdin.yml to include a Crowdin action step');
  }

  return step;
}

test('Crowdin action uses the current immutable release pin', () => {
  expect(loadCrowdinWorkflowStep().uses).toBe(crowdinActionRef);
});

test('Crowdin action runs as workspace owner and surfaces sync failures', () => {
  const step = loadCrowdinWorkflowStep();

  expect(step.with?.user).toBe('auto');
  expect(step['continue-on-error']).toBeUndefined();
});

test('Crowdin checks out the resolved integration branch before creating its branch', () => {
  const steps = loadWorkflow(workflowPath).jobs?.sync?.steps ?? [];
  const baseStepIndex = steps.findIndex((step) => step.id === 'base');
  const checkoutStepIndex = steps.findIndex(
    (step) => step.name === integrationBranchCheckoutStepName,
  );
  const crowdinStepIndex = steps.findIndex((step) =>
    step.uses?.startsWith('crowdin/github-action@'),
  );
  const checkoutStep = steps[checkoutStepIndex];

  expect(baseStepIndex).toBeGreaterThanOrEqual(0);
  expect(checkoutStepIndex).toBeGreaterThan(baseStepIndex);
  expect(crowdinStepIndex).toBeGreaterThan(checkoutStepIndex);

  expect(checkoutStep?.env?.BASE).toBe('${{ steps.base.outputs.name }}');
  expect(checkoutStep?.run).not.toContain('${{ steps.base.outputs.name }}');

  const fetchCommand = 'git fetch origin "refs/heads/${BASE}:refs/remotes/origin/${BASE}"';
  const checkoutCommand = 'git checkout -B "${BASE}" "refs/remotes/origin/${BASE}"';
  expect(checkoutStep?.run).toContain(fetchCommand);
  expect(checkoutStep?.run).toContain(checkoutCommand);
  expect(checkoutStep?.run?.indexOf(fetchCommand)).toBeLessThan(
    checkoutStep?.run?.indexOf(checkoutCommand) ?? -1,
  );
});

test('Crowdin workflow lets crowdin.yml own the target language list', () => {
  const step = loadCrowdinWorkflowStep();
  const config = yaml.parse(readFileSync(crowdinConfigPath, 'utf8')) as CrowdinConfig;
  const mappedLanguages = Object.keys(config.files?.[0]?.languages_mapping?.locale ?? {});

  expect(mappedLanguages).toContain('es-ES');
  expect(mappedLanguages).toContain('zh-TW');
  expect(step.with?.download_translations_args).toBeUndefined();
});

test('Crowdin PR creation authenticates with a minted App token, not the ambient GITHUB_TOKEN', () => {
  // The ambient GITHUB_TOKEN can't create pull requests here
  // (can_approve_pull_request_reviews is false org-wide), so the crowdin step
  // 403'd with "GitHub Actions is not permitted to create or approve pull
  // requests" right after it pushed l10n_crowdin — translations landed but the
  // PR never opened. A dedicated GitHub App installation token is the fix.
  const steps = loadWorkflow(workflowPath).jobs?.sync?.steps ?? [];
  const appTokenStepIndex = steps.findIndex((step) => step.id === 'app-token');
  const crowdinStepIndex = steps.findIndex((step) =>
    step.uses?.startsWith('crowdin/github-action@'),
  );
  const appTokenStep = steps[appTokenStepIndex];
  const crowdinStep = steps[crowdinStepIndex];

  expect(appTokenStepIndex).toBeGreaterThanOrEqual(0);
  expect(appTokenStep?.uses).toBe(
    'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1',
  );
  expect(appTokenStep?.with?.['app-id']).toBe('${{ secrets.CROWDIN_APP_ID }}');
  expect(appTokenStep?.with?.['private-key']).toBe('${{ secrets.CROWDIN_APP_PRIVATE_KEY }}');

  expect(crowdinStepIndex).toBeGreaterThan(appTokenStepIndex);
  expect(crowdinStep?.env?.GITHUB_TOKEN).toBe('${{ steps.app-token.outputs.token }}');
});
