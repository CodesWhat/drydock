/**
 * Reject scope: skipping a whole major or minor line instead of one exact tag.
 *
 * A line skip is stored as an ordinary `skipTags` entry, `major:3` or `minor:3.4`. Docker
 * tags cannot contain a colon, so a line entry can never collide with a real tag, and it
 * rides the existing skip plumbing for free: the `update_policy_overrides` JSON column
 * (restart-safe, no migration), the `dd.updatePolicy.skipTags` label, group policies, the
 * `remove-skip` action and the policy panel.
 *
 * Line membership is judged on the transformed tag (`dd.tag.transform`), the same value
 * the candidate comparison uses, so a rejected line means the same thing to both.
 */
import * as tag from '../tag/index.js';

const { parse: parseSemver, transform: transformTag } = tag;

export type RejectScope = 'tag' | 'minor' | 'major';

export const REJECT_SCOPES: readonly RejectScope[] = ['tag', 'minor', 'major'];

const LINE_ENTRY_PATTERN = /^(major|minor):(\d+)(?:\.(\d+))?$/;

export function isRejectScope(value: unknown): value is RejectScope {
  return typeof value === 'string' && (REJECT_SCOPES as readonly string[]).includes(value);
}

interface LineSkip {
  scope: 'major' | 'minor';
  major: number;
  minor?: number;
}

function parseLineSkipEntry(entry: string): LineSkip | undefined {
  const match = LINE_ENTRY_PATTERN.exec(entry);
  if (!match) {
    return undefined;
  }
  const scope = match[1] as 'major' | 'minor';
  if (scope === 'minor') {
    return match[3] === undefined
      ? undefined
      : { scope, major: Number(match[2]), minor: Number(match[3]) };
  }
  return match[3] === undefined ? { scope, major: Number(match[2]) } : undefined;
}

function getTagLine(
  rawTag: string,
  transformTags: string | undefined,
): { major: number; minor: number } | undefined {
  const parsed = parseSemver(transformTag(transformTags, rawTag));
  return parsed ? { major: parsed.major, minor: parsed.minor } : undefined;
}

/**
 * Build the skipTags entry for rejecting `rawTag` at `scope`, or undefined when the tag has
 * no semver line to skip (non-semver tags only support the exact `tag` scope).
 */
export function buildLineSkipEntry(
  scope: 'major' | 'minor',
  rawTag: string,
  transformTags: string | undefined,
): string | undefined {
  const line = getTagLine(rawTag, transformTags);
  if (!line) {
    return undefined;
  }
  return scope === 'major' ? `major:${line.major}` : `minor:${line.major}.${line.minor}`;
}

/** True when `rawTag` is skipped by an exact entry or by a major/minor line entry. */
export function isTagSkipped(
  rawTag: string,
  skipTags: readonly string[] | undefined,
  transformTags: string | undefined,
): boolean {
  if (!Array.isArray(skipTags) || skipTags.length === 0) {
    return false;
  }
  if (skipTags.includes(rawTag)) {
    return true;
  }
  const lineSkips = skipTags
    .map((entry) => parseLineSkipEntry(entry))
    .filter((entry): entry is LineSkip => entry !== undefined);
  if (lineSkips.length === 0) {
    return false;
  }
  const line = getTagLine(rawTag, transformTags);
  if (!line) {
    return false;
  }
  return lineSkips.some(
    (skip) => skip.major === line.major && (skip.scope === 'major' || skip.minor === line.minor),
  );
}

/**
 * Candidate selection: drop every tag covered by a major/minor line entry so the next
 * eligible tag (a later line, or a patch in a line that was not rejected) is the one
 * offered. Exact entries are deliberately not applied here; they keep suppressing the
 * offered candidate after selection, exactly as before.
 */
export function filterLineSkippedTags(
  tags: string[],
  skipTags: readonly string[] | undefined,
  transformTags: string | undefined,
): string[] {
  const lineEntries = (skipTags ?? []).filter((entry) => parseLineSkipEntry(entry) !== undefined);
  if (lineEntries.length === 0) {
    return tags;
  }
  return tags.filter((candidate) => !isTagSkipped(candidate, lineEntries, transformTags));
}
