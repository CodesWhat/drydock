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

interface FindDockerTriggerForContainerOptions {
  triggerTypes?: string[];
}

interface DockerTriggerCandidate {
  type: string;
  agent?: string;
  configuration?: Record<string, unknown>;
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
  return normalizeComposeFilePath(trigger.configuration?.file);
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
    return false;
  }

  return COMPOSE_DIRECTORY_FILE_CANDIDATES.has(path.basename(normalizedComposeFilePath));
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
