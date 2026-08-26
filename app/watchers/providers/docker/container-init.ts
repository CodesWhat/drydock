import { resolveComposeDependsOn as resolveComposeDependsOnDefault } from '../../../dependencies/compose-dependency-resolver.js';
import log from '../../../log/index.js';
import type { Container, TriggerCategory } from '../../../model/container.js';
import { recordLegacyInput } from '../../../prometheus/compatibility.js';
import * as registry from '../../../registry/index.js';
import * as storeContainer from '../../../store/container.js';
import type { DockerApiBindMountInspector } from '../../../triggers/providers/dockercompose/ComposePathBindMounts.js';
import { getTriggerCategoryForType } from '../../../triggers/trigger-category.js';
import type Watcher from '../../Watcher.js';
import {
  canonicalizeContainerName,
  getContainerConfigBooleanValue,
  getContainerConfigValue,
  getContainerName,
  getFirstConfigString,
  getImgsetSpecificity,
  getOldContainers,
  getRawContainerName,
  getResolvedImgsetConfiguration,
  type ResolvedImgset,
} from './docker-helpers.js';
import type { ContainerLabelOverrides } from './docker-image-details-orchestration.js';
import {
  ddActionAuto,
  ddActionExclude,
  ddActionInclude,
  ddDependsOn,
  ddDependsOnAction,
  ddDisplayIcon,
  ddDisplayName,
  ddInspectTagPath,
  ddInspectTagVersionOnly,
  ddLinkTemplate,
  ddNotificationExclude,
  ddNotificationInclude,
  ddPortLabel,
  ddRegistryLookupImage,
  ddRegistryLookupUrl,
  ddTagExclude,
  ddTagFamily,
  ddTagInclude,
  ddTagPinInfo,
  ddTagTransform,
  ddTriggerExclude,
  ddTriggerInclude,
  ddWatchDigest,
} from './label.js';
import {
  type ResolvedTriggerLabelValues,
  resolveTriggerLabelValuesPure,
} from './trigger-label-resolution.js';
import {
  applyDockerDeclarativeUpdatePolicy,
  type DockerUpdatePolicyResolutionOptions,
} from './update-policy.js';

const warnedLegacyTriggerLabelFallbacks = new Set<string>();
const warnedTriggerCategoryScopeChanges = new Set<string>();
const RECREATED_CONTAINER_NAME_PATTERN = /^([a-f0-9]{12})_(.+)$/i;
const RECREATED_CONTAINER_ALIAS_TRANSIENT_WINDOW_MS = 30 * 1000;

/**
 * Default discovery settling window (#156), configurable per-watcher via
 * `DD_WATCHER_{name}_DISCOVERY_SETTLE_MS`. Deliberately the same magnitude as
 * `RECREATED_CONTAINER_ALIAS_TRANSIENT_WINDOW_MS` above — both windows exist
 * to ride out the same class of Docker recreate/rename race, just from two
 * different angles (name-shape heuristic vs. store-identity based).
 */
export const DEFAULT_DISCOVERY_SETTLE_MS = 30 * 1000;

type ContainerLabelOverrideKey = Exclude<
  keyof ContainerLabelOverrides,
  'registryLookupImage' | 'registryLookupUrl'
>;

interface ResolvedContainerLabelOverrides {
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  tagFamily?: string;
  tagPinInfo?: string;
  inspectTagPath?: string;
  inspectTagVersionOnly?: string;
  linkTemplate?: string;
  portLabel?: string;
  displayName?: string;
  displayIcon?: string;
  actionTriggerInclude?: string;
  actionTriggerExclude?: string;
  notificationTriggerInclude?: string;
  notificationTriggerExclude?: string;
  /** Action category only — no notification counterpart, no deprecated mirror. */
  actionTriggerAuto?: string;
  /** @deprecated compat mirror — see Container.triggerInclude/triggerExclude. */
  triggerInclude?: string;
  /** @deprecated compat mirror. */
  triggerExclude?: string;
  lookupImage?: string;
}

interface ImgsetMatchCandidate {
  specificity: number;
  imgset: ResolvedImgset;
}

interface DockerContainerSummaryLike {
  Id?: unknown;
  Names?: string[];
  [key: string]: unknown;
}

export interface AliasFilterDecision {
  timestamp: string;
  containerId: string;
  containerName: string;
  baseName?: string;
  decision: 'allowed' | 'skipped';
  reason:
    | 'not-recreated-alias'
    | 'base-name-present-in-docker'
    | 'base-name-present-in-store'
    | 'fresh-recreated-alias'
    | 'alias-allowed-no-collision';
}

type DockerImgsetConfigurations = Record<string, unknown>;

interface DockerApiContainerInspector {
  getContainer: (containerId: string) => {
    inspect: () => Promise<{
      State?: {
        Status?: string;
      };
    }>;
  };
}

interface DockerWatcherSourceConfiguration {
  host?: string;
  socket?: string;
  protocol?: string;
  port?: number;
}

interface DockerWatcherSourceLike {
  name?: string;
  agent?: string;
  configuration?: DockerWatcherSourceConfiguration;
}

interface WatcherTagDefaults {
  family?: string;
  pin?: { info?: boolean };
}

interface TagPolicyImageReference {
  path: string;
  domain?: string;
}

interface GetLabelOptions {
  warn?: (message: string) => void;
  warnedLegacyTriggerLabels?: Set<string>;
}

const containerLabelOverrideMappings = [
  { key: 'includeTags', ddKey: ddTagInclude, overrideKey: 'includeTags' },
  { key: 'excludeTags', ddKey: ddTagExclude, overrideKey: 'excludeTags' },
  {
    key: 'transformTags',
    ddKey: ddTagTransform,
    overrideKey: 'transformTags',
  },
  {
    key: 'tagFamily',
    ddKey: ddTagFamily,
    overrideKey: 'tagFamily',
  },
  {
    key: 'tagPinInfo',
    ddKey: ddTagPinInfo,
    overrideKey: 'tagPinInfo',
  },
  {
    key: 'inspectTagPath',
    ddKey: ddInspectTagPath,
    overrideKey: undefined,
  },
  {
    key: 'inspectTagVersionOnly',
    ddKey: ddInspectTagVersionOnly,
    overrideKey: undefined,
  },
  {
    key: 'linkTemplate',
    ddKey: ddLinkTemplate,
    overrideKey: 'linkTemplate',
  },
  {
    key: 'portLabel',
    ddKey: ddPortLabel,
    overrideKey: 'portLabel',
  },
  { key: 'displayName', ddKey: ddDisplayName, overrideKey: 'displayName' },
  { key: 'displayIcon', ddKey: ddDisplayIcon, overrideKey: 'displayIcon' },
  // Trigger include/exclude/auto are NOT in this generic table: dd.action.*/
  // dd.notification.*/dd.trigger.* resolve into scoped fields (plus, for
  // include/exclude, a deprecated mirror), which doesn't fit the single-key
  // shape below. See resolveTriggerLabelOverrides().
] as const satisfies ReadonlyArray<{
  key: keyof ResolvedContainerLabelOverrides;
  ddKey: string;
  overrideKey?: ContainerLabelOverrideKey;
}>;

/** Get a canonical Docker label value. */
export function getLabel(labels: Record<string, string>, ddKey: string) {
  return labels[ddKey];
}

function warnLegacyTriggerLabel(
  ddKey: string,
  warnedLegacyTriggerLabels: Set<string>,
  warn: (message: string) => void,
) {
  if (warnedLegacyTriggerLabels.has(ddKey)) {
    return;
  }
  warnedLegacyTriggerLabels.add(ddKey);

  const aliasKeySuffix = ddKey === ddTriggerInclude ? 'include' : 'exclude';

  warn(
    `Legacy Docker label "${ddKey}" was removed in v1.7.0 and no longer affects trigger routing. Set "dd.action.${aliasKeySuffix}" or "dd.notification.${aliasKeySuffix}" instead.`,
  );
}

/**
 * Resolve one direction (include or exclude) of the trigger labels into its
 * category-scoped values plus the deprecated compat mirror.
 *
 * `dd.trigger.<dir>` support was removed in v1.7.0: it is no longer read for
 * value resolution (delegated entirely to the dependency-free
 * `resolveTriggerLabelValuesPure()`, which only looks at
 * `dd.action.<dir>` / `dd.notification.<dir>`). It is still *detected* here
 * so operators who haven't migrated yet get a loud, per-key warning (and a
 * `dd_legacy_input_total` / deprecation-banner data point) rather than a
 * silently-ignored label.
 */
function resolveTriggerLabelValues(
  labels: Record<string, string>,
  direction: 'include' | 'exclude',
  options: GetLabelOptions,
): ResolvedTriggerLabelValues {
  const ddLegacyKey = direction === 'include' ? ddTriggerInclude : ddTriggerExclude;
  const legacyValue = labels[ddLegacyKey];

  if (legacyValue !== undefined) {
    const warn = options.warn || ((message) => log.error(message));
    const warnedLegacyTriggerLabels =
      options.warnedLegacyTriggerLabels || warnedLegacyTriggerLabelFallbacks;
    recordLegacyInput('label', ddLegacyKey);
    warnLegacyTriggerLabel(ddLegacyKey, warnedLegacyTriggerLabels, warn);
  }

  return resolveTriggerLabelValuesPure(labels, direction);
}

/**
 * Resolve one direction, reusing already-resolved `overrides` rather than
 * re-reading the labels when every value for that direction has already been
 * resolved once.
 *
 * The skip is load-bearing, not an optimization. A newly-discovered container is
 * resolved twice over the same labels — once in Docker.ts to build the override
 * bag, then again here via resolveLabelsFromContainer — and resolveTriggerLabelValues
 * has side effects (recordLegacyInput, deprecation warn). Without the short-circuit
 * a deprecated dd.trigger.* label increments the legacy-input metric twice per
 * container.
 *
 * "Already resolved" is judged by property *presence* (`Object.hasOwn`), not
 * truthiness. `resolveTriggerLabelOverrides` always returns an object with all
 * six fields present, even when a field legitimately resolves to `undefined`
 * (e.g. only `dd.action.<dir>` is set, so the notification field never
 * resolves) — that undefined-but-present value is what gets spread into the
 * `overrides` bag passed back in on the second pass. A truthiness check would
 * never short-circuit for a direction driven only by the (removed in v1.7.0,
 * detection-only) `dd.trigger.<dir>` label, since that label no longer fills
 * any field — which would double-fire recordLegacyInput/warn on every such
 * container. Presence-checking treats "resolved to undefined" and "resolved
 * to a value" identically, so the short-circuit still applies.
 */
function resolveTriggerLabelDirection(
  containerLabels: Record<string, string>,
  direction: 'include' | 'exclude',
  overrides: ContainerLabelOverrides,
  options: GetLabelOptions,
): ResolvedTriggerLabelValues {
  const [actionKey, notificationKey, mirrorKey] =
    direction === 'include'
      ? (['actionTriggerInclude', 'notificationTriggerInclude', 'triggerInclude'] as const)
      : (['actionTriggerExclude', 'notificationTriggerExclude', 'triggerExclude'] as const);

  const actionOverride = overrides[actionKey];
  const notificationOverride = overrides[notificationKey];
  const mirrorOverride = overrides[mirrorKey];

  if (
    Object.hasOwn(overrides, actionKey) &&
    Object.hasOwn(overrides, notificationKey) &&
    Object.hasOwn(overrides, mirrorKey)
  ) {
    return { action: actionOverride, notification: notificationOverride, mirror: mirrorOverride };
  }

  const resolved = resolveTriggerLabelValues(containerLabels, direction, options);

  return {
    action: actionOverride || resolved.action,
    notification: notificationOverride || resolved.notification,
    mirror: mirrorOverride || resolved.mirror,
  };
}

/**
 * Resolve the four category-scoped trigger label fields plus the deprecated
 * triggerInclude/triggerExclude mirror, plus the action-only `actionTriggerAuto`
 * field (dd.action.auto — no notification counterpart, no mirror, so it skips
 * the direction/mirror machinery above and is just a plain override-or-label
 * read). `overrides` (already-resolved values from an earlier pass over the
 * same labels) take priority, matching the override-vs-label precedence used
 * for every other label-derived field.
 */
export function resolveTriggerLabelOverrides(
  containerLabels: Record<string, string>,
  overrides: ContainerLabelOverrides = {},
  options: GetLabelOptions = {},
): Pick<
  ResolvedContainerLabelOverrides,
  | 'actionTriggerInclude'
  | 'actionTriggerExclude'
  | 'notificationTriggerInclude'
  | 'notificationTriggerExclude'
  | 'actionTriggerAuto'
  | 'triggerInclude'
  | 'triggerExclude'
> {
  const includeResolved = resolveTriggerLabelDirection(
    containerLabels,
    'include',
    overrides,
    options,
  );
  const excludeResolved = resolveTriggerLabelDirection(
    containerLabels,
    'exclude',
    overrides,
    options,
  );

  return {
    actionTriggerInclude: includeResolved.action,
    actionTriggerExclude: excludeResolved.action,
    notificationTriggerInclude: includeResolved.notification,
    notificationTriggerExclude: excludeResolved.notification,
    actionTriggerAuto: overrides.actionTriggerAuto ?? getLabel(containerLabels, ddActionAuto),
    triggerInclude: includeResolved.mirror,
    triggerExclude: excludeResolved.mirror,
  };
}

interface TriggerCategoryScopeWarningOptions {
  warn?: (message: string) => void;
  warnedContainerNames?: Set<string>;
  hasConfiguredTriggerOfCategory?: (category: TriggerCategory) => boolean;
}

function hasConfiguredTriggerOfCategoryFromRegistry(category: TriggerCategory): boolean {
  return Object.values(registry.getState().trigger).some(
    (trigger) => getTriggerCategoryForType(trigger.type) === category,
  );
}

function getTriggerCategoryScopeChangeWarning(
  containerName: string,
  resolved: Pick<
    ResolvedContainerLabelOverrides,
    | 'actionTriggerInclude'
    | 'actionTriggerExclude'
    | 'notificationTriggerInclude'
    | 'notificationTriggerExclude'
  >,
  hasConfiguredTriggerOfCategory: (category: TriggerCategory) => boolean,
): string | undefined {
  const asymmetricDirections: Array<{
    setKey: string;
    setValue: string | undefined;
    otherKey: string;
    otherValue: string | undefined;
    otherCategory: TriggerCategory;
  }> = [
    {
      setKey: ddActionInclude,
      setValue: resolved.actionTriggerInclude,
      otherKey: ddNotificationInclude,
      otherValue: resolved.notificationTriggerInclude,
      otherCategory: 'notification',
    },
    {
      setKey: ddNotificationInclude,
      setValue: resolved.notificationTriggerInclude,
      otherKey: ddActionInclude,
      otherValue: resolved.actionTriggerInclude,
      otherCategory: 'action',
    },
    {
      setKey: ddActionExclude,
      setValue: resolved.actionTriggerExclude,
      otherKey: ddNotificationExclude,
      otherValue: resolved.notificationTriggerExclude,
      otherCategory: 'notification',
    },
    {
      setKey: ddNotificationExclude,
      setValue: resolved.notificationTriggerExclude,
      otherKey: ddActionExclude,
      otherValue: resolved.actionTriggerExclude,
      otherCategory: 'action',
    },
  ];

  for (const { setKey, setValue, otherKey, otherValue, otherCategory } of asymmetricDirections) {
    if (
      setValue !== undefined &&
      otherValue === undefined &&
      hasConfiguredTriggerOfCategory(otherCategory)
    ) {
      return (
        `Container "${containerName}" sets "${setKey}" but not "${otherKey}". As of v1.6 this label ` +
        `no longer filters ${otherCategory} triggers. Set "${otherKey}" to restore the previous filtering.`
      );
    }
  }

  return undefined;
}

/**
 * Emit a one-time warning when a container relies on the pre-v1.6 cross-category
 * trigger label leak: exactly one of dd.action.<dir>/dd.notification.<dir> is set
 * (with no dd.trigger.<dir> fallback in play) while the OTHER category has at
 * least one trigger configured. Under strict category scoping (#494) that other
 * category is no longer gated by the lone scoped label — this is a deliberate
 * behavior change, not a bug, but it deserves a heads-up on upgrade.
 */
export function warnTriggerCategoryScopeChangeIfNeeded(
  containerName: string,
  resolved: Pick<
    ResolvedContainerLabelOverrides,
    | 'actionTriggerInclude'
    | 'actionTriggerExclude'
    | 'notificationTriggerInclude'
    | 'notificationTriggerExclude'
  >,
  options: TriggerCategoryScopeWarningOptions = {},
): void {
  if (!containerName) {
    return;
  }
  const warnedContainerNames = options.warnedContainerNames || warnedTriggerCategoryScopeChanges;
  if (warnedContainerNames.has(containerName)) {
    return;
  }

  const hasConfiguredTriggerOfCategory =
    options.hasConfiguredTriggerOfCategory || hasConfiguredTriggerOfCategoryFromRegistry;
  const message = getTriggerCategoryScopeChangeWarning(
    containerName,
    resolved,
    hasConfiguredTriggerOfCategory,
  );
  if (!message) {
    return;
  }

  warnedContainerNames.add(containerName);
  const warn = options.warn || ((warnMessage: string) => log.warn(warnMessage));
  warn(message);
}

/**
 * Prune old containers from the store.
 * Containers that still exist in Docker (e.g. stopped) AND are still in watch
 * scope get their status updated instead of being removed, so the UI can
 * still show them with a start button. A container that inspects
 * successfully but has fallen out of watch scope (watchbydefault disabled,
 * dd.watch label removed, etc.) is deleted just like a container that's gone
 * from Docker entirely — inspect success alone is not "still tracked".
 * @param newContainers
 * @param containersFromTheStore
 * @param dockerApi
 */
export async function pruneOldContainers(
  newContainers: Container[],
  containersFromTheStore: Container[],
  dockerApi: DockerApiContainerInspector,
  options: {
    forceRemoveContainerIds?: Set<string>;
    sameSourceContainersFromStore?: Container[];
    stillInWatchScopeContainerIds?: Set<string>;
  } = {},
) {
  const forceRemoveContainerIds = options.forceRemoveContainerIds || new Set<string>();
  const stillInWatchScopeContainerIds = options.stillInWatchScopeContainerIds;
  const containersToRemove = getOldContainers(newContainers, containersFromTheStore);
  const containersToNamePrune = getOldContainers(
    newContainers,
    options.sameSourceContainersFromStore || containersFromTheStore,
  );
  const newContainerNames = new Set(
    newContainers
      .filter((container) => typeof container.name === 'string' && container.name !== '')
      .map((container) => canonicalizeContainerName(container.name, container.id)),
  );
  const deletedContainerIds = new Set<string>();
  for (const staleContainer of containersToNamePrune) {
    const staleContainerName = canonicalizeContainerName(
      typeof staleContainer.name === 'string' ? staleContainer.name : '',
      staleContainer.id,
    );
    if (staleContainerName !== '' && newContainerNames.has(staleContainerName)) {
      storeContainer.deleteContainer(staleContainer.id, {
        replacementExpected: true,
      });
      deletedContainerIds.add(staleContainer.id);
    }
  }
  for (const containerToRemove of containersToRemove) {
    if (deletedContainerIds.has(containerToRemove.id)) {
      continue;
    }
    if (
      typeof containerToRemove.id === 'string' &&
      forceRemoveContainerIds.has(containerToRemove.id)
    ) {
      storeContainer.deleteContainer(containerToRemove.id);
      continue;
    }
    try {
      const inspectResult = await dockerApi.getContainer(containerToRemove.id).inspect();
      const isStillInWatchScope =
        !stillInWatchScopeContainerIds ||
        (typeof containerToRemove.id === 'string' &&
          stillInWatchScopeContainerIds.has(containerToRemove.id));
      if (!isStillInWatchScope) {
        // Container still exists in Docker, but is no longer in watch scope
        // (e.g. watchbydefault disabled and dd.watch label absent, or the
        // label was removed). Delete like any other stale record — no
        // replacementExpected, this isn't the "container about to reappear
        // under a new id" path.
        storeContainer.deleteContainer(containerToRemove.id);
        continue;
      }
      const newStatus = inspectResult?.State?.Status;
      if (newStatus) {
        storeContainer.updateContainer({ ...containerToRemove, status: newStatus });
      }
    } catch (_error: unknown) {
      // Container no longer exists in Docker — remove from store.
      // Pass replacementExpected: true so the lifecycle cache (updateDetectedAt /
      // firstSeenAt) is stashed and can be restored by the next insertContainer
      // call when the same-named container reappears.  This is the slow-restart
      // path: Docker is still pulling a new image layer when the prune runs, so
      // the replacement container isn't visible yet.  The cache entry expires
      // harmlessly after 30 min if no replacement ever arrives.
      storeContainer.deleteContainer(containerToRemove.id, { replacementExpected: true });
    }
  }
}

function normalizeWatcherSourceStringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized === '' ? undefined : normalized;
}

export function getDockerWatcherRegistryId(watcherName: string, agent?: string): string {
  const normalizedWatcherName = normalizeWatcherSourceStringValue(watcherName);
  if (!normalizedWatcherName) {
    return '';
  }
  const normalizedAgent = normalizeWatcherSourceStringValue(agent);
  if (!normalizedAgent) {
    return `docker.${normalizedWatcherName}`;
  }
  return `${normalizedAgent}.docker.${normalizedWatcherName}`;
}

export function getDockerWatcherSourceKey(watcher: DockerWatcherSourceLike): string {
  const normalizedAgent = normalizeWatcherSourceStringValue(watcher.agent) || '';
  const normalizedHost = normalizeWatcherSourceStringValue(watcher.configuration?.host);
  if (normalizedHost) {
    const normalizedProtocol =
      normalizeWatcherSourceStringValue(watcher.configuration?.protocol)?.toLowerCase() || 'http';
    const normalizedPort =
      typeof watcher.configuration?.port === 'number' &&
      Number.isFinite(watcher.configuration.port) &&
      watcher.configuration.port > 0
        ? Math.trunc(watcher.configuration.port)
        : 2375;
    return `agent:${normalizedAgent}|tcp:${normalizedProtocol}://${normalizedHost.toLowerCase()}:${normalizedPort}`;
  }

  const normalizedSocket =
    normalizeWatcherSourceStringValue(watcher.configuration?.socket) || '/var/run/docker.sock';
  return `agent:${normalizedAgent}|socket:${normalizedSocket}`;
}

export function isDockerWatcher(
  watcher: Watcher | undefined,
): watcher is Watcher & { type: 'docker' } {
  return !!watcher && watcher.type === 'docker';
}

function getRecreatedContainerBaseName(container: { Id?: unknown; Names?: string[] }) {
  const containerId = typeof container.Id === 'string' ? container.Id : '';
  if (containerId === '') {
    return undefined;
  }

  // Use raw name (not canonicalized) so the alias pattern is still detectable
  const containerName = getRawContainerName(container);
  if (containerName === '') {
    return undefined;
  }

  const recreatedNameMatch = containerName.match(RECREATED_CONTAINER_NAME_PATTERN);
  if (!recreatedNameMatch) {
    return undefined;
  }

  const [, shortIdPrefix, baseName] = recreatedNameMatch;
  if (baseName === '' || !containerId.toLowerCase().startsWith(shortIdPrefix.toLowerCase())) {
    return undefined;
  }

  return baseName;
}

function getDockerContainerId(container: { Id?: unknown }) {
  return typeof container.Id === 'string' ? container.Id : '';
}

function getContainerCreatedAtMs(container: Record<string, unknown>): number | undefined {
  const created = container.Created;
  if (typeof created === 'number' && Number.isFinite(created) && created > 0) {
    // Docker list payloads typically expose Created as Unix seconds.
    // Handle both seconds and milliseconds defensively.
    return created >= 1_000_000_000_000 ? Math.trunc(created) : Math.trunc(created * 1000);
  }

  if (typeof created !== 'string') {
    return undefined;
  }

  const createdValue = created.trim();
  if (createdValue === '') {
    return undefined;
  }

  const numericCreatedValue = Number(createdValue);
  if (Number.isFinite(numericCreatedValue) && numericCreatedValue > 0) {
    return numericCreatedValue >= 1_000_000_000_000
      ? Math.trunc(numericCreatedValue)
      : Math.trunc(numericCreatedValue * 1000);
  }

  const parsedDateValue = Date.parse(createdValue);
  return Number.isNaN(parsedDateValue) ? undefined : parsedDateValue;
}

function isWithinRecreatedAliasTransientWindow(
  createdAtMs: number | undefined,
  nowMs: number,
): boolean {
  if (createdAtMs === undefined) {
    return false;
  }
  const ageMs = nowMs - createdAtMs;
  if (ageMs < 0) {
    return false;
  }
  return ageMs <= RECREATED_CONTAINER_ALIAS_TRANSIENT_WINDOW_MS;
}

function buildDockerContainerNameToIds<T extends DockerContainerSummaryLike>(containers: T[]) {
  const dockerContainerNameToIds = new Map<string, Set<string>>();

  for (const container of containers) {
    const containerId = getDockerContainerId(container);
    if (containerId === '') {
      continue;
    }

    const normalizedContainerNames = Array.from(
      new Set(
        (Array.isArray(container.Names) ? container.Names : [])
          .map((name) => (typeof name === 'string' ? name.replace(/^\//, '') : ''))
          .filter((name) => name !== ''),
      ),
    );

    if (normalizedContainerNames.length === 0) {
      const fallbackName = getContainerName(container);
      if (fallbackName !== '') {
        normalizedContainerNames.push(fallbackName);
      }
    }

    for (const containerName of normalizedContainerNames) {
      const idsForName = dockerContainerNameToIds.get(containerName) || new Set<string>();
      idsForName.add(containerId);
      dockerContainerNameToIds.set(containerName, idsForName);
    }
  }

  return dockerContainerNameToIds;
}

function hasSiblingDockerContainerWithName(
  dockerContainerNameToIds: Map<string, Set<string>>,
  containerName: string,
  containerId: string,
) {
  const containerIds = dockerContainerNameToIds.get(containerName);
  if (!containerIds) {
    return false;
  }

  for (const currentContainerId of containerIds) {
    if (currentContainerId !== containerId) {
      return true;
    }
  }

  return false;
}

function hasCurrentContainerWithName(container: DockerContainerSummaryLike, containerName: string) {
  if (!Array.isArray(container.Names) || container.Names.length === 0) {
    return false;
  }

  return container.Names.some(
    (name) => typeof name === 'string' && name.replace(/^\//, '') === containerName,
  );
}

export function filterRecreatedContainerAliases<T extends DockerContainerSummaryLike>(
  containers: T[],
  containersFromTheStore: Container[],
): { containersToWatch: T[]; skippedContainerIds: Set<string>; decisions: AliasFilterDecision[] } {
  const storeContainerNames = new Set(
    containersFromTheStore
      .filter((container) => typeof container.name === 'string' && container.name !== '')
      .map((container) => container.name),
  );

  const dockerContainerNameToIds = buildDockerContainerNameToIds(containers);
  const nowMs = Date.now();

  const containersToWatch: T[] = [];
  const skippedContainerIds = new Set<string>();
  const decisions: AliasFilterDecision[] = [];
  const nowIso = new Date(nowMs).toISOString();
  for (const container of containers) {
    const containerId = getDockerContainerId(container);
    const containerName = getContainerName(container);
    const displayContainerName = containerName || '(unknown)';
    const recreatedContainerBaseName = getRecreatedContainerBaseName(container);

    if (!recreatedContainerBaseName || containerId === '') {
      containersToWatch.push(container);
      decisions.push({
        timestamp: nowIso,
        containerId: containerId || '(unknown)',
        containerName: displayContainerName,
        decision: 'allowed',
        reason: 'not-recreated-alias',
      });
      continue;
    }

    const hasDockerSiblingContainerWithBaseName = hasSiblingDockerContainerWithName(
      dockerContainerNameToIds,
      recreatedContainerBaseName,
      containerId,
    );
    const hasCurrentContainerWithBaseName = hasCurrentContainerWithName(
      container,
      recreatedContainerBaseName,
    );
    const hasDockerContainerWithBaseName =
      hasDockerSiblingContainerWithBaseName || hasCurrentContainerWithBaseName;
    const hasStoreContainerWithBaseName = storeContainerNames.has(recreatedContainerBaseName);
    const isFreshAlias = isWithinRecreatedAliasTransientWindow(
      getContainerCreatedAtMs(container),
      nowMs,
    );

    if (hasDockerContainerWithBaseName || hasStoreContainerWithBaseName || isFreshAlias) {
      skippedContainerIds.add(containerId);
      const reason = hasDockerContainerWithBaseName
        ? 'base-name-present-in-docker'
        : hasStoreContainerWithBaseName
          ? 'base-name-present-in-store'
          : 'fresh-recreated-alias';
      decisions.push({
        timestamp: nowIso,
        containerId,
        containerName: displayContainerName,
        baseName: recreatedContainerBaseName,
        decision: 'skipped',
        reason,
      });
      continue;
    }

    containersToWatch.push(container);
    decisions.push({
      timestamp: nowIso,
      containerId,
      containerName: displayContainerName,
      baseName: recreatedContainerBaseName,
      decision: 'allowed',
      reason: 'alias-allowed-no-collision',
    });
  }

  return { containersToWatch, skippedContainerIds, decisions };
}

/**
 * Per-watcher-instance bookkeeping for a container that has been observed but
 * not yet settled. `name` tracks the most recently observed name so that a
 * mid-window rename (transient alias -> canonical name) registers under the
 * FINAL name rather than the name it happened to have on first sight.
 */
interface PendingDiscoveryEntry {
  firstSeenAtMs: number;
  name: string;
}

export interface PendingDiscoveryFilterResult<T> {
  containersToWatch: T[];
  pendingContainerIds: Set<string>;
}

interface FilterPendingDiscoveriesOptions {
  /** Settling window in ms. `0` disables settling entirely (#156). */
  settleMs: number;
  /**
   * Mutable per-watcher-instance map of container id -> pending entry. Owned
   * by the caller (DockerWatcher instance) so state persists across watch
   * cycles; this function only reads/writes it.
   */
  pendingDiscoveries: Map<string, PendingDiscoveryEntry>;
  nowMs?: number;
  debug?: (message: string) => void;
}

/**
 * Hold first-seen containers in a "pending" state for a configurable
 * settling window before they are allowed through to the store/triggers/UI
 * (#156). This complements — does not replace — `filterRecreatedContainerAliases`
 * above: that function suppresses containers whose *name* looks like a
 * transient `<hex>_<name>` recreate alias; this function gates ALL first-seen
 * containers regardless of name shape, keyed by Docker container id (the
 * store's identity key, stable across renames — see `store/container.ts`
 * `getContainer(id)`).
 *
 * "First-seen" is defined relative to the STORE, not this function's own
 * pending map: a container whose id is already present in
 * `containersFromTheStore` bypasses settling immediately and is never
 * tracked here, so a same-name/same-id recreation that the store already
 * knows about is never blocked from updating.
 *
 * - New container id -> starts a pending entry, excluded from the result.
 * - Still-pending id within the window -> stays excluded; its tracked name is
 *   refreshed so a rename mid-window registers under the final name.
 * - Still-pending id whose window has elapsed -> included in the result
 *   (using its current, i.e. final, name) and removed from the pending map.
 * - A pending id no longer present in the live `containers` list (container
 *   disappeared mid-window) is discarded from the pending map, debug-logged
 *   only, and never surfaces anywhere else.
 */
export function filterPendingDiscoveries<T extends DockerContainerSummaryLike>(
  containers: T[],
  containersFromTheStore: Container[],
  options: FilterPendingDiscoveriesOptions,
): PendingDiscoveryFilterResult<T> {
  const { settleMs, pendingDiscoveries, debug } = options;
  const pendingContainerIds = new Set<string>();

  if (!(settleMs > 0)) {
    return { containersToWatch: containers, pendingContainerIds };
  }

  const nowMs = options.nowMs ?? Date.now();
  const storeContainerIds = new Set(
    containersFromTheStore
      .filter((container) => typeof container.id === 'string' && container.id !== '')
      .map((container) => container.id),
  );

  const containersToWatch: T[] = [];
  const liveContainerIds = new Set<string>();

  for (const container of containers) {
    const containerId = getDockerContainerId(container);
    const containerName = getContainerName(container);

    if (containerId === '') {
      // No id to track pending state against — pass through unmodified,
      // matching filterRecreatedContainerAliases's handling of the same case.
      containersToWatch.push(container);
      continue;
    }

    liveContainerIds.add(containerId);

    if (storeContainerIds.has(containerId)) {
      // Already known to the store: settling only applies to first-seen
      // containers, so this one bypasses it and updates immediately. Drop
      // any stray pending entry defensively (e.g. inserted via another path
      // while this one was mid-window).
      pendingDiscoveries.delete(containerId);
      containersToWatch.push(container);
      continue;
    }

    const displayName = containerName || containerId.substring(0, 12);
    const existingEntry = pendingDiscoveries.get(containerId);

    if (!existingEntry) {
      pendingDiscoveries.set(containerId, { firstSeenAtMs: nowMs, name: containerName });
      pendingContainerIds.add(containerId);
      debug?.(
        `${displayName} - New container discovered; entering ${settleMs}ms discovery settling window before registration (#156)`,
      );
      continue;
    }

    if (existingEntry.name !== containerName) {
      debug?.(
        `${containerId.substring(0, 12)} - Container renamed during discovery settling window (${existingEntry.name || '(unknown)'} -> ${containerName || '(unknown)'})`,
      );
      existingEntry.name = containerName;
    }

    const ageMs = nowMs - existingEntry.firstSeenAtMs;
    if (ageMs < settleMs) {
      pendingContainerIds.add(containerId);
      debug?.(
        `${displayName} - Still within discovery settling window (${ageMs}ms/${settleMs}ms elapsed)`,
      );
      continue;
    }

    pendingDiscoveries.delete(containerId);
    containersToWatch.push(container);
    debug?.(`${displayName} - Discovery settling window elapsed; registering`);
  }

  for (const [pendingId, pendingEntry] of pendingDiscoveries) {
    if (liveContainerIds.has(pendingId)) {
      continue;
    }
    pendingDiscoveries.delete(pendingId);
    debug?.(
      `${pendingEntry.name || pendingId.substring(0, 12)} - Container disappeared during discovery settling window; discarding`,
    );
  }

  return { containersToWatch, pendingContainerIds };
}

interface DiscoverySettlingWatcher {
  // `cron` is required so this shares a property with DockerWatcherConfiguration,
  // which keeps TS's weak-type check from demanding `discoverysettlems` be
  // declared there too — it's set via the Joi schema/env vars, not statically.
  configuration: { cron: string; discoverysettlems?: number };
  pendingDiscoveries: Map<string, PendingDiscoveryEntry>;
  log: { debug: (message: string) => void };
}

/** Thin `filterPendingDiscoveries` wrapper bound to a DockerWatcher instance (#156). */
export function getSettledContainersToWatch<T extends DockerContainerSummaryLike>(
  containers: T[],
  containersFromTheStore: Container[],
  watcher: DiscoverySettlingWatcher,
): T[] {
  return filterPendingDiscoveries(containers, containersFromTheStore, {
    settleMs: watcher.configuration.discoverysettlems ?? DEFAULT_DISCOVERY_SETTLE_MS,
    pendingDiscoveries: watcher.pendingDiscoveries,
    debug: (message) => watcher.log.debug(message),
  }).containersToWatch;
}

/**
 * Delay in ms until the earliest currently-pending discovery finishes settling,
 * or undefined when nothing is pending (or settling is disabled) so no
 * follow-up watch needs scheduling (#156).
 */
export function getPendingDiscoverySettleDelayMs(
  watcher: DiscoverySettlingWatcher,
  nowMs: number = Date.now(),
): number | undefined {
  const settleMs = watcher.configuration.discoverysettlems ?? DEFAULT_DISCOVERY_SETTLE_MS;
  if (!(settleMs > 0)) {
    return undefined;
  }
  let earliestFirstSeenAtMs: number | undefined;
  for (const entry of watcher.pendingDiscoveries.values()) {
    if (earliestFirstSeenAtMs === undefined || entry.firstSeenAtMs < earliestFirstSeenAtMs) {
      earliestFirstSeenAtMs = entry.firstSeenAtMs;
    }
  }
  if (earliestFirstSeenAtMs === undefined) {
    return undefined;
  }
  return Math.max(earliestFirstSeenAtMs + settleMs - nowMs, 0);
}

export function resolveLabelsFromContainer(
  containerLabels: Record<string, string>,
  overrides: ContainerLabelOverrides = {},
) {
  const resolvedOverrides: ResolvedContainerLabelOverrides = {
    lookupImage: resolveLookupImageFromContainerLabels(containerLabels, overrides),
    ...resolveTriggerLabelOverrides(containerLabels, overrides),
  };

  for (const { key, ddKey, overrideKey } of containerLabelOverrideMappings) {
    const overrideValue = overrideKey ? overrides[overrideKey] : undefined;
    resolvedOverrides[key] = overrideValue || getLabel(containerLabels, ddKey);
  }

  return resolvedOverrides;
}

/**
 * Re-derive label-driven container fields from a fresh label set and write
 * them back onto the stored container record.
 *
 * Used on the Docker-event update path (start/die/update events) where the
 * container already exists in the store but its labels may have changed since
 * it was first registered — e.g. after `docker compose up -d` recreates a
 * service with a new `dd.tag.family` label.
 *
 * The caller may supply already-resolved tag-policy fallbacks so removing a
 * direct tag label restores the matching imgset/watcher value on event paths.
 * Other imgset-derived fields remain outside this lightweight label refresh.
 */
export function applyDerivedLabelFieldsToContainer(
  container: Container,
  labels: Record<string, string>,
  tagPolicyFallbacks: { tagFamily?: string; tagPinInfo?: boolean } = {},
): void {
  const resolved = resolveLabelsFromContainer(labels);
  container.includeTags = resolved.includeTags;
  container.excludeTags = resolved.excludeTags;
  container.transformTags = resolved.transformTags;
  container.tagFamily = resolved.tagFamily ?? tagPolicyFallbacks.tagFamily;
  const tagPinInfo = getContainerConfigBooleanValue(resolved.tagPinInfo);
  container.tagPinInfo = tagPinInfo ?? tagPolicyFallbacks.tagPinInfo;
  container.linkTemplate = resolved.linkTemplate;
  container.portLabel = resolved.portLabel;
  container.actionTriggerInclude = resolved.actionTriggerInclude;
  container.actionTriggerExclude = resolved.actionTriggerExclude;
  container.notificationTriggerInclude = resolved.notificationTriggerInclude;
  container.notificationTriggerExclude = resolved.notificationTriggerExclude;
  container.actionTriggerAuto = resolved.actionTriggerAuto;
  container.triggerInclude = resolved.triggerInclude;
  container.triggerExclude = resolved.triggerExclude;
  const dependsOnResolution = resolveDependsOnFromLabels(labels, container.name);
  if (dependsOnResolution.dependsOn !== undefined) {
    container.dependsOn = dependsOnResolution.dependsOn;
    container.dependsOnSource = 'label';
    // dependsOnAction is always resolved (never undefined) whenever dependsOn
    // is — see resolveDependsOnFromLabels's return contract.
    container.dependsOnAction = dependsOnResolution.dependsOnAction;
  } else if (container.dependsOnSource === 'label') {
    // The dd.depends_on label was removed. Clear the label-sourced edge so a
    // stale dependency doesn't linger — compose detection (if any) re-applies
    // on the next full watch cycle, which this lightweight event path can't
    // run (it requires async file I/O).
    container.dependsOn = undefined;
    container.dependsOnSource = undefined;
    container.dependsOnAction = dependsOnResolution.dependsOnAction;
  }
  // The category-scope warning is deliberately NOT emitted here. `resolved` comes from
  // labels alone (no imgset pass, see above), so a container whose other-category filter
  // is supplied by a matching imgset looks falsely asymmetric on this path and would
  // latch a bogus one-time warning for the rest of the process. The full watch cycle
  // evaluates the warning against the imgset-merged config instead.
  // displayName is managed separately by updateContainerFromInspect via
  // getCustomDisplayNameFromLabels, which handles the "no custom name →
  // fall back to container name" logic. We do not overwrite it here.
  //
  // displayIcon is stored but not re-derived on the event path because
  // Docker events do not carry image metadata needed to validate icon refs.
  // It will be refreshed on the next full watch cycle.
  //
  // lookupImage / registryLookupUrl flow into image.registry.lookupImage
  // which is part of the image reference block — only re-derived during a
  // full addImageDetailsToContainer pass, not on lightweight event updates.
}

export function resolveEffectiveContainerTagPolicy(
  container: Container,
  watcherTagDefaults: WatcherTagDefaults | undefined,
  getMatchingImgset: (image: TagPolicyImageReference) => ResolvedImgset | undefined,
) {
  const watcherDefaults = watcherTagDefaults ?? {};
  const labels = container.labels ?? {};
  const usePersistedFallbacks = container.labels === undefined;
  const persistedFallbacks = {
    family: (usePersistedFallbacks ? container.tagFamily : undefined) ?? watcherDefaults.family,
    pin: {
      info: (usePersistedFallbacks ? container.tagPinInfo : undefined) ?? watcherDefaults.pin?.info,
    },
  };
  return mergeConfigWithImgset(
    resolveLabelsFromContainer(labels),
    getMatchingImgset({
      path: container.image.name,
      domain: container.image.registry?.url,
    }),
    labels,
    persistedFallbacks,
  );
}

function applyEffectiveTagPolicyFromLabels(
  container: Container,
  labels: Record<string, string>,
  watcherTagDefaults: WatcherTagDefaults | undefined,
  getMatchingImgset: (image: TagPolicyImageReference) => ResolvedImgset | undefined,
) {
  const tagPolicy = resolveEffectiveContainerTagPolicy(
    { ...container, labels },
    watcherTagDefaults,
    getMatchingImgset,
  );
  applyDerivedLabelFieldsToContainer(container, labels, {
    tagFamily: tagPolicy.tagFamily,
    tagPinInfo: tagPolicy.tagPinInfo,
  });
}

export function applyEffectiveDockerConfigFromLabels(
  container: Container,
  labels: Record<string, string>,
  configuration: {
    tag?: WatcherTagDefaults;
    maturitymode?: 'all' | 'mature';
    maturityminagedays?: number;
  },
  getMatchingImgset: (image: TagPolicyImageReference) => ResolvedImgset | undefined,
  policyResolutionOptions: DockerUpdatePolicyResolutionOptions = {},
) {
  applyEffectiveTagPolicyFromLabels(container, labels, configuration.tag, getMatchingImgset);
  applyDockerDeclarativeUpdatePolicy(container, labels, configuration, policyResolutionOptions);
}

const warnedDependsOnSelfReferences = new Set<string>();
const warnedInvalidDependsOnActions = new Set<string>();

export interface ResolvedDependsOn {
  dependsOn?: string[];
  dependsOnAction?: 'update' | 'restart';
}

export interface ContainerDependsOnResolution {
  dependsOn?: string[];
  dependsOnSource?: 'label' | 'compose';
  dependsOnAction?: 'update' | 'restart';
}

interface ResolveDependsOnOptions {
  warn?: (message: string) => void;
  warnedSelfReferences?: Set<string>;
  warnedInvalidActions?: Set<string>;
}

function parseDependsOnNames(rawValue: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const rawName of rawValue.split(',')) {
    const name = rawName.trim();
    if (name === '' || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Resolve `dd.depends_on` / `dd.depends_on.action` into typed Container
 * fields, label-only.
 *
 * Compose-derived `depends_on` is resolved separately (see
 * `app/dependencies/compose-dependency-resolver.ts`, wired in via
 * `resolveContainerDependsOn` below) because it requires async file I/O this
 * synchronous label pass cannot do. A present `dd.depends_on` label always
 * wins over compose detection — no merge — signalled here by returning a
 * `dependsOn` array (possibly empty) whenever the label key itself is set.
 *
 * Self-references are dropped here (cheap — only needs the container's own
 * name) with a one-time-per-container warning, matching the "self-edge
 * already filtered" precondition the graph engine relies on. Unknown targets
 * and cross-agent edges are NOT validated here — target containers may not
 * be discovered yet — that validation is deferred to `buildDependencyGraph`
 * in the graph engine, which has the full fleet view.
 */
export function resolveDependsOnFromLabels(
  labels: Record<string, string>,
  containerName: string,
  options: ResolveDependsOnOptions = {},
): ResolvedDependsOn {
  const warn = options.warn || ((message: string) => log.warn(message));
  const warnedSelfReferences = options.warnedSelfReferences || warnedDependsOnSelfReferences;
  const warnedInvalidActions = options.warnedInvalidActions || warnedInvalidDependsOnActions;

  const rawAction = getLabel(labels, ddDependsOnAction);
  let dependsOnAction: 'update' | 'restart' | undefined;
  if (rawAction !== undefined) {
    if (rawAction === 'update' || rawAction === 'restart') {
      dependsOnAction = rawAction;
    } else {
      const warnKey = `${containerName}:${rawAction}`;
      if (!warnedInvalidActions.has(warnKey)) {
        warnedInvalidActions.add(warnKey);
        warn(
          `Container "${containerName}" sets "${ddDependsOnAction}" to an unrecognized value "${rawAction}" (expected "update" or "restart"). Falling back to "update".`,
        );
      }
      dependsOnAction = 'update';
    }
  }

  const rawDependsOn = getLabel(labels, ddDependsOn);
  if (rawDependsOn === undefined) {
    return { dependsOnAction };
  }

  const dependsOn = parseDependsOnNames(rawDependsOn).filter((name) => {
    if (name !== containerName) {
      return true;
    }
    if (!warnedSelfReferences.has(containerName)) {
      warnedSelfReferences.add(containerName);
      warn(
        `Container "${containerName}" lists itself in "${ddDependsOn}" — self-reference dropped.`,
      );
    }
    return false;
  });

  return { dependsOn, dependsOnAction: dependsOnAction ?? 'update' };
}

/**
 * Combine label-based and compose-based dependency detection per the
 * detection precedence in the design: label wins outright (no merge), else
 * fall back to the compose service's own `depends_on` (read-only, via
 * `resolveComposeDependsOn`), else no dependencies.
 *
 * Async because compose detection reads a file. Only called from the full
 * discovery/refresh path (`docker-image-details-orchestration.ts`) — the
 * lightweight Docker-event label-refresh path applies the label-only half
 * (`resolveDependsOnFromLabels`) directly, matching the existing precedent
 * for other compose/imgset-derived fields that aren't re-derived on events.
 */
export async function resolveContainerDependsOn(
  labels: Record<string, string>,
  containerName: string,
  options: ResolveDependsOnOptions & {
    resolveComposeDependsOn?: (
      container: { labels?: Record<string, string> },
      composeOptions?: { dockerApi?: DockerApiBindMountInspector },
    ) => Promise<{ dependsOn: string[]; warnings: string[] }>;
    /**
     * The watched watcher's own Docker API, forwarded to compose-based
     * detection so it can translate the compose project labels' HOST-side
     * paths into drydock's own in-container view via its bind mounts (see
     * `compose-dependency-resolver.ts`) — without it, compose detection
     * silently no-ops whenever drydock itself runs containerized.
     */
    dockerApi?: DockerApiBindMountInspector;
  } = {},
): Promise<ContainerDependsOnResolution> {
  const labelResult = resolveDependsOnFromLabels(labels, containerName, options);
  if (labelResult.dependsOn !== undefined) {
    return {
      dependsOn: labelResult.dependsOn,
      dependsOnSource: 'label',
      // Always resolved (never undefined) whenever dependsOn is — see
      // resolveDependsOnFromLabels's return contract.
      dependsOnAction: labelResult.dependsOnAction,
    };
  }

  const resolveCompose = options.resolveComposeDependsOn || resolveComposeDependsOnDefault;
  const composeResult = await resolveCompose({ labels }, { dockerApi: options.dockerApi });
  if (composeResult.warnings.length > 0) {
    const warn = options.warn || ((message: string) => log.warn(message));
    for (const warning of composeResult.warnings) {
      warn(warning);
    }
  }

  if (composeResult.dependsOn.length === 0) {
    return { dependsOnAction: labelResult.dependsOnAction };
  }

  return {
    dependsOn: composeResult.dependsOn,
    dependsOnSource: 'compose',
    dependsOnAction: labelResult.dependsOnAction ?? 'update',
  };
}

function resolveLookupImageFromContainerLabels(
  containerLabels: Record<string, string>,
  overrides: ContainerLabelOverrides,
) {
  return (
    overrides.registryLookupImage ||
    getLabel(containerLabels, ddRegistryLookupImage) ||
    overrides.registryLookupUrl ||
    getLabel(containerLabels, ddRegistryLookupUrl)
  );
}

export function mergeConfigWithImgset(
  labelOverrides: ResolvedContainerLabelOverrides,
  matchingImgset: ResolvedImgset | undefined,
  containerLabels: Record<string, string>,
  watcherTagDefaults: WatcherTagDefaults = {},
) {
  return {
    includeTags: getContainerConfigValue(labelOverrides.includeTags, matchingImgset?.includeTags),
    excludeTags: getContainerConfigValue(labelOverrides.excludeTags, matchingImgset?.excludeTags),
    transformTags: getContainerConfigValue(
      labelOverrides.transformTags,
      matchingImgset?.transformTags,
    ),
    tagFamily:
      getContainerConfigValue(labelOverrides.tagFamily, matchingImgset?.tagFamily) ||
      getContainerConfigValue(undefined, watcherTagDefaults.family) ||
      'strict',
    tagPinInfo:
      getContainerConfigBooleanValue(
        labelOverrides.tagPinInfo,
        matchingImgset?.tagPinInfo,
        watcherTagDefaults.pin?.info,
      ) ?? true,
    linkTemplate: getContainerConfigValue(
      labelOverrides.linkTemplate,
      matchingImgset?.linkTemplate,
    ),
    displayName: getContainerConfigValue(labelOverrides.displayName, matchingImgset?.displayName),
    displayIcon: getContainerConfigValue(labelOverrides.displayIcon, matchingImgset?.displayIcon),
    // Imgset trigger.include/trigger.exclude are NOT category-split (by design — see
    // #494 spec) and sit beneath the per-container labels as a category-agnostic
    // fallback, applied to whichever category (action, notification, or the
    // deprecated mirror) has no label-level value of its own.
    actionTriggerInclude: getContainerConfigValue(
      labelOverrides.actionTriggerInclude,
      matchingImgset?.triggerInclude,
    ),
    actionTriggerExclude: getContainerConfigValue(
      labelOverrides.actionTriggerExclude,
      matchingImgset?.triggerExclude,
    ),
    notificationTriggerInclude: getContainerConfigValue(
      labelOverrides.notificationTriggerInclude,
      matchingImgset?.triggerInclude,
    ),
    notificationTriggerExclude: getContainerConfigValue(
      labelOverrides.notificationTriggerExclude,
      matchingImgset?.triggerExclude,
    ),
    // No imgset counterpart (unlike triggerInclude/triggerExclude above) —
    // dd.action.auto is action-only and imgsets don't carry a matching key.
    actionTriggerAuto: labelOverrides.actionTriggerAuto,
    triggerInclude: getContainerConfigValue(
      labelOverrides.triggerInclude,
      matchingImgset?.triggerInclude,
    ),
    triggerExclude: getContainerConfigValue(
      labelOverrides.triggerExclude,
      matchingImgset?.triggerExclude,
    ),
    lookupImage:
      getContainerConfigValue(labelOverrides.lookupImage, matchingImgset?.registryLookupImage) ||
      getContainerConfigValue(undefined, matchingImgset?.registryLookupUrl),
    inspectTagPath: getContainerConfigValue(
      labelOverrides.inspectTagPath,
      matchingImgset?.inspectTagPath,
    ),
    inspectTagVersionOnly: labelOverrides.inspectTagVersionOnly,
    portLabel: labelOverrides.portLabel,
    watchDigest: getContainerConfigValue(
      getLabel(containerLabels, ddWatchDigest),
      matchingImgset?.watchDigest,
    ),
  };
}

function getImgsetMatchCandidate(
  imgsetName: string,
  imgsetConfiguration: unknown,
  parsedImage: unknown,
): ImgsetMatchCandidate | undefined {
  const imagePattern = getFirstConfigString(imgsetConfiguration, ['image', 'match']);
  if (!imagePattern) {
    return undefined;
  }

  const specificity = getImgsetSpecificity(imagePattern, parsedImage);
  if (specificity < 0) {
    return undefined;
  }

  return {
    specificity,
    imgset: getResolvedImgsetConfiguration(imgsetName, imgsetConfiguration),
  };
}

function isBetterImgsetMatch(candidate: ImgsetMatchCandidate, currentBest: ImgsetMatchCandidate) {
  if (candidate.specificity !== currentBest.specificity) {
    return candidate.specificity > currentBest.specificity;
  }

  return candidate.imgset.name.localeCompare(currentBest.imgset.name) < 0;
}

export function getMatchingImgsetConfiguration(
  parsedImage: unknown,
  configuredImgsets: DockerImgsetConfigurations | undefined,
): ResolvedImgset | undefined {
  if (!configuredImgsets || typeof configuredImgsets !== 'object') {
    return undefined;
  }

  let bestMatch: ImgsetMatchCandidate | undefined;
  for (const [imgsetName, imgsetConfiguration] of Object.entries(configuredImgsets)) {
    const candidate = getImgsetMatchCandidate(imgsetName, imgsetConfiguration, parsedImage);
    if (!candidate) {
      continue;
    }

    if (!bestMatch || isBetterImgsetMatch(candidate, bestMatch)) {
      bestMatch = candidate;
    }
  }

  return bestMatch?.imgset;
}
