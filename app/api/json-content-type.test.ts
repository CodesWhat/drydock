import type { NextFunction, Request } from 'express';
import { describe, expect, test, vi } from 'vitest';
import { createMockResponse } from '../test/helpers.js';
import { requireJsonContentTypeForMutations, shouldParseJsonBody } from './json-content-type.js';

function createRequest(overrides: Partial<Request>): Request {
  return {
    method: 'POST',
    headers: {},
    is: vi.fn(() => false),
    ...overrides,
  } as unknown as Request;
}

describe('json content-type middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('shouldParseJsonBody returns true only for mutation methods', () => {
    expect(shouldParseJsonBody('POST')).toBe(true);
    expect(shouldParseJsonBody('PUT')).toBe(true);
    expect(shouldParseJsonBody('PATCH')).toBe(true);
    expect(shouldParseJsonBody('GET')).toBe(false);
  });

  test('allows non-mutation requests without checking content type', () => {
    const req = createRequest({ method: 'GET' });
    const res = createMockResponse();
    const next = vi.fn() as NextFunction;

    requireJsonContentTypeForMutations(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects body-bearing mutation request when content-length is not numeric', () => {
    const req = createRequest({
      headers: { 'content-length': 'abc' },
      is: vi.fn(() => false),
    });
    const res = createMockResponse();
    const next = vi.fn() as NextFunction;

    requireJsonContentTypeForMutations(req, res, next);

    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith({ error: 'Content-Type must be application/json' });
    expect(next).not.toHaveBeenCalled();
  });

  test('skips content-type enforcement when content-length is blank', () => {
    const req = createRequest({
      headers: { 'content-length': '   ' },
    });
    const res = createMockResponse();
    const next = vi.fn() as NextFunction;

    requireJsonContentTypeForMutations(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('treats non-empty transfer-encoding as request body when content-length is missing', () => {
    const req = createRequest({
      headers: { 'transfer-encoding': ['chunked', 'gzip'] },
      is: vi.fn(() => false),
    });
    const res = createMockResponse();
    const next = vi.fn() as NextFunction;

    requireJsonContentTypeForMutations(req, res, next);

    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith({ error: 'Content-Type must be application/json' });
    expect(next).not.toHaveBeenCalled();
  });

  test('skips content-type enforcement when transfer-encoding is blank', () => {
    const req = createRequest({
      headers: { 'transfer-encoding': '   ' },
    });
    const res = createMockResponse();
    const next = vi.fn() as NextFunction;

    requireJsonContentTypeForMutations(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('allows json mutation requests with body', () => {
    const req = createRequest({
      headers: { 'content-length': '2' },
      is: vi.fn(() => true),
    });
    const res = createMockResponse();
    const next = vi.fn() as NextFunction;

    requireJsonContentTypeForMutations(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects when content-length is 1 (has body) and content-type is not json', () => {
    const req = createRequest({
      headers: { 'content-length': '1' },
      is: vi.fn(() => false),
    });
    const res = createMockResponse();
    const next = vi.fn() as NextFunction;

    requireJsonContentTypeForMutations(req, res, next);

    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith({ error: 'Content-Type must be application/json' });
    expect(next).not.toHaveBeenCalled();
  });

  test('skips content-type check when content-length is 0 (no body)', () => {
    const req = createRequest({
      headers: { 'content-length': '0' },
      is: vi.fn(() => false),
    });
    const res = createMockResponse();
    const next = vi.fn() as NextFunction;

    requireJsonContentTypeForMutations(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('skips content-type check when content-length is negative', () => {
    const req = createRequest({
      headers: { 'content-length': '-1' },
      is: vi.fn(() => false),
    });
    const res = createMockResponse();
    const next = vi.fn() as NextFunction;

    requireJsonContentTypeForMutations(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('skips content-type enforcement when no content-length and no transfer-encoding', () => {
    const req = createRequest({
      headers: {},
      is: vi.fn(() => false),
    });
    const res = createMockResponse();
    const next = vi.fn() as NextFunction;

    requireJsonContentTypeForMutations(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects with exact 415 error message', () => {
    const req = createRequest({
      headers: { 'content-length': '5' },
      is: vi.fn(() => false),
    });
    const res = createMockResponse();
    const next = vi.fn() as NextFunction;

    requireJsonContentTypeForMutations(req, res, next);

    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith({ error: 'Content-Type must be application/json' });
  });

  test('calls req.is with exactly "application/json"', () => {
    // Verifies the string literal is "application/json", not "" or another value.
    const isMock = vi.fn(() => true);
    const req = createRequest({
      headers: { 'content-length': '5' },
      is: isMock,
    });
    const res = createMockResponse();
    const next = vi.fn() as NextFunction;

    requireJsonContentTypeForMutations(req, res, next);

    expect(isMock).toHaveBeenCalledWith('application/json');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('does not call next when req.is returns false for "application/json"', () => {
    // Ensures the is() check gates the content-type validation.
    // If is("") were used and returned falsy for a valid JSON content-type request,
    // the request would be rejected even though it has the right content type.
    const isMock = vi.fn((type: string) => type === 'application/json');
    const req = createRequest({
      headers: { 'content-length': '5' },
      is: isMock,
    });
    const res = createMockResponse();
    const next = vi.fn() as NextFunction;

    requireJsonContentTypeForMutations(req, res, next);

    expect(isMock).toHaveBeenCalledWith('application/json');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('shouldParseJsonBody returns false for DELETE', () => {
    expect(shouldParseJsonBody('DELETE')).toBe(false);
  });

  test('shouldParseJsonBody returns false for HEAD', () => {
    expect(shouldParseJsonBody('HEAD')).toBe(false);
  });
});
