import type { ContainerInfo, ImageInfo, NetworkInspectInfo, PruneNetworksInfo } from 'dockerode';

/** Label that exempts a container, image, volume or network from every cleanup run. */
export const CLEANUP_EXCLUDE_LABEL = 'dd.cleanup.exclude';

export const CLEANUP_TYPES = [
  'danglingImages',
  'unusedImages',
  'stoppedContainers',
  'networks',
  'buildCache',
  'volumes',
] as const;

export type CleanupType = (typeof CLEANUP_TYPES)[number];

/** One validated `DD_CLEANUP_<POLICY>_*` policy. */
export interface CleanupPolicy {
  name: string;
  /** Empty when the policy only runs on a disk threshold or on demand. */
  cron: string;
  /** Cron for the threshold check; only used when `thresholdBytes` is set. */
  checkCron: string;
  /** Run when the reclaimable bytes of the enabled types reach this value. */
  thresholdBytes?: number;
  /** Host ids this policy covers; empty means every supported host. */
  hosts: string[];
  types: Record<CleanupType, boolean>;
  unusedImagesOlderThanHours: number;
  protectHours: number;
  dryRun: boolean;
}

/** The Docker API surface cleanup needs; satisfied by dockerode and the agent transport. */
export interface CleanupDockerApi {
  listImages(options?: Record<string, unknown>): Promise<ImageInfo[]>;
  listContainers(options?: Record<string, unknown>): Promise<ContainerInfo[]>;
  listNetworks(options?: Record<string, unknown>): Promise<NetworkInspectInfo[]>;
  getImage(name: string): { remove(options?: Record<string, unknown>): Promise<unknown> };
  getContainer(id: string): { remove(options?: Record<string, unknown>): Promise<unknown> };
  getVolume(name: string): { remove(options?: Record<string, unknown>): Promise<unknown> };
  pruneNetworks(options?: Record<string, unknown>): Promise<PruneNetworksInfo>;
  pruneBuilder(options?: Record<string, unknown>): Promise<{ SpaceReclaimed?: number }>;
  df(): Promise<DockerDiskUsage>;
}

interface DockerDiskUsage {
  Volumes?: Array<{
    Name: string;
    Labels?: Record<string, string> | null;
    CreatedAt?: string;
    UsageData?: { RefCount?: number; Size?: number } | null;
  }>;
  BuildCache?: Array<{ InUse?: boolean; Size?: number }>;
}

export interface CleanupHost {
  id: string;
  name: string;
  agent?: string;
  api: CleanupDockerApi;
}

export interface CleanupTypeResult {
  /** Items that matched the policy and were not protected. */
  candidates: number;
  /** Items actually removed; always 0 on a dry run. */
  removed: number;
  /** Bytes reclaimed, or on a dry run the bytes a real run would reclaim. */
  reclaimedBytes: number;
  /** Items that matched but were left alone (removal refused, or protected by rollback rules). */
  skipped: number;
  errors: string[];
}

export type CleanupRunTrigger = 'schedule' | 'threshold' | 'manual';

type CleanupRunStatus = 'completed' | 'skipped' | 'error';

export interface CleanupRunResult {
  policy: string;
  host: string;
  trigger: CleanupRunTrigger;
  dryRun: boolean;
  status: CleanupRunStatus;
  /** Why the run did not start or did not finish. */
  reason?: 'update-in-progress' | 'already-running' | 'unsupported-host' | 'below-threshold';
  startedAt: string;
  finishedAt: string;
  totalReclaimedBytes: number;
  types: Partial<Record<CleanupType, CleanupTypeResult>>;
  error?: string;
}
