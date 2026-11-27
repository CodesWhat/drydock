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
import { type HumanPrincipal, resolveHumanRole } from './principal-role.js';
import { hasRoleScope } from './roles.js';
import { API_KEYS_MANAGE_SCOPE } from './route-scopes.js';

/** Is there at least one key that still authenticates (not revoked, not expired)? */
function hasActiveApiKey(now: Date = new Date()): boolean {
  return listApiKeys().some((record) => record.revokedAt === null && !isApiKeyExpired(record, now));
}

/**
 * Can this person do the review at all? The key list and the acknowledge
 * button sit behind `api-keys:manage`, so a role without it would be sent to a
 * page it cannot open and held there.
 */
function canReviewApiKeys(principal: HumanPrincipal): boolean {
  return hasRoleScope(resolveHumanRole(principal), API_KEYS_MANAGE_SCOPE);
}

/**
 * Flag a freshly minted recovery-code session for key review, when there is
 * anything to review and the signed-in role can manage keys. Keys are
 * instance-wide, so any active key counts.
 */
export function flagApiKeyReviewIfNeeded(req: AuthRequest, principal: HumanPrincipal): void {
  if (req.session && canReviewApiKeys(principal) && hasActiveApiKey()) {
    req.session.apiKeyReviewPending = true;
  }
}

/**
 * Does this request's session still owe the review? A key caller never does,
 * even when a session cookie rides along: its principal is the key. Nor does a
 * role that cannot manage keys, which covers a flag set before a demotion.
 */
export function isApiKeyReviewPending(req: AuthRequest): boolean {
  const principal = getPrincipal(req);
  if (principal === undefined || principal.kind === 'api-key') {
    return false;
  }
  return req.session?.apiKeyReviewPending === true && canReviewApiKeys(principal);
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
