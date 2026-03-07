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
});
