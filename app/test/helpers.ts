/**
 * Shared test helpers to reduce duplication across test files.
 *
 * Note: vi.mock() and vi.hoisted() callbacks are hoisted above imports,
 * so these helpers can only be used in test bodies, beforeEach, etc.
 * For logger mocking, use the manual mock at log/__mocks__/index.ts
 * with vi.mock('../log') (no factory).
 */
import { STATUS_CODES } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { vi } from 'vitest';

type MiddlewareLike = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;

function getHeaderValue(headers: Record<string, unknown>, name: string): string | undefined {
  const normalizedName = name.toLowerCase();

  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() !== normalizedName) {
      continue;
    }
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    if (typeof value === 'string') {
      return value;
    }
    return undefined;
  }

  return undefined;
}

/**
 * Mock HTTP response object for API handler tests.
 * Returns an Express-compatible Response with common methods stubbed.
 */
export function createMockResponse(): Response {
  const headerStore: Record<string, unknown> = {};

  const response = {
    statusCode: 200,
    headersSent: false,
    locals: {},
    body: undefined as unknown,
  } as Response & {
    statusCode: number;
    headersSent: boolean;
    locals: Record<string, unknown>;
    body: unknown;
  };

  const assertWritable = (): void => {
    if (response.headersSent) {
      throw new Error('Cannot set headers after they are sent to the client');
    }
  };

  response.status = vi.fn((statusCode: number) => {
    response.statusCode = statusCode;
    return response;
  }) as Response['status'];

  response.set = vi.fn((field: string | Record<string, unknown>, value?: unknown) => {
    assertWritable();
    if (typeof field === 'string') {
      headerStore[field.toLowerCase()] = value;
      return response;
    }

    for (const [headerName, headerValue] of Object.entries(field)) {
      headerStore[headerName.toLowerCase()] = headerValue;
    }
    return response;
  }) as Response['set'];

  response.setHeader = vi.fn((field: string, value: unknown) => {
    assertWritable();
    headerStore[field.toLowerCase()] = value;
    return response;
  }) as Response['setHeader'];

  response.getHeader = vi.fn((field: string) => {
    return headerStore[field.toLowerCase()];
  }) as Response['getHeader'];

  response.type = vi.fn((type: string) => {
    assertWritable();
    headerStore['content-type'] = type;
    return response;
  }) as Response['type'];

  response.json = vi.fn((body?: unknown) => {
    assertWritable();
    response.body = body;
    response.headersSent = true;
    return response;
  }) as Response['json'];

  response.send = vi.fn((body?: unknown) => {
    assertWritable();
    response.body = body;
    response.headersSent = true;
    return response;
  }) as Response['send'];

  response.sendStatus = vi.fn((statusCode: number) => {
    assertWritable();
    response.statusCode = statusCode;
    response.body = STATUS_CODES[statusCode] || `${statusCode}`;
    response.headersSent = true;
    return response;
  }) as Response['sendStatus'];

  response.end = vi.fn((body?: unknown) => {
    assertWritable();
    response.body = body;
    response.headersSent = true;
    return response;
  }) as Response['end'];

  return response;
}

/**
 * Mock HTTP request object for API handler tests.
 * Returns an Express-compatible Request with params, query, and body stubbed.
 */
export function createMockRequest<P = Record<string, string>>(
  overrides: Record<string, unknown> = {},
): Request<P> {
  const request = {
    params: {},
    query: {},
    headers: {},
    body: undefined,
    method: 'GET',
    protocol: 'http',
  } as Request<P> & {
    headers: Record<string, unknown>;
    get: (name: string) => string | undefined;
    header: (name: string) => string | undefined;
  };

  request.get = vi.fn((name: string) => getHeaderValue(request.headers, name));
  request.header = request.get;

  Object.assign(request, overrides);
  return request;
}

/**
 * Run Express middleware with fail-fast next(error) semantics.
 * Rejects when middleware throws or calls next(error).
 */
export async function runMiddleware(
  middleware: MiddlewareLike,
  options: {
    req?: Request;
    res?: Response;
  } = {},
): Promise<{
  req: Request;
  res: Response;
  next: ReturnType<typeof vi.fn>;
}> {
  const req = options.req || createMockRequest();
  const res = options.res || createMockResponse();

  return new Promise((resolve, reject) => {
    let settled = false;

    const next = vi.fn((error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve({ req, res, next });
    });

    Promise.resolve()
      .then(() => middleware(req, res, next))
      .then(() => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({ req, res, next });
      })
      .catch((error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });
  });
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
