import type { AuditEntry } from '../model/audit.js';
import { getContainerIdentityKey } from '../model/container.js';
import { getAuditCounter } from '../prometheus/audit.js';
import * as auditStore from '../store/audit.js';

type AuditContainerImage = NonNullable<AuditEntry['containerImage']>;

type RecordAuditEventArgs = {
  action: AuditEntry['action'];
  status: AuditEntry['status'];
  details?: AuditEntry['details'];
  fromVersion?: AuditEntry['fromVersion'];
  toVersion?: AuditEntry['toVersion'];
  /** Overrides the key derived from `container`, for scopes that are not one container. */
  containerIdentityKey?: AuditEntry['containerIdentityKey'];
  /** Overrides the request principal, for events recorded before one exists (failed login). */
  actor?: AuditEntry['actor'];
} & (
  | {
      container: {
        name: AuditEntry['containerName'];
        watcher?: string;
        agent?: string;
        image?: { name?: AuditContainerImage };
      };
      containerName?: AuditEntry['containerName'];
      containerImage?: AuditEntry['containerImage'];
    }
  | {
      container?: {
        name?: AuditEntry['containerName'];
        image?: { name?: AuditContainerImage };
      };
      containerName: AuditEntry['containerName'];
      containerImage?: AuditEntry['containerImage'];
    }
);

/**
 * Insert an audit entry and increment the shared audit counter.
 */
export function recordAuditEvent({
  action,
  status,
  container,
  containerName = container?.name,
  containerImage = container?.image?.name,
  containerIdentityKey = container ? getContainerIdentityKey(container) : undefined,
  details,
  fromVersion,
  toVersion,
  actor,
}: RecordAuditEventArgs) {
  const entry: AuditEntry = {
    id: '',
    timestamp: new Date().toISOString(),
    action,
    containerName,
    containerImage,
    ...(containerIdentityKey !== undefined ? { containerIdentityKey } : {}),
    status,
    ...(details !== undefined ? { details } : {}),
    ...(fromVersion !== undefined ? { fromVersion } : {}),
    ...(toVersion !== undefined ? { toVersion } : {}),
    ...(actor !== undefined ? { actor } : {}),
  };

  auditStore.insertAudit(entry);
  getAuditCounter()?.inc({ action });
}
