import { RE2JS } from 're2js';

import type { Container } from '../../../model/container.js';
import {
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

interface TagCandidatesResult {
  tags: string[];
  noUpdateReason?: string;
}

function normalizeSuffixTemplate(suffix: string): string {
  return suffix.toLowerCase().replace(/\d+/g, '#');
}

function isSuffixCompatible(referenceSuffix: string, candidateSuffix: string): boolean {
  if (referenceSuffix === '') {
    return candidateSuffix === '';
  }
  if (candidateSuffix === '') {
    return false;
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
): boolean {
  if (candidateShape.prefix !== referenceShape.prefix) {
    return false;
  }

  if (!isSuffixCompatible(referenceShape.suffix, candidateShape.suffix)) {
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
): boolean {
  if (!referenceShape || referenceGroups === undefined) {
    return true;
  }

  const candidateShape = getNumericTagShapeFromTransformedTag(transformedTag);
  if (!candidateShape || candidateShape.numericSegments.length !== referenceGroups) {
    return false;
  }

  if (tagFamilyPolicy === 'loose') {
    return true;
  }

  return isStrictFamilyMatch(referenceShape, candidateShape);
}

function isGreaterCandidateTag(
  transformedTag: string,
  currentTransformedTag: string,
  allowIncludeFilterRecovery: boolean,
): boolean {
  return (
    allowIncludeFilterRecovery ||
    (transformedTag !== currentTransformedTag &&
      isGreaterSemver(transformedTag, currentTransformedTag))
  );
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
 * Sort tags by semver in descending order (mutates the array).
 */
function sortSemverDescending(tags: string[], transformTags: string | undefined): void {
  tags.sort((t1, t2) => {
    const greater = isGreaterSemver(
      transformTag(transformTags, t2),
      transformTag(transformTags, t1),
    );
    return greater ? 1 : -1;
  });
}

/**
 * Keep only tags that are valid semver.
 */
function filterSemverOnly(tags: string[], transformTags: string | undefined): string[] {
  return tags.filter((tag) => parseSemver(transformTag(transformTags, tag)) !== null);
}

/**
 * Filter candidate tags (based on tag name).
 * @param container
 * @param tags
 * @returns {*}
 */
export function getTagCandidates(
  container: Container,
  tags: string[],
  logContainer: TagCandidatesLogger,
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
    sortSemverDescending(semverTags, container.transformTags);
    return { tags: semverTags };
  }

  // Semver image -> find higher semver tag
  let filteredTags = baseTags;
  const tagFamilyPolicy = getTagFamilyPolicy(container, logContainer);

  if (container.image.tag.tagPrecision === 'floating' && tagFamilyPolicy === 'strict') {
    const noUpdateReason = `Floating tag alias "${container.image.tag.value}" is compared by digest in strict tag-family mode. Set dd.tag.family=loose to allow cross-tag semver updates.`;
    if (typeof logContainer?.debug === 'function') {
      logContainer.debug(noUpdateReason);
    }
    return {
      tags: [],
      noUpdateReason: container.image.digest?.watch ? undefined : noUpdateReason,
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

  sortSemverDescending(filteredTags, container.transformTags);
  return { tags: filteredTags, noUpdateReason };
}
