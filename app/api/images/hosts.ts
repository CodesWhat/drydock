import type { ContainerInfo, ImageInfo, PruneImagesInfo } from 'dockerode';

export interface ImageDockerApi {
  listImages(options?: Record<string, unknown>): Promise<ImageInfo[]>;
  listContainers(options?: Record<string, unknown>): Promise<ContainerInfo[]>;
  pruneImages(options?: Record<string, unknown>): Promise<PruneImagesInfo>;
}

export interface ImageHost {
  id: string;
  name: string;
  agent?: string;
  supported: boolean;
  reason?: 'agent-transport-unsupported';
  dockerApi?: ImageDockerApi;
}

interface WatcherLike {
  type?: unknown;
  name?: unknown;
  agent?: unknown;
  dockerApi?: unknown;
}

function isWatcherLike(value: unknown): value is WatcherLike {
  return !!value && typeof value === 'object';
}

export function isImageDockerApi(value: unknown): value is ImageDockerApi {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.listImages === 'function' &&
    typeof candidate.listContainers === 'function' &&
    typeof candidate.pruneImages === 'function'
  );
}

/**
 * Resolve every Docker watcher registered in the registry into an image
 * host: a local watcher's key is `docker.<name>`, an agent-owned watcher's
 * key is `<agent>.docker.<name>` (`Component.getId()`). An agent watcher
 * only carries a usable `dockerApi` when controller Docker transport is
 * available (`AgentWatcher.init()`); otherwise it stays unsupported.
 */
export function listImageHosts(watchers: Record<string, unknown>): ImageHost[] {
  const hosts: ImageHost[] = [];

  for (const [id, watcher] of Object.entries(watchers)) {
    if (!isWatcherLike(watcher) || watcher.type !== 'docker') {
      continue;
    }

    const name = typeof watcher.name === 'string' ? watcher.name : '';
    const agent =
      typeof watcher.agent === 'string' && watcher.agent !== '' ? watcher.agent : undefined;
    const supported = isImageDockerApi(watcher.dockerApi);

    const host: ImageHost = { id, name, supported };

    if (agent) {
      host.agent = agent;
    }
    if (!supported && agent) {
      host.reason = 'agent-transport-unsupported';
    }
    if (supported) {
      host.dockerApi = watcher.dockerApi as ImageDockerApi;
    }

    hosts.push(host);
  }

  return hosts.sort((a, b) => a.id.localeCompare(b.id));
}

export function getImageHost(watchers: Record<string, unknown>, id: string): ImageHost | undefined {
  return listImageHosts(watchers).find((host) => host.id === id);
}
