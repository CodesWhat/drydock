import { recordAuditEvent } from './audit-events.js';

recordAuditEvent({
  action: 'rollback',
  status: 'success',
  containerName: 'nginx',
});

recordAuditEvent({
  action: 'rollback',
  status: 'success',
  container: {
    name: 'nginx',
    image: {
      name: 'library/nginx',
    },
  },
});

recordAuditEvent({
  // @ts-expect-error action must use AuditEntry['action']
  action: 'not-an-audit-action',
  status: 'success',
  containerName: 'nginx',
});

recordAuditEvent({
  action: 'rollback',
  // @ts-expect-error status must use AuditEntry['status']
  status: 'warning',
  containerName: 'nginx',
});
