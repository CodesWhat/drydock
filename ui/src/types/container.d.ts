import type {
  ContainerUpdateOperationKind,
  ContainerUpdateOperationStatus,
  ActiveContainerUpdateOperationPhase,
} from './update-operation';

export type UpdateBlockerReason =
  | 'no-update-available'
  | 'rollback-container'
  | 'active-operation'
  | 'security-scan-blocked'
  | 'last-update-rolled-back'
  | 'snoozed'
  | 'skip-tag'
  | 'skip-digest'
  | 'maturity-not-reached'
  | 'threshold-not-reached'
  | 'trigger-excluded'
  | 'trigger-not-included'
  | 'agent-mismatch'
  | 'no-update-trigger-configured';

/**
 * Severity controls how the UI gates the Update button:
 *  - 'hard': button is locked; clicking is impossible. Hover tooltip shows the blocker message.
 *  - 'soft': button stays clickable; the confirm modal lists soft blockers and the user
 *    can choose to override.
 */
export type UpdateBlockerSeverity = 'hard' | 'soft';

export interface UpdateBlocker {
  reason: UpdateBlockerReason;
  /** Optional for backwards compat with legacy payloads; treat missing as 'hard' to be safe. */
  severity?: UpdateBlockerSeverity;
  message: string;
  actionable: boolean;
  actionHint?: string;
  liftableAt?: string;
  details?: Record<string, unknown>;
}

export interface UpdateEligibility {
  eligible: boolean;
  blockers: UpdateBlocker[];
  evaluatedAt: string;
}

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
  status: ContainerUpdateOperationStatus;
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
  currentReleaseNotes?: ContainerReleaseNotes | null;
  status: 'running' | 'stopped';
  registry: 'dockerhub' | 'ghcr' | 'custom';
  registryName?: string;
  registryUrl?: string;
  updateKind: 'major' | 'minor' | 'patch' | 'digest' | null;
  updateDetectedAt?: string;
  updateOperation?: ContainerUpdateOperation;
  /**
   * UI-only transient: short summary of the most recent failed update attempt
   * (e.g. "Registry rate limit hit"). Set by ContainersView on terminal SSE,
   * cleared on next successful update or when the watcher cron rewrites the
   * row. Not persisted backend-side.
   */
  lastUpdateFailureReason?: string;
  /** UI-only transient: epoch ms when lastUpdateFailureReason was set. */
  lastUpdateFailureAt?: number;
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
  updateEligibility?: UpdateEligibility;
  details: ContainerDetails;
}
