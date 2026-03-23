#!/usr/bin/env node

import { readFileSync } from 'node:fs';

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

  // Skip date format validation for [Unreleased] heading
  if (normalizedVersion.toLowerCase() !== 'unreleased') {
    const strictHeadingRegex = new RegExp(
      `^##\\s+\\[${escapeRegExp(normalizedVersion)}\\]\\s+-\\s+\\d{4}-\\d{2}-\\d{2}\\s*$`,
      'u',
    );
    if (!strictHeadingRegex.test(startMatch[0])) {
      throw new Error(
        `Invalid changelog heading for version ${normalizedVersion}. Expected heading format: ## [${normalizedVersion}] - YYYY-MM-DD.`,
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

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) {
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for argument: ${key}`);
    }
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version;
  const file = args.file ?? 'CHANGELOG.md';

  if (!version) {
    throw new Error('--version is required');
  }

  const changelog = readFileSync(file, 'utf8');
  const entry = extractChangelogEntry(changelog, version);
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
