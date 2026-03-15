import type { Container } from '../../model/container.js';
import { getImageReferenceCandidatesFromPattern } from '../../watchers/providers/docker/docker-helpers.js';
import type { RegistryWebhookReference } from './parsers/types.js';

interface RegistryWebhookWatcher {
  watchContainer: (container: Container) => Promise<unknown>;
}

export interface RegistryWebhookDispatchResult {
  referencesMatched: number;
  containersMatched: number;
  checksTriggered: number;
  checksFailed: number;
  watchersMissing: number;
}

interface RunRegistryWebhookDispatchInput {
  references: RegistryWebhookReference[];
  containers: Container[];
  watchers: Record<string, RegistryWebhookWatcher>;
  markContainerFresh: (containerId: string) => void;
}

function normalizeHost(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }

  const raw = value.trim().toLowerCase();
  let host = raw;

  try {
    const parsed = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
    host = parsed.hostname || parsed.host || host;
  } catch {
    const withoutScheme = raw.replace(/^https?:\/\//, '');
    host = withoutScheme.split('/')[0] || withoutScheme;
  }

  if (host === 'registry-1.docker.io' || host === 'index.docker.io') {
    return 'docker.io';
  }
  return host;
}

function getContainerImageCandidates(container: Container): Set<string> {
  const candidates = new Set<string>();
  const imageName = typeof container.image?.name === 'string' ? container.image.name : '';
  const registryUrl = normalizeHost(container.image?.registry?.url);

  if (imageName) {
    for (const candidate of getImageReferenceCandidatesFromPattern(imageName)) {
      candidates.add(candidate.toLowerCase());
    }
  }

  if (imageName && registryUrl) {
    for (const candidate of getImageReferenceCandidatesFromPattern(`${registryUrl}/${imageName}`)) {
      candidates.add(candidate.toLowerCase());
    }
  }

  return candidates;
}

function getReferenceCandidates(reference: RegistryWebhookReference): Set<string> {
  return new Set(
    getImageReferenceCandidatesFromPattern(reference.image).map((candidate) =>
      candidate.toLowerCase(),
    ),
  );
}

function hasCandidateIntersection(left: Set<string>, right: Set<string>): boolean {
  for (const value of left.values()) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

export function findContainersForImageReferences(
  containers: Container[],
  references: RegistryWebhookReference[],
): Container[] {
  if (containers.length === 0 || references.length === 0) {
    return [];
  }

  const referencesCandidates = references.map((reference) => getReferenceCandidates(reference));
  const matchedContainers = new Map<string, Container>();

  for (const container of containers) {
    const containerCandidates = getContainerImageCandidates(container);
    const isMatch = referencesCandidates.some((referenceCandidates) =>
      hasCandidateIntersection(containerCandidates, referenceCandidates),
    );
    if (isMatch) {
      matchedContainers.set(container.id, container);
    }
  }

  return Array.from(matchedContainers.values());
}

export function resolveWatcherIdForContainer(container: Container): string {
  let watcherId = `docker.${container.watcher}`;
  if (container.agent) {
    watcherId = `${container.agent}.${watcherId}`;
  }
  return watcherId;
}

export async function runRegistryWebhookDispatch({
  references,
  containers,
  watchers,
  markContainerFresh,
}: RunRegistryWebhookDispatchInput): Promise<RegistryWebhookDispatchResult> {
  const matchingContainers = findContainersForImageReferences(containers, references);

  let checksTriggered = 0;
  let checksFailed = 0;
  let watchersMissing = 0;

  await Promise.all(
    matchingContainers.map(async (container) => {
      const watcher = watchers[resolveWatcherIdForContainer(container)];
      if (!watcher || typeof watcher.watchContainer !== 'function') {
        watchersMissing += 1;
        return;
      }

      try {
        await watcher.watchContainer(container);
        checksTriggered += 1;
        markContainerFresh(container.id);
      } catch {
        checksFailed += 1;
      }
    }),
  );

  return {
    referencesMatched: references.length,
    containersMatched: matchingContainers.length,
    checksTriggered,
    checksFailed,
    watchersMissing,
  };
}
