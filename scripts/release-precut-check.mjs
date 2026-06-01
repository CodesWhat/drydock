#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const releaseTagRegex =
  /^v?(?<major>(?:0|[1-9]\d*))\.(?<minor>(?:0|[1-9]\d*))\.(?<patch>(?:0|[1-9]\d*))(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

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

export function parsePendingReplies(markdown, tag) {
  const series = versionSeries(tag);
  const [major, minor] = series.split('.');
  const seriesRegex = new RegExp(`v?${major}\\.${minor}(?![0-9])`, 'u');

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
    return `✓ No pending discussion replies for ${tag}.`;
  }

  const noun = pending.length === 1 ? 'discussion' : 'discussions';
  const items = pending.map((p) => `   #${p.discussion} ${p.feature}`).join('\n');

  const verb = pending.length === 1 ? 'needs' : 'need';
  return `⚠  ${pending.length} ${noun} still ${verb} a "shipped in ${tag}" reply:\n${items}\n\nPost replies + check the boxes in current-tracker.md,\nor re-run with --force to cut anyway.`;
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

  const defaultTrackerPath = fileURLToPath(
    new URL('../.planning/roadmap/current-tracker.md', import.meta.url),
  );
  const trackerPath = flags.tracker ?? defaultTrackerPath;

  let contents;
  try {
    contents = readFileSync(trackerPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`⚠  Tracker not found at ${trackerPath}; skipping discussion-reply check.`);
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
