import { recordAuditEvent } from './audit-events.js';
import type { AuthRequest } from './auth-types.js';

function getAuditUsername(req: AuthRequest): string {
  return typeof req.user?.username === 'string' ? req.user.username : 'unknown';
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
    details: `${details}; user=${auditUser}`,
  });
}
