import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Built from repeat() rather than written out, so this file never contains a
// literal marker and doesn't have to exempt itself from its own scan.
const MARKERS = ['<', '|', '>'].map((char) => char.repeat(7));

// `=======` is deliberately absent. It is a real conflict separator, but it is
// also a setext H1 underline in Markdown, so scanning for it would fail on
// legitimate prose. The other three have no valid meaning at the start of a
// line, and a conflict always leaves at least one of them behind.

// Binary formats only. `.svg` is deliberately absent: it is text, this repo
// commits generated star-history SVGs, and a conflicted one would otherwise
// pass unnoticed. Anything that slips through and is actually binary is caught
// by the NUL check in findMarkers.
const SKIPPED_EXTENSIONS = new Set([
  '.avif',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.webp',
  '.woff',
  '.woff2',
]);

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

function isScannable(path) {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  return !SKIPPED_EXTENSIONS.has(extension);
}

function findMarkers(path) {
  let contents;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  if (contents.includes('\0')) {
    return [];
  }
  return contents
    .split('\n')
    .flatMap((line, index) =>
      MARKERS.some(
        (marker) => line === marker || (line.startsWith(marker) && /\s/u.test(line[marker.length])),
      )
        ? [`${path}:${index + 1}: ${line.slice(0, 80)}`]
        : [],
    );
}

test('no tracked file contains a merge conflict marker', () => {
  const found = trackedFiles().filter(isScannable).flatMap(findMarkers);

  assert.deepEqual(
    found,
    [],
    `merge conflict markers survived a hand-resolved conflict:\n${found.join('\n')}`,
  );
});
