import type { AuditEntry } from '../model/audit.js';
import { getAuditCounter } from '../prometheus/audit.js';
import * as auditStore from '../store/audit.js';

type AuditContainerImage = NonNullable<AuditEntry['containerImage']>;

type RecordAuditEventArgs = {
  action: AuditEntry['action'];
  status: AuditEntry['status'];
  details?: AuditEntry['details'];
  fromVersion?: AuditEntry['fromVersion'];
  toVersion?: AuditEntry['toVersion'];
} & (
  | {
      container: {
        name: AuditEntry['containerName'];
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
  details,
  fromVersion,
  toVersion,
}: RecordAuditEventArgs) {
  const entry: AuditEntry = {
    id: '',
    timestamp: new Date().toISOString(),
    action,
    containerName,
    containerImage,
    status,
    ...(details !== undefined ? { details } : {}),
    ...(fromVersion !== undefined ? { fromVersion } : {}),
    ...(toVersion !== undefined ? { toVersion } : {}),
  };

  auditStore.insertAudit(entry);
  getAuditCounter()?.inc({ action });
}
