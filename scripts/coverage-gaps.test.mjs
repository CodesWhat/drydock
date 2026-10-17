import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./coverage-gaps.mjs', import.meta.url));

test('reports uncovered SFC source without treating every entry as a failed floor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'drydock-coverage-gaps-'));
  try {
    await mkdir(join(directory, 'ui/coverage'), { recursive: true });
    const metric = { total: 10, covered: 9, pct: 90 };
    await writeFile(
      join(directory, 'ui/coverage/coverage-summary.json'),
      JSON.stringify({
        'ui/src/Fixture.vue': {
          lines: metric,
          statements: metric,
          functions: metric,
          branches: metric,
        },
      }),
    );
    await writeFile(
      join(directory, 'ui/coverage/lcov.info'),
      'SF:ui/src/Fixture.vue\nDA:7,0\nBRDA:8,0,1,0\nend_of_record\n',
    );
    const result = spawnSync(
      process.execPath,
      [script, '--workspace', 'ui', '--print', '--write', 'gaps.json'],
      {
        cwd: directory,
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /UNCOVERED SOURCE/);
    assert.match(result.stderr, /Vitest's configured thresholds determine failure/);
    assert.doesNotMatch(result.stderr, /Fix these files before rerunning/);
    const [gap] = JSON.parse(await readFile(join(directory, 'gaps.json'), 'utf8'));
    assert.equal(gap.file, 'ui/src/Fixture.vue');
    assert.deepEqual(gap.lines, metric);
    assert.deepEqual(gap.uncoveredLines, [7]);
    assert.deepEqual(gap.uncoveredBranchLines, [8]);
    assert.deepEqual(gap.uncoveredBranches, [{ line: 8, block: 0, branch: 1 }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pre-push success describes the configured thresholds without claiming universal 100%', async () => {
  const source = await readFile(new URL('./pre-push-coverage.sh', import.meta.url), 'utf8');
  assert.ok(source.includes('echo "Coverage thresholds met."'));
  assert.ok(!source.includes('Coverage thresholds met (100%).'));
});
