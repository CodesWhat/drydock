import type {
  ContainerUpdateOperationPhase,
  ContainerUpdateOperationStatus,
} from './update-operation';

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
  timestamp?: number | string;
  displayTimestamp?: string;
  level?: string;
  component?: string;
  msg?: string;
  message?: string;
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

export type ApiContainerUpdateOperationStatus = ContainerUpdateOperationStatus;
export type ApiContainerUpdateOperationPhase = ContainerUpdateOperationPhase;

/** Persisted update-operation history entry from GET /api/containers/:id/update-operations. */
export interface ApiContainerUpdateOperation {
  id: string;
  status: ApiContainerUpdateOperationStatus;
  phase: ApiContainerUpdateOperationPhase;
  createdAt: string;
  updatedAt: string;
  containerId?: string;
  containerName?: string;
  triggerName?: string;
  oldContainerId?: string;
  oldName?: string;
  tempName?: string;
  oldContainerWasRunning?: boolean;
  oldContainerStopped?: boolean;
  newContainerId?: string;
  fromVersion?: string;
  toVersion?: string;
  targetImage?: string;
  rollbackReason?: string;
  lastError?: string;
}

/** SBOM document shape from GET /api/containers/:id/sbom. */
export interface ApiSbomDocument {
  packages?: unknown[];
  components?: unknown[];
  [key: string]: unknown;
}

/** Vulnerability entry from security scan results. */
export interface ApiVulnerability {
  id?: string;
  target?: string;
  packageName?: string;
  package?: string;
  installedVersion?: string;
  version?: string;
  fixedVersion?: string;
  fixedIn?: string | null;
  severity?: string;
  title?: string;
  Title?: string;
  primaryUrl?: string;
  PrimaryURL?: string;
  publishedDate?: string;
}
