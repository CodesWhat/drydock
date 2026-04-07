export interface AuditEntry {
  id: string;
  timestamp: string;
  action:
    | 'update-available'
    | 'update-applied'
    | 'update-failed'
    | 'notification-delivery-failed'
    | 'container-update'
    | 'security-alert'
    | 'agent-disconnect'
    | 'container-added'
    | 'container-removed'
    | 'rollback'
    | 'preview'
    | 'container-start'
    | 'container-stop'
    | 'container-restart'
    | 'webhook-watch'
    | 'webhook-watch-container'
    | 'webhook-update'
    | 'hook-configured'
    | 'hook-pre-success'
    | 'hook-pre-failed'
    | 'hook-post-success'
    | 'hook-post-failed'
    | 'auto-rollback'
    | 'auth-login'
    | 'env-reveal';
  containerName: string;
  containerImage?: string;
  fromVersion?: string;
  toVersion?: string;
  triggerName?: string;
  status: 'success' | 'error' | 'info';
  details?: string;
}
