/**
 * Returns the error that represents an aborted operation: the signal's own
 * `reason` when it is already an `Error`, otherwise a new `Error` (named
 * `AbortError`) built from the given fallback message.
 */
export function getAbortReason(signal: AbortSignal, fallbackMessage: string): Error {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }
  const error = new Error(fallbackMessage);
  error.name = 'AbortError';
  return error;
}
