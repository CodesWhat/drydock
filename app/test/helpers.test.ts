import { createMockRequest, createMockResponse, runMiddleware } from './helpers.js';

describe('test helpers', () => {
  test('createMockResponse marks headersSent and rejects duplicate writes', () => {
    const res = createMockResponse() as ReturnType<typeof createMockResponse> & {
      body?: unknown;
      headersSent: boolean;
      statusCode: number;
    };

    expect(res.headersSent).toBe(false);

    res.status(201).json({ ok: true });

    expect(res.statusCode).toBe(201);
    expect(res.headersSent).toBe(true);
    expect(res.body).toEqual({ ok: true });
    expect(() => res.send({ again: true })).toThrow(
      'Cannot set headers after they are sent to the client',
    );
  });

  test('createMockRequest resolves headers via case-insensitive get/header helpers', () => {
    const req = createMockRequest({
      headers: {
        Host: 'drydock.example.com',
        'x-forwarded-proto': ['https', 'http'],
      },
    });

    expect(req.get('host')).toBe('drydock.example.com');
    expect(req.header('X-Forwarded-Proto')).toBe('https, http');
  });

  test('runMiddleware rejects when middleware calls next with error', async () => {
    const middleware = (_req, _res, next) => {
      next(new Error('middleware failed'));
    };

    await expect(runMiddleware(middleware as any)).rejects.toThrow('middleware failed');
  });

  test('runMiddleware resolves when middleware ends the response without calling next', async () => {
    const { res, next } = await runMiddleware((_req, response) => {
      response.status(403).json({ error: 'forbidden' });
    });
    const typedResponse = res as typeof res & {
      body?: unknown;
      headersSent: boolean;
      statusCode: number;
    };

    expect(next).not.toHaveBeenCalled();
    expect(typedResponse.statusCode).toBe(403);
    expect(typedResponse.headersSent).toBe(true);
    expect(typedResponse.body).toEqual({ error: 'forbidden' });
  });
});
