/**
 * Best update candidate per update type (patch, minor, major) relative to the
 * running version. The candidate list is already filtered (include/exclude,
 * family, ceilings, skipped lines) and sorted highest first, so the first tag
 * seen for each type is the best one.
 */

import { transform as transformTag } from './index.js';
import { getRunningVersion, type RunningVersion } from './running-version.js';

export type UpdateCandidateType = 'patch' | 'minor' | 'major';

export interface UpdateCandidate {
  tag: string;
  digest?: string;
  semverDiff: UpdateCandidateType;
}

export type UpdateCandidates = Partial<Record<UpdateCandidateType, UpdateCandidate>>;

function stripLeadingZeros(segment: string): string {
  const stripped = segment.replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}

function compareSegment(a: string | undefined, b: string | undefined): number {
  const left = stripLeadingZeros(a ?? '0');
  const right = stripLeadingZeros(b ?? '0');
  if (left.length !== right.length) {
    return left.length > right.length ? 1 : -1;
  }
  if (left === right) {
    return 0;
  }
  return left > right ? 1 : -1;
}

function classify(
  running: RunningVersion,
  candidate: RunningVersion,
): UpdateCandidateType | undefined {
  const majorOrder = compareSegment(candidate.segments[0], running.segments[0]);
  if (majorOrder < 0) {
    return undefined;
  }
  if (majorOrder > 0) {
    return 'major';
  }
  const minorOrder = compareSegment(candidate.segments[1], running.segments[1]);
  if (minorOrder < 0) {
    return undefined;
  }
  return minorOrder > 0 ? 'minor' : 'patch';
}

/**
 * Pick the best candidate per update type from higher tags sorted highest first.
 * Returns undefined when the running tag has no numeric version or fewer than two
 * types have a candidate (a lone candidate is the primary update, which the
 * result already carries). `known` supplies digests resolved for specific tags (only the
 * primary candidate's digest is looked up).
 */
export function computeUpdateCandidates(
  sortedCandidateTags: string[],
  currentTag: string,
  transformTags: string | undefined,
  known: { tag?: string; digest?: string } = {},
): UpdateCandidates | undefined {
  const running = getRunningVersion(transformTag(transformTags, currentTag));
  if (!running) {
    return undefined;
  }
  const candidates: UpdateCandidates = {};
  for (const tag of sortedCandidateTags) {
    const version = getRunningVersion(transformTag(transformTags, tag));
    if (!version) {
      continue;
    }
    const type = classify(running, version);
    if (type === undefined || candidates[type] !== undefined) {
      continue;
    }
    candidates[type] = {
      tag,
      ...(known.digest !== undefined && known.tag === tag ? { digest: known.digest } : {}),
      semverDiff: type,
    };
  }
  return Object.keys(candidates).length > 1 ? candidates : undefined;
}
