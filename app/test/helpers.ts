/**
 * Shared test helpers to reduce duplication across test files.
 *
 * Note: vi.mock() and vi.hoisted() callbacks are hoisted above imports,
 * so these helpers can only be used in test bodies, beforeEach, etc.
 * For logger mocking, use the manual mock at log/__mocks__/index.ts
 * with vi.mock('../log') (no factory).
 */
import type { Request, Response } from 'express';
import { vi } from 'vitest';

/**
 * Mock HTTP response object for API handler tests.
 * Returns an Express-compatible Response with common methods stubbed.
 */
export function createMockResponse(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    json: vi.fn(),
    sendStatus: vi.fn(),
    send: vi.fn(),
  } as unknown as Response;
}

/**
 * Mock HTTP request object for API handler tests.
 * Returns an Express-compatible Request with params, query, and body stubbed.
 */
export function createMockRequest<P = Record<string, string>>(
  overrides: Record<string, unknown> = {},
): Request<P> {
  return {
    params: {},
    query: {},
    body: undefined,
    ...overrides,
  } as unknown as Request<P>;
}

/**
 * Standard container fixture used in store tests.
 */
export function createContainerFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
      id: 'image-123456789',
      registry: {
        name: 'registry',
        url: 'https://hub',
      },
      name: 'organization/image',
      tag: {
        value: 'version',
        semver: false,
      },
      digest: {
        watch: false,
        repo: undefined,
      },
      architecture: 'arch',
      os: 'os',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: 'version',
    },
    ...overrides,
  };
}
