import type { IncomingMessage } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { createBasePathMiddleware, stripBasePath, stripBasePathFromUpgrade } from './base-path.js';

describe('stripBasePath', () => {
  test.each([
    ['/drydock/api/v1/app', '/api/v1/app'],
    ['/drydock/', '/'],
    ['/drydock', '/'],
    ['/drydock?x=1', '/?x=1'],
    ['/drydock/containers?x=1', '/containers?x=1'],
    ['/api/v1/app', '/api/v1/app'],
    ['/drydockery/api', '/drydockery/api'],
    ['/other/drydock/api', '/other/drydock/api'],
  ])('maps %s to %s', (input, expected) => {
    expect(stripBasePath(input, '/drydock')).toBe(expected);
  });

  test('is a no-op without a base path', () => {
    expect(stripBasePath('/drydock/api', '')).toBe('/drydock/api');
  });

  test('handles nested base paths', () => {
    expect(stripBasePath('/tools/drydock/api/v1/events/ui', '/tools/drydock')).toBe(
      '/api/v1/events/ui',
    );
  });
});

describe('createBasePathMiddleware', () => {
  test('rewrites req.url, keeps originalUrl and calls next', () => {
    const req = {
      url: '/drydock/auth/oidc/x/cb?code=1',
      originalUrl: '/drydock/auth/oidc/x/cb?code=1',
    };
    const next = vi.fn() as unknown as NextFunction;
    createBasePathMiddleware('/drydock')(req as Request, {} as Response, next);
    expect(req.url).toBe('/auth/oidc/x/cb?code=1');
    expect(req.originalUrl).toBe('/drydock/auth/oidc/x/cb?code=1');
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('stripBasePathFromUpgrade', () => {
  test('rewrites the upgrade request url', () => {
    const request = { url: '/drydock/api/v1/log/stream?tail=5' } as IncomingMessage;
    stripBasePathFromUpgrade(request, '/drydock');
    expect(request.url).toBe('/api/v1/log/stream?tail=5');
  });

  test('treats a missing url as the root', () => {
    const request = {} as IncomingMessage;
    stripBasePathFromUpgrade(request, '/drydock');
    expect(request.url).toBe('/');
  });
});
