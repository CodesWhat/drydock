import { formatRollbackReason } from '../views/containers/useContainerBackups';

const MAX_RAW_ERROR_LENGTH = 120;

/**
 * Resolve a user-facing reason string from the SSE/operation-row signals,
 * preferring (in order):
 *   1. A summariser-matched friendly label from the raw error.
 *   2. The canonical machine `rollbackReason` humanised (e.g.
 *      `health_gate_failed` → "health gate failed").
 *   3. The raw error itself if it's short and plausible.
 *   4. undefined — caller falls back to the generic toast/banner copy.
 *
 * Use this everywhere a rolled-back / failed event needs to surface "why" to
 * the operator. Single source of truth for the resolution order so the toast,
 * the row banner, and the detail pane never disagree.
 */
export function resolveUpdateFailureReason(args: {
  lastError?: string;
  rollbackReason?: string;
}): string | undefined {
  const summarised = summariseUpdateError(args.lastError);
  if (summarised) {
    return summarised;
  }
  if (typeof args.rollbackReason === 'string' && args.rollbackReason.trim() !== '') {
    return formatRollbackReason(args.rollbackReason);
  }
  if (
    typeof args.lastError === 'string' &&
    args.lastError.trim() !== '' &&
    args.lastError.length <= MAX_RAW_ERROR_LENGTH
  ) {
    return args.lastError;
  }
  return undefined;
}

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
