import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./merge-coverage-gaps.mjs', import.meta.url));

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

test('merges shard gap reports in argument order and skips missing shards', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'drydock-merge-gaps-'));
  try {
    const app = join(directory, 'app.json');
    const ui = join(directory, 'ui.json');
    const out = join(directory, 'merged.json');
    await writeFile(app, JSON.stringify([{ file: 'app/a.ts' }]));
    await writeFile(ui, JSON.stringify([{ file: 'ui/b.vue' }, { file: 'ui/c.ts' }]));

    const result = run(['--out', out, app, join(directory, 'missing.json'), ui]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), [
      { file: 'app/a.ts' },
      { file: 'ui/b.vue' },
      { file: 'ui/c.ts' },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('writes an empty report when no shard produced gaps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'drydock-merge-gaps-'));
  try {
    const out = join(directory, 'merged.json');
    const result = run(['--out', out, join(directory, 'nope.json')]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a missing --out and a corrupt shard report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'drydock-merge-gaps-'));
  try {
    assert.notEqual(run([join(directory, 'x.json')]).status, 0);

    const bad = join(directory, 'bad.json');
    await writeFile(bad, '{not json');
    assert.notEqual(run(['--out', join(directory, 'o.json'), bad]).status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
