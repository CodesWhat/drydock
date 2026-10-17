import { ApiError, errorMessage } from './error';

export function backupErrorMessage(error: unknown, localizedFallback: string): string {
  if (error instanceof ApiError) {
    const details = [error.status ? `HTTP ${error.status}` : '', error.message]
      .filter((part) => part.trim())
      .join(': ');
    return details ? `${localizedFallback}: ${details}` : localizedFallback;
  }
  return errorMessage(error, '') || localizedFallback;
}
