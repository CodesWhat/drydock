import type { Response } from 'express';
import { describe, expect, test, vi } from 'vitest';
import { sendErrorResponse } from './error-response.js';

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
