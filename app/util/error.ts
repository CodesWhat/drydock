const DEFAULT_ERROR_MESSAGE = 'unknown error';

function hasNonEmptyStringValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isStringifiablePrimitive(value: unknown): value is bigint | boolean | number | symbol {
  const valueType = typeof value;
  return (
    valueType === 'bigint' ||
    valueType === 'boolean' ||
    valueType === 'number' ||
    valueType === 'symbol'
  );
}

export function getErrorMessage(error: unknown, fallback = DEFAULT_ERROR_MESSAGE): string {
  if (error instanceof Error && hasNonEmptyStringValue(error.message)) {
    return error.message;
  }

  if (hasNonEmptyStringValue(error)) {
    return error;
  }

  if (isStringifiablePrimitive(error)) {
    const message = String(error);
    return hasNonEmptyStringValue(message) ? message : fallback;
  }

  if (
    error &&
    typeof error === 'object' &&
    hasNonEmptyStringValue((error as { message?: unknown }).message)
  ) {
    return (error as { message: string }).message;
  }

  return fallback;
}

const MAX_ERROR_CAUSE_DEPTH = 5;

// undici's fetch surfaces as a generic `TypeError: fetch failed`; the
// actionable detail (DNS error code, TLS error, refused connection, etc.)
// lives in `error.cause`, sometimes nested. Walk the chain so logs include
// the underlying reason rather than the opaque top-level message.
export function getErrorChainMessage(error: unknown, fallback = DEFAULT_ERROR_MESSAGE): string {
  const parts: string[] = [];
  const seen = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (current && typeof current === 'object') {
      if (seen.has(current)) break;
      seen.add(current);
    }
    const message = getErrorMessage(current, '');
    if (message) {
      const code = (current as { code?: unknown } | null)?.code;
      parts.push(typeof code === 'string' && code.trim() !== '' ? `${message} [${code}]` : message);
    }
    const next = (current as { cause?: unknown } | null)?.cause;
    if (next === undefined || next === null) break;
    current = next;
  }

  return parts.length > 0 ? parts.join(' ← ') : fallback;
}
