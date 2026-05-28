import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

import { expectedActionPins } from './github-action-pins';

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

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

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
