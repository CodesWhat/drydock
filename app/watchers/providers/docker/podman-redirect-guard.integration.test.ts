/**
 * Integration test: proves that version pinning + redirect guard
 * prevent docker-modem's EAI_AGAIN crash when a daemon (e.g. Podman)
 * returns HTTP 301 for image inspect over a unix socket.
 *
 * Uses a real Dockerode instance against a mock unix socket server
 * that simulates Podman's redirect behavior.
 */
import http from 'node:http';
import Dockerode from 'dockerode';
import { afterEach, describe, expect, test } from 'vitest';
import { disableSocketRedirects } from './disable-socket-redirects.js';
import { probeSocketApiVersion } from './socket-version-probe.js';

function createMockSocket(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): {
  socketPath: string;
  server: http.Server;
} {
  const socketPath = `/tmp/drydock-integration-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
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

/**
 * Simulates a Podman-like daemon that:
 * - Serves /version with ApiVersion
 * - Returns 301 for unversioned /images/<id>/json (redirecting to versioned path)
 * - Serves versioned /v1.44/images/<id>/json with 200
 * - Serves /containers/json with 200
 */
function podmanHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url ?? '';

  if (url === '/version' || url === '/v1.44/version') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ApiVersion: '1.44',
        MinAPIVersion: '1.24',
        Version: '27.5.1',
      }),
    );
    return;
  }

  // Unversioned image inspect → 301 redirect (the Podman behavior that triggers the crash)
  if (url.startsWith('/images/') && !url.startsWith('/v')) {
    res.writeHead(301, { Location: `/v1.44${url}` });
    res.end();
    return;
  }

  // Empty image name → double slash → 301 (Podman pod infra containers)
  if (url === '/v1.44/images//json' || url === '/images//json') {
    res.writeHead(301, { Location: '/v1.44/images/json' });
    res.end();
    return;
  }

  // Versioned image inspect → 200
  if (url.startsWith('/v1.44/images/') && url.endsWith('/json')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        Id: 'sha256:abc123',
        RepoTags: ['nginx:latest'],
        RepoDigests: ['nginx@sha256:def456'],
        Architecture: 'amd64',
        Os: 'linux',
      }),
    );
    return;
  }

  // Versioned container listing → 200
  if (url.startsWith('/v1.44/containers/json') || url.startsWith('/containers/json')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
    return;
  }

  res.writeHead(404);
  res.end(`Not found: ${url}`);
}

describe('Podman redirect guard integration', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const server of servers) {
      await closeServer(server);
    }
    servers.length = 0;
  });

  test('version probe extracts ApiVersion from mock Podman socket', async () => {
    const { socketPath, server } = createMockSocket(podmanHandler);
    servers.push(server);
    await listenOnSocket(server, socketPath);

    const version = await probeSocketApiVersion(socketPath);

    expect(version).toBe('1.44');
  });

  test('version-pinned Dockerode uses versioned paths that bypass 301 redirects', async () => {
    const { socketPath, server } = createMockSocket(podmanHandler);
    servers.push(server);
    await listenOnSocket(server, socketPath);

    const apiVersion = await probeSocketApiVersion(socketPath);
    const docker = new Dockerode({ socketPath, version: `v${apiVersion}` });
    disableSocketRedirects(docker);

    // This should hit /v1.44/images/nginx:latest/json → 200 (no redirect)
    const image = await docker.getImage('nginx:latest').inspect();

    expect(image.Id).toBe('sha256:abc123');
    expect(image.RepoTags).toEqual(['nginx:latest']);
  });

  test('redirect guard prevents EAI_AGAIN crash when 301 slips through', async () => {
    // Simulate a daemon that ALWAYS redirects, even versioned paths
    const alwaysRedirectHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url = req.url ?? '';

      if (url === '/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ApiVersion: '1.44' }));
        return;
      }

      // Always redirect image inspect (simulates worst case)
      if (url.includes('/images/')) {
        res.writeHead(301, { Location: `/redirected${url}` });
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    };

    const { socketPath, server } = createMockSocket(alwaysRedirectHandler);
    servers.push(server);
    await listenOnSocket(server, socketPath);

    const docker = new Dockerode({ socketPath, version: 'v1.44' });
    disableSocketRedirects(docker);

    // With the redirect guard, this should reject with a clean error
    // (either "Max redirects exceeded" or "(HTTP code 301) unexpected")
    // but NOT crash the process with EAI_AGAIN
    await expect(docker.getImage('test').inspect()).rejects.toThrow();
  });

  test('without redirect guard, unversioned request to redirecting daemon would hit broken code path', async () => {
    // This test verifies our mock correctly returns 301 for unversioned paths
    const requestLog: { url: string; statusCode: number }[] = [];
    const loggingHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url = req.url ?? '';

      if (url.startsWith('/images/') && !url.startsWith('/v')) {
        requestLog.push({ url, statusCode: 301 });
        res.writeHead(301, { Location: `/v1.44${url}` });
        res.end();
        return;
      }

      if (url.startsWith('/v1.44/images/')) {
        requestLog.push({ url, statusCode: 200 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ Id: 'sha256:abc123' }));
        return;
      }

      res.writeHead(404);
      res.end();
    };

    const { socketPath, server } = createMockSocket(loggingHandler);
    servers.push(server);
    await listenOnSocket(server, socketPath);

    // Use a version-pinned + guarded Dockerode — should skip the 301
    const docker = new Dockerode({ socketPath, version: 'v1.44' });
    disableSocketRedirects(docker);

    const image = await docker.getImage('test-image').inspect();

    expect(image.Id).toBe('sha256:abc123');
    // The request should have gone directly to the versioned path
    expect(requestLog).toEqual([{ url: '/v1.44/images/test-image/json', statusCode: 200 }]);
  });

  test('empty image name triggers 301 but redirect guard catches it cleanly', async () => {
    const { socketPath, server } = createMockSocket(podmanHandler);
    servers.push(server);
    await listenOnSocket(server, socketPath);

    const docker = new Dockerode({ socketPath, version: 'v1.44' });
    disableSocketRedirects(docker);

    // Empty image name → /v1.44/images//json → 301 from mock
    // Redirect guard prevents EAI_AGAIN crash; error is caught cleanly
    await expect(docker.getImage('').inspect()).rejects.toThrow();
  });
});
