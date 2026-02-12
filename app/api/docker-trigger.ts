// @ts-nocheck

export const NO_DOCKER_TRIGGER_FOUND_ERROR = 'No docker trigger found for this container';

/**
 * Find a docker trigger compatible with a container's agent context.
 */
export function findDockerTriggerForContainer(triggers, container) {
  for (const trigger of Object.values(triggers || {})) {
    if (trigger.type !== 'docker') {
      continue;
    }
    if (trigger.agent && trigger.agent !== container.agent) {
      continue;
    }
    if (container.agent && !trigger.agent) {
      continue;
    }
    return trigger;
  }
  return undefined;
}
