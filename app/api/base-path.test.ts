import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
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

describe('createBasePathMiddleware behind a proxy that strips the prefix', () => {
  test('presents the external path on originalUrl, so path-scoped cookies and callbacks still match', () => {
    const req = { url: '/auth/oidc/x/cb?code=1', originalUrl: '/auth/oidc/x/cb?code=1' };
    const next = vi.fn() as unknown as NextFunction;
    createBasePathMiddleware('/drydock')(req as Request, {} as Response, next);
    expect(req.url).toBe('/auth/oidc/x/cb?code=1');
    expect(req.originalUrl).toBe('/drydock/auth/oidc/x/cb?code=1');
    expect(next).toHaveBeenCalledOnce();
  });

  test('leaves originalUrl alone once something upstream already rewrote it', () => {
    const req = { url: '/api/v1/app', originalUrl: '/mounted/api/v1/app' };
    createBasePathMiddleware('/drydock')(req as Request, {} as Response, vi.fn());
    expect(req.originalUrl).toBe('/mounted/api/v1/app');
  });

  describe.each([
    ['forwards the prefix', '/drydock'],
    ['strips the prefix', ''],
  ])('a session cookie scoped to the base path, when the proxy %s', (_shape, upstreamPrefix) => {
    let server: Server;
    let origin: string;

    beforeAll(async () => {
      const app = express();
      app.use(createBasePathMiddleware('/drydock'));
      app.use(
        session({
          secret: 'base-path-test',
          resave: false,
          saveUninitialized: false,
          cookie: { path: '/drydock' },
        }),
      );
      app.post('/auth/login', (req, res) => {
        (req.session as unknown as Record<string, unknown>).user = 'alice';
        res.status(200).end();
      });
      app.get('/api/v1/me', (req, res) => {
        res.json({ user: (req.session as unknown as Record<string, unknown>)?.user ?? null });
      });
      server = await new Promise<Server>((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      });
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    test('keeps the signed-in session on the next request', async () => {
      const login = await fetch(`${origin}${upstreamPrefix}/auth/login`, { method: 'POST' });
      const setCookie = login.headers.get('set-cookie');
      expect(setCookie).toContain('Path=/drydock');
      const cookie = (setCookie ?? '').split(';')[0];
      const me = await fetch(`${origin}${upstreamPrefix}/api/v1/me`, { headers: { cookie } });
      await expect(me.json()).resolves.toEqual({ user: 'alice' });
    });
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
