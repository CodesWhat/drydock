export interface AuditEntry {
  id: string;
  timestamp: string;
  action:
    | 'update-available'
    | 'update-applied'
    | 'update-applied-dryrun'
    | 'update-failed'
    | 'notification-delivery-failed'
    | 'container-update'
    | 'security-alert'
    | 'security-scan-skipped'
    | 'scanner-asset-pull-started'
    | 'scanner-asset-pull-succeeded'
    | 'scanner-asset-pull-failed'
    | 'scanner-asset-warm-started'
    | 'scanner-asset-warm-succeeded'
    | 'scanner-asset-warm-failed'
    | 'agent-disconnect'
    | 'container-unhealthy'
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
    | 'env-reveal'
    | 'auto-update-blocked'
    | 'update-policy-override-set'
    | 'update-policy-override-cleared'
    | 'mqtt-command-update';
  containerName: string;
  containerIdentityKey?: string;
  containerImage?: string;
  fromVersion?: string;
  toVersion?: string;
  semverDiff?: 'major' | 'minor' | 'patch' | 'prerelease' | 'unknown';
  triggerName?: string;
  status: 'success' | 'error' | 'info';
  details?: string;
}
