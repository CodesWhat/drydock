import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

// Files that .gitignore excludes but that are committed on purpose. Test fixtures only:
// self-signed certificates and their keys, generated once and committed so the QA and
// migration stacks come up without a key-generation step. They match the ignore rules
// that keep real keys out of the repo, so each one needed an explicit `git add -f`.
const DELIBERATELY_TRACKED = [
  'test/migration/tls.key',
  'test/mosquitto/config/minica-key.pem',
  'test/mosquitto/config/minica.pem',
  'test/mosquitto/config/mosquitto.dev/cert.pem',
  'test/mosquitto/config/mosquitto.dev/key.pem',
  'test/qa-proxy-certs/cert.pem',
  'test/qa-proxy-certs/key.pem',
  'test/server.key',
];

// `git add -f` on an ignored path leaves no trace afterwards: the file stops showing up
// as untracked, `git status` goes quiet, and it publishes on every push from then on.
// That is how .planning/ — gitignored, and described in CLAUDE.md as local-only —
// ended up public on both main and dev/v1.6 with three stale roadmap files.
test('no gitignored file is tracked except the known test fixtures', () => {
  const tracked = execFileSync('git', ['ls-files', '--cached', '--ignored', '--exclude-standard'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .sort();

  const unexpected = tracked.filter((file) => !DELIBERATELY_TRACKED.includes(file));
  assert.deepEqual(
    unexpected,
    [],
    `These files are gitignored but committed, so they publish on every push:\n  ${unexpected.join('\n  ')}\n` +
      'Run `git rm --cached <file>` to untrack them (this keeps your local copy), or add them ' +
      'to DELIBERATELY_TRACKED with a comment saying why they belong in the repo.',
  );

  const stale = DELIBERATELY_TRACKED.filter((file) => !tracked.includes(file));
  assert.deepEqual(
    stale,
    [],
    `These allowlist entries are no longer tracked-and-ignored; drop them:\n  ${stale.join('\n  ')}`,
  );
});
