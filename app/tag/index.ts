// @ts-nocheck
/**
 * Semver utils.
 */
import semver from 'semver';
import log from '../log/index.js';

function normalizeNumericMultiSegmentTag(rawVersion) {
  if (!/^v?\d+(?:\.\d+){3,}$/.test(rawVersion)) {
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
    if (normalizedMultiSegment !== null) {
        return semver.parse(normalizedMultiSegment);
    }

    const rawVersionCleaned = semver.clean(rawVersion, { loose: true });
    const rawVersionSemver = semver.parse(
        rawVersionCleaned !== null ? rawVersionCleaned : rawVersion,
    );
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
        const transformFormulaSplit = transformFormula.split(/\s*=>\s*/);
        const MAX_PATTERN_LENGTH = 1024;
        if (transformFormulaSplit[0].length > MAX_PATTERN_LENGTH) {
            log.warn(`Transform regex pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`);
            return originalTag;
        }
        const transformRegex = new RegExp(transformFormulaSplit[0]);
        const placeholders = transformFormulaSplit[1].match(/\$\d+/g);
        const originalTagMatches = originalTag.match(transformRegex);

        let transformedTag = transformFormulaSplit[1];
        placeholders.forEach((placeholder) => {
            const placeholderIndex = Number.parseInt(
                placeholder.substring(1),
                10,
            );
            transformedTag = transformedTag.replaceAll(
                placeholder,
                originalTagMatches[placeholderIndex],
            );
        });
        return transformedTag;
    } catch (e) {
        // Upon error; log & fallback to original tag value
        log.warn(
            `Error when applying transform function [${transformFormula}]to tag [${originalTag}]`,
        );
        log.debug(e);
        return originalTag;
    }
}
