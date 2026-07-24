import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

// `git add -f` on an ignored path leaves no trace afterwards: the file stops showing up
// as untracked, `git status` goes quiet, and it publishes on every push from then on.
// That is how .planning/ — gitignored, and described in CLAUDE.md as local-only — ended
// up public on both main and dev/v1.6 carrying three stale roadmap files.
test('no file ignored by the repository is tracked', () => {
  // core.excludesFile=/dev/null drops the developer's personal ~/.gitignore so this
  // asks one question: does the *repository* ignore a file it also commits? Without it
  // the answer changes per machine — a global `*.pem`/`*.key` rule makes the committed
  // test certificates look like violations locally while CI, which has no global
  // excludes, sees nothing at all.
  const tracked = execFileSync(
    'git',
    [
      '-c',
      'core.excludesFile=/dev/null',
      'ls-files',
      '--cached',
      '--ignored',
      '--exclude-standard',
    ],
    { cwd: repositoryRoot, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean)
    .sort();

  assert.deepEqual(
    tracked,
    [],
    `These files are gitignored but committed, so they publish on every push:\n  ${tracked.join('\n  ')}\n` +
      'Run `git rm --cached <file>` to untrack one (your local copy stays). If a file genuinely ' +
      'belongs in the repository, narrow the .gitignore rule rather than force-adding past it.',
  );
});
