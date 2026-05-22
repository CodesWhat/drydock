/**
 * Retry helper for HTTP requests that return 429 / 503 responses.
 * Honors Retry-After response headers (seconds or HTTP-date form).
 * Falls back to exponential backoff when no header is present.
 */

export interface HttpEnvelope<T> {
  status: number;
  headers: Record<string, string | undefined>;
  data: T;
}

export type RetryableHttpRequest<T> = () => Promise<HttpEnvelope<T>>;

export interface WithRetryOptions {
  /** Maximum number of retries after the initial attempt (default: 3). */
  maxRetries?: number;
  /** HTTP status codes that are eligible for retry (default: [429, 503]). */
  retryableStatuses?: number[];
  /**
   * Optional additional predicate: if provided, an error that does NOT match
   * `retryableStatuses` may still be retried when this returns true.
   * Does not affect callers that omit it.
   */
  retryPredicate?: (err: unknown) => boolean;
  /**
   * Optional per-attempt delay override.  When provided, its return value
   * (in ms) takes precedence over the Retry-After header and exponential
   * backoff.  Return undefined to fall back to the default delay logic.
   */
  retryDelayMs?: (err: unknown) => number | undefined;
  /** Base delay in milliseconds for exponential backoff (default: 1000). */
  backoffBaseMs?: number;
  /** Maximum delay in milliseconds for exponential backoff (default: 60_000). */
  backoffMaxMs?: number;
  /** Logger with a debug method for retry messages. */
  logger?: { debug: (msg: string) => void };
  /** Human-readable label for log messages (e.g. "ghcr.io GET /v2/img/tags/list"). */
  requestLabel?: string;
}

function isAxiosError(err: unknown): err is {
  response: { status: number; headers?: Record<string, string | undefined> };
} {
  const isNonNullObject = typeof err === 'object' && err !== null;
  const hasResponseKey = isNonNullObject && 'response' in err;
  const responseValue = hasResponseKey ? (err as Record<string, unknown>).response : undefined;
  const hasValidResponse = typeof responseValue === 'object' && responseValue !== null;
  return hasResponseKey && hasValidResponse;
}

function parseRetryAfterMs(headerValue: string | undefined): number | undefined {
  if (!headerValue) {
    return undefined;
  }

  const trimmed = headerValue.trim();

  // Pure integer: seconds
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }

  // HTTP-date form: must contain at least one space or comma (e.g. "Mon, 01 Jan 2024 00:00:00 GMT")
  // Reject decimal seconds and other non-date strings that Date.parse might accept.
  if (/[, ]/.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return Math.max(0, parsed - Date.now());
    }
  }

  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  request: RetryableHttpRequest<T>,
  options: WithRetryOptions = {},
): Promise<HttpEnvelope<T>> {
  const {
    maxRetries = 3,
    retryableStatuses = [429, 503],
    retryPredicate,
    retryDelayMs,
    backoffBaseMs = 1000,
    backoffMaxMs = 60_000,
    logger,
    requestLabel = '',
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await request();
      return response;
    } catch (err: unknown) {
      lastError = err;

      if (!isAxiosError(err)) {
        // Not an HTTP error — don't retry
        throw err;
      }

      const status = err.response.status;
      const isRetryable =
        retryableStatuses.includes(status) || (retryPredicate !== undefined && retryPredicate(err));

      if (!isRetryable) {
        // Not a retryable status — throw immediately
        throw err;
      }

      if (attempt >= maxRetries) {
        // Exhausted retries
        throw err;
      }

      // Compute delay: custom override → Retry-After header → exponential backoff
      const customDelay = retryDelayMs?.(err);
      const retryAfterHeader = err.response.headers?.['retry-after'];
      const parsedDelay = parseRetryAfterMs(retryAfterHeader);
      const backoffDelay = Math.min(backoffBaseMs * 2 ** attempt, backoffMaxMs);
      const delay = Math.min(customDelay ?? parsedDelay ?? backoffDelay, backoffMaxMs);

      const label = requestLabel ? `Retrying ${requestLabel}` : 'Retrying request';
      logger?.debug(
        `${label} after ${delay}ms (attempt ${attempt + 1}/${maxRetries}, reason: HTTP ${status})`,
      );

      await sleep(delay);
    }
  }

  throw lastError;
}
