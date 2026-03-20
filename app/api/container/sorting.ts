import type { Container } from '../../model/container.js';
import { getFirstNonEmptyQueryValue } from './query-values.js';
import { getContainerUpdateAge } from './update-age.js';

const DEFAULT_CONTAINER_SORT_MODE: ContainerSortMode = 'name';

export const CONTAINER_SORT_MODES = [
  'name',
  '-name',
  'status',
  '-status',
  'age',
  '-age',
  'created',
  '-created',
] as const;

export type ContainerSortMode = (typeof CONTAINER_SORT_MODES)[number];

export const CONTAINER_ORDER_VALUES = ['asc', 'desc'] as const;
export type ContainerOrderDirection = (typeof CONTAINER_ORDER_VALUES)[number];

type AscendingContainerSortMode = Exclude<
  ContainerSortMode,
  '-name' | '-status' | '-age' | '-created'
>;

export function parseContainerSortMode(sortQuery: unknown): ContainerSortMode {
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

  if (orderValue === 'desc') {
    const normalizedSort = normalizeContainerSortMode(baseSortMode);
    return `-${normalizedSort}` as ContainerSortMode;
  }
  if (orderValue === 'asc') {
    return normalizeContainerSortMode(baseSortMode);
  }

  return baseSortMode;
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
  const ageMap = new Map<Container, number | undefined>();
  for (const container of containers) {
    ageMap.set(container, getContainerUpdateAge(container));
  }
  const containersSorted = [...containers];
  containersSorted.sort((leftContainer, rightContainer) => {
    const leftAge = ageMap.get(leftContainer);
    const rightAge = ageMap.get(rightContainer);
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
  const createdMap = new Map<Container, number>();
  for (const container of containers) {
    const ms = Date.parse(container.image?.created || '');
    createdMap.set(container, Number.isFinite(ms) ? ms : Number.NaN);
  }
  const containersSorted = [...containers];
  containersSorted.sort((leftContainer, rightContainer) => {
    const leftCreatedAtMs = createdMap.get(leftContainer) as number;
    const rightCreatedAtMs = createdMap.get(rightContainer) as number;
    const leftHasValidCreatedAt = !Number.isNaN(leftCreatedAtMs);
    const rightHasValidCreatedAt = !Number.isNaN(rightCreatedAtMs);

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
