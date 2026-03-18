import type { Request } from 'express';
import type { Session, SessionData } from 'express-session';

export interface SessionUser {
  username: string;
}

export type UserWithUsername = Express.User & { username?: string };
export type SessionWithRememberMe = Session & Partial<SessionData> & { rememberMe?: boolean };

export type AuthRequest = Request & {
  body?: { remember?: boolean; username?: unknown };
  session?: SessionWithRememberMe;
  user?: UserWithUsername;
  sessionID?: string;
  sessionStore?: {
    all?: (callback: (error: unknown, sessions?: unknown) => void) => void;
    destroy?: (sid: string, callback: (error?: unknown) => void) => void;
  };
};
