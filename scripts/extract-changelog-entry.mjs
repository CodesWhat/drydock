#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { parseArgs } from './lib/parse-args.mjs';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeVersion(version) {
  return String(version ?? '')
    .trim()
    .replace(/^v/u, '');
}

function listChangelogVersions(changelog) {
  const versions = [];
  const headingRegex = /^##\s+\[([^\]]+)\].*$/gmu;
  for (const match of changelog.matchAll(headingRegex)) {
    const version = String(match[1] ?? '').trim();
    if (version) {
      versions.push(version);
    }
  }
  return versions;
}

export function extractChangelogEntry(changelog, version) {
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedVersion) {
    throw new Error('Version is required');
  }

  const content = String(changelog ?? '');
  const versionHeadingRegex = new RegExp(
    `^##\\s+\\[${escapeRegExp(normalizedVersion)}\\].*$`,
    'mu',
  );
  const startMatch = content.match(versionHeadingRegex);
  if (!startMatch || startMatch.index === undefined) {
    const availableVersions = listChangelogVersions(content).slice(0, 10);
    const availableText =
      availableVersions.length > 0
        ? ` Available versions: ${availableVersions.join(', ')}`
        : ' No version headings found in changelog.';
    throw new Error(
      `Changelog entry not found for version ${normalizedVersion}. Expected heading: ## [${normalizedVersion}] - YYYY-MM-DD.${availableText}`,
    );
  }

  // Skip date format validation for [Unreleased] heading. Accept ASCII hyphen,
  // en-dash, or em-dash between the version and the date so Keep-a-Changelog
  // entries that use typographic dashes (the repo convention) still parse.
  if (normalizedVersion.toLowerCase() !== 'unreleased') {
    const strictHeadingRegex = new RegExp(
      `^##\\s+\\[${escapeRegExp(normalizedVersion)}\\]\\s+[-\u2013\u2014]\\s+\\d{4}-\\d{2}-\\d{2}\\s*$`,
      'u',
    );
    if (!strictHeadingRegex.test(startMatch[0])) {
      throw new Error(
        `Invalid changelog heading for version ${normalizedVersion}. Expected heading format: ## [${normalizedVersion}] - YYYY-MM-DD (hyphen, en-dash, or em-dash).`,
      );
    }
  }

  const startIndex = startMatch.index;
  const remaining = content.slice(startIndex + startMatch[0].length);
  const nextHeadingOffset = remaining.search(/\n##\s+\[/u);
  const endIndex =
    nextHeadingOffset === -1
      ? content.length
      : startIndex + startMatch[0].length + nextHeadingOffset;

  return content.slice(startIndex, endIndex).trim();
}

export function extractReleaseNotes(changelog, version) {
  const entry = extractChangelogEntry(changelog, version);
  const startMarker = '<!-- release-summary:start -->';
  const endMarker = '<!-- release-summary:end -->';
  const start = entry.indexOf(startMarker);
  const end = entry.indexOf(endMarker);
  let notes = entry;

  if (start !== -1 || end !== -1) {
    if (
      start === -1 ||
      end === -1 ||
      start !== entry.lastIndexOf(startMarker) ||
      end !== entry.lastIndexOf(endMarker) ||
      end <= start
    ) {
      throw new Error('Release summary needs exactly one ordered start/end marker pair');
    }
    const summary = entry.slice(start + startMarker.length, end).trim();
    if (!summary) {
      throw new Error('Release summary must not be empty');
    }
    notes = `${entry.slice(0, start).trimEnd()}\n\n${summary}`;
  }

  if (notes.length > 100000) {
    throw new Error(
      'Release notes entry exceeds the 100000-character budget; add a compact release summary',
    );
  }
  return notes;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version;
  const file = args.file ?? 'CHANGELOG.md';

  if (!version) {
    throw new Error('--version is required');
  }

  const changelog = readFileSync(file, 'utf8');
  const format = args.format ?? 'entry';
  if (!['entry', 'release'].includes(format)) {
    throw new Error(`Unsupported output format: ${format}`);
  }
  const entry =
    format === 'release'
      ? extractReleaseNotes(changelog, version)
      : extractChangelogEntry(changelog, version);
  console.log(entry);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
