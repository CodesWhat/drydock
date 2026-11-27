/**
 * What a refused request leaves behind: a metric bump every time and, at most
 * once a minute per actor and route, an `auth-denied` audit row.
 *
 * The throttle exists so a viewer probing every admin route, or a script
 * retrying a forbidden call in a loop, can't fill the audit table. The counter
 * takes every refusal, so the throttle never hides the volume.
 */

import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import { recordAuthzDenied } from '../prometheus/auth.js';
import { getAuditActorForRequest } from './audit-actor.js';
import { recordAuditEvent } from './audit-events.js';
import type { PrincipalCarrier } from './principal.js';
import { resolvePrincipalRole } from './principal-role.js';

const log = logger.child({ component: 'authz-denial' });

const DENIAL_AUDIT_WINDOW_MS = 60_000;
const MAX_TRACKED_DENIALS = 1000;
/** Role label for a request authenticated with an API key, which has scopes and no role. */
export const API_KEY_ROLE_LABEL = 'api-key';

const lastAuditedAt = new Map<string, number>();

interface RequestLike extends PrincipalCarrier {
  method?: string;
  baseUrl?: string;
  route?: { path?: unknown };
}

export interface AuthzDenial {
  /** The scope the route declared, or `session-only`. */
  scope: string;
  /** The role floor that was missed, when the refusal was about a role. */
  requiredRole?: string;
}

function routeOf(req: RequestLike): string {
  const routePath = typeof req.route?.path === 'string' ? req.route.path : '';
  return `${req.method ?? 'UNKNOWN'} ${req.baseUrl ?? ''}${routePath === '/' ? '' : routePath}`;
}

function shouldAudit(key: string, now: number): boolean {
  const last = lastAuditedAt.get(key);
  if (last !== undefined && now - last < DENIAL_AUDIT_WINDOW_MS) {
    return false;
  }
  if (lastAuditedAt.size >= MAX_TRACKED_DENIALS) {
    for (const [trackedKey, at] of lastAuditedAt) {
      if (now - at >= DENIAL_AUDIT_WINDOW_MS) {
        lastAuditedAt.delete(trackedKey);
      }
    }
    if (lastAuditedAt.size >= MAX_TRACKED_DENIALS) {
      // Every tracked entry is still inside its window; drop the oldest.
      lastAuditedAt.delete(lastAuditedAt.keys().next().value as string);
    }
  }
  lastAuditedAt.set(key, now);
  return true;
}

/**
 * Count a refused request and, unless the same actor was already refused on the
 * same route within the last minute, write an audit row for it.
 * @param req - the refused request
 * @param denial - what it was refused
 * @param now - clock override for tests
 */
export function recordAuthzDenial(
  req: PrincipalCarrier,
  denial: AuthzDenial,
  now: number = Date.now(),
): void {
  const principal = req.principal;
  const role = principal ? resolvePrincipalRole(principal) : undefined;
  recordAuthzDenied(denial.scope, role ?? API_KEY_ROLE_LABEL);

  const actor = getAuditActorForRequest(req);
  const route = routeOf(req as RequestLike);
  if (!shouldAudit(`${actor ?? ''}\u0000${route}`, now)) {
    return;
  }
  const roleDetail = role ?? API_KEY_ROLE_LABEL;
  const required = denial.requiredRole === undefined ? '' : `; requiredRole=${denial.requiredRole}`;
  try {
    recordAuditEvent({
      action: 'auth-denied',
      status: 'error',
      containerName: 'authorization',
      details: `${sanitizeLogParam(route)}; scope=${denial.scope}; role=${roleDetail}${required}`,
      ...(actor !== undefined ? { actor } : {}),
      ...(role !== undefined ? { actorRole: role } : {}),
    });
  } catch (error) {
    // Bookkeeping must never turn a 403 into a 500.
    log.warn(`Unable to audit an authorization denial (${(error as Error).message})`);
  }
}

export function _resetAuthzDenialStateForTests(): void {
  lastAuditedAt.clear();
}
