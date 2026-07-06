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

test('renovate never automerges: it scans and feeds the dependency dashboard only', () => {
  const config = loadRenovateConfig();
  const automergeRules = (config.packageRules ?? []).filter((rule) => rule.automerge === true);

  expect(automergeRules).toStrictEqual([]);
});
