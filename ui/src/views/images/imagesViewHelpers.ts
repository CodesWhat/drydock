/**
 * Pure formatting/derivation helpers for ImagesView, split out so the
 * repository/tag/size/host logic is unit-testable without mounting the view.
 */
import type { ImageHostSummary, ImageInventoryItem } from '@/services/images';

const SHA256_PREFIX = 'sha256:';
const SHORT_ID_LENGTH = 12;

/** Format a byte count as a compact human-readable size (e.g. "1.2 GB"). */
export function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let nextValue = Math.max(0, Number.isFinite(value) ? value : 0);
  let unitIndex = 0;
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${nextValue.toFixed(precision)} ${units[unitIndex]}`;
}

/** Strip the `sha256:` prefix (if present) and take the first 12 hex chars. */
export function shortImageId(id: string): string {
  const withoutPrefix = id.startsWith(SHA256_PREFIX) ? id.slice(SHA256_PREFIX.length) : id;
  return withoutPrefix.slice(0, SHORT_ID_LENGTH);
}

/**
 * Split a `repoTags` entry into repository and tag. Finds the last `:` that
 * occurs after the last `/`, so a registry host:port (e.g.
 * `registry.example.com:5000/nginx:latest`) isn't mistaken for the tag
 * delimiter.
 */
export function parseRepoTag(repoTag: string): { repository: string; tag: string } {
  const lastSlash = repoTag.lastIndexOf('/');
  const lastColon = repoTag.lastIndexOf(':');
  if (lastColon > lastSlash) {
    return { repository: repoTag.slice(0, lastColon), tag: repoTag.slice(lastColon + 1) };
  }
  return { repository: repoTag, tag: '' };
}

/** Strip the `@sha256:...` digest suffix from a `repoDigests` entry. */
export function digestRepositoryName(repoDigest: string): string {
  const at = repoDigest.lastIndexOf('@');
  return at >= 0 ? repoDigest.slice(0, at) : repoDigest;
}

/**
 * Repository label: the first repoTag's repository, else the first
 * repoDigest's name, else the caller-supplied "untagged" fallback.
 */
export function repositoryLabel(
  item: Pick<ImageInventoryItem, 'repoTags' | 'repoDigests'>,
  untaggedLabel: string,
): string {
  if (item.repoTags.length > 0) {
    return parseRepoTag(item.repoTags[0]).repository;
  }
  if (item.repoDigests.length > 0) {
    return digestRepositoryName(item.repoDigests[0]);
  }
  return untaggedLabel;
}

/** Tag label: the first repoTag's tag, or '' when there is none. */
export function tagLabel(item: Pick<ImageInventoryItem, 'repoTags'>): string {
  if (item.repoTags.length > 0) {
    return parseRepoTag(item.repoTags[0]).tag;
  }
  return '';
}

/** Human-readable watcher name: "local" -> "Local", plus the agent when set. */
export function hostDisplayName(watcher: string, agent?: string): string {
  const name = watcher === 'local' ? 'Local' : watcher.charAt(0).toUpperCase() + watcher.slice(1);
  return agent ? `${name} (${agent})` : name;
}

/** Whether an image inventory item belongs to the given host summary. */
export function hostMatches(
  item: Pick<ImageInventoryItem, 'watcher' | 'agent'>,
  host: Pick<ImageHostSummary, 'name' | 'agent'>,
): boolean {
  return item.watcher === host.name && (item.agent ?? '') === (host.agent ?? '');
}

export type ImageSortKey =
  | 'repository'
  | 'tag'
  | 'imageId'
  | 'size'
  | 'containers'
  | 'created'
  | 'lastSeen'
  | 'host';

/** Sort key extractor backing the images table's column sorting. */
export function imageSortValue(
  item: ImageInventoryItem,
  key: ImageSortKey,
  untaggedLabel: string,
): string | number {
  switch (key) {
    case 'repository':
      return repositoryLabel(item, untaggedLabel).toLowerCase();
    case 'tag':
      return tagLabel(item).toLowerCase();
    case 'imageId':
      return item.id;
    case 'size':
      return item.size;
    case 'containers':
      return item.containers;
    case 'created':
      return item.created;
    case 'lastSeen':
      return item.lastSeen ?? '';
    case 'host':
      return hostDisplayName(item.watcher, item.agent).toLowerCase();
    default:
      return 0;
  }
}
