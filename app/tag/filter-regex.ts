import { RE2JS } from 're2js';
import { getErrorMessage } from '../util/error.js';

const MAX_PATTERN_LENGTH = 1024;

interface FilterRegex {
  test(value: string): boolean;
}

interface FilterRegexLogger {
  warn?: (message: string) => void;
}

/**
 * Compile a user-supplied include/exclude filter pattern.
 * Returns null (and logs a warning) when the pattern is overlong or invalid.
 * Uses RE2 (via re2js), which is inherently immune to ReDoS backtracking attacks.
 */
export function compileFilterRegex(pattern: string, logger: FilterRegexLogger): FilterRegex | null {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    logger.warn?.(`Regex pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`);
    return null;
  }
  try {
    const compiled = RE2JS.compile(pattern);
    return {
      test(value: string): boolean {
        return compiled.matcher(value).find();
      },
    };
  } catch (e: unknown) {
    logger.warn?.(`Invalid regex pattern "${pattern}": ${getErrorMessage(e, String(e))}`);
    return null;
  }
}
