import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

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

test('the current translation guide matches the UI-only Crowdin mapping', () => {
  const config = parse(readFileSync('crowdin.yml', 'utf8'));
  assert.deepEqual(
    config.files.map((file) => file.source),
    ['/ui/src/locales/en/**/*.json'],
  );
  const document = readFileSync('content/docs/current/guides/translations/index.mdx', 'utf8');
  assert.match(document, /ui\/src\/locales\/en\//u);
  assert.ok(document.includes('](https://crowdin.com/project/drydock)'));
  assert.doesNotMatch(
    document,
    /UI and README files through Crowdin|Crowdin watches both|README sections retain/u,
  );
});

test('the translation guide routes README contributions through the repository', () => {
  const document = readFileSync('content/docs/current/guides/translations/index.mdx', 'utf8');
  const section = document.split('## README translations')[1]?.split('\n## ')[0];
  assert.ok(section, 'README translations need a separate contribution route');
  assert.match(section, /README\.<locale>\.md/u);
  assert.match(section, /maintained in the repository/u);
  assert.match(section, /pull request/u);
});

test('the translation guide explains maintainer keys and the post-merge sync', () => {
  const workflow = parse(readFileSync('.github/workflows/i18n-crowdin.yml', 'utf8'));
  const syncStep = Object.values(workflow.jobs)
    .flatMap((job) => job.steps)
    .find((step) => step.uses?.startsWith('crowdin/github-action@'));
  assert.ok(syncStep, 'Crowdin sync action must exist');
  for (const setting of ['upload_sources', 'upload_translations', 'download_translations']) {
    assert.equal(syncStep.with[setting], true);
  }
  const document = readFileSync('content/docs/current/guides/translations/index.mdx', 'utf8');
  const section = document.split('## Maintainer feature changes')[1];
  assert.ok(section, 'maintainer feature keys need guidance distinct from translation-only work');
  assert.match(section, /every configured locale/u);
  assert.match(section, /highest.*dev\/vX\.Y/u);
  assert.match(section, /upload_translations/u);
  assert.match(section, /after.*merge/iu);
  assert.match(section, /not generated Crowdin output/u);
});
