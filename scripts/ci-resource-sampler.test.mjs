import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectResources, parentIsAlive } from './ci-resource-sampler.mjs';

const script = fileURLToPath(new URL('./ci-resource-sampler.mjs', import.meta.url));
const samplePrefix = 'CI_RESOURCE ';

async function parentFixture(t, state, startTime = '9007199254740993') {
  const root = await mkdtemp(join(tmpdir(), 'dd-ci-parent-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, String(process.pid)));
  const path = join(root, String(process.pid), 'stat');
  await writeFile(
    path,
    `${process.pid} (parent ) name) ${state} ${Array(18).fill('0').join(' ')} ${startTime}\n`,
  );
  return { root, path };
}

test('recognizes the original live parent despite spaces and parentheses in its name', async (t) => {
  const { root } = await parentFixture(t, 'S');
  assert.equal(await parentIsAlive(process.pid, '9007199254740993', root), true);
});

for (const state of ['Z', 'X', 'x']) {
  test(`stops for a ${state} parent even while its PID still exists`, async (t) => {
    const { root } = await parentFixture(t, state);
    assert.equal(await parentIsAlive(process.pid, '9007199254740993', root), false);
  });
}

test('stops when the same PID has a different start time without numeric rounding', async (t) => {
  const { root } = await parentFixture(t, 'S', '9007199254740992');
  assert.equal(await parentIsAlive(process.pid, '9007199254740993', root), false);
});

test('stops when previously available parent identity disappears', async (t) => {
  const { root, path } = await parentFixture(t, 'S');
  await rm(path);
  assert.equal(await parentIsAlive(process.pid, '9007199254740993', root), false);
});

test('stops when previously available parent identity becomes malformed', async (t) => {
  const { root, path } = await parentFixture(t, 'S');
  for (const value of [
    'invalid',
    `${process.pid} (parent) S 0`,
    `${process.pid} (parent) S ${Array(18).fill('0').join(' ')} invalid`,
  ]) {
    await writeFile(path, value);
    assert.equal(await parentIsAlive(process.pid, '9007199254740993', root), false);
  }
});

test('retains portable PID liveness when no initial proc identity is available', async (t) => {
  const { root, path } = await parentFixture(t, 'S');
  await rm(path);
  assert.equal(await parentIsAlive(process.pid, null, root), true);
});

test('reads only numeric Linux fields and bounds the highest-RSS process list', async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), 'dd-ci-resources-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await writeFile(
    join(fixture, 'meminfo'),
    'MemTotal: 7000 kB\nMemAvailable: 800 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\nPrivate: do-not-log\n',
  );
  for (let pid = 1; pid <= 7; pid++) {
    await mkdir(join(fixture, String(pid)));
    await writeFile(
      join(fixture, String(pid), 'status'),
      `Name: do-not-log\nPPid: 1\nVmRSS: ${pid * 10} kB\n`,
    );
  }
  await mkdir(join(fixture, '8'));
  await writeFile(join(fixture, '8', 'status'), 'VmRSS: invalid\nPPid: 1\n');
  await mkdir(join(fixture, '9'));
  const sample = await collectResources(fixture, fixture);
  assert.deepEqual(sample.memoryKiB, {
    MemTotal: 7000,
    MemAvailable: 800,
    SwapTotal: 0,
    SwapFree: 0,
  });
  assert.deepEqual(
    sample.processes,
    [7, 6, 5, 4, 3].map((pid) => ({ pid, ppid: 1, rssKiB: pid * 10 })),
  );
  assert.ok(sample.diskBytes.available >= 0);
  assert.doesNotMatch(JSON.stringify(sample), /do-not-log|Private|Name/);
});

test('missing resource sources are explicit unknowns, not zero usage', async () => {
  const absent = join(tmpdir(), `dd-absent-resources-${process.pid}`);
  const sample = await collectResources(absent, absent);
  assert.deepEqual(sample.memoryKiB, {});
  assert.deepEqual(sample.processes, []);
  assert.equal(sample.diskBytes, null);
});

test('emits bounded numeric resource samples without command arguments or environment', () => {
  const result = spawnSync(process.execPath, [script, String(process.pid), '1', '2'], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, PRIVATE_DIAGNOSTIC_SENTINEL: 'must-not-appear' },
  });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.ok(line.startsWith(samplePrefix));
    const sample = JSON.parse(line.slice(samplePrefix.length));
    assert.deepEqual(Object.keys(sample).sort(), ['at', 'diskBytes', 'memoryKiB', 'processes']);
    assert.ok(Number.isFinite(Date.parse(sample.at)));
    assert.ok(sample.diskBytes === null || sample.diskBytes.available >= 0);
    for (const value of Object.values(sample.memoryKiB)) assert.ok(Number.isFinite(value));
    assert.ok(sample.processes.length <= 5);
    for (const entry of sample.processes) {
      assert.deepEqual(Object.keys(entry).sort(), ['pid', 'ppid', 'rssKiB']);
      assert.ok(Object.values(entry).every(Number.isFinite));
    }
  }
  assert.doesNotMatch(result.stdout, /PRIVATE_DIAGNOSTIC_SENTINEL|must-not-appear/);
});

test('invalid or unbounded arguments fail before sampling', () => {
  for (const args of [
    [],
    ['0'],
    ['abc'],
    ['1', '0'],
    ['1', '60001'],
    ['1', '1', '10001'],
    ['1', '1', '0'],
    ['1', '1', '2', 'extra'],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
  }
});

test('stops when the monitored parent exits', async () => {
  const parent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)']);
  const sampler = spawn(process.execPath, [script, String(parent.pid), '25', '80']);
  let output = '';
  sampler.stdout.on('data', (chunk) => {
    output += chunk;
  });
  const stopped = once(sampler, 'exit');
  const deadline = setTimeout(() => sampler.kill('SIGKILL'), 5000);
  try {
    await Promise.race([
      once(sampler.stdout, 'data'),
      stopped.then(() => {
        throw new Error('Sampler exited before emitting evidence');
      }),
    ]);
    const parentStopped = once(parent, 'exit');
    parent.kill('SIGTERM');
    await parentStopped;
    const [code, signal] = await stopped;
    assert.equal(code, 0);
    assert.equal(signal, null);
    assert.ok(output.split(samplePrefix).length - 1 < 80);
  } finally {
    clearTimeout(deadline);
    parent.kill('SIGTERM');
    sampler.kill('SIGTERM');
  }
});
