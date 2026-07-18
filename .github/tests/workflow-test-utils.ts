import { readFileSync } from 'node:fs';

import yaml from 'yaml';

export interface WorkflowStep {
  env?: Record<string, string>;
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean;
  'working-directory'?: string;
  if?: string;
}

export interface WorkflowJob {
  env?: Record<string, string>;
  name?: string;
  steps?: WorkflowStep[];
  strategy?: {
    matrix?: {
      include?: Array<{
        name?: string;
        package?: string;
        mutate?: string;
      }>;
    };
  };
  'runs-on'?: string | string[];
  'timeout-minutes'?: number;
  if?: string;
  needs?: string | string[];
}

export interface WorkflowDefinition {
  env?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
  on?: {
    schedule?: Array<{
      cron?: string;
    }>;
    [trigger: string]: unknown;
  };
}

export function loadWorkflow(path: string): WorkflowDefinition {
  return yaml.parse(readFileSync(path, 'utf8')) as WorkflowDefinition;
}

export function getWorkflowStep(
  path: string,
  jobId: string,
  name: string,
): WorkflowStep | undefined {
  return loadWorkflow(path).jobs?.[jobId]?.steps?.find((step) => step.name === name);
}
