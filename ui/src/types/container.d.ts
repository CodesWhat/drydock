import type {
  ContainerUpdateOperationKind,
  ActiveContainerUpdateOperationPhase,
  ActiveContainerUpdateOperationStatus,
} from './update-operation';

/** Shared UI container type used across views, composables, and templates. */

export interface ContainerDetails {
  ports: string[];
  volumes: string[];
  env: { key: string; value: string; sensitive?: boolean }[];
  labels: string[];
}

export interface ContainerSecuritySummary {
  unknown: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface ContainerSecurityDelta {
  fixed: number;
  new: number;
  unchanged: number;
  fixedCritical: number;
  fixedHigh: number;
  newCritical: number;
  newHigh: number;
}

export interface ContainerReleaseNotes {
  title: string;
  body: string;
  url: string;
  publishedAt: string;
  provider: string;
}

export interface ContainerUpdateOperation {
  id: string;
  kind?: ContainerUpdateOperationKind;
  status: ActiveContainerUpdateOperationStatus;
  phase: ActiveContainerUpdateOperationPhase;
  updatedAt: string;
  batchId?: string;
  queuePosition?: number;
  queueTotal?: number;
  fromVersion?: string;
  toVersion?: string;
  targetImage?: string;
}

export interface Container {
  id: string;
  identityKey: string;
  name: string;
  image: string;
  icon: string;
  currentTag: string;
  newTag: string | null;
  tagFamily?: string;
  imageVariant?: string;
  imageDigestWatch?: boolean;
  imageTagSemver?: boolean;
  tagPrecision?: 'specific' | 'floating';
  tagPinned?: boolean;
  releaseLink?: string;
  suggestedTag?: string;
  sourceRepo?: string;
  releaseNotes?: ContainerReleaseNotes | null;
  status: 'running' | 'stopped';
  registry: 'dockerhub' | 'ghcr' | 'custom';
  registryName?: string;
  registryUrl?: string;
  updateKind: 'major' | 'minor' | 'patch' | 'digest' | null;
  updateDetectedAt?: string;
  updateOperation?: ContainerUpdateOperation;
  updateMaturity: 'fresh' | 'settled' | null;
  updateMaturityTooltip?: string;
  updatePolicyState?: 'snoozed' | 'skipped' | 'maturity-blocked';
  suppressedUpdateTag?: string;
  registryError?: string;
  noUpdateReason?: string;
  bouncer: 'safe' | 'unsafe' | 'blocked';
  securityScanState?: 'scanned' | 'not-scanned';
  securitySummary?: ContainerSecuritySummary;
  updateBouncer?: 'safe' | 'unsafe' | 'blocked';
  updateSecurityScanState?: 'scanned' | 'not-scanned';
  updateSecuritySummary?: ContainerSecuritySummary;
  securityDelta?: ContainerSecurityDelta;
  imageCreated?: string;
  server: string;
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  triggerInclude?: string;
  triggerExclude?: string;
  details: ContainerDetails;
}
