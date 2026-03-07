import type { Response } from 'express';
import { describe, expect, test, vi } from 'vitest';
import { normalizeErrorResponsePayload, sendErrorResponse } from './error-response.js';

function createResponse(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
}

describe('sendErrorResponse', () => {
  test('uses explicit message when provided', () => {
    const res = createResponse();

    sendErrorResponse(res, 400, 'Bad payload');

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Bad payload' });
  });

  test('uses standard status text when message is omitted', () => {
    const res = createResponse();

    sendErrorResponse(res, 404);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not Found' });
  });

  test('falls back to generic message when status text is unknown', () => {
    const res = createResponse();

    sendErrorResponse(res, 799);

    expect(res.status).toHaveBeenCalledWith(799);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error' });
  });

  test('supports options object with explicit message and details', () => {
    const res = createResponse();

    sendErrorResponse(res, 422, {
      message: 'Validation failed',
      details: { field: 'name' },
    });

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: { field: 'name' },
    });
  });
});

describe('normalizeErrorResponsePayload', () => {
  test('expands legacy string error payloads with code and message fields', () => {
    const jsonSpy = vi.fn();
    const res = {
      statusCode: 404,
      json: jsonSpy,
    } as unknown as Response;

    normalizeErrorResponsePayload({} as never, res, vi.fn());
    res.json({ error: 'Container not found' });

    expect(jsonSpy).toHaveBeenCalledWith({
      error: 'Container not found',
      code: 'CONTAINER_NOT_FOUND',
      message: 'Container not found',
    });
  });

  test('preserves explicit error code and details fields when present', () => {
    const jsonSpy = vi.fn();
    const res = {
      statusCode: 422,
      json: jsonSpy,
    } as unknown as Response;

    normalizeErrorResponsePayload({} as never, res, vi.fn());
    res.json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: { field: 'name' },
    });

    expect(jsonSpy).toHaveBeenCalledWith({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: { field: 'name' },
    });
  });

  test('normalizes known messages case-insensitively and trims whitespace', () => {
    const jsonSpy = vi.fn();
    const res = {
      statusCode: 401,
      json: jsonSpy,
    } as unknown as Response;

    normalizeErrorResponsePayload({} as never, res, vi.fn());
    res.json({ error: '  unauthorized  ' });

    expect(jsonSpy).toHaveBeenCalledWith({
      error: '  unauthorized  ',
      code: 'UNAUTHORIZED',
      message: '  unauthorized  ',
    });
  });

  test('derives error code from status code when message mapping is unknown', () => {
    const jsonSpy = vi.fn();
    const res = {
      statusCode: 502,
      json: jsonSpy,
    } as unknown as Response;

    normalizeErrorResponsePayload({} as never, res, vi.fn());
    res.json({ error: 'Gateway failed unexpectedly' });

    expect(jsonSpy).toHaveBeenCalledWith({
      error: 'Gateway failed unexpectedly',
      code: 'BAD_GATEWAY',
      message: 'Gateway failed unexpectedly',
    });
  });

  test('falls back to generic ERROR code for unknown statuses', () => {
    const jsonSpy = vi.fn();
    const res = {
      statusCode: 599,
      json: jsonSpy,
    } as unknown as Response;

    normalizeErrorResponsePayload({} as never, res, vi.fn());
    res.json({ error: 'Custom downstream error' });

    expect(jsonSpy).toHaveBeenCalledWith({
      error: 'Custom downstream error',
      code: 'ERROR',
      message: 'Custom downstream error',
    });
  });

  test('prefers explicit message field over error field when normalizing', () => {
    const jsonSpy = vi.fn();
    const res = {
      statusCode: 404,
      json: jsonSpy,
    } as unknown as Response;

    normalizeErrorResponsePayload({} as never, res, vi.fn());
    res.json({
      error: 'container not found',
      message: 'Route not found',
    });

    expect(jsonSpy).toHaveBeenCalledWith({
      error: 'Route not found',
      code: 'ROUTE_NOT_FOUND',
      message: 'Route not found',
    });
  });

  test('does not rewrite non-error or non-object payloads', () => {
    const jsonSpy = vi.fn();
    const res = {
      statusCode: 200,
      json: jsonSpy,
    } as unknown as Response;

    normalizeErrorResponsePayload({} as never, res, vi.fn());
    res.json('ok');
    res.statusCode = 500;
    res.json({ message: 'missing error string field' });

    expect(jsonSpy).toHaveBeenNthCalledWith(1, 'ok');
    expect(jsonSpy).toHaveBeenNthCalledWith(2, { message: 'missing error string field' });
  });
});
