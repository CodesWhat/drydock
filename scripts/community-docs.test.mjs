import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('dependency label guidance states the supported host boundary', () => {
  const document = readFileSync('content/docs/current/configuration/watchers/index.mdx', 'utf8');
  const section = document.split('title="Dependency-ordered updates">')[1]?.split('</Callout>')[0];
  assert.ok(section, 'dependency ordering needs operator-facing guidance');
  assert.match(section, /same agent and watcher/u);
  assert.match(section, /cross-host.*not supported/iu);
});

test('the roadmap preserves unfinished community requests', () => {
  const document = readFileSync('README.md', 'utf8');
  const section = document.split('Open community requirements')[1]?.split('</details>')[0];
  assert.ok(section, 'unfinished requests must not be described as shipped');
  for (const number of [219, 558, 657, 897]) {
    assert.ok(section.includes(`/discussions/${number}`), `missing discussion ${number}`);
  }
  assert.match(section, /not implemented/u);
});
