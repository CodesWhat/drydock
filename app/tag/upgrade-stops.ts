/**
 * Required upgrade stops (`dd.tag.stops`). A stop is a version the update path
 * must pass through before anything beyond it is offered, for example
 * Nextcloud's one-major-at-a-time rule (`27,28,29`) or GitLab's required stops
 * (`13.8.8,13.12.15`). A stop compares only to the depth it names: stop `27` is
 * reached by any `27.x.y`, stop `13.8.8` only by `13.8.8` or later.
 */

import { getNumericTagShapeFromTransformedTag } from './precision.js';
import type { RunningVersion } from './running-version.js';

/** Version segments as digit strings, for example `['27']` or `['13','8','8']`. */
export type UpgradeStop = string[];

const STOP_PATTERN = /^v?\d+(?:\.\d+)*$/i;

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

/** Compare `segments` to `stop` over the stop's depth only; missing segments count as 0. */
function compareToStop(segments: string[], stop: UpgradeStop): number {
  for (let index = 0; index < stop.length; index += 1) {
    const order = compareSegment(segments[index], stop[index]);
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}

function compareStops(a: UpgradeStop, b: UpgradeStop): number {
  const depth = Math.max(a.length, b.length);
  for (let index = 0; index < depth; index += 1) {
    const order = compareSegment(a[index], b[index]);
    if (order !== 0) {
      return order;
    }
  }
  return a.length - b.length;
}

/**
 * Parse a `dd.tag.stops` value: a comma separated list of versions. Stops come
 * back sorted ascending and de-duplicated. Entries that are not plain dotted
 * numbers land in `invalid` and are skipped.
 */
export function parseUpgradeStops(raw: string | undefined): {
  stops: UpgradeStop[];
  invalid: string[];
} {
  const parsed: UpgradeStop[] = [];
  const invalid: string[] = [];
  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') {
      continue;
    }
    if (STOP_PATTERN.test(trimmed)) {
      parsed.push(trimmed.replace(/^v/i, '').split('.'));
    } else {
      invalid.push(trimmed);
    }
  }
  parsed.sort(compareStops);
  const stops = parsed.filter(
    (stop, index) => index === 0 || compareStops(stop, parsed[index - 1]) !== 0,
  );
  return { stops, invalid };
}

/**
 * The first stop the running version has not reached yet, or undefined when it
 * is at or past every stop.
 */
export function getActiveUpgradeStop(
  stops: UpgradeStop[],
  running: RunningVersion,
): UpgradeStop | undefined {
  return stops.find((stop) => compareToStop(running.segments, stop) < 0);
}

/** True when the candidate does not pass the stop. A candidate with no numeric version is rejected. */
export function isWithinUpgradeStop(stop: UpgradeStop, candidateTransformedTag: string): boolean {
  const candidateShape = getNumericTagShapeFromTransformedTag(candidateTransformedTag);
  if (!candidateShape) {
    return false;
  }
  return compareToStop(candidateShape.numericSegments, stop) <= 0;
}
