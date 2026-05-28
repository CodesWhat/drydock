import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface RenovatePackageRule {
  automerge?: boolean;
  matchManagers?: string[];
  matchUpdateTypes?: string[];
}

interface RenovateConfig {
  packageRules?: RenovatePackageRule[];
}

const renovatePath = fileURLToPath(new URL('../renovate.json', import.meta.url));

function loadRenovateConfig(): RenovateConfig {
  return JSON.parse(readFileSync(renovatePath, 'utf8')) as RenovateConfig;
}

test('patch automerge is scoped to GitHub Actions updates only', () => {
  const config = loadRenovateConfig();
  const patchAutomergeRules = (config.packageRules ?? []).filter(
    (rule) => rule.automerge === true && rule.matchUpdateTypes?.includes('patch'),
  );

  expect(patchAutomergeRules).not.toStrictEqual([]);
  for (const rule of patchAutomergeRules) {
    expect(rule.matchManagers).toStrictEqual(['github-actions']);
  }
});
