import { RE2JS } from 're2js';
import type { Container } from '../model/container.js';
import { parse as parseSemver } from './index.js';

interface SafeRegex {
  test(s: string): boolean;
}

interface TagSuggestionLogger {
  warn?: (message: string) => void;
}

interface StableSemverCandidate {
  tag: string;
  major: number;
  minor: number;
  patch: number;
}

interface MessageLikeError {
  message: string;
}

const PRERELEASE_LABEL_PATTERN = /(?:^|[+._-])(alpha|beta|rc|dev|nightly|canary)(?:$|[+._-])/i;

function isMessageLikeError(error: unknown): error is MessageLikeError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  return 'message' in error && typeof (error as { message: unknown }).message === 'string';
}

function normalizeErrorMessage(error: unknown): string {
  if (isMessageLikeError(error)) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return String(error);
}

function safeRegExp(pattern: string, logger: TagSuggestionLogger): SafeRegex | null {
  const MAX_PATTERN_LENGTH = 1024;
  if (pattern.length > MAX_PATTERN_LENGTH) {
    logger.warn?.(`Regex pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`);
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
    logger.warn?.(`Invalid regex pattern "${pattern}": ${normalizeErrorMessage(e)}`);
    return null;
  }
}

function applyIncludeExcludeFilters(
  tags: string[],
  includeTags: string | undefined,
  excludeTags: string | undefined,
  logger: TagSuggestionLogger,
): string[] {
  let filteredTags = tags;

  if (includeTags) {
    const includeRegex = safeRegExp(includeTags, logger);
    if (includeRegex) {
      filteredTags = filteredTags.filter((tag) => includeRegex.test(tag));
    }
  }

  if (excludeTags) {
    const excludeRegex = safeRegExp(excludeTags, logger);
    if (excludeRegex) {
      filteredTags = filteredTags.filter((tag) => !excludeRegex.test(tag));
    }
  }

  return filteredTags;
}

function isLatestOrUntagged(tagValue: string | undefined): boolean {
  if (typeof tagValue !== 'string') {
    return true;
  }
  const normalizedTag = tagValue.trim().toLowerCase();
  return normalizedTag === '' || normalizedTag === 'latest';
}

function isStableSemverCandidate(tag: string): StableSemverCandidate | null {
  const parsed = parseSemver(tag);
  if (!parsed) {
    return null;
  }

  // Defensive exclusion for prerelease-like labels that can be lost by coercion.
  if (PRERELEASE_LABEL_PATTERN.test(tag)) {
    return null;
  }

  const prerelease = Array.isArray(parsed.prerelease) ? parsed.prerelease : [];
  if (prerelease.length > 0) {
    return null;
  }

  if (
    !Number.isInteger(parsed.major) ||
    !Number.isInteger(parsed.minor) ||
    !Number.isInteger(parsed.patch)
  ) {
    return null;
  }

  return {
    tag,
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
  };
}

function sortBySemverDescending(candidates: StableSemverCandidate[]): void {
  candidates.sort((candidate1, candidate2) => {
    if (candidate1.major !== candidate2.major) {
      return candidate2.major - candidate1.major;
    }
    if (candidate1.minor !== candidate2.minor) {
      return candidate2.minor - candidate1.minor;
    }
    if (candidate1.patch !== candidate2.patch) {
      return candidate2.patch - candidate1.patch;
    }
    return 0;
  });
}

export function suggest(
  container: Pick<Container, 'includeTags' | 'excludeTags' | 'image'>,
  tags: string[],
  logger: TagSuggestionLogger = {},
): string | null {
  const currentTagValue = container?.image?.tag?.value;
  if (!isLatestOrUntagged(currentTagValue)) {
    return null;
  }

  const filteredTags = applyIncludeExcludeFilters(
    tags,
    container.includeTags,
    container.excludeTags,
    logger,
  );
  const stableSemverCandidates = filteredTags
    .map((tag) => isStableSemverCandidate(tag))
    .filter((candidate): candidate is StableSemverCandidate => candidate !== null);

  if (stableSemverCandidates.length === 0) {
    return null;
  }

  sortBySemverDescending(stableSemverCandidates);
  return stableSemverCandidates[0].tag;
}
