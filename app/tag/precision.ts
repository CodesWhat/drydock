import { parse as parseSemver, transform as transformTag } from './index.js';

export type TagPrecision = 'specific' | 'floating';

export interface NumericTagShape {
  prefix: string;
  numericSegments: string[];
  suffix: string;
}

const MIN_SPECIFIC_SEGMENTS = 3;

function isAsciiDigit(value: string | undefined): boolean {
  return value !== undefined && value >= '0' && value <= '9';
}

function getFirstDigitIndex(value: string): number {
  return value.search(/[0-9]/);
}

function getNumericTagShapeFromTransformedTag(transformedTag: string): NumericTagShape | null {
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
  const transformedTag = transformTag(transformTags, tag);
  return getNumericTagShapeFromTransformedTag(transformedTag);
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
