import { describe, expect, test } from 'vitest';
import { buildPaginationLinks } from './pagination-links.js';

describe('buildPaginationLinks', () => {
  test('returns undefined when limit is zero or negative', () => {
    expect(
      buildPaginationLinks({
        basePath: '/api/items',
        query: {},
        limit: 0,
        offset: 0,
        total: 10,
        returnedCount: 10,
      }),
    ).toBeUndefined();

    expect(
      buildPaginationLinks({
        basePath: '/api/items',
        query: {},
        limit: -1,
        offset: 0,
        total: 10,
        returnedCount: 10,
      }),
    ).toBeUndefined();
  });

  test('normalizes query params and omits unsupported values', () => {
    const links = buildPaginationLinks({
      basePath: '/api/items',
      query: {
        text: 'hello',
        count: 3,
        active: true,
        tags: ['latest', 'stable'],
        firstOnly: [{ unsupported: true }],
        nested: { unsupported: true },
        limit: '999',
        offset: '999',
      },
      limit: 2,
      offset: 1,
      total: 10,
      returnedCount: 1,
    });

    expect(links).toBeDefined();
    expect(links?.self).toBe(
      '/api/items?text=hello&count=3&active=true&tags=latest&limit=2&offset=1',
    );
    expect(links?.next).toBe(
      '/api/items?text=hello&count=3&active=true&tags=latest&limit=2&offset=3',
    );
  });

  test('uses empty query entries for non-object query inputs', () => {
    const linksFromNull = buildPaginationLinks({
      basePath: '/api/items',
      query: null,
      limit: 5,
      offset: 0,
      total: 5,
      returnedCount: 5,
    });

    const linksFromArray = buildPaginationLinks({
      basePath: '/api/items',
      query: ['unexpected'],
      limit: 5,
      offset: 0,
      total: 5,
      returnedCount: 5,
    });

    expect(linksFromNull).toEqual({
      self: '/api/items?limit=5&offset=0',
    });
    expect(linksFromArray).toEqual({
      self: '/api/items?limit=5&offset=0',
    });
  });

  test('does not include next link when there are no more results', () => {
    const links = buildPaginationLinks({
      basePath: '/api/items',
      query: {},
      limit: 5,
      offset: 5,
      total: 10,
      returnedCount: 5,
    });

    expect(links).toEqual({
      self: '/api/items?limit=5&offset=5',
    });
  });
});
