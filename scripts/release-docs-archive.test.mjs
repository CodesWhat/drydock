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

test('v1.6 archive is byte-for-byte bound to the published GA docs tree', () => {
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
    assert.equal(git('hash-object', join(archiveRoot, path)), sourceBlob, path);
  }

  const changelog = readFileSync(join(archiveRoot, 'changelog/index.mdx'));
  assert.equal(
    createHash('sha256').update(changelog).digest('hex'),
    provenance.generatedChangelogSha256,
  );
});
