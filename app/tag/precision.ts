import { parse as parseSemver, transform as transformTag } from './index.js';

export type TagPrecision = 'specific' | 'floating';

export interface NumericTagShape {
  prefix: string;
  numericSegments: string[];
  suffix: string;
}

const MIN_SPECIFIC_SEGMENTS = 3;
const ROLLING_TAG_ALIASES = new Set([
  'latest',
  'stable',
  'edge',
  'nightly',
  'canary',
  'rolling',
  'main',
  'master',
  'develop',
  'dev',
  'next',
  'beta',
  'alpha',
  'preview',
  'experimental',
  'test',
  'testing',
  'rc',
  'lts',
]);

function isAsciiDigit(value: string | undefined): boolean {
  return value !== undefined && value >= '0' && value <= '9';
}

function getFirstDigitIndex(value: string): number {
  return value.search(/[0-9]/);
}

function getTransformedTagValue(tag: string, transformTags: string | undefined): string | null {
  const transformedTag = transformTag(transformTags, tag);
  /* v8 ignore next 3 -- defensive: transformTag always returns a string in practice */
  if (typeof transformedTag !== 'string') {
    return null;
  }
  if (transformedTag.includes('\n') || transformedTag.includes('\r')) {
    return null;
  }

  const trimmedTag = transformedTag.trim();
  return trimmedTag.length > 0 ? trimmedTag : null;
}

function isRollingTagAliasValue(transformedTag: string): boolean {
  const normalizedTag = transformedTag.toLowerCase();
  if (ROLLING_TAG_ALIASES.has(normalizedTag)) {
    return true;
  }

  const [firstToken] = normalizedTag.split(/[-_.]/, 1);
  return ROLLING_TAG_ALIASES.has(firstToken);
}

export function getNumericTagShapeFromTransformedTag(
  transformedTag: string,
): NumericTagShape | null {
  if (transformedTag.includes('\n') || transformedTag.includes('\r')) {
    return null;
  }

  const numericStart = getFirstDigitIndex(transformedTag);
  if (numericStart < 0) {
    return null;
  }

  let numericEnd = numericStart;
  while (isAsciiDigit(transformedTag[numericEnd])) {
    numericEnd += 1;
  }
  while (transformedTag[numericEnd] === '.' && isAsciiDigit(transformedTag[numericEnd + 1])) {
    numericEnd += 1;
    while (isAsciiDigit(transformedTag[numericEnd])) {
      numericEnd += 1;
    }
  }

  return {
    prefix: transformedTag.slice(0, numericStart),
    numericSegments: transformedTag.slice(numericStart, numericEnd).split('.'),
    suffix: transformedTag.slice(numericEnd),
  };
}

export function getNumericTagShape(
  tag: string,
  transformTags: string | undefined,
): NumericTagShape | null {
  const transformedTag = getTransformedTagValue(tag, transformTags);
  if (!transformedTag) {
    return null;
  }
  return getNumericTagShapeFromTransformedTag(transformedTag);
}

export function isTagPinned(tag: string, transformTags: string | undefined): boolean {
  const transformedTag = getTransformedTagValue(tag, transformTags);
  if (!transformedTag) {
    return false;
  }

  if (getNumericTagShapeFromTransformedTag(transformedTag)) {
    return true;
  }

  return !isRollingTagAliasValue(transformedTag);
}

export function classifyTagPrecision(
  tag: string,
  transformTags: string | undefined,
  parsedTag: unknown = parseSemver(transformTag(transformTags, tag)),
): TagPrecision {
  if (!parsedTag) return 'floating';
  const shape = getNumericTagShape(tag, transformTags);
  if (!shape) return 'floating';
  return shape.numericSegments.length >= MIN_SPECIFIC_SEGMENTS ? 'specific' : 'floating';
}
