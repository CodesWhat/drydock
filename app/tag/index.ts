// @ts-nocheck
/**
 * Semver utils.
 */
import semver from 'semver';
import log from '../log/index.js';

function hasOnlyDigits(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  for (let i = 0; i < value.length; i += 1) {
    const charCode = value.charCodeAt(i);
    if (charCode < 48 || charCode > 57) {
      return false;
    }
  }
  return true;
}

function normalizeNumericMultiSegmentTag(rawVersion) {
  if (typeof rawVersion !== 'string' || rawVersion.length === 0) {
    return null;
  }

  const versionWithoutPrefix = rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;
  const versionParts = versionWithoutPrefix.split('.');
  if (versionParts.length < 4 || versionParts.some((part) => !hasOnlyDigits(part))) {
    return null;
  }

  const numericParts = rawVersion
    .replace(/^v/, '')
    .split('.')
    .map((part) => String(Number.parseInt(part, 10)));
  const [major, minor, patch, ...prereleaseParts] = numericParts;

  return `${major}.${minor}.${patch}-${prereleaseParts.join('.')}`;
}

/**
 * Parse a string to a semver (return null is it cannot be parsed as a valid semver).
 * @param rawVersion
 * @returns {*|SemVer}
 */
export function parse(rawVersion) {
  const normalizedMultiSegment = normalizeNumericMultiSegmentTag(rawVersion);
  if (normalizedMultiSegment) {
    return semver.parse(normalizedMultiSegment);
  }

  const rawVersionCleaned = semver.clean(rawVersion, { loose: true });
  const rawVersionSemver = semver.parse(rawVersionCleaned ?? rawVersion);
  // Hurrah!
  if (rawVersionSemver !== null) {
    return rawVersionSemver;
  }

  // Last chance; try to coerce (all data behind patch digit will be lost).
  return semver.coerce(rawVersion);
}

/**
 * Return true if version1 is semver greater than version2.
 * @param version1
 * @param version2
 */
export function isGreater(version1, version2) {
  const version1Semver = parse(version1);
  const version2Semver = parse(version2);

  // No comparison possible
  if (version1Semver === null || version2Semver === null) {
    return false;
  }
  return semver.gte(version1Semver, version2Semver);
}

/**
 * Diff between 2 semver versions.
 * @param version1
 * @param version2
 * @returns {*|string|null}
 */
export function diff(version1, version2) {
  const version1Semver = parse(version1);
  const version2Semver = parse(version2);

  // No diff possible
  if (version1Semver === null || version2Semver === null) {
    return null;
  }
  return semver.diff(version1Semver, version2Semver);
}

/**
 * Transform a tag using a formula.
 * @param transformFormula
 * @param originalTag
 * @return {*}
 */
export function transform(transformFormula, originalTag) {
  // No formula ? return original tag value
  if (!transformFormula || transformFormula === '') {
    return originalTag;
  }
  try {
    const separatorIndex = transformFormula.indexOf('=>');
    if (separatorIndex === -1) {
      return originalTag;
    }
    const pattern = transformFormula.slice(0, separatorIndex).trim();
    const replacement = transformFormula.slice(separatorIndex + 2).trim();
    const MAX_PATTERN_LENGTH = 1024;
    if (pattern.length > MAX_PATTERN_LENGTH) {
      log.warn(
        `Transform regex pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`,
      );
      return originalTag;
    }
    const placeholders = replacement.match(/\$\d+/g) || [];
    const originalTagMatches = originalTag.match(pattern);
    if (!originalTagMatches) {
      return originalTag;
    }

    let transformedTag = replacement;
    placeholders.forEach((placeholder) => {
      const placeholderIndex = Number.parseInt(placeholder.substring(1), 10);
      const replacementValue = originalTagMatches[placeholderIndex];
      transformedTag = transformedTag.replaceAll(placeholder, replacementValue ?? '');
    });
    return transformedTag;
  } catch (e) {
    // Upon error; log & fallback to original tag value
    log.warn(`Error when applying transform function [${transformFormula}]to tag [${originalTag}]`);
    log.debug(e);
    return originalTag;
  }
}
