import type { Container } from '../model/container.js';
import { compileFilterRegex } from './filter-regex.js';
import { pickPreferredVersionTag } from './version-population.js';

interface TagSuggestionLogger {
  warn?: (message: string) => void;
}

function applyIncludeExcludeFilters(
  tags: string[],
  includeTags: string | undefined,
  excludeTags: string | undefined,
  logger: TagSuggestionLogger,
): string[] {
  let filteredTags = tags;

  if (includeTags) {
    const includeRegex = compileFilterRegex(includeTags, logger);
    if (includeRegex) {
      filteredTags = filteredTags.filter((tag) => includeRegex.test(tag));
    }
  }

  if (excludeTags) {
    const excludeRegex = compileFilterRegex(excludeTags, logger);
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
