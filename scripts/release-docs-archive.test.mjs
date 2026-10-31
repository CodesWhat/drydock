import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const archiveRoot = 'content/docs/v1.6';
const provenance = JSON.parse(readFileSync('content/docs/archive-provenance.json', 'utf8'));

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function listFiles(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

test('v1.6 archive preserves GA bytes except its exact settings migration erratum', () => {
  assert.deepEqual(provenance, {
    version: 'v1.6',
    sourceCommit: 'd0f015a38eb2b15fcf634681bd14dfa1568f5fa9',
    sourceDocsTree: '39ed502d2eb8dada5f146dcf0b0e9a26bcb49b9c',
    sourceChangelogBlob: '5c4a4f6c5ddd759cf5bb7a38938bb833f07704cb',
    generatedChangelogSha256: 'eefe1e8316865e34f824a5f1ad679ac8b8542ac5a43580c9d075c048f39f2594',
  });

  assert.equal(
    git('show', '-s', '--format=%s', provenance.sourceCommit),
    '🔧 chore(release): sync dev/v1.6 into main for the v1.6.0 GA cut',
  );
  assert.equal(
    git('rev-parse', `${provenance.sourceCommit}:content/docs/current`),
    provenance.sourceDocsTree,
  );
  assert.equal(
    git('rev-parse', `${provenance.sourceCommit}:CHANGELOG.md`),
    provenance.sourceChangelogBlob,
  );

  const sourceEntries = git(
    'ls-tree',
    '-r',
    '--format=%(objectname) %(path)',
    provenance.sourceCommit,
    'content/docs/current',
  )
    .split('\n')
    .map((entry) => entry.split(' '))
    .map(([object, path]) => [path.replace('content/docs/current/', ''), object]);
  const archivedFiles = listFiles(archiveRoot).map((path) => relative(archiveRoot, path));

  assert.deepEqual(
    archivedFiles,
    [...sourceEntries.map(([path]) => path), 'changelog/index.mdx'].sort(),
  );
  for (const [path, sourceBlob] of sourceEntries) {
    if (path === 'deprecations/index.mdx') {
      const original = execFileSync('git', ['show', sourceBlob], { encoding: 'utf8' });
      const paragraph =
        'The `PUT` method on `/api/v1/settings` is a compatibility alias for `PATCH`. Responses include `Deprecation` and `Sunset` HTTP headers.';
      const corrected = original
        .replaceAll('/api/settings', '/api/v1/settings')
        .replace(
          paragraph,
          `${paragraph}\n\n**Documentation correction:** The unversioned \`/api/settings\` path returns \`410 Gone\` in v1.6. Both the retained \`PUT\` alias and its \`PATCH\` replacement use \`/api/v1/settings\`; settings is not a wud-card compatibility exception.`,
        );
      assert.equal(readFileSync(join(archiveRoot, path), 'utf8'), corrected, path);
    } else {
      assert.equal(git('hash-object', join(archiveRoot, path)), sourceBlob, path);
    }
  }

  const changelog = readFileSync(join(archiveRoot, 'changelog/index.mdx'));
  assert.equal(
    createHash('sha256').update(changelog).digest('hex'),
    provenance.generatedChangelogSha256,
  );
});

test('CodeRabbit reviews the archive contract instead of the immutable snapshot files', () => {
  const config = readFileSync('.coderabbit.yaml', 'utf8');

  assert.match(config, /^ {4}- "!content\/docs\/v1\.6\/\*\*"$/mu);
  assert.doesNotMatch(config, /!content\/docs\/archive-provenance\.json/u);
  assert.doesNotMatch(config, /!scripts\/release-docs-archive\.test\.mjs/u);
});

test('secret-scan exceptions for the immutable archive are exact and commit-independent', () => {
  const exceptions = readFileSync('.gitleaksignore', 'utf8')
    .trim()
    .split('\n')
    .filter((entry) => entry.startsWith(`${archiveRoot}/`));

  assert.deepEqual(exceptions, [
    'content/docs/v1.6/configuration/authentications/oidc/index.mdx:private-key:55',
    'content/docs/v1.6/configuration/registries/alicr/index.mdx:generic-api-key:60',
    'content/docs/v1.6/configuration/registries/alicr/index.mdx:generic-api-key:67',
    'content/docs/v1.6/configuration/registries/dhi/index.mdx:generic-api-key:68',
    'content/docs/v1.6/configuration/registries/dhi/index.mdx:generic-api-key:75',
    'content/docs/v1.6/configuration/registries/docr/index.mdx:generic-api-key:85',
    'content/docs/v1.6/configuration/registries/docr/index.mdx:generic-api-key:95',
    'content/docs/v1.6/configuration/registries/gcr/index.mdx:private-key:40',
    'content/docs/v1.6/configuration/registries/hub/index.mdx:generic-api-key:102',
    'content/docs/v1.6/configuration/registries/hub/index.mdx:generic-api-key:109',
    'content/docs/v1.6/configuration/registries/ibmcr/index.mdx:generic-api-key:86',
    'content/docs/v1.6/configuration/registries/ibmcr/index.mdx:generic-api-key:93',
    'content/docs/v1.6/configuration/registries/ocir/index.mdx:generic-api-key:60',
    'content/docs/v1.6/configuration/registries/ocir/index.mdx:generic-api-key:67',
  ]);
});

test('v1.7 archive preserves rc.24 bytes with exact credential-example errata', () => {
  const record = JSON.parse(readFileSync('content/docs/v1.7-provenance.json', 'utf8'));
  const root = 'content/docs/v1.7';
  assert.equal(record.version, 'v1.7');
  assert.equal(record.sourceTag, 'v1.7.0-rc.24');
  assert.equal(
    record.generatedChangelogSha256,
    'd949eb0b7e4959dd9f3dd9db8f31f498353049f623ae9af918000aa0af997806',
  );
  assert.doesNotMatch(
    readFileSync(join(root, 'changelog/index.mdx'), 'utf8'),
    /^## \[Unreleased\]|^\[Unreleased\]:/mu,
  );
  assert.equal(record.sourceCommit, '3f29a8ade3675845b62f170a3492faa312d577fb');
  assert.equal(git('rev-parse', `${record.sourceTag}^{commit}`), record.sourceCommit);
  assert.equal(
    git('rev-parse', `${record.sourceCommit}:content/docs/current`),
    record.sourceDocsTree,
  );
  assert.equal(git('rev-parse', `${record.sourceCommit}:CHANGELOG.md`), record.sourceChangelogBlob);
  const sourceFiles = git(
    'ls-tree',
    '-r',
    '--format=%(objectname) %(path)',
    record.sourceCommit,
    'content/docs/current',
  )
    .split('\n')
    .map((entry) => entry.split(' '))
    .map(([object, path]) => [path.replace('content/docs/current/', ''), object]);
  assert.deepEqual(
    listFiles(root).map((path) => relative(root, path)),
    [...sourceFiles.map(([path]) => path), 'changelog/index.mdx'].sort(),
  );
  const errata = JSON.parse(readFileSync('content/docs/v1.7-errata.json', 'utf8'));
  assert.equal(errata.changes.length, 15);
  assert.equal(new Set(errata.changes.map((entry) => entry.path)).size, 8);
  for (const [path, blob] of sourceFiles) {
    const changes = errata.changes.filter((entry) => entry.path === path);
    if (changes.length === 0) {
      assert.equal(git('hash-object', join(root, path)), blob, path);
      continue;
    }
    const lines = execFileSync('git', ['show', blob], { encoding: 'utf8' }).match(
      /[^\n]*\n|[^\n]+$/g,
    );
    for (const change of changes.sort((a, b) => b.startLine - a.startLine)) {
      const before = lines.slice(change.startLine - 1, change.endLine).join('');
      assert.equal(createHash('sha256').update(before).digest('hex'), change.beforeSha256, path);
      lines.splice(change.startLine - 1, change.endLine - change.startLine + 1, change.replacement);
      assert.ok(
        readFileSync(join('content/docs/current', path), 'utf8').includes(
          change.replacement.replaceAll('codeswhat/drydock\n', 'codeswhat/drydock:1.8.0-rc.10\n'),
        ),
        path,
      );
    }
    assert.equal(readFileSync(join(root, path), 'utf8'), lines.join(''), path);
  }
  assert.equal(
    createHash('sha256')
      .update(readFileSync(join(root, 'changelog/index.mdx')))
      .digest('hex'),
    record.generatedChangelogSha256,
  );
  const config = readFileSync('.coderabbit.yaml', 'utf8');
  assert.ok(config.includes('    - "!content/docs/v1.7/**"'));
  assert.ok(!config.includes('!content/docs/v1.7-provenance.json'));
  assert.ok(!config.includes('!content/docs/v1.7-errata.json'));
});
