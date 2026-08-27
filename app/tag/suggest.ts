import { RE2JS } from 're2js';
import type { Container } from '../model/container.js';
import { pickPreferredVersionTag } from './version-population.js';

interface SafeRegex {
  test(s: string): boolean;
}

interface TagSuggestionLogger {
  warn?: (message: string) => void;
}

interface MessageLikeError {
  message: string;
}

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

  // #859: never let a bare integer build-number tag ("168") outrank a real
  // dotted release ("1.43.3") — see tag/version-population.ts.
  return pickPreferredVersionTag(filteredTags);
}
