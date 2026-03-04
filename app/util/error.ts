const DEFAULT_ERROR_MESSAGE = 'unknown error';

function hasNonEmptyStringValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function getErrorMessage(error: unknown, fallback = DEFAULT_ERROR_MESSAGE): string {
  if (error instanceof Error && hasNonEmptyStringValue(error.message)) {
    return error.message;
  }

  if (hasNonEmptyStringValue(error)) {
    return error;
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

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
