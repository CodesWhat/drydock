/**
 * Replacing the caller's own session after a change to their second factor
 * (spec 11.1.2 decisions 11 and 12). Activation, replacement and removal all
 * move the subject's factor version, which already makes every other session
 * of the subject invalid on its next read. This mints the one session that
 * survives: the browser that proved itself, on a fresh id, at the new version.
 * It then destroys the others, legacy sessions of the username included, so
 * their rows go. Open streams close with the rows rather than waiting for a
 * next read that a stream never makes: the session store closes the streams of
 * every id it destroys, which covers the caller's own old id at regeneration
 * and the sessions the concurrent-session limit drops as stale on the way.
 */

import log from '../log/index.js';
import { getErrorMessage } from '../util/error.js';
import { destroyOtherSubjectSessions } from '../util/session-limit.js';
import { applyRememberMe } from './auth-remember-me.js';
import { enforceSessionLimitBeforeLogin } from './auth-session.js';
import type { AuthRequest } from './auth-types.js';
import type { AuthenticatedPrincipal } from './principal.js';
import { writeSessionPrincipal } from './session-principal.js';

type LocalPrincipal = Extract<AuthenticatedPrincipal, { kind: 'basic' }>;

/**
 * Regenerate the request's session and write `principal` into it, then destroy
 * every other session of the same subject. Resolves false when no new session
 * could be established; the old one is gone either way, so a caller that
 * already committed the factor change still answers and the person signs in
 * again.
 */
export function replaceSessionAfterFactorChange(
  req: AuthRequest,
  principal: LocalPrincipal,
): Promise<boolean> {
  return new Promise((resolve) => {
    const refuse = (message: string): void => {
      log.warn(`Unable to replace the session after a two-factor change (${message})`);
      resolve(false);
    };
    const { session } = req;
    if (!session || typeof session.regenerate !== 'function') {
      refuse('session unavailable');
      return;
    }
    const rememberMe = session.rememberMe === true;
    session.regenerate((regenerateError: unknown) => {
      if (regenerateError) {
        refuse(getErrorMessage(regenerateError));
        return;
      }
      const fresh = req.session;
      if (!fresh) {
        refuse('session unavailable after regeneration');
        return;
      }
      fresh.rememberMe = rememberMe;
      applyRememberMe(req);
      enforceSessionLimitBeforeLogin(
        req,
        principal.username,
        async () => {
          writeSessionPrincipal(req, principal);
          if (req.sessionStore) {
            try {
              await destroyOtherSubjectSessions({
                subjectId: principal.identity.subjectId,
                username: principal.username,
                sessionStore: req.sessionStore,
                currentSessionId: req.sessionID,
              });
            } catch (error: unknown) {
              // The version bump already makes them invalid; only their rows
              // and open streams outlive this, until the next sweep.
              log.warn(`Unable to destroy the other sessions (${getErrorMessage(error)})`);
            }
          }
          resolve(true);
        },
        refuse,
      );
    });
  });
}
