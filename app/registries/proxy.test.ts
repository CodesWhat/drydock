import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import {
  assertValidProxyUrl,
  ConnectProxyAgent,
  hasProxyEnvironment,
  resolveProxyForUrl,
  shouldBypassProxy,
  withOutboundProxy,
} from './proxy.js';

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

describe('registries/proxy', () => {
  describe('assertValidProxyUrl', () => {
    test('accepts http and https URLs', () => {
      expect(assertValidProxyUrl('http://u:p@proxy:3128', 'r')).toBe('http://u:p@proxy:3128');
      expect(assertValidProxyUrl('https://proxy', 'r')).toBe('https://proxy');
    });

    test.each([
      [undefined, 'non-empty'],
      ['   ', 'non-empty'],
      [42, 'non-empty'],
      ['not a url', 'not a valid URL'],
      ['socks5://proxy:1080', 'http:// or https://'],
    ])('rejects %p', (value, message) => {
      expect(() => assertValidProxyUrl(value, 'registry hub.x')).toThrow(message);
    });

    test('never echoes the value in the error', () => {
      expect(() => assertValidProxyUrl('socks5://user:hunter2@proxy', 'r')).toThrow(
        /^(?!.*hunter2)/,
      );
    });
  });

  describe('shouldBypassProxy', () => {
    const target = new URL('https://registry.example.com:8443/v2/');
    test.each([
      [undefined, false],
      ['', false],
      ['*', true],
      ['registry.example.com', true],
      ['.example.com', true],
      ['*.example.com', true],
      ['example.com', true],
      ['other.com, example.com', true],
      ['example.com:8443', true],
      ['example.com:9999', false],
      ['badexample.com', false],
      ['other.com,,', false],
    ])('%p -> %p', (noProxy, expected) => {
      expect(shouldBypassProxy(target, noProxy)).toBe(expected);
    });

    test('matches default ports and bracketed ipv6 hosts', () => {
      expect(shouldBypassProxy(new URL('https://a.test/'), 'a.test:443')).toBe(true);
      expect(shouldBypassProxy(new URL('http://a.test/'), 'a.test:80')).toBe(true);
      expect(shouldBypassProxy(new URL('http://[::1]:5000/'), '[::1]')).toBe(true);
    });
  });

  describe('resolveProxyForUrl', () => {
    test('returns undefined for missing, invalid or non-http targets', () => {
      expect(resolveProxyForUrl(undefined, 'http://p:1', {})).toBeUndefined();
      expect(resolveProxyForUrl('nope', 'http://p:1', {})).toBeUndefined();
      expect(resolveProxyForUrl('ftp://x/y', 'http://p:1', {})).toBeUndefined();
    });

    test('per-registry proxy wins over environment', () => {
      expect(
        resolveProxyForUrl('https://r.test/v2', 'http://reg:1', { HTTPS_PROXY: 'http://env:2' }),
      ).toBe('http://reg:1');
    });

    test('picks protocol specific variables, DD_ first', () => {
      const env = {
        DD_HTTPS_PROXY: 'http://dds:1',
        HTTPS_PROXY: 'http://std:1',
        DD_HTTP_PROXY: 'http://ddh:1',
        http_proxy: 'http://low:1',
      };
      expect(resolveProxyForUrl('https://r.test/', undefined, env)).toBe('http://dds:1');
      expect(resolveProxyForUrl('http://r.test/', undefined, env)).toBe('http://ddh:1');
      expect(resolveProxyForUrl('http://r.test/', undefined, { http_proxy: 'http://low:1' })).toBe(
        'http://low:1',
      );
      expect(resolveProxyForUrl('https://r.test/', undefined, {})).toBeUndefined();
    });

    test('NO_PROXY disables both configured and environment proxies', () => {
      expect(
        resolveProxyForUrl('https://r.internal/', 'http://reg:1', { NO_PROXY: '.internal' }),
      ).toBeUndefined();
      expect(
        resolveProxyForUrl('https://r.internal/', undefined, {
          HTTPS_PROXY: 'http://env:1',
          DD_NO_PROXY: 'r.internal',
        }),
      ).toBeUndefined();
    });
  });

  test('hasProxyEnvironment detects any proxy variable', () => {
    expect(hasProxyEnvironment({})).toBe(false);
    expect(hasProxyEnvironment({ NO_PROXY: ' ' })).toBe(false);
    expect(hasProxyEnvironment({ no_proxy: 'x' })).toBe(true);
    expect(hasProxyEnvironment({ DD_HTTPS_PROXY: 'http://p' })).toBe(true);
    expect(typeof hasProxyEnvironment()).toBe('boolean');
  });

  describe('withOutboundProxy', () => {
    test('leaves options untouched when nothing is configured', () => {
      const options = { url: 'https://r.test/v2' };
      expect(withOutboundProxy(options, undefined, {})).toBe(options);
    });

    test('disables axios env proxying when NO_PROXY bypasses', () => {
      expect(
        withOutboundProxy({ url: 'https://r.test/' }, undefined, {
          HTTPS_PROXY: 'http://p:1',
          NO_PROXY: 'r.test',
        }),
      ).toEqual({ url: 'https://r.test/', proxy: false });
      expect(
        withOutboundProxy({ url: 'https://r.test/' }, 'http://p:1', { NO_PROXY: '*' }),
      ).toEqual({ url: 'https://r.test/', proxy: false });
    });

    test('uses a CONNECT agent for https targets and reuses it', () => {
      const first = withOutboundProxy({ url: 'https://r.test/a' }, 'http://u:p@proxy:3128', {});
      const second = withOutboundProxy({ url: 'https://r.test/b' }, 'http://u:p@proxy:3128', {});
      expect(first.proxy).toBe(false);
      expect(first.httpsAgent).toBeInstanceOf(ConnectProxyAgent);
      expect(second.httpsAgent).toBe(first.httpsAgent);
    });

    test('keeps TLS options from an existing agent and caches per agent', () => {
      const base = new https.Agent({ rejectUnauthorized: false });
      const result = withOutboundProxy(
        { url: 'https://r.test/', httpsAgent: base },
        'http://p:1',
        {},
      );
      expect(
        (result.httpsAgent as unknown as { options: { rejectUnauthorized: boolean } }).options
          .rejectUnauthorized,
      ).toBe(false);
      expect(result.httpsAgent).not.toBe(base);
    });

    test('uses axios forward proxy config for http targets', () => {
      const result = withOutboundProxy(
        { url: 'http://r.test/v2' },
        'http://u:p%40x@proxy:3128',
        {},
      );
      expect(result.proxy).toEqual({
        host: 'proxy',
        port: 3128,
        protocol: 'http',
        auth: { username: 'u', password: 'p@x' },
      });
    });
  });

  describe('through real proxies', () => {
    let tmpDir: string;
    let originServer: https.Server;
    let originPort: number;
    let proxyServer: http.Server;
    let proxyPort: number;
    let connectRequests: Array<{ url?: string; auth?: string }>;
    let proxyMode: 'allow' | 'deny';
    let httpProxyServer: http.Server;
    let httpProxyPort: number;
    let httpProxyRequests: Array<{ url?: string; auth?: string }>;
    let httpOrigin: http.Server;
    let httpOriginPort: number;

    beforeAll(async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-proxy-'));
      const keyPath = path.join(tmpDir, 'key.pem');
      const certPath = path.join(tmpDir, 'cert.pem');
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          keyPath,
          '-out',
          certPath,
          '-subj',
          '/CN=localhost',
          '-days',
          '1',
        ],
        { stdio: 'ignore' },
      );
      originServer = https.createServer(
        { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
        (_req, res) => {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        },
      );
      originPort = await listen(originServer);

      proxyServer = http.createServer((_req, res) => {
        res.statusCode = 405;
        res.end();
      });
      proxyServer.on('connect', (req, clientSocket) => {
        connectRequests.push({ url: req.url, auth: req.headers['proxy-authorization'] as string });
        if (proxyMode === 'deny') {
          clientSocket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
          return;
        }
        const [host, port] = (req.url as string).split(':');
        const upstream = net.connect(Number(port), host, () => {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
        });
        upstream.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => upstream.destroy());
      });
      proxyPort = await listen(proxyServer);

      httpOrigin = http.createServer((_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ via: 'origin' }));
      });
      httpOriginPort = await listen(httpOrigin);

      httpProxyServer = http.createServer((req, res) => {
        httpProxyRequests.push({
          url: req.url,
          auth: req.headers['proxy-authorization'] as string,
        });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ via: 'proxy' }));
      });
      httpProxyPort = await listen(httpProxyServer);
    });

    afterAll(async () => {
      await Promise.all([
        close(originServer),
        close(proxyServer),
        close(httpOrigin),
        close(httpProxyServer),
      ]);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
      connectRequests = [];
      httpProxyRequests = [];
      proxyMode = 'allow';
    });

    const insecureAgent = () => new https.Agent({ rejectUnauthorized: false });

    test('tunnels an https registry call through an authenticated http proxy via CONNECT', async () => {
      const request = withOutboundProxy(
        { url: `https://localhost:${originPort}/v2/`, httpsAgent: insecureAgent() },
        `http://alice:s%3Acret@127.0.0.1:${proxyPort}`,
        {},
      );
      const response = await axios(request);
      expect(response.data).toEqual({ ok: true });
      expect(connectRequests).toEqual([
        {
          url: `localhost:${originPort}`,
          auth: `Basic ${Buffer.from('alice:s:cret').toString('base64')}`,
        },
      ]);
    });

    test('tunnels through an https proxy', async () => {
      const keyPath = path.join(tmpDir, 'key.pem');
      const certPath = path.join(tmpDir, 'cert.pem');
      const tlsProxy = https.createServer({
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      });
      tlsProxy.on('connect', (req, clientSocket) => {
        connectRequests.push({ url: req.url, auth: req.headers['proxy-authorization'] as string });
        const [host, port] = (req.url as string).split(':');
        const upstream = net.connect(Number(port), host, () => {
          clientSocket.write('HTTP/1.1 200 OK\r\n\r\n');
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
        });
        upstream.on('error', () => clientSocket.destroy());
      });
      const tlsProxyPort = await listen(tlsProxy);
      const request = withOutboundProxy(
        { url: `https://localhost:${originPort}/`, httpsAgent: insecureAgent() },
        `https://127.0.0.1:${tlsProxyPort}`,
        {},
      );
      const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      try {
        const response = await axios(request);
        expect(response.data).toEqual({ ok: true });
        expect(connectRequests).toHaveLength(1);
      } finally {
        if (previous === undefined) {
          delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        } else {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
        }
        (request.httpsAgent as https.Agent).destroy();
        await close(tlsProxy);
      }
    });

    test('uses the global environment proxy for https targets', async () => {
      const request = withOutboundProxy(
        { url: `https://localhost:${originPort}/`, httpsAgent: insecureAgent() },
        undefined,
        { DD_HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` },
      );
      await axios(request);
      expect(connectRequests).toHaveLength(1);
    });

    test('NO_PROXY skips the proxy', async () => {
      const request = withOutboundProxy(
        { url: `https://localhost:${originPort}/`, httpsAgent: insecureAgent() },
        `http://127.0.0.1:${proxyPort}`,
        { NO_PROXY: 'localhost' },
      );
      const response = await axios(request);
      expect(response.data).toEqual({ ok: true });
      expect(connectRequests).toHaveLength(0);
    });

    test('rejects with a credential free message when the proxy refuses CONNECT', async () => {
      proxyMode = 'deny';
      const request = withOutboundProxy(
        { url: `https://localhost:${originPort}/`, httpsAgent: insecureAgent() },
        `http://alice:hunter2@127.0.0.1:${proxyPort}`,
        {},
      );
      const error = await axios(request).catch((e: Error) => e);
      expect((error as Error).message).toContain('refused CONNECT');
      expect((error as Error).message).toContain('407');
      expect((error as Error).message).not.toContain('hunter2');
    });

    test('rejects with a credential free message when the proxy is unreachable', async () => {
      const unused = net.createServer();
      const deadPort = await listen(unused);
      await close(unused);
      const request = withOutboundProxy(
        { url: `https://localhost:${originPort}/`, httpsAgent: insecureAgent() },
        `http://alice:hunter2@127.0.0.1:${deadPort}`,
        {},
      );
      const error = await axios(request).catch((e: Error) => e);
      expect((error as Error).message).toContain('connection failed');
      expect((error as Error).message).not.toContain('hunter2');
    });

    test('forwards http targets to an authenticated http proxy', async () => {
      const request = withOutboundProxy(
        { url: `http://127.0.0.1:${httpOriginPort}/v2/` },
        `http://bob:pw@127.0.0.1:${httpProxyPort}`,
        {},
      );
      const response = await axios(request);
      expect(response.data).toEqual({ via: 'proxy' });
      expect(httpProxyRequests[0].url).toBe(`http://127.0.0.1:${httpOriginPort}/v2/`);
      expect(httpProxyRequests[0].auth).toBe(`Basic ${Buffer.from('bob:pw').toString('base64')}`);
    });

    test('keeps an explicit servername and tolerates malformed percent-encoding in userinfo', async () => {
      const agent = new ConnectProxyAgent(`http://al%ZZ:p%ZZ@127.0.0.1:${proxyPort}`, {});
      const callback = vi.fn();
      agent.createConnection(
        { host: 'localhost', port: originPort, servername: 'localhost', rejectUnauthorized: false },
        callback,
      );
      await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(null, expect.anything()));
      expect(connectRequests[0].auth).toBe(`Basic ${Buffer.from('al%ZZ:p%ZZ').toString('base64')}`);
      callback.mock.calls[0][1].destroy();
      agent.destroy();
    });

    test('defaults the target host and port when none are given', async () => {
      const agent = new ConnectProxyAgent(`http://127.0.0.1:${proxyPort}`, {});
      const callback = vi.fn();
      agent.createConnection({}, callback);
      await vi.waitFor(() => expect(connectRequests).toHaveLength(1));
      expect(connectRequests[0].url).toBe('localhost:443');
      agent.destroy();
    });

    test.each(['http://127.0.0.1', 'https://127.0.0.1'])(
      'falls back to the default port for %s',
      async (proxyUrl) => {
        const agent = new ConnectProxyAgent(proxyUrl, {});
        const callback = vi.fn();
        agent.createConnection({ host: 'localhost', port: 1 }, callback);
        await vi.waitFor(() => expect(callback).toHaveBeenCalled());
        expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
        agent.destroy();
      },
    );

    test('supports ipv6 literal targets in the CONNECT authority', async () => {
      const agent = new ConnectProxyAgent(`http://127.0.0.1:${proxyPort}`, {
        rejectUnauthorized: false,
      });
      const callback = vi.fn();
      agent.createConnection({ host: '::1', port: 1 }, callback);
      await vi.waitFor(() => expect(connectRequests).toHaveLength(1));
      expect(connectRequests[0].url).toBe('[::1]:1');
      agent.destroy();
    });
  });
});
