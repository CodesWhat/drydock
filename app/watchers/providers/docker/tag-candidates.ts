import { RE2JS } from 're2js';

import type { Container } from '../../../model/container.js';
import {
  diff as diffSemver,
  isGreater as isGreaterSemver,
  parse as parseSemver,
  transform as transformTag,
} from '../../../tag/index.js';
import {
  getNumericTagShapeFromTransformedTag,
  getNumericTagShape as getSharedNumericTagShape,
  type NumericTagShape,
} from '../../../tag/precision.js';
import { getErrorMessage } from '../../../util/error.js';

interface SafeRegex {
  test(s: string): boolean;
}

interface TagCandidatesLogger {
  warn(message: string): void;
  debug?: (message: string) => void;
}

/**
 * Safely compile a user-supplied regex pattern.
 * Returns null (and logs a warning) when the pattern is invalid.
 * Uses RE2 (via re2js), which is inherently immune to ReDoS backtracking attacks.
 */
function safeRegExp(pattern: string, logger: TagCandidatesLogger): SafeRegex | null {
  const MAX_PATTERN_LENGTH = 1024;
  if (pattern.length > MAX_PATTERN_LENGTH) {
    logger.warn(`Regex pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`);
    return null;
  }
  try {
    const compiled = RE2JS.compile(pattern);
    return {
      test(s: string): boolean {
        return compiled.matcher(s).find();
      },
    };
  } catch (e: unknown) {
    logger.warn(`Invalid regex pattern "${pattern}": ${getErrorMessage(e, String(e))}`);
    return null;
  }
}

/**
 * Apply include/exclude regex filters to tags.
 * Returns the filtered tags and whether include-filter recovery mode is active.
 */
function applyIncludeExcludeFilters(
  container: Container,
  tags: string[],
  logContainer: TagCandidatesLogger,
): { filteredTags: string[]; allowIncludeFilterRecovery: boolean } {
  let filteredTags = tags;
  let allowIncludeFilterRecovery = false;

  if (container.includeTags) {
    const includeTagsRegex = safeRegExp(container.includeTags, logContainer);
    if (includeTagsRegex) {
      filteredTags = filteredTags.filter((tag) => includeTagsRegex.test(tag));
      if (container.image.tag.semver && !includeTagsRegex.test(container.image.tag.value)) {
        logContainer.warn(
          `Current tag "${container.image.tag.value}" does not match includeTags regex "${container.includeTags}". Trying best-effort semver upgrade within filtered tags.`,
        );
        allowIncludeFilterRecovery = true;
      }
    }
  } else {
    filteredTags = filteredTags.filter((tag) => !tag.startsWith('sha'));
  }

  if (container.excludeTags) {
    const excludeTagsRegex = safeRegExp(container.excludeTags, logContainer);
    if (excludeTagsRegex) {
      filteredTags = filteredTags.filter((tag) => !excludeTagsRegex.test(tag));
    }
  }

  filteredTags = filteredTags.filter((tag) => !tag.endsWith('.sig'));
  return { filteredTags, allowIncludeFilterRecovery };
}

export function getFirstDigitIndex(value: string): number {
  return value.search(/[0-9]/);
}

export function getCurrentPrefix(value: string): string {
  const firstDigitIndex = getFirstDigitIndex(value);
  return firstDigitIndex >= 0 ? value.slice(0, firstDigitIndex) : '';
}

function startsWithDigit(value: string): boolean {
  return getFirstDigitIndex(value) === 0;
}

function getPrefixFilterWarning(currentPrefix: string): string {
  if (currentPrefix) {
    return `No tags found with existing prefix: '${currentPrefix}'; check your regex filters`;
  }
  return 'No tags found starting with a number (no prefix); check your regex filters';
}

function hasLeadingZero(value: string): boolean {
  return value.length > 1 && value.startsWith('0');
}

export const getNumericTagShape = getSharedNumericTagShape;

type TagFamilyPolicy = 'strict' | 'loose';

interface SemverCandidateFilterStats {
  input: number;
  afterPrefix: number;
  afterSemver: number;
  afterFamily: number;
  afterGreater: number;
  output: number;
  crossFamilyGreaterDropped: number;
  prefixSkipped: boolean;
  greaterSkipped: boolean;
}

export interface TagInsight {
  tag: string;
  kind: 'major' | 'minor' | 'patch';
}

interface TagCandidatesResult {
  tags: string[];
  noUpdateReason?: string;
  insight?: TagInsight;
}

function normalizeSuffixTemplate(suffix: string): string {
  return suffix.toLowerCase().replace(/\d+/g, '#');
}

/**
 * #498: pre-compiled RE2 pattern for isPrereleaseSuffix(). Matches only
 * conventional prerelease identifiers, optionally followed by a numeric
 * qualifier (e.g. "-rc.1", "-beta2") — never a variant/build suffix like
 * "-openvino" or "-alpine3.19". Compiled once at module load, mirroring the
 * REJECTED_CREDENTIAL_DEFAULT_PATTERN pattern in BaseRegistry.ts.
 */
const PRERELEASE_SUFFIX_PATTERN = RE2JS.compile(
  '^[-._]?(rc|alpha|beta|pre|preview|dev|next|canary|snapshot)([._-]?[0-9]+)*$',
);

/**
 * #498: true when `suffix` is a conventional prerelease identifier (rc,
 * alpha, beta, pre, preview, dev, next, canary, snapshot — optionally
 * followed by a numeric qualifier). Lets a prerelease-pinned tag (e.g.
 * "1.5.2-rc.1") see its own bare GA release ("1.5.2") in isSuffixCompatible,
 * without opening the door to unrelated variant suffixes.
 */
export function isPrereleaseSuffix(suffix: string): boolean {
  return PRERELEASE_SUFFIX_PATTERN.matches(suffix.toLowerCase());
}

/**
 * #501: `allowPrereleaseToGA` scopes the #498 prerelease->GA widening to the
 * informational insight path only (computePinGateInsight). It defaults to
 * false, so the actionable path — which shares this function via
 * isSemverFamilyMatch/isStrictFamilyMatch — never treats a bare GA release as
 * an actionable update candidate for a prerelease-pinned container, even
 * under dd.tag.family=loose or a permissive includeTags filter.
 */
function isSuffixCompatible(
  referenceSuffix: string,
  candidateSuffix: string,
  allowPrereleaseToGA = false,
): boolean {
  if (referenceSuffix === '') {
    return candidateSuffix === '';
  }
  if (candidateSuffix === '') {
    // #498/#501: a prerelease-pinned reference (e.g. "1.5.2-rc.1") can see its
    // own GA release ("1.5.2") only when the caller opts in (the insight path)
    // and the reference suffix is a conventional prerelease identifier.
    // Variant suffixes (e.g. "-openvino", "-alpine") never accept a bare
    // candidate; a bare tag says nothing about which variant it belongs to.
    return allowPrereleaseToGA && isPrereleaseSuffix(referenceSuffix);
  }
  const referenceTemplate = normalizeSuffixTemplate(referenceSuffix);
  const candidateTemplate = normalizeSuffixTemplate(candidateSuffix);
  return (
    candidateTemplate === referenceTemplate ||
    candidateTemplate.startsWith(referenceTemplate) ||
    referenceTemplate.startsWith(candidateTemplate)
  );
}

function getTagFamilyPolicy(
  container: Container,
  logContainer: TagCandidatesLogger,
): TagFamilyPolicy {
  if (!container.tagFamily) {
    return 'strict';
  }
  const normalizedPolicy = container.tagFamily.trim().toLowerCase();
  if (normalizedPolicy === 'strict' || normalizedPolicy === 'loose') {
    return normalizedPolicy;
  }
  logContainer.warn(`Invalid tag family policy "${container.tagFamily}", falling back to "strict"`);
  return 'strict';
}

function isStrictFamilyMatch(
  referenceShape: NumericTagShape,
  candidateShape: NumericTagShape,
  allowPrereleaseToGA = false,
): boolean {
  if (candidateShape.prefix !== referenceShape.prefix) {
    return false;
  }

  if (!isSuffixCompatible(referenceShape.suffix, candidateShape.suffix, allowPrereleaseToGA)) {
    return false;
  }

  // For CalVer-style tags (major >= 1000, e.g. 2025.11.1), relax the
  // leading-zero check so zero-padded months like '02' are accepted.
  const majorValue = Number.parseInt(referenceShape.numericSegments[0], 10);
  const isCalVer = !Number.isNaN(majorValue) && majorValue >= 1000;

  return candidateShape.numericSegments.every((segment, index) => {
    if (!hasLeadingZero(segment)) return true;
    if (hasLeadingZero(referenceShape.numericSegments[index])) return true;
    // Candidate has a leading zero but reference doesn't.
    // Only allow this for CalVer tags where zero-padded months are normal.
    return isCalVer;
  });
}

function hasExpectedPrefix(tag: string, currentPrefix: string): boolean {
  return currentPrefix ? tag.startsWith(currentPrefix) : startsWithDigit(tag);
}

function isSemverFamilyMatch(
  transformedTag: string,
  referenceShape: NumericTagShape | null,
  referenceGroups: number | undefined,
  tagFamilyPolicy: TagFamilyPolicy,
  allowPrereleaseToGA = false,
): boolean {
  if (!referenceShape || referenceGroups === undefined) {
    return true;
  }

  const candidateShape = getNumericTagShapeFromTransformedTag(transformedTag);
  if (!candidateShape || candidateShape.numericSegments.length !== referenceGroups) {
    return false;
  }

  // #498: the suffix/variant guard must hold regardless of tag-family policy.
  // Loose mode only relaxes prefix equality and leading-zero rules — it must
  // never let a bare tag or a different variant cross a suffixed reference.
  // #501: allowPrereleaseToGA defaults to false here, so the actionable path
  // never treats a bare GA release as a match for a prerelease-pinned
  // reference — only computePinGateInsight opts in.
  if (!isSuffixCompatible(referenceShape.suffix, candidateShape.suffix, allowPrereleaseToGA)) {
    return false;
  }

  if (tagFamilyPolicy === 'loose') {
    return true;
  }

  return isStrictFamilyMatch(referenceShape, candidateShape, allowPrereleaseToGA);
}

function isGreaterCandidateTag(
  transformedTag: string,
  currentTransformedTag: string,
  allowIncludeFilterRecovery: boolean,
): boolean {
  if (allowIncludeFilterRecovery) {
    return true;
  }
  if (transformedTag === currentTransformedTag) {
    return false;
  }
  if (!isGreaterSemver(transformedTag, currentTransformedTag)) {
    return false;
  }
  // isGreaterSemver implements >= (semver.gte) for backwards compatibility,
  // so floating aliases like "3.3" and "3.3.0" both pass the >= check in both
  // directions. Reject candidates that are semver-equal to current — they are
  // aliases, not higher versions.
  return !isGreaterSemver(currentTransformedTag, transformedTag);
}

function trackCrossFamilyGreaterDrop(
  stats: SemverCandidateFilterStats,
  allowIncludeFilterRecovery: boolean,
  greaterThanCurrent: boolean,
): void {
  if (!allowIncludeFilterRecovery && greaterThanCurrent) {
    stats.crossFamilyGreaterDropped += 1;
  }
}

interface SemverCandidateFilterContext {
  transformTags: string | undefined;
  currentPrefix: string;
  currentTransformedTag: string;
  referenceShape: NumericTagShape | null;
  referenceGroups: number | undefined;
  tagFamilyPolicy: TagFamilyPolicy;
  applyPrefixFilter: boolean;
  allowIncludeFilterRecovery: boolean;
  // #501: only true for the computePinGateInsight() call chain — never for
  // the actionable candidate path.
  allowPrereleaseToGA: boolean;
}

function shouldIncludeSemverCandidate(
  tag: string,
  context: SemverCandidateFilterContext,
  stats: SemverCandidateFilterStats,
): boolean {
  if (context.applyPrefixFilter && !hasExpectedPrefix(tag, context.currentPrefix)) {
    return false;
  }
  stats.afterPrefix += 1;

  const transformedTag = transformTag(context.transformTags, tag);
  if (parseSemver(transformedTag) === null) {
    return false;
  }
  stats.afterSemver += 1;

  const familyMatch = isSemverFamilyMatch(
    transformedTag,
    context.referenceShape,
    context.referenceGroups,
    context.tagFamilyPolicy,
    context.allowPrereleaseToGA,
  );
  const greaterThanCurrent = isGreaterCandidateTag(
    transformedTag,
    context.currentTransformedTag,
    context.allowIncludeFilterRecovery,
  );

  if (!familyMatch) {
    trackCrossFamilyGreaterDrop(stats, context.allowIncludeFilterRecovery, greaterThanCurrent);
    return false;
  }
  stats.afterFamily += 1;

  if (!greaterThanCurrent) {
    return false;
  }
  stats.afterGreater += 1;

  return true;
}

function filterSemverCandidatesOnePass(
  tags: string[],
  container: Container,
  tagFamilyPolicy: TagFamilyPolicy,
  applyPrefixFilter: boolean,
  allowIncludeFilterRecovery: boolean,
  allowPrereleaseToGA = false,
): { filteredTags: string[]; currentPrefix: string; stats: SemverCandidateFilterStats } {
  const currentTag = container.image.tag.value;
  const currentPrefix = getCurrentPrefix(currentTag);
  const currentTransformedTag = transformTag(container.transformTags, currentTag);
  const referenceShape = getNumericTagShapeFromTransformedTag(currentTransformedTag);
  const referenceGroups = referenceShape?.numericSegments.length;
  const context: SemverCandidateFilterContext = {
    transformTags: container.transformTags,
    currentPrefix,
    currentTransformedTag,
    referenceShape,
    referenceGroups,
    tagFamilyPolicy,
    applyPrefixFilter,
    allowIncludeFilterRecovery,
    allowPrereleaseToGA,
  };

  const stats: SemverCandidateFilterStats = {
    input: tags.length,
    afterPrefix: 0,
    afterSemver: 0,
    afterFamily: 0,
    afterGreater: 0,
    output: 0,
    crossFamilyGreaterDropped: 0,
    prefixSkipped: !applyPrefixFilter,
    greaterSkipped: allowIncludeFilterRecovery,
  };

  const filteredTags = tags.filter((tag) => shouldIncludeSemverCandidate(tag, context, stats));

  stats.output = filteredTags.length;
  return { filteredTags, currentPrefix, stats };
}

function logSemverCandidateFilterStats(
  logContainer: TagCandidatesLogger,
  tagFamilyPolicy: TagFamilyPolicy,
  stats: SemverCandidateFilterStats,
): void {
  if (typeof logContainer?.debug !== 'function') {
    return;
  }

  const prefixDropped = stats.prefixSkipped ? 0 : stats.input - stats.afterPrefix;
  const semverDropped = stats.afterPrefix - stats.afterSemver;
  const familyDropped = stats.afterSemver - stats.afterFamily;
  const greaterDropped = stats.greaterSkipped ? 0 : stats.afterFamily - stats.afterGreater;
  const prefixCounter = stats.prefixSkipped ? 'skipped' : `${stats.afterPrefix}`;
  const greaterCounter = stats.greaterSkipped ? 'skipped' : `${stats.afterGreater}`;

  logContainer.debug(
    `Tag candidate filter counters (${tagFamilyPolicy}): input=${stats.input}, prefix=${prefixCounter}, semver=${stats.afterSemver}, family=${stats.afterFamily}, greater=${greaterCounter}, output=${stats.output}; dropped(prefix=${prefixDropped}, semver=${semverDropped}, family=${familyDropped}, greater=${greaterDropped})`,
  );
}

/**
 * Filter tags to only those with the same number of numeric segments
 * and inferred family as the current tag.
 */
export function filterBySegmentCount(tags: string[], container: Container): string[] {
  const referenceShape = getNumericTagShape(container.image.tag.value, container.transformTags);
  if (!referenceShape) {
    return tags;
  }

  const referenceGroups = referenceShape.numericSegments.length;

  return tags.filter((tag) => {
    const candidateShape = getNumericTagShape(tag, container.transformTags);
    if (!candidateShape || candidateShape.numericSegments.length !== referenceGroups) {
      return false;
    }

    return isStrictFamilyMatch(referenceShape, candidateShape);
  });
}

/**
 * Compare two numeric-tag shapes by their numeric segments only (descending),
 * matching semver major/minor/patch precedence but ignoring the suffix.
 * Missing trailing segments are treated as 0. Returns 0 when all segments tie.
 */
function compareNumericSegmentsDescending(a: NumericTagShape, b: NumericTagShape): number {
  const segmentCount = Math.max(a.numericSegments.length, b.numericSegments.length);
  for (let i = 0; i < segmentCount; i += 1) {
    const aSegment = Number.parseInt(a.numericSegments[i] ?? '0', 10);
    const bSegment = Number.parseInt(b.numericSegments[i] ?? '0', 10);
    if (aSegment !== bSegment) {
      return bSegment - aSegment;
    }
  }
  return 0;
}

/**
 * #498: when numeric segments tie, prefer the candidate whose suffix template
 * exactly matches the reference's over one that is merely suffix-compatible.
 * Without this, semver treats the suffix as a prerelease field, so a bare tag
 * or a differently-precise variant (e.g. "-alpine3.21") can outrank the exact
 * match (e.g. "-alpine") at the same numeric version.
 */
function compareExactSuffixMatch(
  a: NumericTagShape,
  b: NumericTagShape,
  referenceSuffixTemplate: string | undefined,
): number {
  if (referenceSuffixTemplate === undefined) {
    return 0;
  }
  const aExact = normalizeSuffixTemplate(a.suffix) === referenceSuffixTemplate;
  const bExact = normalizeSuffixTemplate(b.suffix) === referenceSuffixTemplate;
  if (aExact === bExact) {
    return 0;
  }
  return aExact ? -1 : 1;
}

/**
 * Sort tags by semver in descending order (mutates the array).
 * Pre-computes transformed tags to avoid recompiling the transform formula
 * on every comparator call (O(n log n) calls for an n-element array).
 * Ties on numeric segments are broken in favor of the candidate whose suffix
 * template exactly matches referenceTag's (#498) — when referenceTag has no
 * derivable numeric shape (e.g. a rolling alias), the tie-break is skipped.
 */
function sortSemverDescending(
  tags: string[],
  transformTags: string | undefined,
  referenceTag: string,
): void {
  const referenceShape = getNumericTagShapeFromTransformedTag(
    transformTag(transformTags, referenceTag),
  );
  const referenceSuffixTemplate = referenceShape
    ? normalizeSuffixTemplate(referenceShape.suffix)
    : undefined;

  const transformed = tags.map((tag) => {
    const transformedTag = transformTag(transformTags, tag);
    return {
      tag,
      transformed: transformedTag,
      shape: getNumericTagShapeFromTransformedTag(transformedTag),
    };
  });
  transformed.sort((a, b) => {
    if (a.shape && b.shape) {
      const numericComparison = compareNumericSegmentsDescending(a.shape, b.shape);
      if (numericComparison !== 0) {
        return numericComparison;
      }
      const suffixComparison = compareExactSuffixMatch(a.shape, b.shape, referenceSuffixTemplate);
      if (suffixComparison !== 0) {
        return suffixComparison;
      }
    }
    const greater = isGreaterSemver(b.transformed, a.transformed);
    return greater ? 1 : -1;
  });
  for (let i = 0; i < tags.length; i += 1) {
    tags[i] = transformed[i].tag;
  }
}

/**
 * Keep only tags that are valid semver.
 */
function filterSemverOnly(tags: string[], transformTags: string | undefined): string[] {
  return tags.filter((tag) => parseSemver(transformTag(transformTags, tag)) !== null);
}

/**
 * #498: classify a pin-gate insight's version bump as major/minor/patch.
 * diffSemver() treats a shared suffix as a semver prerelease field, so a
 * cross-major bump between two same-suffix tags reports as "premajor" (not
 * "major") — fold the pre-* variants into their release counterpart. Any
 * other outcome (e.g. a pure suffix/variant change with no numeric bump)
 * collapses to "patch", the least severe of the three reported kinds.
 */
function toPinInfoKind(
  currentTransformedTag: string,
  candidateTransformedTag: string,
): TagInsight['kind'] {
  const semverDiffResult = diffSemver(currentTransformedTag, candidateTransformedTag);
  switch (semverDiffResult) {
    case 'major':
    case 'premajor':
      return 'major';
    case 'minor':
    case 'preminor':
      return 'minor';
    default:
      return 'patch';
  }
}

/**
 * #498 (nit): true when a same-numeric-core candidate represents a genuine
 * version step rather than the same version described with a more precise
 * suffix. Two cases count as genuine: the suffix template is unchanged and
 * only its digit qualifier moved (e.g. "-rc.1" -> "-rc.2"), or the reference
 * suffix is a conventional prerelease identifier and the candidate is its
 * bare GA release (e.g. "-rc.1" -> ""). Anything else at the same core
 * version — most notably a suffix template growing more precise, e.g.
 * "-alpine" -> "-alpine3.21" — describes the same version, not a newer one.
 */
function isMeaningfulSameCoreCandidate(
  currentShape: NumericTagShape,
  candidateShape: NumericTagShape,
): boolean {
  if (candidateShape.suffix === '' && isPrereleaseSuffix(currentShape.suffix)) {
    return true;
  }
  return (
    normalizeSuffixTemplate(currentShape.suffix) === normalizeSuffixTemplate(candidateShape.suffix)
  );
}

/**
 * #498 (nit): drop pin-gate candidates that only grow the current tag's
 * suffix precision at the same numeric core version (see
 * isMeaningfulSameCoreCandidate above) — those describe the same version,
 * not an update, and must never be reported as an insight.
 */
function filterMeaningfulInsightCandidates(
  candidates: string[],
  container: Container,
  currentShape: NumericTagShape | null,
): string[] {
  if (!currentShape) {
    return candidates;
  }
  return candidates.filter((candidateTag) => {
    const candidateTransformedTag = transformTag(container.transformTags, candidateTag);
    const candidateShape = getNumericTagShapeFromTransformedTag(candidateTransformedTag);
    // #498: defensive only. A candidate only reaches this array by surviving
    // isSemverFamilyMatch, which (whenever currentShape here is non-null,
    // i.e. its own reference-shape computation was non-null) requires that
    // same candidate to have produced a non-null shape there too — computed
    // from the exact same (container.transformTags, candidateTag) inputs.
    /* v8 ignore next 3 -- unreachable given the invariant above; kept for type-safety and defense-in-depth */
    if (!candidateShape) {
      return true;
    }
    if (compareNumericSegmentsDescending(currentShape, candidateShape) !== 0) {
      return true;
    }
    return isMeaningfulSameCoreCandidate(currentShape, candidateShape);
  });
}

/**
 * #498: compute the informational "what's newer" insight for a container
 * caught by the pin gate (specific-precision, unlabeled, non-loose). Reuses
 * the same one-pass semver-family filter as the actionable path, but always
 * under strict-style family matching — the pin gate is only ever entered
 * when the container's own policy is already non-loose, so this mirrors that
 * policy rather than overriding it. Cross-MAJOR jumps are allowed (that is
 * the entire point of the informational channel); crossing a suffix/variant
 * boundary is not.
 *
 * #501: this is the *only* call site that passes allowPrereleaseToGA=true —
 * a prerelease-pinned reference (e.g. "1.5.2-rc.1") sees its own bare GA
 * release ("1.5.2") here, for information only. The actionable path never
 * sets this flag, so the same widening cannot make a bare GA release an
 * actionable update candidate.
 */
function computePinGateInsight(
  container: Container,
  filteredTags: string[],
): TagInsight | undefined {
  const { filteredTags: insightCandidates } = filterSemverCandidatesOnePass(
    filteredTags,
    container,
    'strict',
    true,
    false,
    true,
  );

  if (insightCandidates.length === 0) {
    return undefined;
  }

  const currentTransformedTag = transformTag(container.transformTags, container.image.tag.value);
  const currentShape = getNumericTagShapeFromTransformedTag(currentTransformedTag);

  const meaningfulCandidates = filterMeaningfulInsightCandidates(
    insightCandidates,
    container,
    currentShape,
  );

  if (meaningfulCandidates.length === 0) {
    return undefined;
  }

  sortSemverDescending(meaningfulCandidates, container.transformTags, container.image.tag.value);

  const winningTag = meaningfulCandidates[0];
  const winningTransformedTag = transformTag(container.transformTags, winningTag);

  return {
    tag: winningTag,
    kind: toPinInfoKind(currentTransformedTag, winningTransformedTag),
  };
}

/**
 * #498: the pin gate's digest-disabled noUpdateReason must never contradict a
 * rendered updateInsight badge. When digest watching is off and no insight
 * will be shown either (opt-out via tag.pin.info=false, or no newer
 * same-family tag exists), no update detection of any kind is running — the
 * original, stronger wording. But when an insight *will* still be shown,
 * only actionable update detection (anything that could fire a trigger) is
 * off; the newer-tag badge is still real and still worth surfacing.
 */
function getPinGateDigestDisabledNoUpdateReason(
  currentTagValue: string,
  hasInsight: boolean,
): string {
  const remedy =
    'Remove the digest-watch override (dd.watch.digest=false label or imgset watch.digest=false) to detect same-tag rebuilds, or set dd.tag.family=loose or add a dd.tag.include filter to allow semver version climbing.';
  if (hasInsight) {
    return `Pinned tag "${currentTagValue}": digest watching is disabled for this container, so no actionable update detection is running (a newer same-family tag is still shown for information). ${remedy}`;
  }
  return `Pinned tag "${currentTagValue}": digest watching is disabled for this container, so no update detection is running. ${remedy}`;
}

/**
 * Filter candidate tags (based on tag name).
 * @param container
 * @param tags
 * @param logContainer
 * @param computeInsight when true (default), also compute the pin-gate
 *   informational insight (#498). Watchers can opt out via tag.pin.info=false.
 * @returns {*}
 */
export function getTagCandidates(
  container: Container,
  tags: string[],
  logContainer: TagCandidatesLogger,
  computeInsight = true,
): TagCandidatesResult {
  const { filteredTags: baseTags, allowIncludeFilterRecovery } = applyIncludeExcludeFilters(
    container,
    tags,
    logContainer,
  );

  if (!container.image.tag.semver && !container.includeTags) {
    return { tags: [] };
  }

  if (!container.image.tag.semver) {
    // Non-semver tag with includeTags filter: advise best semver tag
    logContainer.warn(
      `Current tag "${container.image.tag.value}" is not semver but includeTags filter "${container.includeTags}" is set. Advising best semver tag from filtered candidates.`,
    );
    const semverTags = filterSemverOnly(baseTags, container.transformTags);
    sortSemverDescending(semverTags, container.transformTags, container.image.tag.value);
    return { tags: semverTags };
  }

  // Semver image -> find higher semver tag
  let filteredTags = baseTags;
  const tagFamilyPolicy = getTagFamilyPolicy(container, logContainer);

  if (container.image.tag.tagPrecision === 'floating' && tagFamilyPolicy === 'strict') {
    const digestWatchEnabled = Boolean(container.image.digest?.watch);
    const noUpdateReason = digestWatchEnabled
      ? `Floating tag alias "${container.image.tag.value}" is compared by digest in strict tag-family mode. Set dd.tag.family=loose to allow cross-tag semver updates.`
      : `Floating tag alias "${container.image.tag.value}": digest watching is disabled for this container, so no update detection is running. Remove the digest-watch override (dd.watch.digest=false label or imgset watch.digest=false) to detect same-tag rebuilds, or set dd.tag.family=loose to allow cross-tag semver updates.`;
    if (typeof logContainer?.debug === 'function') {
      logContainer.debug(noUpdateReason);
    }
    return {
      tags: [],
      noUpdateReason: digestWatchEnabled ? undefined : noUpdateReason,
    };
  }

  // A 'specific' (fully-pinned) tag is digest-only by default.
  // Opt out with dd.tag.include filter OR dd.tag.family=loose.
  if (
    container.image.tag.tagPrecision === 'specific' &&
    !container.includeTags &&
    tagFamilyPolicy !== 'loose'
  ) {
    const digestWatchEnabled = Boolean(container.image.digest?.watch);
    const insight = computeInsight ? computePinGateInsight(container, filteredTags) : undefined;
    const noUpdateReason = digestWatchEnabled
      ? `Pinned tag "${container.image.tag.value}" is compared by digest only. Set dd.tag.family=loose or add a dd.tag.include filter to allow semver version climbing.`
      : getPinGateDigestDisabledNoUpdateReason(container.image.tag.value, Boolean(insight));
    if (typeof logContainer?.debug === 'function') {
      logContainer.debug(noUpdateReason);
    }
    return {
      tags: [],
      noUpdateReason: digestWatchEnabled ? undefined : noUpdateReason,
      insight,
    };
  }

  if (filteredTags.length === 0) {
    logContainer.warn('No tags found after filtering; check you regex filters');
  }

  const {
    filteredTags: semverTagCandidates,
    currentPrefix,
    stats,
  } = filterSemverCandidatesOnePass(
    filteredTags,
    container,
    tagFamilyPolicy,
    !container.includeTags,
    allowIncludeFilterRecovery,
  );
  filteredTags = semverTagCandidates;

  if (!container.includeTags && stats.afterPrefix === 0) {
    logContainer.warn(getPrefixFilterWarning(currentPrefix));
  }

  let noUpdateReason: string | undefined;
  if (tagFamilyPolicy === 'strict') {
    if (stats.afterSemver > 0 && stats.afterFamily === 0) {
      logContainer.warn(
        `No tags found in the same inferred family as "${container.image.tag.value}". Set dd.tag.family=loose to allow cross-family semver updates.`,
      );
    } else if (stats.crossFamilyGreaterDropped > 0 && stats.output === 0) {
      noUpdateReason = `Strict tag-family policy filtered out ${stats.crossFamilyGreaterDropped} higher semver tag(s) outside the inferred family of "${container.image.tag.value}". Set dd.tag.family=loose to restore cross-family update behavior.`;
      logContainer.warn(noUpdateReason);
    }
  }

  logSemverCandidateFilterStats(logContainer, tagFamilyPolicy, stats);

  sortSemverDescending(filteredTags, container.transformTags, container.image.tag.value);
  return { tags: filteredTags, noUpdateReason };
}
