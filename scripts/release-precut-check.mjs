#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReleaseTag } from './release-tag.mjs';

const releaseTagRegex =
  /^v?(?<major>(?:0|[1-9]\d*))\.(?<minor>(?:0|[1-9]\d*))\.(?<patch>(?:0|[1-9]\d*))(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function versionSeries(tag) {
  const value = String(tag ?? '').trim();
  const match = value.match(releaseTagRegex);
  if (!match?.groups) {
    throw new Error(`Invalid release tag: ${tag}. Use vX.Y.Z or vX.Y.Z-<prerelease>.`);
  }
  return `${match.groups.major}.${match.groups.minor}`;
}

export function isPrerelease(tag) {
  const value = String(tag ?? '').trim();
  const match = value.match(releaseTagRegex);
  return Boolean(match?.groups?.prerelease);
}

export function validateReleaseMetadata(root, tag) {
  const normalizedTag = String(tag).startsWith('v') ? String(tag) : `v${tag}`;
  const metadata = parseReleaseTag(normalizedTag);
  const version = metadata.tag.slice(1);
  const problems = [];
  const packagePaths = [
    'package.json',
    'app/package.json',
    'ui/package.json',
    'e2e/package.json',
    'apps/demo/package.json',
  ];
  const lockPaths = packagePaths.map((path) =>
    path.replace(/package\.json$/u, 'package-lock.json'),
  );

  for (const relativePath of packagePaths) {
    const contents = JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
    if (contents.version !== metadata.baseVersion) {
      problems.push(
        `${relativePath} version is ${contents.version ?? '<missing>'}, expected ${metadata.baseVersion}`,
      );
    }
  }
  for (const relativePath of lockPaths) {
    const contents = JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
    for (const [location, actual] of [
      ['version', contents.version],
      ['packages[""].version', contents.packages?.['']?.version],
    ]) {
      if (actual !== metadata.baseVersion) {
        problems.push(
          `${relativePath} ${location} is ${actual ?? '<missing>'}, expected ${metadata.baseVersion}`,
        );
      }
    }
  }

  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const escapedVersion = escapeRegExp(version);
  const changelogEntry = changelog.match(
    new RegExp(
      `^## \\[${escapedVersion}\\] [–—-] \\d{4}-\\d{2}-\\d{2}\\n(?<body>[\\s\\S]*?)(?=^## |(?![\\s\\S]))`,
      'mu',
    ),
  );
  if (!changelogEntry?.groups?.body.trim()) {
    problems.push(`CHANGELOG.md has no non-empty [${version}] entry`);
  }

  // README version badges read live from shields' github/v/release endpoint,
  // so there is no static badge string to bump or validate per cut.
  const publicChecks = [
    ['README.md', [`v${version} highlights`]],
    ['apps/web/src/lib/site-config.ts', [`version: "${version}"`]],
    [
      'apps/web/scripts/docs-versions.mjs',
      [
        `{ slug: "v${versionSeries(metadata.tag)}", source: "current", title: "v${versionSeries(metadata.tag)}" }`,
      ],
    ],
    ['content/docs/current/updates/index.mdx', [`## v${version} Highlights`]],
    [
      'content/docs/current/quickstart/index.mdx',
      [
        `| \`${version}\` | ${metadata.isPrerelease ? 'Immutable release candidate' : 'Immutable exact GA release'}`,
      ],
    ],
  ];
  for (const [relativePath, requiredValues] of publicChecks) {
    const contents = readFileSync(join(root, relativePath), 'utf8');
    for (const requiredValue of requiredValues) {
      if (!contents.includes(requiredValue)) {
        problems.push(`${relativePath} is missing ${requiredValue}`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`Release metadata does not match ${metadata.tag}:\n- ${problems.join('\n- ')}`);
  }
}

export function parsePendingReplies(markdown, tag) {
  const series = versionSeries(tag);
  const [major, minor] = series.split('.');
  const seriesRegex = new RegExp(`v?${escapeRegExp(major)}\\.${escapeRegExp(minor)}(?![0-9])`, 'u');

  const seen = new Set();
  const results = [];

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      continue;
    }

    const cells = trimmed
      .slice(1, trimmed.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((c) => c.trim());

    if (cells.length < 2) {
      continue;
    }

    const firstCell = cells[0];
    if (!/^#\d+/u.test(firstCell)) {
      continue;
    }

    if (!/☐/u.test(trimmed)) {
      continue;
    }

    if (!/shipped in/iu.test(trimmed)) {
      continue;
    }

    if (!seriesRegex.test(trimmed)) {
      continue;
    }

    const discussionMatch = firstCell.match(/^#(\d+)/u);
    if (!discussionMatch) {
      continue;
    }

    const discussion = Number(discussionMatch[1]);
    if (seen.has(discussion)) {
      continue;
    }

    seen.add(discussion);

    const feature = cells[1].replace(/\*\*/gu, '').trim();

    results.push({ discussion, feature });
  }

  return results;
}

export function formatReport(pending, tag) {
  if (pending.length === 0) {
    return `No pending discussion replies for ${tag}.`;
  }

  const noun = pending.length === 1 ? 'discussion' : 'discussions';
  const items = pending.map((p) => `   #${p.discussion} ${p.feature}`).join('\n');

  const verb = pending.length === 1 ? 'needs' : 'need';
  return `${pending.length} ${noun} still ${verb} a "shipped in ${tag}" reply:\n${items}\n\nPost replies + check the boxes in current-tracker.md,\nor re-run with --force to cut anyway.`;
}

function parseArgs(argv) {
  const args = { flags: {}, tag: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') {
      args.flags.force = true;
    } else if (arg === '--strict') {
      args.flags.strict = true;
    } else if (arg === '--tag') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error('Missing value for argument: --tag');
      }
      args.tag = next;
      i += 1;
    } else if (arg === '--tracker') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error('Missing value for argument: --tracker');
      }
      args.flags.tracker = next;
      i += 1;
    } else if (!arg.startsWith('--')) {
      if (args.tag === null) {
        args.tag = arg;
      }
    }
  }
  return args;
}

function main() {
  const { tag, flags } = parseArgs(process.argv.slice(2));

  if (!tag) {
    throw new Error('release tag is required (e.g. v1.6.0)');
  }

  const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
  validateReleaseMetadata(repositoryRoot, tag);
  console.log(`Release metadata matches ${tag.startsWith('v') ? tag : `v${tag}`}.`);

  const defaultTrackerPath = fileURLToPath(
    new URL('../.planning/roadmap/current-tracker.md', import.meta.url),
  );
  const trackerPath = flags.tracker ?? defaultTrackerPath;

  let contents;
  try {
    contents = readFileSync(trackerPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`Tracker not found at ${trackerPath}; skipping discussion-reply check.`);
      return;
    }
    throw err;
  }

  const pending = parsePendingReplies(contents, tag);
  const report = formatReport(pending, tag);

  if (pending.length === 0) {
    console.log(report);
    return;
  }

  console.error(report);

  if (flags.force) {
    console.log('ℹ  --force set; bypassing discussion-reply check.');
    return;
  }

  if (isPrerelease(tag) && !flags.strict) {
    return;
  }

  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
