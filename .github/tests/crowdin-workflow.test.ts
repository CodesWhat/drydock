import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

import { loadWorkflow, type WorkflowStep } from './workflow-test-utils';

interface CrowdinConfig {
  files?: Array<{
    source?: string;
    translation?: string;
    excluded_target_languages?: string[];
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

test('Crowdin sync manages the six translated READMEs independently of UI catalogs', () => {
  const workflow = loadWorkflow(workflowPath);
  const config = yaml.parse(readFileSync(crowdinConfigPath, 'utf8')) as CrowdinConfig;
  const readmeFileSet = config.files?.find((file) => file.source === '/README.md');

  expect(readmeFileSet).toEqual({
    source: '/README.md',
    translation: '/README.%locale%.md',
    languages_mapping: {
      locale: {
        de: 'de',
        'es-ES': 'es',
        fr: 'fr',
        pl: 'pl',
        'pt-BR': 'pt-BR',
        'zh-CN': 'zh-CN',
      },
    },
    excluded_target_languages: ['ar', 'it', 'ja', 'ko', 'nl', 'ru', 'tr', 'uk', 'vi', 'zh-TW'],
    update_option: 'update_as_unapproved',
  });
  expect(workflow.on?.push?.paths).toContain('README.md');
  expect(workflow.on?.push?.paths).not.toContain('README.*.md');
});
