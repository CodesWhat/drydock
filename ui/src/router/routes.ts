/**
 * Centralized route path constants.
 *
 * Query param conventions used across views:
 *  - `?q=`          — search term (standard across all list views)
 *  - `?tab=`        — section tab (ConfigView: appearance | profile)
 *  - `?filterKind=` — update kind filter (ContainersView)
 *  - `?filterStatus=` / `?filterRegistry=` / `?filterBouncer=` / `?filterServer=` — container filters (ContainersView)
 *  - `?sort=`       — container sort (ContainersView)
 *  - `?groupByStack=` — group containers by stack labels (ContainersView)
 *  - `?view=`       — view mode (AuditView)
 *  - `?page=`       — pagination (AuditView)
 *  - `?action=`     — action filter (AuditView)
 *  - `?container=`  — container filter (AuditView)
 *  - `?from=`       — date range start (AuditView)
 *  - `?to=`         — date range end (AuditView)
 *  - `?status=`     — outbox entry status (NotificationOutboxView)
 *  - `?next=`       — post-login redirect (auth guard)
 *
 * Rule: use query params for shareable/bookmarkable state;
 * use component state for transient UI.
 */
export const ROUTES = {
  LOGIN: '/login',
  DASHBOARD: '/',
  CONTAINERS: '/containers',
  CONTAINER_LOGS: '/containers/:id/logs',
  SECURITY: '/security',
  SERVERS: '/servers',
  CONFIG: '/config',
  REGISTRIES: '/registries',
  AGENTS: '/agents',
  TRIGGERS: '/triggers',
  WATCHERS: '/watchers',
  AUTH: '/auth',
  NOTIFICATIONS: '/notifications',
  NOTIFICATION_OUTBOX: '/notifications/outbox',
  AUDIT: '/audit',
  LOGS: '/logs',
} as const;
