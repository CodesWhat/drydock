type QueryRecord = Record<string, unknown>;

export interface PaginationLinks {
  self: string;
  next?: string;
}

interface BuildPaginationLinksOptions {
  basePath: string;
  query: QueryRecord | unknown;
  limit: number;
  offset: number;
  total: number;
  returnedCount: number;
}

function getSerializableQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function normalizeQueryEntries(query: QueryRecord | unknown): [string, string][] {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return [];
  }

  const entries: [string, string][] = [];
  Object.entries(query as QueryRecord).forEach(([key, rawValue]) => {
    if (key === 'limit' || key === 'offset') {
      return;
    }

    if (Array.isArray(rawValue)) {
      const firstValue = rawValue[0];
      const serialized = getSerializableQueryValue(firstValue);
      if (serialized !== undefined) {
        entries.push([key, serialized]);
      }
      return;
    }

    const serialized = getSerializableQueryValue(rawValue);
    if (serialized !== undefined) {
      entries.push([key, serialized]);
    }
  });

  return entries;
}

function buildLink(
  basePath: string,
  queryEntries: [string, string][],
  limit: number,
  offset: number,
): string {
  const searchParams = new URLSearchParams();
  queryEntries.forEach(([key, value]) => {
    searchParams.set(key, value);
  });
  searchParams.set('limit', String(limit));
  searchParams.set('offset', String(offset));
  return `${basePath}?${searchParams.toString()}`;
}

export function buildPaginationLinks({
  basePath,
  query,
  limit,
  offset,
  total,
  returnedCount,
}: BuildPaginationLinksOptions): PaginationLinks | undefined {
  if (limit <= 0) {
    return undefined;
  }

  const queryEntries = normalizeQueryEntries(query);
  const links: PaginationLinks = {
    self: buildLink(basePath, queryEntries, limit, offset),
  };

  if (offset + returnedCount < total) {
    links.next = buildLink(basePath, queryEntries, limit, offset + Math.max(returnedCount, limit));
  }

  return links;
}
