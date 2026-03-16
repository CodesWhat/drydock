import type { Request } from 'express';
import joi from 'joi';
import type { Container } from '../../model/container.js';
import {
  maturityMinAgeDaysToMilliseconds,
  resolveMaturityMinAgeDays,
} from '../../model/maturity-policy.js';
import { normalizeLimitOffsetPagination } from './request-helpers.js';

const DEFAULT_CONTAINER_SORT_MODE: ContainerSortMode = 'name';
const DEFAULT_UI_MATURITY_THRESHOLD_DAYS = 7;
const ESTABLISHED_UPDATE_AGE_DAYS = 30;
export const CONTAINER_LIST_MAX_LIMIT = 200;

export type ContainerMaturityFilter = 'hot' | 'mature' | 'established';
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

const CONTAINER_LIST_QUERY_SCHEMA = joi.object({
  sort: joi
    .string()
    .valid('name', '-name', 'status', '-status', 'age', '-age', 'created', '-created')
    .messages({
      'any.only': 'Invalid sort value',
    }),
  status: joi.string().valid('update-available', 'up-to-date').messages({
    'any.only': 'Invalid status filter value',
  }),
  kind: joi.string().valid('major', 'minor', 'patch', 'digest').messages({
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

export function getFirstQueryValue(value: unknown): string | undefined {
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

export function parseContainerMaturityFilter(
  maturityQuery: unknown,
): ContainerMaturityFilter | undefined {
  const normalized = getFirstNonEmptyQueryValue(maturityQuery)?.toLowerCase();
  if (normalized === 'hot' || normalized === 'mature' || normalized === 'established') {
    return normalized;
  }
  return undefined;
}

export interface ValidatedContainerListQuery {
  sortMode: ContainerSortMode;
  status?: 'update-available' | 'up-to-date';
  kind?: 'major' | 'minor' | 'patch' | 'digest';
  watcher?: string;
  maturity?: ContainerMaturityFilter;
}

export function validateContainerListQuery(query: Request['query']): ValidatedContainerListQuery {
  const { value, error } = CONTAINER_LIST_QUERY_SCHEMA.validate(
    {
      sort: getFirstQueryValue(query.sort),
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
    throw new Error(error.details?.[0]?.message || 'Invalid query parameters');
  }

  return {
    sortMode: parseContainerSortMode(value.sort),
    status: value.status,
    kind: value.kind,
    watcher: value.watcher,
    maturity: value.maturity,
  };
}

export function getContainerUpdateAge(container: Container): number | undefined {
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

function resolveUiMaturityThresholdDays(): number {
  return resolveMaturityMinAgeDays(
    process.env.DD_UI_MATURITY_THRESHOLD_DAYS,
    DEFAULT_UI_MATURITY_THRESHOLD_DAYS,
  );
}

function getContainerMaturityLevel(container: Container): ContainerMaturityFilter | undefined {
  if (
    container.updateMaturityLevel === 'hot' ||
    container.updateMaturityLevel === 'mature' ||
    container.updateMaturityLevel === 'established'
  ) {
    return container.updateMaturityLevel;
  }

  const updateAge = getContainerUpdateAge(container);
  if (updateAge === undefined) {
    return undefined;
  }
  if (updateAge >= maturityMinAgeDaysToMilliseconds(ESTABLISHED_UPDATE_AGE_DAYS)) {
    return 'established';
  }
  return updateAge >= maturityMinAgeDaysToMilliseconds(resolveUiMaturityThresholdDays())
    ? 'mature'
    : 'hot';
}

export function applyContainerMaturityFilter(
  containers: Container[],
  maturityFilter: ContainerMaturityFilter | undefined,
): Container[] {
  if (!maturityFilter) {
    return containers;
  }
  return containers.filter((container) => getContainerMaturityLevel(container) === maturityFilter);
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
  const containersSorted = [...containers];
  containersSorted.sort((leftContainer, rightContainer) => {
    const leftAge = getContainerUpdateAge(leftContainer);
    const rightAge = getContainerUpdateAge(rightContainer);
    if (leftAge !== undefined && rightAge !== undefined && leftAge !== rightAge) {
      return rightAge - leftAge;
    }
    if (leftAge !== undefined && rightAge === undefined) {
      return -1;
    }
    if (leftAge === undefined && rightAge !== undefined) {
      return 1;
    }
    const leftName = `${getContainerWatcherForSort(leftContainer)}.${getContainerNameForSort(
      leftContainer,
    )}.${getContainerIdForSort(leftContainer)}`;
    const rightName = `${getContainerWatcherForSort(rightContainer)}.${getContainerNameForSort(
      rightContainer,
    )}.${getContainerIdForSort(rightContainer)}`;
    return leftName.localeCompare(rightName);
  });
  return containersSorted;
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
  const containersSorted = [...containers];
  containersSorted.sort((leftContainer, rightContainer) => {
    const leftCreatedAtMs = Date.parse(leftContainer.image?.created || '');
    const rightCreatedAtMs = Date.parse(rightContainer.image?.created || '');
    const leftHasValidCreatedAt = Number.isFinite(leftCreatedAtMs);
    const rightHasValidCreatedAt = Number.isFinite(rightCreatedAtMs);

    if (leftHasValidCreatedAt && rightHasValidCreatedAt) {
      if (leftCreatedAtMs !== rightCreatedAtMs) {
        return leftCreatedAtMs - rightCreatedAtMs;
      }
      return getContainerNameForSort(leftContainer).localeCompare(
        getContainerNameForSort(rightContainer),
      );
    }
    if (leftHasValidCreatedAt !== rightHasValidCreatedAt) {
      return leftHasValidCreatedAt ? -1 : 1;
    }
    return getContainerNameForSort(leftContainer).localeCompare(
      getContainerNameForSort(rightContainer),
    );
  });
  return containersSorted;
}

function sortContainersByName(containers: Container[], descending = false): Container[] {
  const containersSorted = [...containers];
  containersSorted.sort((leftContainer, rightContainer) => {
    const nameCompare = getContainerNameForSort(leftContainer).localeCompare(
      getContainerNameForSort(rightContainer),
    );
    return descending ? -nameCompare : nameCompare;
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

export function mapContainerListStatusFilter(statusQuery: unknown): boolean | undefined {
  const statusFilter = getFirstNonEmptyQueryValue(statusQuery);
  if (statusFilter === 'update-available') {
    return true;
  }
  if (statusFilter === 'up-to-date') {
    return false;
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
