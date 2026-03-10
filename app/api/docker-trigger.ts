import type { Container } from '../model/container.js';
import type Docker from '../triggers/providers/docker/Docker.js';
import type Trigger from '../triggers/providers/Trigger.js';

export const NO_DOCKER_TRIGGER_FOUND_ERROR = 'No docker trigger found for this container';
const DEFAULT_TRIGGER_TYPES = ['docker', 'dockercompose'];

interface FindDockerTriggerForContainerOptions {
  triggerTypes?: string[];
}

/**
 * Find a docker trigger compatible with a container's agent context.
 */
export function findDockerTriggerForContainer(
  triggers: Record<string, Trigger> | undefined,
  container: Pick<Container, 'agent'>,
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
    if (trigger.agent && trigger.agent !== container.agent) {
      continue;
    }
    if (container.agent && !trigger.agent) {
      continue;
    }
    return trigger as Docker;
  }
  return undefined;
}
