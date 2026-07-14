import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readScript = (name) => readFile(new URL(name, import.meta.url), 'utf8');
const readRepositoryFile = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

const operationalClients = [
  ['scripts/start-drydock.sh', () => readScript('start-drydock.sh')],
  ['scripts/run-load-test.sh', () => readScript('run-load-test.sh')],
  ['test/test.yml', () => readRepositoryFile('test/test.yml')],
  ['test/test-behavior.yml', () => readRepositoryFile('test/test-behavior.yml')],
  ['test/load-test.processor.cjs', () => readRepositoryFile('test/load-test.processor.cjs')],
];

test('first-party test clients use only the versioned operational API', async () => {
  const staleEndpoints = [];

  for (const [name, read] of operationalClients) {
    const source = await read();
    for (const [index, line] of source.split('\n').entries()) {
      if (/\/api\/(?!v1(?:\/|[?"'`\s]|$))/u.test(line)) {
        staleEndpoints.push(`${name}:${index + 1}: ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(staleEndpoints, []);
});

test('readiness probes poll the canonical container collection', async () => {
  for (const scriptName of ['start-drydock.sh', 'run-load-test.sh']) {
    const source = await readScript(scriptName);

    assert.match(source, /curl[^\n]*\/api\/v1\/containers/u);
  }
});

test('behavior profile captures collection envelopes and patches notifications', async () => {
  const source = await readRepositoryFile('test/test-behavior.yml');

  assert.equal(source.match(/json: "\$\.data\[0\]\.id"/gu)?.length, 3);
  assert.doesNotMatch(source, /json: "\$\[0\]\.id"/u);
  assert.match(
    source,
    /- patch:\n\s+url: "\/api\/v1\/notifications\/\{\{ notificationRuleId \}\}"/u,
  );
});

test('agent log probe unwraps the canonical collection envelope', async () => {
  const source = await readRepositoryFile('test/load-test.processor.cjs');

  assert.match(source, /Array\.isArray\(agentsResponse\.body\?\.data\)/u);
});
