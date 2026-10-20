/**
 * The API key review a recovery-code login owes.
 *
 * A recovery-code login ends every other session of the subject, but a key an
 * attacker minted from a stolen session outlives that, and nothing prompts the
 * owner to look. Revoking keys on their behalf would break automation they may
 * rely on, so the session is flagged instead: the UI sends the user to the key
 * list and holds them there until they acknowledge it. Revoking a key does not
 * clear the flag, because "I revoked the one I did not recognise" and "I
 * looked and the rest are mine" are different statements.
 *
 * The flag lives on the session (`apiKeyReviewPending`), so it dies with it.
 */
import type { Response } from 'express';
import { isApiKeyExpired, listApiKeys } from '../store/api-key.js';
import type { AuthRequest } from './auth-types.js';
import { sendErrorResponse } from './error-response.js';
import { getPrincipal } from './principal.js';

/** Is there at least one key that still authenticates (not revoked, not expired)? */
function hasActiveApiKey(now: Date = new Date()): boolean {
  return listApiKeys().some((record) => record.revokedAt === null && !isApiKeyExpired(record, now));
}

/**
 * Flag a freshly minted recovery-code session for key review, when there is
 * anything to review. Keys are instance-wide, so any active key counts.
 */
export function flagApiKeyReviewIfNeeded(req: AuthRequest): void {
  if (req.session && hasActiveApiKey()) {
    req.session.apiKeyReviewPending = true;
  }
}

/**
 * Does this request's session still owe the review? A key caller never does,
 * even when a session cookie rides along: its principal is the key.
 */
export function isApiKeyReviewPending(req: AuthRequest): boolean {
  return getPrincipal(req)?.kind !== 'api-key' && req.session?.apiKeyReviewPending === true;
}

/**
 * POST /auth/api-key-review/acknowledge: the user's statement that they looked.
 * Session-only: a key cannot clear a review that exists to distrust keys.
 */
export function acknowledgeApiKeyReview(req: AuthRequest, res: Response): void {
  if (getPrincipal(req)?.kind !== 'session') {
    sendErrorResponse(res, 403, 'Acknowledging the API key review requires a signed-in session');
    return;
  }
  if (req.session) {
    delete req.session.apiKeyReviewPending;
  }
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ apiKeyReviewPending: false });
}
