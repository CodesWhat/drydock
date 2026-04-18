import {
  createContainerFixture,
  createMockRequest,
  createMockResponse,
  runMiddleware,
} from './helpers.js';

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

  test('createMockRequest returns undefined for missing and non-string header values', () => {
    const req = createMockRequest({
      headers: {
        'x-trace-id': 12345,
      },
    });

    expect(req.get('missing-header')).toBeUndefined();
    expect(req.header('x-trace-id')).toBeUndefined();
  });

  test('createMockResponse exposes header helpers and terminal writers', () => {
    const res = createMockResponse() as ReturnType<typeof createMockResponse> & {
      body?: unknown;
      headersSent: boolean;
      statusCode: number;
      getHeader: (name: string) => unknown;
    };

    res.set('X-Trace-Id', 'trace-1');
    res.set({ ETag: '"123"', 'Cache-Control': 'no-store' });
    res.setHeader('Retry-After', 60);
    res.type('application/json');

    expect(res.getHeader('x-trace-id')).toBe('trace-1');
    expect(res.getHeader('etag')).toBe('"123"');
    expect(res.getHeader('cache-control')).toBe('no-store');
    expect(res.getHeader('retry-after')).toBe(60);
    expect(res.getHeader('content-type')).toBe('application/json');

    res.send('payload');
    expect(res.body).toBe('payload');
    expect(() => res.sendStatus(418)).toThrow(
      'Cannot set headers after they are sent to the client',
    );
  });

  test('createMockResponse end writes the response body', () => {
    const res = createMockResponse() as ReturnType<typeof createMockResponse> & {
      body?: unknown;
      headersSent: boolean;
    };

    res.end('done');

    expect(res.headersSent).toBe(true);
    expect(res.body).toBe('done');
  });

  test('createMockResponse sendStatus falls back to the numeric status when no reason phrase exists', () => {
    const res = createMockResponse() as ReturnType<typeof createMockResponse> & {
      body?: unknown;
      headersSent: boolean;
      statusCode: number;
    };

    res.sendStatus(599);

    expect(res.statusCode).toBe(599);
    expect(res.body).toBe('599');
    expect(res.headersSent).toBe(true);
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

  test('runMiddleware resolves when middleware calls next without an error', async () => {
    const req = createMockRequest({ method: 'POST' });
    const res = createMockResponse();

    const result = await runMiddleware(
      (_req, _res, next) => {
        next();
      },
      { req, res },
    );

    expect(result.req).toBe(req);
    expect(result.res).toBe(res);
    expect(result.next).toHaveBeenCalledOnce();
  });

  test('runMiddleware ignores later throws after next already resolved', async () => {
    await expect(
      runMiddleware((_req, _res, next) => {
        next();
        throw new Error('too late');
      }),
    ).resolves.toMatchObject({
      next: expect.any(Function),
    });
  });

  test('runMiddleware ignores later next calls after settling', async () => {
    const result = await runMiddleware((_req, _res, next) => {
      next();
      next(new Error('too late'));
    });

    expect(result.next).toHaveBeenCalledTimes(2);
  });

  test('runMiddleware rejects when middleware throws before settling', async () => {
    await expect(
      runMiddleware(() => {
        throw new Error('sync failure');
      }),
    ).rejects.toThrow('sync failure');
  });

  test('runMiddleware rejects when middleware returns a rejected promise', async () => {
    await expect(
      runMiddleware(async () => {
        throw new Error('async failure');
      }),
    ).rejects.toThrow('async failure');
  });

  test('createContainerFixture applies overrides on top of the default fixture', () => {
    expect(
      createContainerFixture({
        name: 'api',
        result: { tag: '2.0.0' },
      }),
    ).toEqual(
      expect.objectContaining({
        id: 'container-123456789',
        name: 'api',
        watcher: 'test',
        result: { tag: '2.0.0' },
      }),
    );
  });
});
