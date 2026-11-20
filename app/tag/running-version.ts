/**
 * Running-version helpers for tag selection: the `dd.tag.ceiling` boundary and
 * the `${major}` / `${minor}` / `${patch}` / `${flavor}` variables usable in
 * `dd.tag.include` / `dd.tag.exclude`. Every value is read from the transformed
 * running tag.
 */

import { getNumericTagShapeFromTransformedTag } from './precision.js';

export type TagCeiling = 'major' | 'minor';

type RunningVersionVariable = 'major' | 'minor' | 'patch' | 'flavor';

export interface RunningVersion {
  /** Numeric segments of the transformed running tag, as digit strings. */
  segments: string[];
  /** Non-numeric suffix after the version core, without its leading separator. */
  flavor: string;
}

const VARIABLE_PATTERN = /\$\{(major|minor|patch|flavor)\}/g;
const SEGMENT_INDEX: Record<'major' | 'minor' | 'patch', number> = { major: 0, minor: 1, patch: 2 };

/**
 * Normalize a raw ceiling value. `undefined` means "not configured"; `'invalid'`
 * means a value was supplied that is neither `major` nor `minor`.
 */
export function normalizeTagCeiling(raw: string | undefined): TagCeiling | 'invalid' | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === 'major' || normalized === 'minor' ? normalized : 'invalid';
}

/**
 * Read the running version from an already transformed tag. Returns null when
 * the tag has no numeric version core (for example "latest").
 */
export function getRunningVersion(transformedTag: string): RunningVersion | null {
  const shape = getNumericTagShapeFromTransformedTag(transformedTag);
  if (!shape) {
    return null;
  }
  return {
    segments: shape.numericSegments,
    flavor: shape.suffix.replace(/^[-_.+]+/, ''),
  };
}

function stripLeadingZeros(segment: string): string {
  const stripped = segment.replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}

/**
 * True when the candidate stays inside the running version's ceiling. A candidate
 * that cannot supply the segments the ceiling needs is rejected (fail safe).
 */
export function isWithinCeiling(
  ceiling: TagCeiling,
  running: RunningVersion,
  candidateTransformedTag: string,
): boolean {
  const candidateShape = getNumericTagShapeFromTransformedTag(candidateTransformedTag);
  if (!candidateShape) {
    return false;
  }
  const depth = ceiling === 'major' ? 1 : 2;
  for (let index = 0; index < depth; index += 1) {
    const candidateSegment = candidateShape.numericSegments[index];
    if (
      candidateSegment === undefined ||
      stripLeadingZeros(candidateSegment) !== stripLeadingZeros(running.segments[index])
    ) {
      return false;
    }
  }
  return true;
}

/** Whether the running version has enough segments for the ceiling to apply. */
export function canApplyCeiling(ceiling: TagCeiling, running: RunningVersion): boolean {
  return running.segments.length >= (ceiling === 'major' ? 1 : 2);
}

/**
 * Backslash-escape ASCII punctuation so an inserted value is always a regex
 * literal. Letters, digits and non-ASCII characters stay as they are: RE2 rejects
 * a backslash before them.
 */
function escapeRegexLiteral(value: string): string {
  return value.replace(/[^\dA-Za-z\u0080-\uffff]/g, '\\$&');
}

export type VariableSubstitution =
  | { ok: true; pattern: string }
  | { ok: false; missing: RunningVersionVariable[] };

/**
 * Substitute running-version variables into a filter pattern. When the running
 * version cannot supply a variable the pattern uses, the result is `ok: false`
 * and the caller must not evaluate the pattern at all.
 */
export function substituteRunningVersionVariables(
  pattern: string,
  running: RunningVersion | null,
): VariableSubstitution {
  const used = [...pattern.matchAll(VARIABLE_PATTERN)].map(
    (match) => match[1] as RunningVersionVariable,
  );
  if (used.length === 0) {
    return { ok: true, pattern };
  }
  const resolve = (name: RunningVersionVariable): string | undefined => {
    if (!running) return undefined;
    const value = name === 'flavor' ? running.flavor : running.segments[SEGMENT_INDEX[name]];
    return value === undefined || value === '' ? undefined : value;
  };
  const missing = [...new Set(used)].filter((name) => resolve(name) === undefined);
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return {
    ok: true,
    pattern: pattern.replace(VARIABLE_PATTERN, (_match, name: RunningVersionVariable) =>
      escapeRegexLiteral(resolve(name) as string),
    ),
  };
}
