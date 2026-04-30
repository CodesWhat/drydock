/**
 * Map a raw update-failure error string from the backend to a short,
 * user-facing reason label. Returns `undefined` when the error doesn't match
 * any known pattern — callers should fall back to the generic "Update failed"
 * text in that case.
 *
 * The full error string is kept available separately (operation row's
 * `lastError`) for tooltips and detail panes.
 */
export function summariseUpdateError(error: string | undefined): string | undefined {
  if (!error || typeof error !== 'string') {
    return undefined;
  }
  const lower = error.toLowerCase();

  if (lower.includes('rate limit') || lower.includes('toomanyrequests')) {
    return 'Registry rate limit hit';
  }
  if (lower.includes('http code 403') || lower.includes('denied') || lower.includes('forbidden')) {
    return 'Registry access denied';
  }
  if (
    lower.includes('manifest unknown') ||
    lower.includes('no such image') ||
    lower.includes('http code 404')
  ) {
    return 'Image not found';
  }
  if (
    lower.includes('http code 401') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid_token') ||
    lower.includes('authentication required')
  ) {
    return 'Registry authentication failed';
  }
  if (
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('socket hang up') ||
    lower.includes('econnreset')
  ) {
    return 'Registry unreachable';
  }
  if (error === 'Cancelled by operator') {
    return 'Cancelled';
  }
  if (lower.includes('security scan blocked')) {
    return 'Blocked by security scan';
  }
  if (lower.includes('signature verification') || lower.includes('cosign')) {
    return 'Signature verification failed';
  }
  return undefined;
}
