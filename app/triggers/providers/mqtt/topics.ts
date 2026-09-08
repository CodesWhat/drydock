import { getContainerIdentitySlug } from './naming.js';

/**
 * The single source of truth for MQTT container/watcher topic construction,
 * shared by the state-payload publisher (`Mqtt.ts`) and the Home Assistant
 * discovery publisher (`Hass.ts`).
 *
 * #386 added the `agent/<name>` segment in `Hass.ts` only, so the discovery
 * payload named `<topic>/agent/<agent>/<watcher>/<container>` as its
 * `state_topic` while `Mqtt.trigger` kept publishing the container payload to
 * `<topic>/<watcher>/<container>`. An agent-owned container's Home Assistant
 * entity was therefore created but never fed, sitting permanently on
 * "Unknown". Both sides now call these helpers so the two topics cannot drift
 * apart again.
 */

/**
 * `''` and non-strings both mean "not owned by an agent", so an empty agent
 * name can never produce an `agent//` segment (#386).
 */
export function normalizeAgentValue(agent: unknown): string | undefined {
  if (typeof agent !== 'string') {
    return undefined;
  }
  return agent === '' ? undefined : agent;
}

/**
 * The topic prefix every container and watcher-level topic hangs off.
 * The `agent/<name>` segment is inserted only when the caller has the agent
 * topic segment enabled AND the subject actually belongs to an agent, so
 * controller-local topics are byte-identical either way.
 */
export function getWatcherTopicPrefix({
  baseTopic,
  watcherName,
  agentName,
  agentTopicSegment,
}: {
  baseTopic: string;
  watcherName: string;
  agentName?: string;
  agentTopicSegment?: boolean;
}): string {
  if (agentTopicSegment && agentName) {
    return `${baseTopic}/agent/${agentName}/${watcherName}`;
  }
  return `${baseTopic}/${watcherName}`;
}

/**
 * A container state topic built from an explicit container segment. Used for
 * the current topic and for the stale rename/recreate alias topics whose
 * retained discovery configs get cleaned up, so both live in the same agent
 * namespace.
 */
export function getContainerStateTopicFromName({
  baseTopic,
  watcherName,
  containerName,
  agentName,
  agentTopicSegment,
}: {
  baseTopic: string;
  watcherName: string;
  containerName: string;
  agentName?: string;
  agentTopicSegment?: boolean;
}): string {
  return `${getWatcherTopicPrefix({ baseTopic, watcherName, agentName, agentTopicSegment })}/${containerName}`;
}

/**
 * A container's state topic, keyed by durable identity
 * (`getContainerIdentitySlug`) rather than by its current name.
 */
export function getContainerStateTopic({
  baseTopic,
  container,
  agentTopicSegment,
}: {
  baseTopic: string;
  container: Parameters<typeof getContainerIdentitySlug>[0] & {
    watcher?: unknown;
    agent?: unknown;
  };
  agentTopicSegment?: boolean;
}): string {
  return getContainerStateTopicFromName({
    baseTopic,
    watcherName: container.watcher as string,
    containerName: getContainerIdentitySlug(container),
    agentName: normalizeAgentValue(container?.agent),
    agentTopicSegment,
  });
}
