import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Scope: published text only — files a reader actually sees — not every
// tracked file the way scripts/conflict-markers.test.mjs scans. A conflict
// marker has no legitimate meaning anywhere in the repo, but a token like
// `FOO_PLACEHOLDER` could be a real sentinel constant in application source;
// scanning source code for it would risk the exact false-positive problem
// this guard exists to avoid. CHANGELOG.md is the proven incident (PR #906
// shipped the literal string `(PR_LINK_PLACEHOLDER)` where a real citation
// belonged). README*.md, DEPRECATIONS.md, and the published docs snapshots
// under content/docs/**/*.mdx carry the same risk: unreviewed prose that
// reaches readers. content/docs/current/changelog/index.mdx is gitignored
// (generated from CHANGELOG.md at doc-sync time), so `git ls-files` never
// returns it and it needs no special-casing here.
const PUBLISHED_TEXT_PATHSPECS = [
  'CHANGELOG.md',
  'README*.md',
  'DEPRECATIONS.md',
  'content/docs/**/*.mdx',
];

function publishedTextFiles() {
  return execFileSync('git', ['ls-files', '-z', '--', ...PUBLISHED_TEXT_PATHSPECS], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
}

// The proven shape: ALL-CAPS, underscore-joined, ending in PLACEHOLDER.
// Matches `PR_LINK_PLACEHOLDER` (the real incident) and a bare `PLACEHOLDER`,
// but not the word used correctly in lowercase prose, which this repo does
// legitimately dozens of times ("served a placeholder ... SVG", "Template
// strings use ... placeholders"). It also doesn't match generic ALL-CAPS
// example tokens like `YOUR_QUAY_ROBOT_TOKEN` or the `replace-with-your-*`
// convention scripts/docs-secret-examples.test.mjs already enforces for
// credential examples — neither ends in `_PLACEHOLDER` nor is the bare word,
// so this pattern doesn't collide with either deliberate convention.
const PLACEHOLDER_TOKEN = /\b(?:[A-Z][A-Z0-9]*_)*PLACEHOLDER\b/u;

// An empty markdown link or image target: `[text]()`, `[]()`, `![alt]()`.
// Deliberately scoped to prose files only (see PUBLISHED_TEXT_PATHSPECS),
// never source code: the same shape is ordinary JS/TS syntax — an index
// immediately invoked, e.g. `callbacks[0]()` — which shows up harmlessly
// throughout app/ and ui/tests. It does not currently appear in any of the
// 418 tracked .mdx files scanned here; if a docs code sample ever starts
// demonstrating that exact idiom, narrow this to skip fenced code blocks
// rather than drop the check.
const EMPTY_LINK_TARGET = /\[[^\]]*\]\(\s*\)/u;

const PATTERNS = [PLACEHOLDER_TOKEN, EMPTY_LINK_TARGET];

function findUnfilledPlaceholders(path) {
  let contents;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  // No truncation: unlike conflict markers (always at line start), a
  // placeholder can sit anywhere in a long changelog bullet, and slicing
  // from character 0 could cut the match out of the reported message
  // entirely. Printing the full line also keeps this in parity with the
  // `grep -n` backstop in release-cut.yml, which prints untruncated too.
  return contents
    .split('\n')
    .flatMap((line, index) =>
      PATTERNS.some((pattern) => pattern.test(line)) ? [`${path}:${index + 1}: ${line}`] : [],
    );
}

test('no published-text file contains an unfilled placeholder citation', () => {
  const found = publishedTextFiles().flatMap(findUnfilledPlaceholders);

  assert.deepEqual(
    found,
    [],
    `unfilled placeholder reached published text — fill in the real value before merging:\n${found.join('\n')}`,
  );
});
