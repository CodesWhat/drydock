import path from 'node:path';
import type { Container } from '../model/container.js';
import type Docker from '../triggers/providers/docker/Docker.js';
import type Trigger from '../triggers/providers/Trigger.js';

export const NO_DOCKER_TRIGGER_FOUND_ERROR = 'No docker trigger found for this container';
const DEFAULT_TRIGGER_TYPES = ['docker', 'dockercompose'];
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

interface DockerTriggerCandidate {
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

type ContainerTriggerContext = Pick<Container, 'agent' | 'labels'> &
  Partial<Pick<Container, 'name' | 'watcher'>>;

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
  if (container.agent && !trigger.agent && ['docker', 'dockercompose'].includes(trigger.type)) {
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
