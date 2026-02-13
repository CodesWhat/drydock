import type { Container } from '../../model/container.js';

const NON_DIGEST_ONLY_SUFFIX = '-no-digest';

export const SUPPORTED_THRESHOLDS = [
  'all',
  'major',
  'minor',
  'patch',
  'major-only',
  'minor-only',
  'digest',
  'major-no-digest',
  'minor-no-digest',
  'patch-no-digest',
  'major-only-no-digest',
  'minor-only-no-digest',
] as const;

type SemverThresholdPredicate = (semverDiff: string) => boolean;

const SEMVER_THRESHOLD_PREDICATES: Record<string, SemverThresholdPredicate> = {
  'major-only': (semverDiff) => semverDiff === 'major',
  'minor-only': (semverDiff) => semverDiff === 'minor',
  minor: (semverDiff) => semverDiff !== 'major',
  patch: (semverDiff) => semverDiff !== 'major' && semverDiff !== 'minor',
};

function evaluateSemverThreshold(thresholdBase: string, semverDiff: string): boolean {
  return SEMVER_THRESHOLD_PREDICATES[thresholdBase]?.(semverDiff) ?? true;
}

function shouldFilterDigestOnlyUpdate(
  nonDigestOnly: boolean,
  updateKind: string | undefined,
): boolean {
  return nonDigestOnly && updateKind === 'digest';
}

function isDigestThreshold(thresholdBase: string): boolean {
  return thresholdBase === 'digest';
}

function isAllThreshold(thresholdBase: string): boolean {
  return thresholdBase === 'all';
}

function hasKnownTagSemver(
  updateKind: string | undefined,
  semverDiff: string | undefined,
): boolean {
  return updateKind === 'tag' && Boolean(semverDiff) && semverDiff !== 'unknown';
}

export function parseThresholdWithDigestBehavior(threshold: string | undefined) {
  const thresholdNormalized = (threshold ?? 'all').toLowerCase();
  const nonDigestOnly = thresholdNormalized.endsWith(NON_DIGEST_ONLY_SUFFIX);
  const thresholdBase = nonDigestOnly
    ? thresholdNormalized.slice(0, thresholdNormalized.length - NON_DIGEST_ONLY_SUFFIX.length)
    : thresholdNormalized;

  return {
    thresholdBase,
    nonDigestOnly,
  };
}

export function isThresholdReached(containerResult: Container, threshold: string): boolean {
  const { thresholdBase, nonDigestOnly } = parseThresholdWithDigestBehavior(threshold);
  const updateKind = containerResult.updateKind?.kind;
  const semverDiff = containerResult.updateKind?.semverDiff;

  if (shouldFilterDigestOnlyUpdate(nonDigestOnly, updateKind)) {
    return false;
  }

  if (isDigestThreshold(thresholdBase)) {
    return updateKind === 'digest';
  }

  if (isAllThreshold(thresholdBase)) {
    return true;
  }

  if (hasKnownTagSemver(updateKind, semverDiff)) {
    return evaluateSemverThreshold(thresholdBase, semverDiff);
  }

  return true;
}
