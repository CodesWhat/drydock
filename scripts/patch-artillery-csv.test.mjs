import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./patch-artillery-csv.mjs', import.meta.url));
const files = ['dist/lib/cmds/run.js', 'dist/lib/util/prepare-test-execution-plan.js'];
const aliases = ['_csv', 'csv'];

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'drydock-artillery-csv-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [index, file] of files.entries()) {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), `import ${aliases[index]} from 'csv-parse';\n`);
  }
  return directory;
}

test('adapts both Artillery runtime imports to the patched parser and is idempotent', (t) => {
  const directory = fixture(t);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    for (const [index, file] of files.entries()) {
      assert.equal(
        readFileSync(join(directory, file), 'utf8'),
        `import { parse as ${aliases[index]} } from 'csv-parse';\n`,
      );
    }
  }
});

test('an unexpected upstream import fails before either runtime file is changed', (t) => {
  const directory = fixture(t);
  writeFileSync(join(directory, files[1]), 'unexpected upstream layout\n');
  const result = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected Artillery csv-parse import/u);
  assert.equal(readFileSync(join(directory, files[0]), 'utf8'), "import _csv from 'csv-parse';\n");
});
