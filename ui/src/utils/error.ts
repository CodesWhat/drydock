export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Extract a human-readable message from an unknown caught value. */
export function errorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
}

export function errorMessageEquals(error: unknown, expected: string): boolean {
  return errorMessage(error, '').trim() === expected;
}

export const NO_UPDATE_AVAILABLE_ERROR = 'No update available for this container';

export function isNoUpdateAvailableError(error: unknown): boolean {
  return errorMessageEquals(error, NO_UPDATE_AVAILABLE_ERROR);
}
