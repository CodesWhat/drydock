/**
 * The refusal a recovery-code session gets from the routes that create a
 * credential able to outlive a factor reset.
 *
 * A recovery code is a bearer secret that proves less than the authenticator it
 * stands in for. Whoever holds one can sign in and reset the factor, but must
 * not be able to leave something behind that still works after the owner has
 * taken the account back: an API key, anything written to the configuration file
 * (an account, a webhook credential, a command action), an agent key. Every such
 * route asks here first, so the status, the reason and the wording cannot drift
 * between them.
 */
import type { Response } from 'express';
import { sendErrorResponse } from './error-response.js';
import { isRecoveryAssuranceSession, type PrincipalCarrier } from './principal.js';

/**
 * Answer 403 when the request comes from a session that signed in with a
 * recovery code. Call it before anything in the request is read: the refusal is
 * about who is asking.
 * @param action what the session tried to do, completing "… cannot <action>."
 * @returns true when the request was refused and has been answered
 */
export function refuseRecoveryAssuranceSession(
  req: PrincipalCarrier,
  res: Response,
  action: string,
): boolean {
  if (!isRecoveryAssuranceSession(req.principal)) {
    return false;
  }
  sendErrorResponse(res, 403, {
    message: `A session that signed in with a recovery code cannot ${action}. Sign in with a code from your authenticator app and try again.`,
    details: { reason: 'recovery-assurance' },
  });
  return true;
}
