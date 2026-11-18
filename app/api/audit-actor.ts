import type { NextFunction, Request, Response } from 'express';
import { runWithAuditActor } from '../store/audit-actor.js';
import { getPrincipal } from './principal.js';

const MAX_ACTOR_LENGTH = 200;

/**
 * The audit actor name for the principal on this request, or undefined when the
 * request is unauthenticated. Sessions, Basic and OIDC report their username,
 * an API key reports `api-key:<key name>` so it can't be confused with a person,
 * and anonymous access reports `anonymous`.
 */
export function getAuditActorForRequest(req: Request): string | undefined {
  const principal = getPrincipal(req);
  if (!principal) {
    return undefined;
  }
  const username = principal.username.trim().slice(0, MAX_ACTOR_LENGTH);
  if (principal.kind === 'api-key') {
    return `api-key:${username || principal.keyId}`;
  }
  return username || undefined;
}

/**
 * Mount after authentication. Binds the request's principal as the audit actor
 * for everything the rest of the request (and work it kicks off) records.
 */
export function bindAuditActor(req: Request, _res: Response, next: NextFunction): void {
  const actor = getAuditActorForRequest(req);
  if (actor === undefined) {
    next();
    return;
  }
  runWithAuditActor(actor, next);
}
