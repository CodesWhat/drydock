import type { Request } from 'express';
import joi from 'joi';
import type { Container } from '../../model/container.js';
import type { ContainerMaturityFilter } from './maturity-filter.js';
import { normalizeLimitOffsetPagination } from './request-helpers.js';
import type { ContainerWatchedKind } from './watched-kind-filter.js';
import { isContainerWatchedKind } from './watched-kind-filter.js';

const DEFAULT_CONTAINER_SORT_MODE: ContainerSortMode = 'name';
const CONTAINER_LIST_MAX_LIMIT = 200;

export type ContainerSortMode =
  | 'name'
  | '-name'
  | 'status'
  | '-status'
  | 'age'
  | '-age'
  | 'created'
  | '-created';
type AscendingContainerSortMode = Exclude<
  ContainerSortMode,
  '-name' | '-status' | '-age' | '-created'
>;

export const CONTAINER_SORT_FIELDS = ['name', 'status', 'age', 'created'] as const;
export type ContainerSortField = (typeof CONTAINER_SORT_FIELDS)[number];

export const CONTAINER_ORDER_VALUES = ['asc', 'desc'] as const;
export type ContainerOrderDirection = (typeof CONTAINER_ORDER_VALUES)[number];

export {
  applyContainerMaturityFilter,
  parseContainerMaturityFilter,
} from './maturity-filter.js';
export {
  applyContainerWatchedKindFilter,
  isContainerWatchedKind,
} from './watched-kind-filter.js';
export type { ContainerMaturityFilter, ContainerWatchedKind };

const CONTAINER_LIST_QUERY_SCHEMA = joi.object({
  sort: joi
    .string()
    .valid('name', '-name', 'status', '-status', 'age', '-age', 'created', '-created')
    .messages({
      'any.only': 'Invalid sort value',
    }),
  order: joi
    .string()
    .valid(...CONTAINER_ORDER_VALUES)
    .messages({
      'any.only': 'Invalid order value',
    }),
  status: joi
    .string()
    .valid(
      'update-available',
      'up-to-date',
      'running',
      'stopped',
      'exited',
      'paused',
      'restarting',
      'dead',
      'created',
    )
    .messages({
      'any.only': 'Invalid status filter value',
    }),
  kind: joi
    .string()
    .valid('major', 'minor', 'patch', 'digest', 'watched', 'unwatched', 'all')
    .messages({
      'any.only': 'Invalid kind filter value',
    }),
  watcher: joi.string().trim().min(1).messages({
    'string.empty': 'Invalid watcher filter value',
    'string.min': 'Invalid watcher filter value',
  }),
  maturity: joi.string().valid('hot', 'mature', 'established').messages({
    'any.only': 'Invalid maturity filter value',
  }),
});

export function removeContainerListControlParams(query: Request['query']): Request['query'] {
  const filteredQuery: Record<string, unknown> = {};
  Object.entries(query || {}).forEach(([key, value]) => {
    if (
      key === 'includeVulnerabilities' ||
      key === 'limit' ||
      key === 'offset' ||
      key === 'sort' ||
      key === 'order' ||
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

function getFirstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        return item.trim();
      }
    }
    return undefined;
  }
  return typeof value === 'string' ? value.trim() : undefined;
}

export function getFirstNonEmptyQueryValue(value: unknown): string | undefined {
  const queryValue = getFirstQueryValue(value);
  if (!queryValue || queryValue.length === 0) {
    return undefined;
  }
  return queryValue;
}

function parseContainerSortMode(sortQuery: unknown): ContainerSortMode {
  const sortValue = getFirstNonEmptyQueryValue(sortQuery);
  if (!sortValue || !isContainerSortMode(sortValue)) {
    return DEFAULT_CONTAINER_SORT_MODE;
  }
  return sortValue;
}

export function resolveContainerSortMode(
  sortQuery: unknown,
  orderQuery: unknown,
): ContainerSortMode {
  const baseSortMode = parseContainerSortMode(sortQuery);
  const orderValue = getFirstNonEmptyQueryValue(orderQuery)?.toLowerCase();

  // If an explicit order param is provided, it overrides any prefix on the sort value
  if (orderValue === 'desc') {
    const normalizedSort = normalizeContainerSortMode(baseSortMode);
    return `-${normalizedSort}` as ContainerSortMode;
  }
  if (orderValue === 'asc') {
    return normalizeContainerSortMode(baseSortMode);
  }

  // No order param — use the sort value as-is (including any prefix)
  return baseSortMode;
}

export type ContainerRuntimeStatus =
  | 'running'
  | 'stopped'
  | 'exited'
  | 'paused'
  | 'restarting'
  | 'dead'
  | 'created';

export type ContainerUpdateStatus = 'update-available' | 'up-to-date';

export interface ValidatedContainerListQuery {
  sortMode: ContainerSortMode;
  status?: ContainerUpdateStatus | ContainerRuntimeStatus;
  kind?: 'major' | 'minor' | 'patch' | 'digest' | ContainerWatchedKind;
  watcher?: string;
  maturity?: ContainerMaturityFilter;
}

export function validateContainerListQuery(query: Request['query']): ValidatedContainerListQuery {
  const { value, error } = CONTAINER_LIST_QUERY_SCHEMA.validate(
    {
      sort: getFirstQueryValue(query.sort),
      order: getFirstQueryValue(query.order),
      status: getFirstQueryValue(query.status),
      kind: getFirstQueryValue(query.kind),
      watcher: getFirstQueryValue(query.watcher),
      maturity: getFirstQueryValue(query.maturity),
    },
    {
      abortEarly: true,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  return {
    sortMode: resolveContainerSortMode(value.sort, value.order),
    status: value.status,
    kind: value.kind,
    watcher: value.watcher,
    maturity: value.maturity,
  };
}

function getContainerUpdateAge(container: Container): number | undefined {
  if (typeof container.updateAge === 'number' && Number.isFinite(container.updateAge)) {
    return container.updateAge;
  }

  const firstSeenAtMs = Date.parse(container.firstSeenAt || '');
  const publishedAtMs = Date.parse(container.result?.publishedAt || '');
  const updateDetectedAtMs = Date.parse(container.updateDetectedAt || '');
  let startedAtMs: number | undefined;
  if (Number.isFinite(firstSeenAtMs) && Number.isFinite(publishedAtMs)) {
    startedAtMs = Math.min(firstSeenAtMs, publishedAtMs);
  } else if (Number.isFinite(firstSeenAtMs)) {
    startedAtMs = firstSeenAtMs;
  } else if (Number.isFinite(publishedAtMs)) {
    startedAtMs = publishedAtMs;
  } else if (Number.isFinite(updateDetectedAtMs)) {
    startedAtMs = updateDetectedAtMs;
  }

  return startedAtMs === undefined ? undefined : Math.max(0, Date.now() - startedAtMs);
}

function getContainerNameForSort(container: Container): string {
  return typeof container.name === 'string' ? container.name : '';
}

function getContainerIdForSort(container: Container): string {
  return typeof container.id === 'string' ? container.id : '';
}

function getContainerWatcherForSort(container: Container): string {
  return typeof container.watcher === 'string' ? container.watcher : '';
}

function sortContainersByAge(containers: Container[]): Container[] {
  const containersWithAge = containers.map((container) => ({
    container,
    age: getContainerUpdateAge(container),
    sortName: `${getContainerWatcherForSort(container)}.${getContainerNameForSort(
      container,
    )}.${getContainerIdForSort(container)}`,
  }));

  containersWithAge.sort((leftContainer, rightContainer) => {
    const leftAge = leftContainer.age;
    const rightAge = rightContainer.age;
    if (leftAge !== undefined && rightAge !== undefined && leftAge !== rightAge) {
      return rightAge - leftAge;
    }
    if (leftAge !== undefined && rightAge === undefined) {
      return -1;
    }
    if (leftAge === undefined && rightAge !== undefined) {
      return 1;
    }
    return leftContainer.sortName.localeCompare(rightContainer.sortName);
  });
  return containersWithAge.map(({ container }) => container);
}

function sortContainersByStatus(containers: Container[]): Container[] {
  const containersSorted = [...containers];
  containersSorted.sort((leftContainer, rightContainer) => {
    if (leftContainer.updateAvailable !== rightContainer.updateAvailable) {
      return leftContainer.updateAvailable ? -1 : 1;
    }
    return getContainerNameForSort(leftContainer).localeCompare(
      getContainerNameForSort(rightContainer),
    );
  });
  return containersSorted;
}

function sortContainersByCreatedDate(containers: Container[]): Container[] {
  const containersWithCreatedDate = containers.map((container) => {
    const createdAtMs = Date.parse(container.image?.created || '');
    return {
      container,
      createdAtMs,
      hasValidCreatedAt: Number.isFinite(createdAtMs),
      sortName: getContainerNameForSort(container),
    };
  });

  containersWithCreatedDate.sort((leftContainer, rightContainer) => {
    const leftHasValidCreatedAt = leftContainer.hasValidCreatedAt;
    const rightHasValidCreatedAt = rightContainer.hasValidCreatedAt;

    if (leftHasValidCreatedAt && rightHasValidCreatedAt) {
      if (leftContainer.createdAtMs !== rightContainer.createdAtMs) {
        return leftContainer.createdAtMs - rightContainer.createdAtMs;
      }
      return leftContainer.sortName.localeCompare(rightContainer.sortName);
    }
    if (leftHasValidCreatedAt !== rightHasValidCreatedAt) {
      return leftHasValidCreatedAt ? -1 : 1;
    }
    return leftContainer.sortName.localeCompare(rightContainer.sortName);
  });
  return containersWithCreatedDate.map(({ container }) => container);
}

function sortContainersByName(containers: Container[]): Container[] {
  const containersSorted = [...containers];
  containersSorted.sort((leftContainer, rightContainer) => {
    const nameCompare = getContainerNameForSort(leftContainer).localeCompare(
      getContainerNameForSort(rightContainer),
    );
    return nameCompare;
  });
  return containersSorted;
}

function isContainerSortMode(value: string): value is ContainerSortMode {
  return (
    value === 'name' ||
    value === '-name' ||
    value === 'status' ||
    value === '-status' ||
    value === 'age' ||
    value === '-age' ||
    value === 'created' ||
    value === '-created'
  );
}

function normalizeContainerSortMode(sortMode: ContainerSortMode): AscendingContainerSortMode {
  if (sortMode === '-name') {
    return 'name';
  }
  if (sortMode === '-status') {
    return 'status';
  }
  if (sortMode === '-age') {
    return 'age';
  }
  if (sortMode === '-created') {
    return 'created';
  }
  return sortMode;
}

export function sortContainers(containers: Container[], sortMode: ContainerSortMode): Container[] {
  const isDescending = sortMode.startsWith('-');
  const normalizedSortMode = normalizeContainerSortMode(sortMode);

  let containersSorted: Container[];
  if (normalizedSortMode === 'status') {
    containersSorted = sortContainersByStatus(containers);
  } else if (normalizedSortMode === 'age') {
    containersSorted = sortContainersByAge(containers);
  } else if (normalizedSortMode === 'created') {
    containersSorted = sortContainersByCreatedDate(containers);
  } else {
    containersSorted = sortContainersByName(containers);
  }

  if (isDescending) {
    containersSorted.reverse();
  }
  return containersSorted;
}

const RUNTIME_STATUS_VALUES: ReadonlySet<string> = new Set([
  'running',
  'stopped',
  'exited',
  'paused',
  'restarting',
  'dead',
  'created',
]);

export function isContainerRuntimeStatus(value: unknown): value is ContainerRuntimeStatus {
  return typeof value === 'string' && RUNTIME_STATUS_VALUES.has(value);
}

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
  if (isContainerRuntimeStatus(statusFilter)) {
    return { runtimeStatus: statusFilter };
  }
  return undefined;
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

export function normalizeContainerListPagination(query: Request['query']) {
  return normalizeLimitOffsetPagination(query, { maxLimit: CONTAINER_LIST_MAX_LIMIT });
}

export function paginateCollection<T>(
  collection: T[],
  pagination: { limit: number; offset: number },
): T[] {
  if (pagination.limit === 0 && pagination.offset === 0) {
    return collection;
  }
  if (pagination.limit === 0) {
    return collection.slice(pagination.offset);
  }
  return collection.slice(pagination.offset, pagination.offset + pagination.limit);
}
