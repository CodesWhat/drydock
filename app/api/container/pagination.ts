import type { Request } from 'express';
import { normalizeLimitOffsetPagination } from './request-helpers.js';

const CONTAINER_LIST_MAX_LIMIT = 200;

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
