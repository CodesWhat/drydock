import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'vitest';

const uiDirectory = resolve(import.meta.dirname, '..');
const coveredSfc =
  '<script setup lang="ts">const value = "ready";</script><template>{{ value }}</template>';
const coveredTs = 'export const value = "ready";';

function runCoverage(config: string) {
  return new Promise<{ code: number | null; signal: string | null; output: string }>(
    (resolve, reject) => {
      const child = spawn('npm', ['run', 'test:unit', '--', '--config', config], {
        cwd: uiDirectory,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      const deadline = setTimeout(() => {
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
              reject(error);
          }
        }
      }, 35_000);
      child.on('error', (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      child.on('close', (code, signal) => {
        clearTimeout(deadline);
        resolve({ code, signal, output });
      });
    },
  );
}

interface CoverageScenario {
  name: string;
  valid?: boolean;
  ts?: string;
  sfc?: string;
  threshold?: string;
  unimported?: boolean;
}

const scenarios: CoverageScenario[] = [
  { name: 'covered TypeScript and Vue control', valid: true },
  {
    name: 'uncovered TypeScript still requires 100%',
    ts: 'function label(ready: boolean) { if (ready) return "ready"; return "missing"; } export const value = label(true);',
    threshold: 'src/**/*.ts',
  },
  {
    name: 'uncovered Vue script fails the SFC floor',
    sfc: '<script setup lang="ts">function label(ready: boolean) { if (ready) return "ready"; return "missing"; } const value = label(true);</script><template>{{ value }}</template>',
    threshold: 'src/**/*.vue',
  },
  {
    name: 'uncovered Vue template fails the SFC floor',
    sfc: '<script setup lang="ts">defineProps<{ ready: boolean }>();</script><template><span v-if="ready">ready</span><span v-else>missing</span></template>',
    threshold: 'src/**/*.vue',
  },
  {
    name: 'unimported SFC stays in the denominator',
    unimported: true,
    threshold: 'src/**/*.vue',
  },
];

for (const scenario of scenarios) {
  test(scenario.name, { timeout: 45_000 }, async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'drydock-ui-coverage-contract-')),
    );
    try {
      await mkdir(join(directory, 'src'));
      await mkdir(join(directory, 'tests'));
      await symlink(join(uiDirectory, 'node_modules'), join(directory, 'node_modules'), 'dir');
      await writeFile(join(directory, 'src/anchor.ts'), scenario.ts ?? coveredTs);
      await writeFile(join(directory, 'src/Fixture.vue'), scenario.sfc ?? coveredSfc);
      if (scenario.unimported) await writeFile(join(directory, 'src/Unimported.vue'), coveredSfc);
      await writeFile(
        join(directory, 'tests/fixture.spec.ts'),
        `
import { mount } from '@vue/test-utils';
import Fixture from '../src/Fixture.vue';
import { value } from '../src/anchor';
test('renders the actual fixture', () => {
  expect(value).toBe('ready');
  const wrapper = mount(Fixture, { props: { ready: true } });
  expect(wrapper.text()).toBe('ready');
  wrapper.unmount();
});
`,
      );
      const config = join(directory, 'vitest.config.mts');
      // Inherit the real plugins, provider, includes, exclusions and thresholds.
      // Only fixture discovery and output paths replace production test paths.
      await writeFile(
        config,
        `
import base from ${JSON.stringify(join(uiDirectory, 'vitest.config.ts'))};
export default {
  ...base,
  root: ${JSON.stringify(directory)},
  test: {
    ...base.test,
    include: ['tests/fixture.spec.ts'],
    setupFiles: [],
    coverage: {
      ...base.test.coverage,
      customProviderModule: ${JSON.stringify(join(uiDirectory, 'vitest.coverage-provider.ts'))},
      reportsDirectory: ${JSON.stringify(join(directory, 'coverage'))},
    },
  },
};
`,
      );
      const result = await runCoverage(config);
      assert.equal(result.signal, null, result.output);
      assert.match(result.output, /1 passed/, result.output);
      assert.equal(result.code, scenario.valid ? 0 : 1, result.output);
      const summary = JSON.parse(
        await readFile(join(directory, 'coverage/coverage-summary.json'), 'utf8'),
      );
      if (scenario.threshold) {
        assert.ok(result.output.includes(`"${scenario.threshold}" threshold`), result.output);
      }
      if (scenario.valid) {
        assert.equal(summary[join(directory, 'src/anchor.ts')].lines.pct, 100);
      }
      if (scenario.unimported) {
        const unimported = summary[join(directory, 'src/Unimported.vue')];
        assert.ok(unimported.statements.total > 0);
        assert.equal(unimported.statements.covered, 0);
        assert.ok(unimported.lines.total > 0);
        assert.equal(unimported.lines.covered, 0);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
