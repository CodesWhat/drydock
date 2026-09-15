import { getSanitizedCanonicalContainerName } from './naming.js';

// Shared by MQTT state publishing and Home Assistant discovery (#1139).
export function normalizeAgentValue(agent: unknown): string | undefined {
  if (typeof agent !== 'string') {
    return undefined;
  }
  return agent === '' ? undefined : agent;
}

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

export function getContainerStateTopic({
  baseTopic,
  container,
  agentTopicSegment,
}: {
  baseTopic: string;
  container: Parameters<typeof getSanitizedCanonicalContainerName>[0] & {
    watcher?: unknown;
    agent?: unknown;
  };
  agentTopicSegment?: boolean;
}): string {
  return getContainerStateTopicFromName({
    baseTopic,
    watcherName: container.watcher as string,
    containerName: getSanitizedCanonicalContainerName(container),
    agentName: normalizeAgentValue(container?.agent),
    agentTopicSegment,
  });
}
