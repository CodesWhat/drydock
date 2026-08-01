import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import Dockerode from 'dockerode';
import { describe, expect, test, vi } from 'vitest';
import { PortwingDockerBridge } from './PortwingDockerBridge.js';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('PortwingDockerBridge', () => {
  test('start is idempotent and stop before start is a no-op', async () => {
    const bridge = new PortwingDockerBridge({ requestDockerApi: vi.fn() });

    await expect(bridge.stop()).resolves.toBeUndefined();
    const endpoint = await bridge.start();
    try {
      await expect(bridge.start()).resolves.toBe(endpoint);
    } finally {
      await bridge.stop();
    }
  });

  test('fails closed when the listening server does not expose a TCP address', async () => {
    const address = vi.spyOn(http.Server.prototype, 'address').mockReturnValueOnce(null);
    const bridge = new PortwingDockerBridge({ requestDockerApi: vi.fn() });

    try {
      await expect(bridge.start()).rejects.toThrow(
        'Unable to determine Portwing Docker bridge address',
      );
    } finally {
      address.mockRestore();
      await bridge.stop();
    }
  });

  test('propagates a loopback listen error', async () => {
    const listen = vi.spyOn(http.Server.prototype, 'listen').mockImplementation(function (
      this: http.Server,
    ) {
      queueMicrotask(() => this.emit('error', new Error('loopback listen failed')));
      return this;
    });
    const bridge = new PortwingDockerBridge({ requestDockerApi: vi.fn() });

    try {
      await expect(bridge.start()).rejects.toThrow('loopback listen failed');
    } finally {
      listen.mockRestore();
      await bridge.stop();
    }
  });

  test('round-trips a real Dockerode version request with the bridge bearer header', async () => {
    const requestDockerApi = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        JSON.stringify({
          Version: '27.1.1',
          ApiVersion: '1.46',
          MinAPIVersion: '1.24',
          GitCommit: 'test',
          GoVersion: 'go1.23',
          Os: 'linux',
          Arch: 'amd64',
          KernelVersion: '6.8',
          BuildTime: '2026-08-01T00:00:00Z',
        }),
      ),
    });
    const bridge = new PortwingDockerBridge({ requestDockerApi });
    const endpoint = await bridge.start();
    const dockerApi = new Dockerode({
      host: endpoint.host,
      port: endpoint.port,
      protocol: 'http',
      headers: { Authorization: endpoint.authorization },
    });

    try {
      await expect(dockerApi.version()).resolves.toEqual(
        expect.objectContaining({ Version: '27.1.1', ApiVersion: '1.46' }),
      );
      expect(requestDockerApi).toHaveBeenCalledWith(
        'GET',
        '/version',
        expect.any(Object),
        undefined,
      );
    } finally {
      await bridge.stop();
    }
  });

  test('round-trips real Dockerode start, stop, restart, and inspect operations', async () => {
    const requestDockerApi = vi.fn((method: string, target: string) => {
      if (method === 'GET' && target === '/containers/c1/json') {
        return Promise.resolve({
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: Buffer.from(JSON.stringify({ Id: 'c1', State: { Status: 'running' } })),
        });
      }
      return Promise.resolve({ statusCode: 204, headers: {}, body: Buffer.alloc(0) });
    });
    const bridge = new PortwingDockerBridge({ requestDockerApi });
    const endpoint = await bridge.start();
    const dockerApi = new Dockerode({
      host: endpoint.host,
      port: endpoint.port,
      protocol: 'http',
      headers: { Authorization: endpoint.authorization },
    });
    const container = dockerApi.getContainer('c1');

    try {
      await container.start();
      await container.stop();
      await container.restart();
      await expect(container.inspect()).resolves.toEqual(
        expect.objectContaining({ Id: 'c1', State: { Status: 'running' } }),
      );
      expect(requestDockerApi.mock.calls.map(([method, target]) => [method, target])).toEqual([
        ['POST', '/containers/c1/start'],
        ['POST', '/containers/c1/stop'],
        ['POST', '/containers/c1/restart'],
        ['GET', '/containers/c1/json'],
      ]);
    } finally {
      await bridge.stop();
    }
  });

  test('authenticates the local request and forwards the exact Docker target, headers, and body', async () => {
    const requestDockerApi = vi.fn().mockResolvedValue({
      statusCode: 201,
      headers: { 'content-type': 'application/json', 'x-docker-id': 'created' },
      body: Buffer.from('{"Id":"c1"}'),
    });
    const bridge = new PortwingDockerBridge({ requestDockerApi });
    const endpoint = await bridge.start();

    try {
      const response = await fetch(`${endpoint.baseUrl}/v1.44/containers/create?name=web%2Fblue`, {
        method: 'POST',
        headers: {
          authorization: endpoint.authorization,
          'content-type': 'application/json',
          'x-registry-auth': 'registry-token',
        },
        body: '{"Image":"nginx:latest"}',
      });

      expect(response.status).toBe(201);
      expect(response.headers.get('x-docker-id')).toBe('created');
      expect(await response.text()).toBe('{"Id":"c1"}');
      expect(requestDockerApi).toHaveBeenCalledWith(
        'POST',
        '/v1.44/containers/create?name=web%2Fblue',
        expect.objectContaining({
          'content-type': 'application/json',
          'x-registry-auth': 'registry-token',
        }),
        Buffer.from('{"Image":"nginx:latest"}'),
      );
      expect(requestDockerApi.mock.calls[0][2]).not.toHaveProperty('authorization');
    } finally {
      await bridge.stop();
    }
  });

  test('rejects unauthenticated local callers before invoking the remote agent', async () => {
    const requestDockerApi = vi.fn();
    const bridge = new PortwingDockerBridge({ requestDockerApi });
    const endpoint = await bridge.start();

    try {
      const response = await fetch(`${endpoint.baseUrl}/v1.44/info`);
      expect(response.status).toBe(401);
      expect(requestDockerApi).not.toHaveBeenCalled();
    } finally {
      await bridge.stop();
    }
  });

  test('rejects a same-length incorrect bearer token with a constant-time comparison', async () => {
    const requestDockerApi = vi.fn();
    const bridge = new PortwingDockerBridge({ requestDockerApi });
    const endpoint = await bridge.start();

    try {
      const replacement = endpoint.authorization.endsWith('a') ? 'b' : 'a';
      const wrongAuthorization = `${endpoint.authorization.slice(0, -1)}${replacement}`;
      const response = await fetch(`${endpoint.baseUrl}/v1.44/info`, {
        headers: { authorization: wrongAuthorization },
      });
      expect(response.status).toBe(401);
      expect(requestDockerApi).not.toHaveBeenCalled();
    } finally {
      await bridge.stop();
    }
  });

  test('bounds request bodies and returns 413 without forwarding oversized payloads', async () => {
    const requestDockerApi = vi.fn();
    const bridge = new PortwingDockerBridge({ requestDockerApi }, { maxRequestBodyBytes: 4 });
    const endpoint = await bridge.start();

    try {
      const response = await fetch(`${endpoint.baseUrl}/v1.44/containers/create`, {
        method: 'POST',
        headers: { authorization: endpoint.authorization },
        body: '12345',
      });
      expect(response.status).toBe(413);
      expect(requestDockerApi).not.toHaveBeenCalled();
    } finally {
      await bridge.stop();
    }
  });

  test('keeps concurrent responses correlated when the remote requests complete out of order', async () => {
    const first = deferred<{
      statusCode: number;
      headers: Record<string, never>;
      body: Buffer;
    }>();
    const second = deferred<{
      statusCode: number;
      headers: Record<string, never>;
      body: Buffer;
    }>();
    const requestDockerApi = vi.fn((_, target: string) =>
      target.endsWith('/first') ? first.promise : second.promise,
    );
    const bridge = new PortwingDockerBridge({ requestDockerApi });
    const endpoint = await bridge.start();

    try {
      const firstResponse = fetch(`${endpoint.baseUrl}/v1.44/first`, {
        headers: { authorization: endpoint.authorization },
      });
      const secondResponse = fetch(`${endpoint.baseUrl}/v1.44/second`, {
        headers: { authorization: endpoint.authorization },
      });
      await vi.waitFor(() => expect(requestDockerApi).toHaveBeenCalledTimes(2));

      second.resolve({ statusCode: 200, headers: {}, body: Buffer.from('second') });
      first.resolve({ statusCode: 200, headers: {}, body: Buffer.from('first') });

      expect(await (await firstResponse).text()).toBe('first');
      expect(await (await secondResponse).text()).toBe('second');
    } finally {
      await bridge.stop();
    }
  });

  test('maps transport failures to a bounded 502 response without leaking error detail', async () => {
    const requestDockerApi = vi.fn().mockRejectedValue(new Error('secret upstream detail'));
    const bridge = new PortwingDockerBridge({ requestDockerApi });
    const endpoint = await bridge.start();

    try {
      const response = await fetch(`${endpoint.baseUrl}/v1.44/info`, {
        headers: { authorization: endpoint.authorization },
      });
      expect(response.status).toBe(502);
      const body = await response.text();
      expect(body).toContain('Portwing Docker transport failed');
      expect(body).not.toContain('secret upstream detail');
    } finally {
      await bridge.stop();
    }
  });

  test('rejects invalid upstream status codes and strips hop-by-hop response headers', async () => {
    const requestDockerApi = vi
      .fn()
      .mockResolvedValueOnce({ statusCode: 700, headers: {}, body: Buffer.alloc(0) })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: { connection: 'upgrade', 'x-forwarded-result': 'ok' },
        body: Buffer.from('ok'),
      });
    const bridge = new PortwingDockerBridge({ requestDockerApi });
    const endpoint = await bridge.start();

    try {
      const invalid = await fetch(`${endpoint.baseUrl}/v1.44/info`, {
        headers: { authorization: endpoint.authorization },
      });
      expect(invalid.status).toBe(502);

      const valid = await fetch(`${endpoint.baseUrl}/v1.44/info`, {
        headers: { authorization: endpoint.authorization },
      });
      expect(valid.status).toBe(200);
      expect(valid.headers.get('x-forwarded-result')).toBe('ok');
      expect(valid.headers.get('connection')).not.toBe('upgrade');
    } finally {
      await bridge.stop();
    }
  });

  test('normalizes array request headers and non-buffer request chunks', async () => {
    const requestDockerApi = vi.fn().mockResolvedValue({
      statusCode: 204,
      headers: {},
      body: Buffer.alloc(0),
    });
    const bridge = new PortwingDockerBridge({ requestDockerApi });
    const endpoint = await bridge.start();

    try {
      await new Promise<void>((resolve, reject) => {
        const request = http.request(
          `${endpoint.baseUrl}/v1.44/info`,
          {
            headers: {
              authorization: endpoint.authorization,
              'set-cookie': ['one=1', 'two=2'],
            },
          },
          (response) => {
            response.resume();
            response.once('end', resolve);
          },
        );
        request.once('error', reject);
        request.end();
      });
      expect(requestDockerApi).toHaveBeenCalledWith(
        'GET',
        '/v1.44/info',
        expect.objectContaining({ 'set-cookie': 'one=1, two=2' }),
        undefined,
      );

      const readBody = bridge as unknown as {
        readBody: (request: AsyncIterable<string>) => Promise<Buffer | undefined>;
      };
      const syntheticRequest = {
        async *[Symbol.asyncIterator]() {
          yield 'text-chunk';
        },
      };
      await expect(readBody.readBody(syntheticRequest)).resolves.toEqual(Buffer.from('text-chunk'));
    } finally {
      await bridge.stop();
    }
  });

  test('defaults missing request method and URL in the internal request boundary', async () => {
    const requestDockerApi = vi.fn().mockResolvedValue({
      statusCode: 204,
      headers: {},
      body: Buffer.alloc(0),
    });
    const bridge = new PortwingDockerBridge({ requestDockerApi });
    const endpoint = await bridge.start();
    const request = {
      headers: { authorization: endpoint.authorization },
      method: undefined,
      url: undefined,
      async *[Symbol.asyncIterator]() {},
    } as unknown as IncomingMessage;
    const response = {
      headersSent: false,
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
      writeHead: vi.fn(),
      destroy: vi.fn(),
    } as unknown as ServerResponse;

    try {
      const internal = bridge as unknown as {
        handle: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
      };
      await internal.handle(request, response);
      expect(requestDockerApi).toHaveBeenCalledWith('GET', '/', {}, undefined);
    } finally {
      await bridge.stop();
    }
  });

  test('destroys a response when transport failure happens after headers are sent', async () => {
    const requestDockerApi = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: Buffer.from('partial'),
    });
    const bridge = new PortwingDockerBridge({ requestDockerApi });
    const endpoint = await bridge.start();
    const originalSetHeader = http.ServerResponse.prototype.setHeader;
    const setHeader = vi
      .spyOn(http.ServerResponse.prototype, 'setHeader')
      .mockImplementation(function (this: ServerResponse, name, value) {
        if (String(name).toLowerCase() === 'content-length') {
          this.flushHeaders();
          throw new Error('response failed after headers');
        }
        return originalSetHeader.call(this, name, value);
      });

    try {
      const response = await fetch(`${endpoint.baseUrl}/v1.44/info`, {
        headers: { authorization: endpoint.authorization },
      });
      await expect(response.arrayBuffer()).rejects.toThrow();
    } finally {
      setHeader.mockRestore();
      await bridge.stop();
    }
  });
});
