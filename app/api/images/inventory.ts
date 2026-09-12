import type { ContainerInfo, ImageInfo } from 'dockerode';

export type PruneMode = 'dangling' | 'unused';

export interface ImageInventoryItem {
  id: string;
  repoTags: string[];
  repoDigests: string[];
  size: number;
  reclaimable: number;
  created: string;
  containers: number;
  dangling: boolean;
  watcher: string;
  agent?: string;
  lastSeen?: string;
}

export interface PruneEstimate {
  host: string;
  mode: PruneMode;
  images: number;
  reclaimable: number;
}

function dropNoneEntries(values: string[] | undefined): string[] {
  return (values ?? []).filter((value) => !value.includes('<none>'));
}

export function buildImageInventory(
  images: ImageInfo[],
  containers: ContainerInfo[],
  ctx: { watcher: string; agent?: string },
): ImageInventoryItem[] {
  const items = images.map((image): ImageInventoryItem => {
    const matchingContainers = containers.filter((container) => container.ImageID === image.Id);
    const repoTags = dropNoneEntries(image.RepoTags);
    const repoDigests = dropNoneEntries(image.RepoDigests);
    const sharedSize = Math.max(0, image.SharedSize ?? -1);
    const reclaimable = Math.max(0, image.Size - sharedSize);

    const item: ImageInventoryItem = {
      id: image.Id,
      repoTags,
      repoDigests,
      size: image.Size,
      reclaimable,
      created: new Date(image.Created * 1000).toISOString(),
      containers: matchingContainers.length,
      dangling: repoTags.length === 0,
      watcher: ctx.watcher,
    };

    if (ctx.agent) {
      item.agent = ctx.agent;
    }

    if (matchingContainers.length > 0) {
      const lastSeenSeconds = Math.max(...matchingContainers.map((container) => container.Created));
      item.lastSeen = new Date(lastSeenSeconds * 1000).toISOString();
    }

    return item;
  });

  return items.sort((a, b) => {
    if (b.size !== a.size) {
      return b.size - a.size;
    }
    return a.id.localeCompare(b.id);
  });
}

export function estimateReclaimable(
  items: ImageInventoryItem[],
  host: string,
  mode: PruneMode,
): PruneEstimate {
  const matched = items.filter((item) => {
    if (item.containers !== 0) {
      return false;
    }
    return mode === 'dangling' ? item.dangling : true;
  });

  return {
    host,
    mode,
    images: matched.length,
    reclaimable: matched.reduce((sum, item) => sum + item.reclaimable, 0),
  };
}

export function isPruneMode(value: unknown): value is PruneMode {
  return value === 'dangling' || value === 'unused';
}
