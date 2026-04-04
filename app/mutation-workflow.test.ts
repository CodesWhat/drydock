import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

import uiStrykerConfig from '../ui/stryker.conf.mjs';

interface WorkflowTrigger {
  schedule?: Array<{
    cron?: string;
  }>;
}

interface WorkflowMatrixEntry {
  name?: string;
  package?: string;
  mutate?: string;
}

interface WorkflowJobStep {
  name?: string;
  run?: string;
}

interface WorkflowJob {
  strategy?: {
    matrix?: {
      include?: WorkflowMatrixEntry[];
    };
  };
  steps?: WorkflowJobStep[];
}

interface WorkflowDefinition {
  on?: WorkflowTrigger;
  jobs?: Record<string, WorkflowJob>;
}

const workflowPath = fileURLToPath(
  new URL('../.github/workflows/quality-mutation-monthly.yml', import.meta.url),
);
const expectedAppMutatePatterns = [
  'api/**/*.ts',
  'agent/**/*.ts',
  'authentications/providers/**/*.ts',
  'configuration/**/*.ts',
  'debug/**/*.ts',
  'event/**/*.ts',
  'log/**/*.ts',
  'model/**/*.ts',
  'notifications/trigger-policy.ts',
  'docker/legacy-label.ts',
  'index.ts',
  'triggers/**/*.ts',
  'release-notes/**/*.ts',
  'registry/**/*.ts',
  'runtime/**/*.ts',
  'util/**/*.ts',
  'tag/**/*.ts',
  'watchers/**/*.ts',
  'store/**/*.ts',
  'registries/**/*.ts',
  'security/**/*.ts',
  'stats/**/*.ts',
  'prometheus/**/*.ts',
  '!**/*.d.ts',
  '!**/*.test.ts',
  '!**/*.fuzz.test.ts',
  '!**/*.typecheck.ts',
  '!test/**',
  '!dist/**',
  '!coverage/**',
];

function expandMutatePatterns(cwd: string, patterns: string[]): string[] {
  const includes = patterns.filter((pattern) => pattern && !pattern.startsWith('!'));
  const excludes = patterns
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => pattern.slice(1));

  return [...new Set(includes.flatMap((pattern) => globSync(pattern, { cwd, exclude: excludes })))]
    .filter((path) => !path.startsWith('node_modules/'))
    .sort();
}

function splitMutateEntry(entry: WorkflowMatrixEntry): string[] {
  return (entry.mutate ?? '')
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

test('mutation workflow runs monthly with 20 logical slices and aggregate count parity', () => {
  const workflow = yaml.parse(readFileSync(workflowPath, 'utf8')) as WorkflowDefinition;

  expect(workflow.on?.schedule).toStrictEqual([{ cron: '15 6 1 * *' }]);

  const matrixEntries = workflow.jobs?.stryker?.strategy?.matrix?.include ?? [];

  expect(matrixEntries).toHaveLength(20);
  expect(new Set(matrixEntries.map((entry) => entry.name)).size).toBe(20);
  expect(new Set(matrixEntries.map((entry) => entry.package))).toStrictEqual(
    new Set(['app', 'ui']),
  );

  const aggregateRunScript = workflow.jobs?.aggregate?.steps?.find(
    (step) => step.name === 'Aggregate shard scores',
  )?.run;

  expect(aggregateRunScript).toContain('--expected-count 20');
});

test('mutation workflow slices cover the app and ui Stryker targets without overlap', () => {
  const workflow = yaml.parse(readFileSync(workflowPath, 'utf8')) as WorkflowDefinition;
  const matrixEntries = workflow.jobs?.stryker?.strategy?.matrix?.include ?? [];

  const appEntries = matrixEntries.filter((entry) => entry.package === 'app');
  const uiEntries = matrixEntries.filter((entry) => entry.package === 'ui');

  const expectedAppFiles = expandMutatePatterns('.', expectedAppMutatePatterns);
  const expectedUiFiles = expandMutatePatterns('../ui', uiStrykerConfig.mutate);

  const appCoverage = new Map<string, string[]>();
  for (const entry of appEntries) {
    const files = expandMutatePatterns('.', splitMutateEntry(entry));
    for (const file of files) {
      const owners = appCoverage.get(file) ?? [];
      owners.push(entry.name ?? 'unknown');
      appCoverage.set(file, owners);
    }
  }

  const uiCoverage = new Map<string, string[]>();
  for (const entry of uiEntries) {
    const files = expandMutatePatterns('../ui', splitMutateEntry(entry));
    for (const file of files) {
      const owners = uiCoverage.get(file) ?? [];
      owners.push(entry.name ?? 'unknown');
      uiCoverage.set(file, owners);
    }
  }

  expect([...appCoverage.keys()].sort()).toStrictEqual(expectedAppFiles);
  expect([...uiCoverage.keys()].sort()).toStrictEqual(expectedUiFiles);

  const overlappingAppFiles = [...appCoverage.entries()].filter(([, owners]) => owners.length > 1);
  const overlappingUiFiles = [...uiCoverage.entries()].filter(([, owners]) => owners.length > 1);

  expect(overlappingAppFiles).toStrictEqual([]);
  expect(overlappingUiFiles).toStrictEqual([]);
});
