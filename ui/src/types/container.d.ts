import type {
  ActiveContainerUpdateOperationPhase,
  ContainerUpdateOperationKind,
  ContainerUpdateOperationStatus,
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
  | 'no-update-trigger-configured'
  | 'self-update-unavailable'
  | 'maintenance-window-closed'
  | 'group-notify-only';

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

/** Mirrors app/model/action-policy.ts's ActionPolicyState (spec-6.0.1-action-policy.md). */
export type ActionPolicyState = 'blocked' | 'manual' | 'auto';
export type ActionPolicyBlockedReason = 'excluded' | 'not-included';

/**
 * Non-blocker reflection of the action-policy resolver's verdict for this container.
 * Omitted entirely when no compatible action trigger exists at all (no-update-trigger-configured
 * / agent-mismatch own that messaging). Drives the "Auto" badge — see useUpdateStatus.ts.
 */
export interface ActionPolicy {
  state: ActionPolicyState;
  triggerId?: string;
  reason?: ActionPolicyBlockedReason;
}

/**
 * The update mode that binds this container and whose it is, resolved by the server
 * (app/model/update-eligibility.ts). The UI renders it and never re-derives the ceiling.
 */
export interface UpdateEligibilityUpdateMode {
  value: 'notify' | 'manual' | 'auto';
  source: 'global' | 'group';
  group?: string;
}

export interface UpdateEligibility {
  eligible: boolean;
  blockers: UpdateBlocker[];
  evaluatedAt: string;
  actionPolicy?: ActionPolicy;
  updateMode?: UpdateEligibilityUpdateMode;
}

/** Shared UI container type used across views, composables, and templates. */

/** Where an effective update-policy field came from, as resolved by the server. */
export type ContainerUpdatePolicySource = 'env' | 'group' | 'label' | 'override';

/** The declarative (non-snooze) update-policy fields a group policy can set. */
export interface ContainerDeclarativeUpdatePolicy {
  maturityMode?: 'all' | 'mature';
  maturityMinAgeDays?: number;
  skipTags?: string[];
  skipDigests?: string[];
}

/** The group policy snapshot the server applied to a container; absent when none applies. */
export interface ContainerGroupPolicySnapshot {
  id: string;
  group: string;
  revision: number;
  updatePolicy: ContainerDeclarativeUpdatePolicy;
  actions: { updateMode?: 'manual' | 'notify'; exclude?: string[] };
}

export interface ContainerDetails {
  ports: string[];
  volumes: string[];
  env: { key: string; value: string; sensitive?: boolean }[];
  labels: string[];
  startedAt?: string;
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
  currentDigest?: string;
  newDigest?: string | null;
  tagFamily?: string;
  imageVariant?: string;
  imageDigestWatch?: boolean;
  imageTagSemver?: boolean;
  tagPrecision?: 'specific' | 'floating';
  tagPinned?: boolean;
  /**
   * Backend pin-gate verdict (specific tag, no include filter, non-loose
   * family): drydock will not climb this tag. Drives the pin glyph; distinct
   * from shape-based `tagPinned`, which feeds the hide-pinned filter.
   */
  tagPinGated?: boolean;
  /**
   * True when the container is referenced by digest (`image@sha256:…`) rather
   * than a tag — i.e. `image.tag.value` is a `sha256:…` literal. UI uses this
   * to decide whether the digest pair is the only meaningful identifier
   * (digest-pinned) or whether a human-readable tag should take precedence
   * (floating-tag + digest-watch).
   */
  isDigestPinned: boolean;
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
  maturityGatePendingSince?: string;
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
  updateMaturityTooltip?: string;
  updatePolicyState?: 'snoozed' | 'skipped' | 'maturity-blocked';
  suppressedUpdateTag?: string;
  registryError?: string;
  registryErrorKind?: 'rate-limited' | 'auth' | 'not-found' | 'transient' | 'unknown';
  noUpdateReason?: string;
  /**
   * Pure information (#498): the best newer same-family tag for a container
   * caught by the pin gate. Additive only — never implies an actionable
   * update (see updateKind/updateEligibility for that).
   */
  updateInsight?: { tag: string; kind: 'major' | 'minor' | 'patch' };
  bouncer: 'safe' | 'unsafe' | 'blocked';
  securityScanState?: 'scanned' | 'not-scanned';
  securitySummary?: ContainerSecuritySummary;
  updateBouncer?: 'safe' | 'unsafe' | 'blocked';
  updateSecurityScanState?: 'scanned' | 'not-scanned';
  updateSecuritySummary?: ContainerSecuritySummary;
  securityDelta?: ContainerSecurityDelta;
  softwareVersion?: string;
  imageCreated?: string;
  server: string;
  agent?: string;
  labels?: Record<string, unknown>;
  portLabel?: string;
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  triggerInclude?: string;
  triggerExclude?: string;
  updateEligibility?: UpdateEligibility;
  /** Cheap dependency-ordering badge counts (#219); full graph detail comes from getContainerDependencies(). */
  dependencyCount?: number;
  dependentCount?: number;
  details: ContainerDetails;
}

export interface DependencyGraphNode {
  id: string;
  name: string;
  displayName: string;
  watcher?: string;
  agent?: string;
}

export interface DependencyGraphEdge {
  from: string;
  to: string;
  action: 'update' | 'restart';
  source: 'label' | 'compose';
}

export interface DependencyGraphUnresolvedEdge {
  nodeId: string;
  missingTarget: string;
}

export interface DependencyGraphCrossHostIgnoredEdge {
  from: string;
  to: string;
}

export interface DependencyGraph {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
  cycles: string[][];
  unresolved: DependencyGraphUnresolvedEdge[];
  crossHostIgnored: DependencyGraphCrossHostIgnoredEdge[];
}

export interface UpdateChainPreviewWaveContainer {
  id: string;
  name: string;
  actionKind: 'update' | 'restart';
}

export interface UpdateChainPreviewWave {
  index: number;
  containers: UpdateChainPreviewWaveContainer[];
}

export interface UpdateChainPreview {
  waves: UpdateChainPreviewWave[];
  warnings: {
    cycles: string[][];
    unresolved: DependencyGraphUnresolvedEdge[];
  };
}
