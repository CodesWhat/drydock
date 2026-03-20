import type { Request } from 'express';
import { getFirstNonEmptyQueryValue } from './query-values.js';

export function removeContainerListControlParams(query: Request['query']): Request['query'] {
  const filteredQuery: Record<string, unknown> = {};
  Object.entries(query || {}).forEach(([key, value]) => {
    if (
      key === 'includeVulnerabilities' ||
      key === 'limit' ||
      key === 'offset' ||
      key === 'sort' ||
      key === 'maturity' ||
      key === 'status' ||
      key === 'kind' ||
      key === 'watcher'
    ) {
      return;
    }
    filteredQuery[key] = value;
  });
  return filteredQuery as Request['query'];
}

type ContainerRuntimeStatus =
  | 'running'
  | 'stopped'
  | 'exited'
  | 'paused'
  | 'restarting'
  | 'dead'
  | 'created';

const RUNTIME_STATUS_VALUES: ReadonlySet<string> = new Set([
  'running',
  'stopped',
  'exited',
  'paused',
  'restarting',
  'dead',
  'created',
]);

export interface ContainerListStatusFilter {
  updateAvailable?: boolean;
  runtimeStatus?: ContainerRuntimeStatus;
}

export function mapContainerListStatusFilter(
  statusQuery: unknown,
): ContainerListStatusFilter | undefined {
  const statusFilter = getFirstNonEmptyQueryValue(statusQuery);
  if (statusFilter === 'update-available') {
    return { updateAvailable: true };
  }
  if (statusFilter === 'up-to-date') {
    return { updateAvailable: false };
  }
  if (typeof statusFilter === 'string' && RUNTIME_STATUS_VALUES.has(statusFilter)) {
    return { runtimeStatus: statusFilter as ContainerRuntimeStatus };
  }
  return undefined;
}

export type ContainerWatchedKind = 'watched' | 'unwatched' | 'all';

const WATCHED_KIND_VALUES: ReadonlySet<string> = new Set(['watched', 'unwatched', 'all']);

export function isContainerWatchedKind(value: unknown): value is ContainerWatchedKind {
  return typeof value === 'string' && WATCHED_KIND_VALUES.has(value);
}

export function mapContainerListKindFilter(
  kindQuery: unknown,
):
  | { 'updateKind.kind': 'digest' }
  | { 'updateKind.semverDiff': 'major' | 'minor' | 'patch' }
  | undefined {
  const kindFilter = getFirstNonEmptyQueryValue(kindQuery);
  if (isContainerWatchedKind(kindFilter)) {
    return undefined;
  }
  if (kindFilter === 'digest') {
    return { 'updateKind.kind': 'digest' };
  }
  if (kindFilter === 'major' || kindFilter === 'minor' || kindFilter === 'patch') {
    return { 'updateKind.semverDiff': kindFilter };
  }
  return undefined;
}
