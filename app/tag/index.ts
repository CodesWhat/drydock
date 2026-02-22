// @ts-nocheck
/**
 * Semver utils.
 */

import { RE2JS } from 're2js';
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

interface SafeRegex {
  exec(s: string): RegExpMatchArray | null;
}

/**
 * Safely compile a user-supplied regex pattern.
 * Returns null (and logs a warning) when the pattern is invalid.
 * Uses RE2 (via re2js), which is inherently immune to ReDoS backtracking attacks.
 */
function safeRegExp(pattern: string): SafeRegex | null {
  const MAX_PATTERN_LENGTH = 1024;
  if (pattern.length > MAX_PATTERN_LENGTH) {
    log.warn(`Regex pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`);
    return null;
  }
  try {
    const compiled = RE2JS.compile(pattern);
    return {
      exec(s: string): RegExpMatchArray | null {
        const m = compiled.matcher(s);
        if (!m.find()) return null;
        const result = [m.group(0)] as RegExpMatchArray;
        for (let i = 1; i <= m.groupCount(); i++) result.push(m.group(i));
        result.index = m.start();
        result.input = s;
        return result;
      },
    };
  } catch (e: any) {
    log.warn(`Invalid regex pattern "${pattern}": ${e.message}`);
    return null;
  }
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
    const compiledPattern = safeRegExp(pattern);
    if (!compiledPattern) {
      return originalTag;
    }
    const placeholders = replacement.match(/\$\d+/g) || [];
    const originalTagMatches = compiledPattern.exec(originalTag);
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
