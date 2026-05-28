import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

interface ActionStep {
  uses?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  steps?: ActionStep[];
}

interface WorkflowDocument {
  jobs?: Record<string, WorkflowJob>;
}

interface CompositeActionDocument {
  runs?: {
    steps?: ActionStep[];
  };
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const expectedActionPins = new Map([
  ['actions/cache', 'actions/cache@668228422ae6a00e4ad889ee87cd7109ec5666a7  # v5.0.4'],
  ['actions/checkout', 'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd  # v6.0.2'],
  [
    'actions/dependency-review-action',
    'actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294  # v5.0.0',
  ],
  [
    'actions/download-artifact',
    'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c  # v8.0.1',
  ],
  ['actions/setup-node', 'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e  # v6.4.0'],
  [
    'actions/upload-artifact',
    'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a  # v7.0.1',
  ],
]);

function collectYamlFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        return collectYamlFiles(path);
      }
      return path.endsWith('.yml') || path.endsWith('.yaml') ? [path] : [];
    })
    .sort();
}

function collectActionSteps(file: string): ActionStep[] {
  const document = yaml.parse(readFileSync(file, 'utf8')) as
    | CompositeActionDocument
    | WorkflowDocument
    | null;

  const workflowSteps = Object.values((document as WorkflowDocument)?.jobs ?? {}).flatMap(
    (job) => job.steps ?? [],
  );
  const compositeSteps = (document as CompositeActionDocument)?.runs?.steps ?? [];

  return [...workflowSteps, ...compositeSteps];
}

test('GitHub core actions use current immutable release pins', () => {
  const yamlFiles = collectYamlFiles(join(repoRoot, '.github'));
  const violations: string[] = [];

  for (const file of yamlFiles) {
    const sourceLines = readFileSync(file, 'utf8').split('\n');
    for (const [actionName, expectedPin] of expectedActionPins) {
      const expectedUses = expectedPin.split('  # ')[0];
      const matchingLines = sourceLines
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ line }) => line.includes(`uses: ${actionName}@`));

      for (const { line, lineNumber } of matchingLines) {
        if (!line.includes(expectedPin)) {
          violations.push(`${relative(repoRoot, file)}:${lineNumber} expected ${expectedPin}`);
        }
      }

      for (const step of collectActionSteps(file)) {
        if (step.uses?.startsWith(`${actionName}@`) && step.uses !== expectedUses) {
          violations.push(`${relative(repoRoot, file)} has parsed use ${step.uses}`);
        }
      }
    }
  }

  expect(violations).toStrictEqual([]);
});

test('upload-artifact steps keep explicit retention periods', () => {
  const missingRetention = collectYamlFiles(join(repoRoot, '.github', 'workflows')).flatMap(
    (file) =>
      collectActionSteps(file)
        .filter((step) => step.uses?.startsWith('actions/upload-artifact@'))
        .filter((step) => step.with?.['retention-days'] === undefined)
        .map(() => basename(file)),
  );

  expect(missingRetention).toStrictEqual([]);
});
