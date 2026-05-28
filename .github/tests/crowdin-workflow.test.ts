import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

interface WorkflowStep {
  name?: string;
  uses?: string;
  with?: Record<string, string>;
  'continue-on-error'?: boolean;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface WorkflowDefinition {
  jobs?: Record<string, WorkflowJob>;
}

interface CrowdinConfig {
  files?: Array<{
    languages_mapping?: {
      locale?: Record<string, string>;
    };
  }>;
}

const workflowPath = fileURLToPath(new URL('../workflows/i18n-crowdin.yml', import.meta.url));
const crowdinConfigPath = fileURLToPath(new URL('../../crowdin.yml', import.meta.url));
const crowdinActionRef = 'crowdin/github-action@8868a33591d21088edfc398968173a3b98d51706';

function loadCrowdinWorkflowStep(): WorkflowStep {
  const workflow = yaml.parse(readFileSync(workflowPath, 'utf8')) as WorkflowDefinition;
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

test('Crowdin workflow lets crowdin.yml own the target language list', () => {
  const step = loadCrowdinWorkflowStep();
  const config = yaml.parse(readFileSync(crowdinConfigPath, 'utf8')) as CrowdinConfig;
  const mappedLanguages = Object.keys(config.files?.[0]?.languages_mapping?.locale ?? {});

  expect(mappedLanguages).toContain('es-ES');
  expect(mappedLanguages).toContain('zh-TW');
  expect(step.with?.download_translations_args).toBeUndefined();
});
