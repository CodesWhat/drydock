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
import type {
  Container,
  ContainerReleaseNotes,
  ContainerSecurityDelta,
  ContainerSecuritySummary,
} from '../types/container';
import { normalizeSeverityCount } from '../views/security/securityViewUtils';
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
  updatePolicy?: ApiContainerUpdatePolicy | null;
  details?: ApiContainerDetails | null;
  tagFamily?: unknown;
  includeTags?: unknown;
  excludeTags?: unknown;
  transformTags?: unknown;
  triggerInclude?: unknown;
  triggerExclude?: unknown;
  sourceRepo?: unknown;
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

/** Derive `bouncer` (security gate verdict) from current-image scan data. */
function deriveBouncer(apiContainer: ApiContainerInput): BouncerStatus {
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

function deriveUpdatePolicyState(apiContainer: ApiContainerInput): Container['updatePolicyState'] {
  const updateKind = apiContainer.updateKind;
  if (
    apiContainer.updateAvailable ||
    !updateKind ||
    (updateKind.kind !== 'tag' && updateKind.kind !== 'digest')
  ) {
    return undefined;
  }

  const updatePolicy = apiContainer.updatePolicy;
  if (!updatePolicy || typeof updatePolicy !== 'object') {
    return undefined;
  }

  const snoozeUntil = asNonEmptyString(updatePolicy.snoozeUntil);
  if (snoozeUntil) {
    const parsedSnoozeUntil = Date.parse(snoozeUntil);
    if (!Number.isNaN(parsedSnoozeUntil) && parsedSnoozeUntil > Date.now()) {
      return 'snoozed';
    }
  }

  const remoteValue = asNonEmptyString(updateKind.remoteValue);

  if (
    updateKind.kind === 'tag' &&
    remoteValue &&
    Array.isArray(updatePolicy.skipTags) &&
    updatePolicy.skipTags.includes(remoteValue)
  ) {
    return 'skipped';
  }

  if (
    updateKind.kind === 'digest' &&
    remoteValue &&
    Array.isArray(updatePolicy.skipDigests) &&
    updatePolicy.skipDigests.includes(remoteValue)
  ) {
    return 'skipped';
  }

  const maturityMode = normalizeMaturityMode(updatePolicy.maturityMode);
  if (maturityMode === 'mature') {
    const minAgeDays = resolveMaturityMinAgeDays(updatePolicy.maturityMinAgeDays);
    const updateDetectedAt = deriveUpdateDetectedAt(apiContainer);
    const detectedAtMs = Date.parse(updateDetectedAt || '');
    const minAgeMs = maturityMinAgeDaysToMilliseconds(minAgeDays);
    if (!Number.isFinite(detectedAtMs) || Date.now() - detectedAtMs < minAgeMs) {
      return 'maturity-blocked';
    }
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

/** Derive inline release notes summary from API result. */
function deriveReleaseNotes(apiContainer: ApiContainerInput): ContainerReleaseNotes | null {
  const rn = apiContainer.result?.releaseNotes;
  if (!rn || typeof rn !== 'object') return null;
  const title = asNonEmptyString(rn.title);
  const body = asNonEmptyString(rn.body);
  const url = asNonEmptyString(rn.url);
  const publishedAt = asNonEmptyString(rn.publishedAt);
  const provider = asNonEmptyString(rn.provider);
  if (!title || !body || !url || !publishedAt || !provider) return null;
  return { title, body, url, publishedAt, provider };
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

  return {
    id,
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
    suggestedTag: asNonEmptyString(apiContainer.result?.suggestedTag),
    sourceRepo: asNonEmptyString(apiContainer.sourceRepo),
    releaseNotes: deriveReleaseNotes(apiContainer),
    releaseLink: deriveReleaseLink(apiContainer),
    updateDetectedAt: deriveUpdateDetectedAt(apiContainer),
    updateMaturity: getUpdateMaturity(
      deriveUpdateDetectedAt(apiContainer),
      !!apiContainer.updateAvailable,
    ),
    updateMaturityTooltip: formatUpdateAge(
      deriveUpdateDetectedAt(apiContainer),
      !!apiContainer.updateAvailable,
    ),
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
