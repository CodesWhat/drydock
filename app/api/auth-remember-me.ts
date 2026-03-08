import type { Response } from 'express';
import { getCookieMaxAge, REMEMBER_ME_DAYS } from './auth-session.js';
import type { AuthRequest } from './auth-types.js';
import { sendErrorResponse } from './error-response.js';

/**
 * Apply the "remember me" preference stored in the session.
 * When remember is true, extend the cookie to 30 days.
 * When false, make it a session cookie that expires on browser close.
 */
export function applyRememberMe(req: AuthRequest): void {
  if (!req.session?.cookie) return;
  if (req.session.rememberMe) {
    req.session.cookie.maxAge = getCookieMaxAge(REMEMBER_ME_DAYS);
  } else {
    req.session.cookie.expires = false as unknown as Date;
    req.session.cookie.maxAge = null;
  }
}

/**
 * Store the "remember me" preference in the session.
 * Called before any auth flow (basic or OIDC redirect).
 * @param req
 * @param res
 */
export function setRememberMe(req: AuthRequest, res: Response): void {
  if (!req.session) {
    sendErrorResponse(res, 500, 'Unable to access session');
    return;
  }
  req.session.rememberMe = req.body?.remember === true;
  applyRememberMe(req);
  res.status(200).json({ ok: true });
}
