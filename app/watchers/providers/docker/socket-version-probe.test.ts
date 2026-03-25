import { EventEmitter } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { probeSocketApiVersion } from './socket-version-probe.js';

function createFakeSocket(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): {
  socketPath: string;
  server: http.Server;
} {
  const socketPath = `/tmp/drydock-test-probe-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
  const server = http.createServer(handler);
  return { socketPath, server };
}

function listenOnSocket(server: http.Server, socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    server.listen(socketPath, () => resolve());
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe('probeSocketApiVersion', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const server of servers) {
      await closeServer(server);
    }
    servers.length = 0;
    vi.restoreAllMocks();
  });

  test('returns ApiVersion from daemon /version endpoint', async () => {
    const { socketPath, server } = createFakeSocket((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ApiVersion: '1.44', Version: '27.5.1' }));
    });
    servers.push(server);
    await listenOnSocket(server, socketPath);

    const version = await probeSocketApiVersion(socketPath);

    expect(version).toBe('1.44');
  });

  test('follows a single redirect and returns the version', async () => {
    const { socketPath, server } = createFakeSocket((req, res) => {
      if (req.url === '/version') {
        res.writeHead(301, { Location: '/v5.0.0/version' });
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ApiVersion: '5.0.0' }));
      }
    });
    servers.push(server);
    await listenOnSocket(server, socketPath);

    const version = await probeSocketApiVersion(socketPath);

    expect(version).toBe('5.0.0');
  });

  test('returns undefined when socket does not exist', async () => {
    const version = await probeSocketApiVersion('/tmp/nonexistent-drydock-test.sock');

    expect(version).toBeUndefined();
  });

  test('returns undefined when daemon returns non-JSON', async () => {
    const { socketPath, server } = createFakeSocket((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('not json');
    });
    servers.push(server);
    await listenOnSocket(server, socketPath);

    const version = await probeSocketApiVersion(socketPath);

    expect(version).toBeUndefined();
  });

  test('returns undefined when response has no ApiVersion field', async () => {
    const { socketPath, server } = createFakeSocket((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ Version: '27.5.1' }));
    });
    servers.push(server);
    await listenOnSocket(server, socketPath);

    const version = await probeSocketApiVersion(socketPath);

    expect(version).toBeUndefined();
  });

  test('returns undefined when daemon returns 500', async () => {
    const { socketPath, server } = createFakeSocket((_req, res) => {
      res.writeHead(500);
      res.end('Internal Server Error');
    });
    servers.push(server);
    await listenOnSocket(server, socketPath);

    const version = await probeSocketApiVersion(socketPath);

    expect(version).toBeUndefined();
  });

  test('returns undefined when connection is immediately closed', async () => {
    const socketPath = `/tmp/drydock-test-probe-close-${Date.now()}.sock`;
    const server = net.createServer((socket) => {
      socket.destroy();
    });
    servers.push(server as unknown as http.Server);
    await new Promise<void>((resolve) => {
      server.listen(socketPath, () => resolve());
    });

    const version = await probeSocketApiVersion(socketPath);

    expect(version).toBeUndefined();
  });

  test('returns undefined and destroys the request when the probe times out', async () => {
    const request = new EventEmitter() as http.ClientRequest;
    const destroy = vi.fn();
    const end = vi.fn(() => {
      request.emit('timeout');
      return request;
    });

    Object.assign(request, {
      destroy,
      end,
    });

    vi.spyOn(http, 'request').mockImplementation((_options, _callback) => request);

    const version = await probeSocketApiVersion('/tmp/drydock-test-probe-timeout.sock');

    expect(version).toBeUndefined();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test('returns undefined when the response stream errors', async () => {
    const request = new EventEmitter() as http.ClientRequest;
    const response = new EventEmitter() as http.IncomingMessage;
    const end = vi.fn(() => {
      response.statusCode = 200;
      response.headers = {};
      response.setEncoding = vi.fn();
      const requestSpy = vi.mocked(http.request);
      const responseHandler = requestSpy.mock.calls.at(-1)?.[1] as
        | ((res: http.IncomingMessage) => void)
        | undefined;
      responseHandler?.(response);
      response.emit('error', new Error('stream failed'));
      return request;
    });

    Object.assign(request, {
      destroy: vi.fn(),
      end,
    });

    vi.spyOn(http, 'request').mockImplementation((_options, _callback) => request);

    const version = await probeSocketApiVersion('/tmp/drydock-test-probe-response-error.sock');

    expect(version).toBeUndefined();
  });
});
