/**
 * Maps API container objects to the UI Container type used by templates.
 *
 * API shape (from /api/containers):
 *   id, name, displayName, status, watcher, agent,
 *   image: { registry: { name, url }, name, tag: { value }, ... },
 *   result?: { tag, digest, noUpdateReason, ... }, error?: { message },
 *   updateAvailable, updateKind: { kind, semverDiff, ... },
 *   security?: { scan?: { status, blockingCount, summary, ... } },
 *   labels?: Record<string, string>
 *
 * UI shape (what templates expect):
 *   id, name, image, currentTag, newTag, status, registry, updateKind, registryError,
 *   bouncer, server, details: { ports, volumes, env, labels }
 */

import { getEffectiveDisplayIcon } from '../services/image-icon';
import type { ApiContainerUpdateOperation } from '../types/api';
import type {
  Container,
  ContainerReleaseNotes,
  ContainerSecurityDelta,
  ContainerSecuritySummary,
  ContainerUpdateOperation,
  UpdateBlocker,
  UpdateBlockerReason,
  UpdateEligibility,
} from '../types/container';
import {
  isActiveContainerUpdateOperationPhaseForStatus,
  isActiveContainerUpdateOperationStatus,
  isContainerUpdateOperationKind,
} from '../types/update-operation';
import { normalizeSeverityCount } from '../views/security/securityViewUtils';
import { buildContainerIdentityKey } from './container-action-key';
import {
  maturityMinAgeDaysToMilliseconds,
  normalizeMaturityMode,
  resolveMaturityMinAgeDays,
} from './maturity-policy';
import { formatUpdateAge, getUpdateMaturity } from './update-maturity';

interface ApiContainerImage {
  name?: unknown;
  variant?: unknown;
  created?: unknown;
  registry?: {
    name?: unknown;
    url?: unknown;
  } | null;
  tag?: {
    value?: unknown;
    semver?: unknown;
    tagPrecision?: unknown;
  } | null;
  digest?: {
    watch?: unknown;
  } | null;
}

interface ApiContainerReleaseNotes {
  title?: unknown;
  body?: unknown;
  url?: unknown;
  publishedAt?: unknown;
  provider?: unknown;
}

interface ApiContainerResult {
  tag?: unknown;
  suggestedTag?: unknown;
  digest?: unknown;
  link?: unknown;
  noUpdateReason?: unknown;
  releaseNotes?: ApiContainerReleaseNotes | null;
}

interface ApiContainerUpdateKind {
  kind?: unknown;
  semverDiff?: unknown;
  remoteValue?: unknown;
}

interface ApiContainerUpdatePolicy {
  snoozeUntil?: unknown;
  skipTags?: unknown;
  skipDigests?: unknown;
  maturityMode?: unknown;
  maturityMinAgeDays?: unknown;
}

interface ApiContainerDetails {
  ports?: unknown;
  volumes?: unknown;
  env?: unknown;
}

interface ApiContainerSecuritySummary {
  unknown?: unknown;
  low?: unknown;
  medium?: unknown;
  high?: unknown;
  critical?: unknown;
}

interface ApiContainerSecurityScan {
  status?: unknown;
  summary?: ApiContainerSecuritySummary | null;
}

interface ApiContainerUpdateBlocker {
  reason?: unknown;
  message?: unknown;
  actionable?: unknown;
  actionHint?: unknown;
  liftableAt?: unknown;
  details?: unknown;
}

interface ApiContainerUpdateEligibility {
  eligible?: unknown;
  blockers?: unknown;
  evaluatedAt?: unknown;
}

type SecurityScanType = 'scan' | 'updateScan';

/**
 * Domain term used by UI templates.
 *
 * "bouncer" is the security gate verdict for a container image:
 * - `safe`: no high/critical vulnerabilities were found.
 * - `unsafe`: one or more high/critical vulnerabilities were found.
 * - `blocked`: update or deployment is blocked by policy.
 */
type BouncerStatus = 'safe' | 'unsafe' | 'blocked';

export interface ApiContainerInput {
  id?: unknown;
  name?: unknown;
  displayName?: unknown;
  status?: unknown;
  watcher?: unknown;
  agent?: unknown;
  image?: ApiContainerImage | null;
  result?: ApiContainerResult | null;
  updateAvailable?: unknown;
  updateKind?: ApiContainerUpdateKind | null;
  security?: {
    scan?: ApiContainerSecurityScan | null;
    updateScan?: ApiContainerSecurityScan | null;
  } | null;
  labels?: Record<string, unknown> | null;
  displayIcon?: unknown;
  updateDetectedAt?: unknown;
  updateOperation?: ApiContainerUpdateOperation | null;
  updatePolicy?: ApiContainerUpdatePolicy | null;
  updateEligibility?: ApiContainerUpdateEligibility | null;
  details?: ApiContainerDetails | null;
  tagFamily?: unknown;
  includeTags?: unknown;
  excludeTags?: unknown;
  transformTags?: unknown;
  triggerInclude?: unknown;
  triggerExclude?: unknown;
  tagPinned?: unknown;
  sourceRepo?: unknown;
  currentReleaseNotes?: ApiContainerReleaseNotes | null;
  error?: { message?: unknown } | null;
  ports?: unknown;
  volumes?: unknown;
  env?: unknown;
}

const DOCKERHUB_REGISTRY_HOSTS = new Set(['docker.io', 'registry-1.docker.io', 'index.docker.io']);
const GHCR_REGISTRY_HOSTS = new Set(['ghcr.io']);

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Derive a human-readable server/host name from watcher + agent fields. */
function deriveServer(apiContainer: ApiContainerInput): string {
  const agent = asNonEmptyString(apiContainer.agent);
  if (agent) {
    return agent;
  }
  const watcher = asNonEmptyString(apiContainer.watcher);
  if (watcher && watcher !== 'local') {
    return watcher.charAt(0).toUpperCase() + watcher.slice(1);
  }
  return 'Local';
}

/** Map the API registry name to the UI registry category. */
function deriveRegistry(apiContainer: ApiContainerInput): 'dockerhub' | 'ghcr' | 'custom' {
  const registryName = deriveRegistryName(apiContainer) ?? '';
  const registryUrl = deriveRegistryUrl(apiContainer) ?? '';
  const registryHost = deriveRegistryHost(registryUrl);

  if (registryName === 'hub' || isKnownRegistryHost(registryHost, DOCKERHUB_REGISTRY_HOSTS)) {
    return 'dockerhub';
  }
  if (registryName === 'ghcr' || isKnownRegistryHost(registryHost, GHCR_REGISTRY_HOSTS)) {
    return 'ghcr';
  }
  return 'custom';
}

function deriveRegistryName(apiContainer: ApiContainerInput): string | undefined {
  return asNonEmptyString(apiContainer.image?.registry?.name);
}

function deriveRegistryUrl(apiContainer: ApiContainerInput): string | undefined {
  return asNonEmptyString(apiContainer.image?.registry?.url);
}

function deriveRegistryHost(registryUrl: string): string | undefined {
  if (!registryUrl) {
    return undefined;
  }

  const normalizedUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(registryUrl)
    ? registryUrl
    : `https://${registryUrl}`;

  try {
    return new URL(normalizedUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isKnownRegistryHost(host: string | undefined, knownHosts: ReadonlySet<string>): boolean {
  return host !== undefined && knownHosts.has(host);
}

function getSecurityScan(
  apiContainer: ApiContainerInput,
  scanType: SecurityScanType,
): ApiContainerSecurityScan | undefined {
  return apiContainer.security?.[scanType] ?? undefined;
}

function deriveBouncerFromScan(scan: ApiContainerSecurityScan | undefined): BouncerStatus {
  if (!scan) return 'safe';
  if (scan.status === 'blocked') return 'blocked';
  const summary = scan.summary;
  if (
    summary &&
    (normalizeSeverityCount(summary.critical) > 0 || normalizeSeverityCount(summary.high) > 0)
  ) {
    return 'unsafe';
  }
  return 'safe';
}

function deriveSecurityScanStateFromScan(
  scan: ApiContainerSecurityScan | undefined,
): 'scanned' | 'not-scanned' {
  if (!scan || scan.status === 'not-scanned') return 'not-scanned';
  return 'scanned';
}

function normalizeSecuritySummary(
  summary: ApiContainerSecuritySummary | null | undefined,
): ContainerSecuritySummary | undefined {
  if (!summary || typeof summary !== 'object') {
    return undefined;
  }
  return {
    unknown: normalizeSeverityCount(summary.unknown),
    low: normalizeSeverityCount(summary.low),
    medium: normalizeSeverityCount(summary.medium),
    high: normalizeSeverityCount(summary.high),
    critical: normalizeSeverityCount(summary.critical),
  };
}

function deriveSecuritySummaryFromScan(
  scan: ApiContainerSecurityScan | undefined,
): ContainerSecuritySummary | undefined {
  return normalizeSecuritySummary(scan?.summary);
}

/** Derive `bouncer` (security gate verdict) from current-image OR update-image scan data.
 * If either scan shows blocked, the container is blocked. The update scan takes
 * precedence since it reflects the SecurityGate verdict during the last update attempt. */
function deriveBouncer(apiContainer: ApiContainerInput): BouncerStatus {
  const updateScan = getSecurityScan(apiContainer, 'updateScan');
  if (updateScan?.status === 'blocked') return 'blocked';
  return deriveBouncerFromScan(getSecurityScan(apiContainer, 'scan'));
}

/** Derive whether a container has a persisted security scan result. */
function deriveSecurityScanState(apiContainer: ApiContainerInput): 'scanned' | 'not-scanned' {
  return deriveSecurityScanStateFromScan(getSecurityScan(apiContainer, 'scan'));
}

function deriveSecuritySummary(
  apiContainer: ApiContainerInput,
): ContainerSecuritySummary | undefined {
  return deriveSecuritySummaryFromScan(getSecurityScan(apiContainer, 'scan'));
}

/** Derive `updateBouncer` (security gate verdict) from candidate-update scan data. */
function deriveUpdateBouncer(apiContainer: ApiContainerInput): BouncerStatus | undefined {
  const updateScan = getSecurityScan(apiContainer, 'updateScan');
  if (!updateScan) return undefined;
  return deriveBouncerFromScan(updateScan);
}

/** Derive whether a container has a persisted update security scan result. */
function deriveUpdateSecurityScanState(
  apiContainer: ApiContainerInput,
): 'scanned' | 'not-scanned' | undefined {
  const updateScan = getSecurityScan(apiContainer, 'updateScan');
  if (!updateScan) return undefined;
  return deriveSecurityScanStateFromScan(updateScan);
}

function deriveUpdateSecuritySummary(
  apiContainer: ApiContainerInput,
): ContainerSecuritySummary | undefined {
  return deriveSecuritySummaryFromScan(getSecurityScan(apiContainer, 'updateScan'));
}

/** Compute the delta between current and update security summaries. */
export function computeSecurityDelta(
  current: ContainerSecuritySummary | undefined,
  update: ContainerSecuritySummary | undefined,
): ContainerSecurityDelta | undefined {
  if (!current || !update) return undefined;
  const severities = ['unknown', 'low', 'medium', 'high', 'critical'] as const;
  let fixed = 0;
  let newVulns = 0;
  let unchanged = 0;
  for (const sev of severities) {
    const diff = current[sev] - update[sev];
    if (diff > 0) fixed += diff;
    else if (diff < 0) newVulns += -diff;
    else unchanged += current[sev];
  }
  return {
    fixed,
    new: newVulns,
    unchanged,
    fixedCritical: Math.max(0, current.critical - update.critical),
    fixedHigh: Math.max(0, current.high - update.high),
    newCritical: Math.max(0, update.critical - current.critical),
    newHigh: Math.max(0, update.high - current.high),
  };
}

/** Derive the simplified updateKind string from the API updateKind object. */
function deriveUpdateKind(
  apiContainer: ApiContainerInput,
): 'major' | 'minor' | 'patch' | 'digest' | null {
  if (!apiContainer.updateAvailable) return null;
  const uk = apiContainer.updateKind;
  if (!uk) return null;
  if (uk.kind === 'digest') return 'digest';
  if (uk.semverDiff === 'major') return 'major';
  if (uk.semverDiff === 'minor') return 'minor';
  if (uk.semverDiff === 'patch') return 'patch';
  if (uk.semverDiff === 'prerelease') return 'patch';
  // Unknown tag change -- treat as patch
  if (uk.kind === 'tag') return 'patch';
  return null;
}

/** Derive the new tag (remote version) when an update is available. */
function deriveNewTag(apiContainer: ApiContainerInput): string | null {
  if (!apiContainer.updateAvailable) return null;
  return asNonEmptyString(apiContainer.result?.tag) ?? null;
}

/** Derive the release/changelog URL for the update when present. */
function deriveReleaseLink(apiContainer: ApiContainerInput): string | undefined {
  const trimmed = asNonEmptyString(apiContainer.result?.link);
  if (!trimmed) return undefined;
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

function deriveImageCreated(apiContainer: ApiContainerInput): string | undefined {
  const value = asNonEmptyString(apiContainer.image?.created);
  if (!value) return undefined;
  const parsedAt = Date.parse(value);
  if (Number.isNaN(parsedAt)) return undefined;
  return new Date(parsedAt).toISOString();
}

function deriveUpdateDetectedAt(apiContainer: ApiContainerInput): string | undefined {
  const value = asNonEmptyString(apiContainer.updateDetectedAt);
  if (!value) return undefined;
  const parsedAt = Date.parse(value);
  if (Number.isNaN(parsedAt)) return undefined;
  return new Date(parsedAt).toISOString();
}

function hasPolicyRelevantUpdateKind(
  updateKind: ApiContainerUpdateKind | null | undefined,
): boolean {
  return updateKind?.kind === 'tag' || updateKind?.kind === 'digest';
}

function isFutureSnoozeUntil(updatePolicy: ApiContainerUpdatePolicy, nowMs: number): boolean {
  const snoozeUntil = asNonEmptyString(updatePolicy.snoozeUntil);
  if (!snoozeUntil) {
    return false;
  }

  const parsedSnoozeUntil = Date.parse(snoozeUntil);
  return !Number.isNaN(parsedSnoozeUntil) && parsedSnoozeUntil > nowMs;
}

function isSkippedByTagPolicy(
  updateKind: ApiContainerUpdateKind,
  updatePolicy: ApiContainerUpdatePolicy,
  remoteValue: string | undefined,
): boolean {
  return (
    updateKind.kind === 'tag' &&
    remoteValue !== undefined &&
    Array.isArray(updatePolicy.skipTags) &&
    updatePolicy.skipTags.includes(remoteValue)
  );
}

function isSkippedByDigestPolicy(
  updateKind: ApiContainerUpdateKind,
  updatePolicy: ApiContainerUpdatePolicy,
  remoteValue: string | undefined,
): boolean {
  return (
    updateKind.kind === 'digest' &&
    remoteValue !== undefined &&
    Array.isArray(updatePolicy.skipDigests) &&
    updatePolicy.skipDigests.includes(remoteValue)
  );
}

function isMaturityBlocked(
  apiContainer: ApiContainerInput,
  updatePolicy: ApiContainerUpdatePolicy,
): boolean {
  if (normalizeMaturityMode(updatePolicy.maturityMode) !== 'mature') {
    return false;
  }

  const minAgeDays = resolveMaturityMinAgeDays(updatePolicy.maturityMinAgeDays);
  const updateDetectedAt = deriveUpdateDetectedAt(apiContainer);
  const detectedAtMs = Date.parse(updateDetectedAt || '');
  const minAgeMs = maturityMinAgeDaysToMilliseconds(minAgeDays);
  return !Number.isFinite(detectedAtMs) || Date.now() - detectedAtMs < minAgeMs;
}

function deriveUpdatePolicyState(apiContainer: ApiContainerInput): Container['updatePolicyState'] {
  const updateKind = apiContainer.updateKind;
  if (apiContainer.updateAvailable || !updateKind || !hasPolicyRelevantUpdateKind(updateKind)) {
    return undefined;
  }

  const updatePolicy = apiContainer.updatePolicy;
  if (!updatePolicy || typeof updatePolicy !== 'object') {
    return undefined;
  }

  if (isFutureSnoozeUntil(updatePolicy, Date.now())) {
    return 'snoozed';
  }

  const remoteValue = asNonEmptyString(updateKind.remoteValue);

  if (isSkippedByTagPolicy(updateKind, updatePolicy, remoteValue)) {
    return 'skipped';
  }

  if (isSkippedByDigestPolicy(updateKind, updatePolicy, remoteValue)) {
    return 'skipped';
  }

  if (isMaturityBlocked(apiContainer, updatePolicy)) {
    return 'maturity-blocked';
  }

  return undefined;
}

function deriveSuppressedUpdateTag(
  apiContainer: ApiContainerInput,
  updatePolicyState: Container['updatePolicyState'],
): string | undefined {
  if (!updatePolicyState) {
    return undefined;
  }

  const updateKind = apiContainer.updateKind;
  if (updateKind?.kind === 'digest') {
    const remoteDigest = asNonEmptyString(updateKind.remoteValue);
    if (remoteDigest) {
      return remoteDigest;
    }
    const resultDigest = asNonEmptyString(apiContainer.result?.digest);
    if (resultDigest) {
      return resultDigest;
    }
    return undefined;
  }

  const remoteTag = asNonEmptyString(updateKind?.remoteValue);
  if (remoteTag) {
    return remoteTag;
  }
  const resultTag = asNonEmptyString(apiContainer.result?.tag);
  if (resultTag) {
    return resultTag;
  }

  return undefined;
}

/** Derive no-update explanation when backend intentionally filtered candidate updates. */
function deriveNoUpdateReason(apiContainer: ApiContainerInput): string | undefined {
  if (apiContainer.updateAvailable) return undefined;
  return asNonEmptyString(apiContainer.result?.noUpdateReason);
}

/** Derive a user-facing registry error message from API error payloads. */
function deriveRegistryError(apiContainer: ApiContainerInput): string | undefined {
  return asNonEmptyString(apiContainer.error?.message);
}

/** Extract labels from the API labels object into an array of "key=value" strings. */
function deriveLabels(apiContainer: ApiContainerInput): string[] {
  const labels = apiContainer.labels;
  if (!labels || typeof labels !== 'object') return [];
  return Object.entries(labels).map(([k, v]) => {
    if (v == null) {
      return k;
    }
    switch (v) {
      case '':
      case false:
      case 0:
        return k;
      default:
        return `${k}=${String(v)}`;
    }
  });
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function normalizeEnv(values: unknown): { key: string; value: string; sensitive?: boolean }[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter(
      (value): value is { key: unknown; value: unknown; sensitive?: unknown } =>
        !!value && typeof value === 'object',
    )
    .map((value) => {
      const key = typeof value.key === 'string' ? value.key.trim() : '';
      const envValue = typeof value.value === 'string' ? value.value : `${value.value ?? ''}`;
      return {
        key,
        value: envValue,
        ...(typeof value.sensitive === 'boolean' ? { sensitive: value.sensitive } : {}),
      };
    })
    .filter((value) => value.key.length > 0);
}

function deriveRuntimeDetails(
  apiContainer: ApiContainerInput,
): Omit<Container['details'], 'labels'> {
  const detailsSource =
    apiContainer.details && typeof apiContainer.details === 'object'
      ? apiContainer.details
      : apiContainer;
  return {
    ports: normalizeStringArray(detailsSource.ports),
    volumes: normalizeStringArray(detailsSource.volumes),
    env: normalizeEnv(detailsSource.env),
  };
}

function normalizeReleaseNotes(
  rn: ApiContainerReleaseNotes | null | undefined,
): ContainerReleaseNotes | null {
  if (!rn || typeof rn !== 'object') return null;
  const title = asNonEmptyString(rn.title);
  const body = asNonEmptyString(rn.body);
  const url = asNonEmptyString(rn.url);
  const publishedAt = asNonEmptyString(rn.publishedAt);
  const provider = asNonEmptyString(rn.provider);
  if (!title || !body || !url || !publishedAt || !provider) return null;
  return { title, body, url, publishedAt, provider };
}

/** Derive inline release notes summary for the new (update target) tag. */
function deriveReleaseNotes(apiContainer: ApiContainerInput): ContainerReleaseNotes | null {
  return normalizeReleaseNotes(apiContainer.result?.releaseNotes);
}

/** Derive inline release notes summary for the currently running tag. */
function deriveCurrentReleaseNotes(apiContainer: ApiContainerInput): ContainerReleaseNotes | null {
  return normalizeReleaseNotes(apiContainer.currentReleaseNotes);
}

const VALID_UPDATE_BLOCKER_REASONS: ReadonlySet<UpdateBlockerReason> = new Set([
  'no-update-available',
  'rollback-container',
  'active-operation',
  'security-scan-blocked',
  'last-update-rolled-back',
  'snoozed',
  'skip-tag',
  'skip-digest',
  'maturity-not-reached',
  'threshold-not-reached',
  'trigger-excluded',
  'trigger-not-included',
  'agent-mismatch',
  'no-update-trigger-configured',
]);

function isUpdateBlockerReason(value: unknown): value is UpdateBlockerReason {
  return (
    typeof value === 'string' && VALID_UPDATE_BLOCKER_REASONS.has(value as UpdateBlockerReason)
  );
}

function deriveUpdateBlocker(blocker: unknown): UpdateBlocker | null {
  if (!blocker || typeof blocker !== 'object') return null;
  const b = blocker as ApiContainerUpdateBlocker;
  if (!isUpdateBlockerReason(b.reason)) return null;
  const message = asNonEmptyString(b.message);
  if (!message) return null;
  const actionable = typeof b.actionable === 'boolean' ? b.actionable : false;
  const result: UpdateBlocker = { reason: b.reason, message, actionable };
  const actionHint = asNonEmptyString(b.actionHint);
  if (actionHint) result.actionHint = actionHint;
  const liftableAt = asNonEmptyString(b.liftableAt);
  if (liftableAt) result.liftableAt = liftableAt;
  if (b.details && typeof b.details === 'object') {
    result.details = b.details as Record<string, unknown>;
  }
  return result;
}

function deriveUpdateEligibility(apiContainer: ApiContainerInput): UpdateEligibility | undefined {
  const eligibility = apiContainer.updateEligibility;
  if (!eligibility || typeof eligibility !== 'object') return undefined;
  if (typeof eligibility.eligible !== 'boolean') return undefined;
  const evaluatedAt = asNonEmptyString(eligibility.evaluatedAt);
  if (!evaluatedAt) return undefined;
  const rawBlockers = Array.isArray(eligibility.blockers) ? eligibility.blockers : [];
  const blockers = rawBlockers
    .map(deriveUpdateBlocker)
    .filter((b): b is UpdateBlocker => b !== null);
  return { eligible: eligibility.eligible, blockers, evaluatedAt };
}

function deriveUpdateOperation(
  apiContainer: ApiContainerInput,
): ContainerUpdateOperation | undefined {
  const operation = apiContainer.updateOperation;
  if (!operation || typeof operation !== 'object') {
    return undefined;
  }

  const id = asNonEmptyString(operation.id);
  const kind = isContainerUpdateOperationKind(operation.kind) ? operation.kind : undefined;
  const status = isActiveContainerUpdateOperationStatus(operation.status)
    ? operation.status
    : undefined;
  const phase =
    status && isActiveContainerUpdateOperationPhaseForStatus(status, operation.phase)
      ? operation.phase
      : undefined;
  const updatedAt = asNonEmptyString(operation.updatedAt);
  const batchId = asNonEmptyString(operation.batchId);
  const queuePosition = asPositiveInteger(operation.queuePosition);
  const queueTotal = asPositiveInteger(operation.queueTotal);

  if (!id || !status || !phase || !updatedAt) {
    return undefined;
  }

  return {
    id,
    ...(kind ? { kind } : {}),
    status,
    phase,
    updatedAt,
    ...(asNonEmptyString(operation.fromVersion)
      ? { fromVersion: asNonEmptyString(operation.fromVersion) }
      : {}),
    ...(asNonEmptyString(operation.toVersion)
      ? { toVersion: asNonEmptyString(operation.toVersion) }
      : {}),
    ...(asNonEmptyString(operation.targetImage)
      ? { targetImage: asNonEmptyString(operation.targetImage) }
      : {}),
    ...(batchId && queuePosition && queueTotal && queuePosition <= queueTotal
      ? { batchId, queuePosition, queueTotal }
      : {}),
  };
}

/** Map a single API container to the UI Container type. */
export function mapApiContainer(apiContainer: ApiContainerInput): Container {
  const runtimeDetails = deriveRuntimeDetails(apiContainer);
  const updatePolicyState = deriveUpdatePolicyState(apiContainer);
  const id = asNonEmptyString(apiContainer.id) ?? '';
  const name = asNonEmptyString(apiContainer.name) ?? id;
  const displayName = asNonEmptyString(apiContainer.displayName);
  const imageName = asNonEmptyString(apiContainer.image?.name) ?? '';
  const displayIcon = asNonEmptyString(apiContainer.displayIcon) ?? '';
  const currentTag = asNonEmptyString(apiContainer.image?.tag?.value) ?? 'latest';
  const currentSummary = deriveSecuritySummary(apiContainer);
  const updateSummary = deriveUpdateSecuritySummary(apiContainer);
  const detectedAt = deriveUpdateDetectedAt(apiContainer);

  return {
    id,
    identityKey: buildContainerIdentityKey(apiContainer) || id || name,
    name: displayName ?? name,
    image: imageName,
    icon: getEffectiveDisplayIcon(displayIcon, imageName),
    currentTag,
    newTag: deriveNewTag(apiContainer),
    tagFamily: asNonEmptyString(apiContainer.tagFamily),
    imageVariant: asNonEmptyString(apiContainer.image?.variant),
    imageDigestWatch: asOptionalBoolean(apiContainer.image?.digest?.watch),
    imageTagSemver: asOptionalBoolean(apiContainer.image?.tag?.semver),
    tagPrecision: apiContainer.image?.tag?.tagPrecision as 'specific' | 'floating' | undefined,
    tagPinned: asOptionalBoolean(apiContainer.tagPinned),
    suggestedTag: asNonEmptyString(apiContainer.result?.suggestedTag),
    sourceRepo: asNonEmptyString(apiContainer.sourceRepo),
    releaseNotes: deriveReleaseNotes(apiContainer),
    currentReleaseNotes: deriveCurrentReleaseNotes(apiContainer),
    releaseLink: deriveReleaseLink(apiContainer),
    updateDetectedAt: detectedAt,
    updateOperation: deriveUpdateOperation(apiContainer),
    updateMaturity: getUpdateMaturity(detectedAt, !!apiContainer.updateAvailable),
    updateMaturityTooltip: formatUpdateAge(detectedAt, !!apiContainer.updateAvailable),
    updateEligibility: deriveUpdateEligibility(apiContainer),
    updatePolicyState,
    suppressedUpdateTag: deriveSuppressedUpdateTag(apiContainer, updatePolicyState),
    status: apiContainer.status === 'running' ? 'running' : 'stopped',
    registry: deriveRegistry(apiContainer),
    registryName: deriveRegistryName(apiContainer),
    registryUrl: deriveRegistryUrl(apiContainer),
    updateKind: deriveUpdateKind(apiContainer),
    registryError: deriveRegistryError(apiContainer),
    noUpdateReason: deriveNoUpdateReason(apiContainer),
    bouncer: deriveBouncer(apiContainer),
    securityScanState: deriveSecurityScanState(apiContainer),
    securitySummary: currentSummary,
    updateBouncer: deriveUpdateBouncer(apiContainer),
    updateSecurityScanState: deriveUpdateSecurityScanState(apiContainer),
    updateSecuritySummary: updateSummary,
    securityDelta: computeSecurityDelta(currentSummary, updateSummary),
    imageCreated: deriveImageCreated(apiContainer),
    server: deriveServer(apiContainer),
    includeTags: asNonEmptyString(apiContainer.includeTags),
    excludeTags: asNonEmptyString(apiContainer.excludeTags),
    transformTags: asNonEmptyString(apiContainer.transformTags),
    triggerInclude: asNonEmptyString(apiContainer.triggerInclude),
    triggerExclude: asNonEmptyString(apiContainer.triggerExclude),
    details: {
      ports: runtimeDetails.ports,
      volumes: runtimeDetails.volumes,
      env: runtimeDetails.env,
      labels: deriveLabels(apiContainer),
    },
  };
}

/** Map an array of API containers to UI containers. */
export function mapApiContainers(apiContainers: ApiContainerInput[]): Container[] {
  return apiContainers.map(mapApiContainer);
}
