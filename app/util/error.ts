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
