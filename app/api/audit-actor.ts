import type { NextFunction, Request, Response } from 'express';
import { runWithAuditActor } from '../store/audit-actor.js';
import { getPrincipal, type PrincipalCarrier } from './principal.js';
import { resolvePrincipalRole } from './principal-role.js';

const MAX_ACTOR_LENGTH = 200;

/**
 * The audit actor name for the principal on this request, or undefined when the
 * request is unauthenticated. Sessions, Basic and OIDC report their username,
 * an API key reports `api-key:<key name>` so it can't be confused with a person,
 * and anonymous access reports `anonymous`.
 */
export function getAuditActorForRequest(req: PrincipalCarrier): string | undefined {
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

/** The role the person on this request holds, or undefined for a key or no principal. */
export function getAuditRoleForRequest(req: PrincipalCarrier): string | undefined {
  const principal = getPrincipal(req);
  return principal ? resolvePrincipalRole(principal) : undefined;
}

/**
 * Mount after authentication. Binds the request's principal as the audit actor
 * for everything the rest of the request (and work it kicks off) records, with the
 * role that person holds so a later demotion doesn't rewrite who acted as what.
 */
export function bindAuditActor(req: Request, _res: Response, next: NextFunction): void {
  const actor = getAuditActorForRequest(req);
  if (actor === undefined) {
    next();
    return;
  }
  runWithAuditActor(actor, next, getAuditRoleForRequest(req));
}
