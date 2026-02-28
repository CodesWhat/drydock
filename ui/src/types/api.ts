/** Base shape returned by /api/{triggers,watchers,registries,authentications} endpoints. */
export interface ApiComponent {
  id: string;
  type: string;
  name: string;
  configuration: Record<string, unknown>;
  agent?: string;
}

/** Agent shape returned by GET /api/agents. */
export interface ApiAgent {
  name: string;
  host: string;
  port?: number;
  connected: boolean;
  version?: string;
  os?: string;
  arch?: string;
  cpus?: number;
  memoryGb?: number;
  uptimeSeconds?: number;
  lastSeen?: string;
  logLevel?: string;
  pollInterval?: string;
  containers: { total: number; running: number; stopped: number };
  images?: number;
}

/** Single entry from GET /api/agents/:name/log. */
export interface ApiAgentLogEntry {
  timestamp?: string;
  level?: string;
  message?: string;
}

/** Single audit entry from GET /api/audit. */
export interface ApiAuditEntry {
  id: string;
  timestamp: string;
  action: string;
  containerName: string;
  containerImage?: string;
  fromVersion?: string;
  toVersion?: string;
  triggerName?: string;
  status: 'success' | 'error' | 'info';
  details?: string;
}

/** Watcher configuration subset used by DashboardView. */
export interface ApiWatcherConfiguration {
  maintenanceWindow?: string;
  maintenancewindow?: string;
  maintenanceWindowOpen?: boolean;
  maintenancewindowopen?: boolean;
  maintenanceNextWindow?: string;
  maintenancenextwindow?: string;
  [key: string]: unknown;
}

/** Trigger associated with a container (from GET /api/containers/:id/triggers). */
export interface ApiContainerTrigger {
  id?: string;
  type: string;
  name: string;
  agent?: string;
  configuration?: Record<string, unknown>;
  threshold?: string;
}

/** SBOM document shape from GET /api/containers/:id/sbom. */
export interface ApiSbomDocument {
  packages?: unknown[];
  components?: unknown[];
  [key: string]: unknown;
}

/** Vulnerability entry from security scan results. */
export interface ApiVulnerability {
  packageName?: string;
  package?: string;
  severity?: string;
  [key: string]: unknown;
}
