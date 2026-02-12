import type { AuditEntry } from '../model/audit.js';
import { getAuditCounter } from '../prometheus/audit.js';
import * as auditStore from '../store/audit.js';

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
}) {
  var entry: Partial<AuditEntry> = {
    id: '',
    timestamp: new Date().toISOString(),
    action,
    containerName,
    containerImage,
    status,
  };

  if (details !== undefined) {
    entry.details = details;
  }
  if (fromVersion !== undefined) {
    entry.fromVersion = fromVersion;
  }
  if (toVersion !== undefined) {
    entry.toVersion = toVersion;
  }

  auditStore.insertAudit(entry as AuditEntry);
  getAuditCounter()?.inc({ action });
}
