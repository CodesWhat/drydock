import path from 'node:path';
import { getAgent } from '../agent/manager.js';
import type { Container } from '../model/container.js';
import type Docker from '../triggers/providers/docker/Docker.js';
import type Trigger from '../triggers/providers/Trigger.js';

export const NO_DOCKER_TRIGGER_FOUND_ERROR = 'No docker trigger found for this container';
export const AGENT_LIFECYCLE_UNSUPPORTED_ERROR =
  "Lifecycle actions (start/stop/restart) are not supported over this container's agent connection, typically because the agent has not advertised the usesControllerDockerTransport capability.";
const DEFAULT_TRIGGER_TYPES = ['docker', 'dockercompose', 'portainer'];
const COMPOSE_DIRECTORY_FILE_CANDIDATES = new Set([
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml',
]);
const AMBIGUOUS_COMPOSE_PARENT_SEGMENTS = new Set([
  'app',
  'apps',
  'compose',
  'docker',
  'service',
  'services',
  'stack',
  'stacks',
]);

interface FindDockerTriggerForContainerOptions {
  triggerTypes?: string[];
}

export interface DockerTriggerCandidate {
  type: string;
  agent?: string;
  configuration?: object;
  getDefaultComposeFilePath?: () => string | null;
  getComposeFilesForContainer?: (container: {
    name?: string;
    labels?: Record<string, string>;
    watcher?: string;
  }) => string[];
}

type TriggerWithComposeAffinity = DockerTriggerCandidate;

export type ContainerTriggerContext = Pick<Container, 'agent' | 'labels'> &
  Partial<Pick<Container, 'name' | 'watcher'>>;

/**
 * Relative specificity of a compatible docker/dockercompose/portainer trigger, used by
 * `model/action-policy.ts`'s `selectActionTrigger` to rank multiple
 * compatible candidates (spec-6.0.1-action-policy.md decision 3): a
 * dockercompose trigger whose configured file was actually verified against
 * one of the container's own compose files outranks a dockercompose trigger
 * that matched only because it has no configured file (or because the
 * container's compose files couldn't be determined), which in turn outranks
 * a generic (non-compose) docker trigger. Ties within a tier are broken by
 * registry insertion order at the call site.
 */
export type DockerTriggerSpecificity =
  | 'compose-file-matched'
  | 'compose-catch-all'
  | 'docker-generic';

function normalizeComposeFilePath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  return normalized;
}

function getConfiguredComposeFilePath(trigger: TriggerWithComposeAffinity): string | null {
  if (typeof trigger.getDefaultComposeFilePath === 'function') {
    const composeFileFromMethod = normalizeComposeFilePath(trigger.getDefaultComposeFilePath());
    if (composeFileFromMethod) {
      return composeFileFromMethod;
    }
  }
  return normalizeComposeFilePath((trigger.configuration as { file?: unknown } | undefined)?.file);
}

function getComposeFilesForContainer(
  trigger: TriggerWithComposeAffinity,
  container: ContainerTriggerContext,
): string[] {
  if (typeof trigger.getComposeFilesForContainer === 'function') {
    return trigger
      .getComposeFilesForContainer(container)
      .map((composeFilePath) => normalizeComposeFilePath(composeFilePath))
      .filter((composeFilePath): composeFilePath is string => composeFilePath !== null);
  }
  return [];
}

function doesComposeFileMatchConfiguredFile(
  composeFilePath: string,
  configuredComposeFilePath: string,
): boolean {
  const normalizedComposeFilePath = path.normalize(composeFilePath);
  const normalizedConfiguredComposeFilePath = path.normalize(configuredComposeFilePath);
  if (normalizedComposeFilePath === normalizedConfiguredComposeFilePath) {
    return true;
  }

  const configuredDirectoryPrefix = normalizedConfiguredComposeFilePath.endsWith(path.sep)
    ? normalizedConfiguredComposeFilePath
    : `${normalizedConfiguredComposeFilePath}${path.sep}`;
  if (!normalizedComposeFilePath.startsWith(configuredDirectoryPrefix)) {
    return doesComposeFilePathSuffixMatchConfiguredPath(
      normalizedComposeFilePath,
      normalizedConfiguredComposeFilePath,
    );
  }

  return COMPOSE_DIRECTORY_FILE_CANDIDATES.has(path.basename(normalizedComposeFilePath));
}

function splitPathSegments(composeFilePath: string): string[] {
  return path
    .normalize(composeFilePath)
    .split(path.sep)
    .filter((segment) => segment.length > 0 && segment !== '.');
}

function countCommonPathSuffixSegments(leftSegments: string[], rightSegments: string[]): number {
  const maxComparableSegments = Math.min(leftSegments.length, rightSegments.length);
  let commonSuffixSegmentCount = 0;

  while (commonSuffixSegmentCount < maxComparableSegments) {
    const leftSegment = leftSegments[leftSegments.length - commonSuffixSegmentCount - 1];
    const rightSegment = rightSegments[rightSegments.length - commonSuffixSegmentCount - 1];
    if (leftSegment !== rightSegment) {
      break;
    }
    commonSuffixSegmentCount += 1;
  }

  return commonSuffixSegmentCount;
}

function hasAmbiguousSingleDirectorySuffixMatch(
  leftSegments: string[],
  rightSegments: string[],
  commonSuffixSegmentCount: number,
): boolean {
  if (commonSuffixSegmentCount !== 2) {
    return false;
  }

  const parentSegment = leftSegments[leftSegments.length - 2];
  return (
    parentSegment === rightSegments[rightSegments.length - 2] &&
    AMBIGUOUS_COMPOSE_PARENT_SEGMENTS.has(parentSegment.toLowerCase())
  );
}

function hasAmbiguousSingleSegmentDirectoryMatch(
  leftSegments: string[],
  rightSegments: string[],
  commonSuffixSegmentCount: number,
): boolean {
  if (commonSuffixSegmentCount !== 1) {
    return false;
  }

  const lastSegment = leftSegments[leftSegments.length - 1];
  return (
    lastSegment === rightSegments[rightSegments.length - 1] &&
    AMBIGUOUS_COMPOSE_PARENT_SEGMENTS.has(lastSegment.toLowerCase())
  );
}

function doesComposeFilePathSuffixMatchConfiguredPath(
  composeFilePath: string,
  configuredComposeFilePath: string,
): boolean {
  const composeFileSegments = splitPathSegments(composeFilePath);
  const configuredPathSegments = splitPathSegments(configuredComposeFilePath);
  const composeFileName = path.basename(composeFilePath);
  const configuredPathFileName = path.basename(configuredComposeFilePath);
  const hasGenericComposeFileName =
    COMPOSE_DIRECTORY_FILE_CANDIDATES.has(composeFileName) ||
    COMPOSE_DIRECTORY_FILE_CANDIDATES.has(configuredPathFileName);

  const composeFileCommonSuffixSegments = countCommonPathSuffixSegments(
    composeFileSegments,
    configuredPathSegments,
  );
  const requiredFileSuffixSegments = hasGenericComposeFileName ? 2 : 1;
  if (
    composeFileCommonSuffixSegments >= requiredFileSuffixSegments &&
    !hasAmbiguousSingleDirectorySuffixMatch(
      composeFileSegments,
      configuredPathSegments,
      composeFileCommonSuffixSegments,
    )
  ) {
    return true;
  }

  if (!COMPOSE_DIRECTORY_FILE_CANDIDATES.has(composeFileName)) {
    return false;
  }

  const composeDirectorySegments = splitPathSegments(path.dirname(composeFilePath));
  const composeDirectoryCommonSuffixSegments = countCommonPathSuffixSegments(
    composeDirectorySegments,
    configuredPathSegments,
  );
  if (
    composeDirectoryCommonSuffixSegments >= 1 &&
    !hasAmbiguousSingleSegmentDirectoryMatch(
      composeDirectorySegments,
      configuredPathSegments,
      composeDirectoryCommonSuffixSegments,
    )
  ) {
    return true;
  }
  return false;
}

function isTriggerAgentCompatible(
  trigger: Pick<DockerTriggerCandidate, 'type' | 'agent'>,
  container: ContainerTriggerContext,
): boolean {
  if (trigger.agent && trigger.agent !== container.agent) {
    return false;
  }
  if (
    container.agent &&
    !trigger.agent &&
    ['docker', 'dockercompose', 'portainer'].includes(trigger.type)
  ) {
    return false;
  }
  return true;
}

function isComposeTriggerCompatibleWithContainer(
  trigger: TriggerWithComposeAffinity,
  container: ContainerTriggerContext,
): boolean {
  const configuredComposeFilePath = getConfiguredComposeFilePath(trigger);
  if (!configuredComposeFilePath) {
    return true;
  }

  const composeFilesForContainer = getComposeFilesForContainer(trigger, container);
  if (composeFilesForContainer.length === 0) {
    return true;
  }

  return composeFilesForContainer.some((composeFilePath) =>
    doesComposeFileMatchConfiguredFile(composeFilePath, configuredComposeFilePath),
  );
}

export function isTriggerCompatibleWithContainer(
  trigger: DockerTriggerCandidate,
  container: ContainerTriggerContext,
): boolean {
  if (!isTriggerAgentCompatible(trigger, container)) {
    return false;
  }

  if (trigger.type === 'dockercompose') {
    return isComposeTriggerCompatibleWithContainer(
      trigger as TriggerWithComposeAffinity,
      container,
    );
  }

  return true;
}

/**
 * Compute a compatible trigger's specificity tier for the hybrid
 * multi-trigger walk (`model/action-policy.ts`'s `selectActionTrigger`).
 * Callers are expected to have already filtered to compatible triggers via
 * `isTriggerCompatibleWithContainer` — a dockercompose trigger with a
 * configured file that does NOT match the container's compose files would
 * already have been excluded there, so `'compose-file-matched'` is the only
 * reachable outcome once a configured file and a non-empty compose-file list
 * are both present.
 */
export function getDockerTriggerSpecificity(
  trigger: DockerTriggerCandidate,
  container: ContainerTriggerContext,
): DockerTriggerSpecificity {
  if (trigger.type !== 'dockercompose') {
    return 'docker-generic';
  }

  const configuredComposeFilePath = getConfiguredComposeFilePath(trigger);
  if (!configuredComposeFilePath) {
    return 'compose-catch-all';
  }

  const composeFilesForContainer = getComposeFilesForContainer(trigger, container);
  if (composeFilesForContainer.length === 0) {
    return 'compose-catch-all';
  }

  const isVerifiedMatch = composeFilesForContainer.some((composeFilePath) =>
    doesComposeFileMatchConfiguredFile(composeFilePath, configuredComposeFilePath),
  );
  return isVerifiedMatch ? 'compose-file-matched' : 'compose-catch-all';
}

/**
 * Whether lifecycle actions (start/stop/restart/rollback) are unsupported for
 * an agent-owned container, decided from the agent's actual advertised
 * capability rather than trigger presence/absence:
 *
 * - No agent on the container: never unsupported (non-agent containers are
 *   handled by the plain docker-trigger lookup).
 * - Agent not currently connected/registered: not decided here; the caller's
 *   docker-trigger lookup will report the honest transient 404 instead.
 * - Agent connected but its watcher hasn't advertised controller Docker
 *   transport: unsupported, regardless of whether a legacy AgentTrigger is
 *   still registered for it (that trigger's getWatcher()/rollback methods
 *   throw rather than working).
 */
export function isAgentLifecycleUnsupported(
  container: Pick<Container, 'agent' | 'watcher'>,
): boolean {
  if (!container.agent) {
    return false;
  }
  const agentClient = getAgent(container.agent);
  if (!agentClient) {
    return false;
  }
  return !agentClient.hasControllerDockerTransport(container.watcher);
}

/**
 * Find a docker trigger compatible with a container's agent context.
 */
export function findDockerTriggerForContainer(
  triggers: Record<string, Trigger> | undefined,
  container: ContainerTriggerContext,
  options: FindDockerTriggerForContainerOptions = {},
): Docker | undefined {
  if (!triggers) {
    return undefined;
  }
  const triggerTypes = new Set(options.triggerTypes || DEFAULT_TRIGGER_TYPES);

  for (const trigger of Object.values(triggers)) {
    if (!triggerTypes.has(trigger.type)) {
      continue;
    }
    if (!isTriggerCompatibleWithContainer(trigger, container)) {
      continue;
    }
    return trigger as Docker;
  }
  return undefined;
}
