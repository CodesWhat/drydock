import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// GitHub closes the referenced issue when a closing keyword followed by an
// issue reference lands on the default branch, in a PR body or a commit
// message. A dev -> main sync squash carries sub-PR text, so a stale
// "Fixes: #N" there re-closes an issue that was reopened on purpose
// (#565 was closed again by three syncs).
const KEYWORD = '(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)';
const REFERENCE =
  '(?:[\\w.-]+/[\\w.-]+#\\d+|#\\d+|https?://github\\.com/[\\w.-]+/[\\w.-]+/issues/\\d+)';
const closingKeywordRegex = new RegExp(`(?<![\\w-])${KEYWORD}[ \\t]*:?[ \\t]*${REFERENCE}`, 'giu');

export function findClosingKeywords(text) {
  const hits = [];
  const lines = String(text ?? '').split(/\r?\n/u);
  lines.forEach((lineText, index) => {
    for (const match of lineText.matchAll(closingKeywordRegex)) {
      hits.push({ line: index + 1, text: match[0] });
    }
  });
  return hits;
}

export function formatFailure(hits) {
  const lines = hits.map((hit) => `  ${hit.source}:${hit.line}: ${hit.text}`);
  return [
    'GitHub closing keywords found. Merging into main would close these issues again.',
    ...lines,
    'Reword to "Refs #N" (or drop the reference) in the PR title/body and in the squash message.',
  ].join('\n');
}

// CLI: each argument is `label=path`; a missing file is an error, an empty one is fine.
function main(args) {
  const hits = [];
  for (const arg of args) {
    const separator = arg.indexOf('=');
    const source = separator === -1 ? arg : arg.slice(0, separator);
    const path = separator === -1 ? arg : arg.slice(separator + 1);
    for (const hit of findClosingKeywords(readFileSync(path, 'utf8'))) {
      hits.push({ source, ...hit });
    }
  }
  if (hits.length > 0) {
    console.error(formatFailure(hits));
    return 1;
  }
  console.log('No closing keywords found.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
