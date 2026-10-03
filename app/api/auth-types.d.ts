import type { Request } from 'express';
import type { Session, SessionData } from 'express-session';
import type { SessionIdentity } from './principal.js';

export interface SessionUser {
  username: string;
  /** Absent on a legacy `{ username }` session. */
  identity?: SessionIdentity;
}

export type SessionWithRememberMe = Session & Partial<SessionData> & { rememberMe?: boolean };

export type AuthRequest = Request & {
  body?: { remember?: boolean; username?: unknown };
  session?: SessionWithRememberMe;
  sessionID?: string;
  sessionStore?: {
    all?: (callback: (error: unknown, sessions?: unknown) => void) => void;
    destroy?: (sid: string, callback: (error?: unknown) => void) => void;
  };
};
