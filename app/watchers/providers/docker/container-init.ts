import { getPreferredLabelValue } from '../../../docker/legacy-label.js';
import log from '../../../log/index.js';
import type { Container, TriggerCategory } from '../../../model/container.js';
import { recordLegacyInput } from '../../../prometheus/compatibility.js';
import * as registry from '../../../registry/index.js';
import * as storeContainer from '../../../store/container.js';
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
  ddActionExclude,
  ddActionInclude,
  ddDisplayIcon,
  ddDisplayName,
  ddInspectTagPath,
  ddInspectTagVersionOnly,
  ddLinkTemplate,
  ddNotificationExclude,
  ddNotificationInclude,
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
  wudDisplayIcon,
  wudDisplayName,
  wudInspectTagPath,
  wudLinkTemplate,
  wudRegistryLookupImage,
  wudRegistryLookupUrl,
  wudTagExclude,
  wudTagInclude,
  wudTagTransform,
  wudTriggerExclude,
  wudTriggerInclude,
  wudWatchDigest,
} from './label.js';
import {
  type ResolvedTriggerLabelValues,
  resolveTriggerLabelValuesPure,
} from './trigger-label-resolution.js';

const warnedLegacyLabelFallbacks = new Set<string>();
const warnedLegacyTriggerLabelFallbacks = new Set<string>();
const warnedTriggerCategoryScopeChanges = new Set<string>();
const RECREATED_CONTAINER_NAME_PATTERN = /^([a-f0-9]{12})_(.+)$/i;
const RECREATED_CONTAINER_ALIAS_TRANSIENT_WINDOW_MS = 30 * 1000;

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
  displayName?: string;
  displayIcon?: string;
  actionTriggerInclude?: string;
  actionTriggerExclude?: string;
  notificationTriggerInclude?: string;
  notificationTriggerExclude?: string;
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
  { key: 'includeTags', ddKey: ddTagInclude, wudKey: wudTagInclude, overrideKey: 'includeTags' },
  { key: 'excludeTags', ddKey: ddTagExclude, wudKey: wudTagExclude, overrideKey: 'excludeTags' },
  {
    key: 'transformTags',
    ddKey: ddTagTransform,
    wudKey: wudTagTransform,
    overrideKey: 'transformTags',
  },
  {
    key: 'tagFamily',
    ddKey: ddTagFamily,
    wudKey: undefined,
    overrideKey: 'tagFamily',
  },
  {
    key: 'tagPinInfo',
    ddKey: ddTagPinInfo,
    wudKey: undefined,
    overrideKey: 'tagPinInfo',
  },
  {
    key: 'inspectTagPath',
    ddKey: ddInspectTagPath,
    wudKey: wudInspectTagPath,
    overrideKey: undefined,
  },
  {
    key: 'inspectTagVersionOnly',
    ddKey: ddInspectTagVersionOnly,
    wudKey: undefined,
    overrideKey: undefined,
  },
  {
    key: 'linkTemplate',
    ddKey: ddLinkTemplate,
    wudKey: wudLinkTemplate,
    overrideKey: 'linkTemplate',
  },
  { key: 'displayName', ddKey: ddDisplayName, wudKey: wudDisplayName, overrideKey: 'displayName' },
  { key: 'displayIcon', ddKey: ddDisplayIcon, wudKey: wudDisplayIcon, overrideKey: 'displayIcon' },
  // Trigger include/exclude are NOT in this generic table: dd.action.*/dd.notification.*/
  // dd.trigger.* resolve into 4 category-scoped fields plus a deprecated mirror, which
  // doesn't fit the single dd/wud key-pair shape below. See resolveTriggerLabelOverrides().
] as const satisfies ReadonlyArray<{
  key: keyof ResolvedContainerLabelOverrides;
  ddKey: string;
  wudKey?: string;
  overrideKey?: ContainerLabelOverrideKey;
}>;

/**
 * Get a label value, preferring the dd.* key over the wud.* fallback.
 */
export function getLabel(
  labels: Record<string, string>,
  ddKey: string,
  wudKey?: string,
  options: GetLabelOptions = {},
) {
  return getPreferredLabelValue(labels, ddKey, wudKey, {
    warnedFallbacks: warnedLegacyLabelFallbacks,
    warn: options.warn || ((message) => log.warn(message)),
  });
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
    `Legacy Docker label "${ddKey}" is deprecated. Please migrate to "dd.action.${aliasKeySuffix}" or "dd.notification.${aliasKeySuffix}" before removal in v1.7.0.`,
  );
}

/**
 * Resolve one direction (include or exclude) of the trigger labels into its
 * category-scoped values plus the deprecated compat mirror.
 *
 * `dd.trigger.<dir>` is a per-category fallback: it only fills in a category
 * whose own scoped label (`dd.action.<dir>` / `dd.notification.<dir>`) is
 * absent — it never overrides a scoped label that is present. `wud.trigger.<dir>`
 * is used only when none of `dd.action.<dir>` / `dd.notification.<dir>` /
 * `dd.trigger.<dir>` are present at all, matching the existing
 * getPreferredLabelValue fallback semantics.
 *
 * The numeric resolution itself is delegated to the dependency-free
 * `resolveTriggerLabelValuesPure()` — this wrapper only adds the
 * warn/telemetry side effects for the legacy `dd.trigger.<dir>` and
 * `wud.trigger.<dir>` labels.
 */
function resolveTriggerLabelValues(
  labels: Record<string, string>,
  direction: 'include' | 'exclude',
  options: GetLabelOptions,
): ResolvedTriggerLabelValues {
  const ddLegacyKey = direction === 'include' ? ddTriggerInclude : ddTriggerExclude;
  const wudLegacyKey = direction === 'include' ? wudTriggerInclude : wudTriggerExclude;

  const actionValue = labels[direction === 'include' ? ddActionInclude : ddActionExclude];
  const notificationValue =
    labels[direction === 'include' ? ddNotificationInclude : ddNotificationExclude];
  const legacyValue = labels[ddLegacyKey];
  const warn = options.warn || ((message) => log.warn(message));

  if (actionValue === undefined && notificationValue === undefined && legacyValue === undefined) {
    const wudValue = getPreferredLabelValue(labels, ddLegacyKey, wudLegacyKey, {
      warnedFallbacks: warnedLegacyLabelFallbacks,
      warn,
    });
    return wudValue !== undefined
      ? { action: wudValue, notification: wudValue, mirror: wudValue }
      : {};
  }

  if (legacyValue !== undefined) {
    const warnedLegacyTriggerLabels =
      options.warnedLegacyTriggerLabels || warnedLegacyTriggerLabelFallbacks;
    recordLegacyInput('label', ddLegacyKey);
    warnLegacyTriggerLabel(ddLegacyKey, warnedLegacyTriggerLabels, warn);
  }

  return resolveTriggerLabelValuesPure(labels, direction);
}

/**
 * Resolve one direction, reusing already-resolved `overrides` rather than
 * re-reading the labels when every value for that direction is present.
 *
 * The skip is load-bearing, not an optimization. A newly-discovered container is
 * resolved twice over the same labels — once in Docker.ts to build the override
 * bag, then again here via resolveLabelsFromContainer — and resolveTriggerLabelValues
 * has side effects (recordLegacyInput, deprecation warn). Without the short-circuit
 * a deprecated dd.trigger.* label increments the legacy-input metric twice per
 * container. The old per-key `override || getLabel(...)` loop skipped the second
 * read for exactly this reason.
 */
function resolveTriggerLabelDirection(
  containerLabels: Record<string, string>,
  direction: 'include' | 'exclude',
  overrides: ContainerLabelOverrides,
  options: GetLabelOptions,
): ResolvedTriggerLabelValues {
  const [actionOverride, notificationOverride, mirrorOverride] =
    direction === 'include'
      ? [
          overrides.actionTriggerInclude,
          overrides.notificationTriggerInclude,
          overrides.triggerInclude,
        ]
      : [
          overrides.actionTriggerExclude,
          overrides.notificationTriggerExclude,
          overrides.triggerExclude,
        ];

  if (actionOverride && notificationOverride && mirrorOverride) {
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
 * triggerInclude/triggerExclude mirror. `overrides` (already-resolved values
 * from an earlier pass over the same labels) take priority, matching the
 * override-vs-label precedence used for every other label-derived field.
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
 * Containers that still exist in Docker (e.g. stopped) get their status updated
 * instead of being removed, so the UI can still show them with a start button.
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
  } = {},
) {
  const forceRemoveContainerIds = options.forceRemoveContainerIds || new Set<string>();
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

export function resolveLabelsFromContainer(
  containerLabels: Record<string, string>,
  overrides: ContainerLabelOverrides = {},
) {
  const resolvedOverrides: ResolvedContainerLabelOverrides = {
    lookupImage: resolveLookupImageFromContainerLabels(containerLabels, overrides),
    ...resolveTriggerLabelOverrides(containerLabels, overrides),
  };

  for (const { key, ddKey, wudKey, overrideKey } of containerLabelOverrideMappings) {
    const overrideValue = overrideKey ? overrides[overrideKey] : undefined;
    resolvedOverrides[key] = overrideValue || getLabel(containerLabels, ddKey, wudKey);
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
  container.actionTriggerInclude = resolved.actionTriggerInclude;
  container.actionTriggerExclude = resolved.actionTriggerExclude;
  container.notificationTriggerInclude = resolved.notificationTriggerInclude;
  container.notificationTriggerExclude = resolved.notificationTriggerExclude;
  container.triggerInclude = resolved.triggerInclude;
  container.triggerExclude = resolved.triggerExclude;
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
  const fallback = {
    tagFamily: container.tagFamily ?? watcherDefaults.family ?? 'strict',
    tagPinInfo: container.tagPinInfo ?? watcherDefaults.pin?.info ?? true,
  };
  if (!container.labels) {
    return fallback;
  }

  const labels = container.labels as Record<string, string>;
  return mergeConfigWithImgset(
    resolveLabelsFromContainer(labels),
    getMatchingImgset({
      path: container.image.name,
      domain: container.image.registry?.url,
    }),
    labels,
    watcherDefaults,
  );
}

export function applyEffectiveTagPolicyFromLabels(
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

function resolveLookupImageFromContainerLabels(
  containerLabels: Record<string, string>,
  overrides: ContainerLabelOverrides,
) {
  return (
    overrides.registryLookupImage ||
    getLabel(containerLabels, ddRegistryLookupImage, wudRegistryLookupImage) ||
    overrides.registryLookupUrl ||
    getLabel(containerLabels, ddRegistryLookupUrl, wudRegistryLookupUrl)
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
    watchDigest: getContainerConfigValue(
      getLabel(containerLabels, ddWatchDigest, wudWatchDigest),
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
