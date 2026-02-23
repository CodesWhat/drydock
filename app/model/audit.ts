export interface AuditEntry {
  id: string;
  timestamp: string;
  action:
    | 'update-available'
    | 'update-applied'
    | 'update-failed'
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
    | 'hook-pre-success'
    | 'hook-pre-failed'
    | 'hook-post-success'
    | 'hook-post-failed'
    | 'auto-rollback';
  containerName: string;
  containerImage?: string;
  fromVersion?: string;
  toVersion?: string;
  triggerName?: string;
  status: 'success' | 'error' | 'info';
  details?: string;
}
