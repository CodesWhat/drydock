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
  // --exclude-per-directory=.gitignore reads only the repository's committed .gitignore
  // files (root plus nested), never the developer's global core.excludesFile and never
  // the clone-local .git/info/exclude — the latter isn't even suppressed by pinning
  // core.excludesFile, since it's a separate exclude source `--exclude-standard` also
  // reads. That leaves one question, answered the same way on every machine and in CI:
  // does the *repository* ignore a file it also commits?
  const tracked = execFileSync(
    'git',
    ['ls-files', '--cached', '--ignored', '--exclude-per-directory=.gitignore'],
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
