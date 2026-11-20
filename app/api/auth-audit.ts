import { sanitizeLogParam } from '../log/sanitize.js';
import { recordAuditEvent } from './audit-events.js';
import type { AuthRequest } from './auth-types.js';
import { getIdentityUsername } from './principal.js';

function getAuditUsername(req: AuthRequest): string {
  return getIdentityUsername(req) ?? 'unknown';
}

export function recordLoginAuditEvent(
  req: AuthRequest,
  status: 'success' | 'error',
  details: string,
  loginIdentity?: string,
): void {
  const auditUser =
    typeof loginIdentity === 'string' && loginIdentity.trim() !== ''
      ? loginIdentity
      : getAuditUsername(req);
  recordAuditEvent({
    action: 'auth-login',
    status,
    containerName: 'authentication',
    details: `${details}; user=${sanitizeLogParam(auditUser)}`,
    // Only a verified login names an actor. A failed attempt carries a name the
    // caller typed, which is evidence for the details line but not an identity.
    ...(status === 'success' ? { actor: auditUser } : {}),
  });
}
