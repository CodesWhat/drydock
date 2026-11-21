import type { AddressInfo } from 'node:net';
import express, { type Request, type Response } from 'express';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetState, handlerCalls } = vi.hoisted(() => ({
  mockGetState: vi.fn(() => ({ watcher: { 'docker.local': {} } })),
  handlerCalls: vi.fn(),
}));

vi.mock('../../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  },
}));
vi.mock('../../configuration/index.js', () => ({
  getServerConfiguration: () => ({ port: 0, tls: { enabled: false }, cors: { enabled: false } }),
}));
vi.mock('../../registry/index.js', () => ({ getState: mockGetState }));
vi.mock('../../log/buffer.js', () => ({ getEntries: vi.fn().mockReturnValue([]) }));
vi.mock('./watcher-inventory.js', () => ({
  refreshWatcherInventory: (_req: Request, res: Response) => {
    handlerCalls('inventory');
    res.status(200).json({ ran: true });
  },
}));

vi.mock('./container.js', () => ({
  getContainers: (_req: Request, res: Response) => {
    handlerCalls('getContainers');
    res.status(200).json({ ran: true });
  },
  getContainerLogs: (_req: Request, res: Response) => {
    handlerCalls('getContainerLogs');
    res.status(200).json({ ran: true });
  },
  getContainerEnv: (_req: Request, res: Response) => {
    handlerCalls('getContainerEnv');
    res.status(200).json({ ran: true });
  },
  deleteContainer: (_req: Request, res: Response) => {
    handlerCalls('deleteContainer');
    res.status(200).json({ ran: true });
  },
}));
vi.mock('./watcher.js', () => ({
  getWatcher: (_req: Request, res: Response) => {
    handlerCalls('getWatcher');
    res.status(200).json({ ran: true });
  },
  getWatchers: (_req: Request, res: Response) => {
    handlerCalls('getWatchers');
    res.status(200).json({ ran: true });
  },
  watchWatcher: (_req: Request, res: Response) => {
    handlerCalls('watchWatcher');
    res.status(200).json({ ran: true });
  },
  watchContainer: (_req: Request, res: Response) => {
    handlerCalls('watchContainer');
    res.status(200).json({ ran: true });
  },
}));
vi.mock('./trigger.js', () => ({
  getTriggers: (_req: Request, res: Response) => {
    handlerCalls('getTriggers');
    res.status(200).json({ ran: true });
  },
  runTrigger: (_req: Request, res: Response) => {
    handlerCalls('runTrigger');
    res.status(200).json({ ran: true });
  },
  runTriggerBatch: (_req: Request, res: Response) => {
    handlerCalls('runTriggerBatch');
    res.status(200).json({ ran: true });
  },
}));
vi.mock('./event.js', () => ({
  initEvents: vi.fn(),
  subscribeEvents: (_req: Request, res: Response) => {
    handlerCalls('subscribeEvents');
    res.status(200).json({ ran: true });
    return true;
  },
}));

import { init } from './index.js';

const SECRET = 'real-agent-secret';

const PROTECTED_ROUTES: [string, string][] = [
  ['GET', '/api/log/entries'],
  ['GET', '/api/containers'],
  ['GET', '/api/containers/abc/logs'],
  ['GET', '/api/containers/abc/env'],
  ['DELETE', '/api/containers/abc'],
  ['GET', '/api/watchers'],
  ['GET', '/api/watchers/docker/local'],
  ['GET', '/api/triggers'],
  ['GET', '/api/events'],
  ['POST', '/api/triggers/docker/local'],
  ['POST', '/api/triggers/docker/local/batch'],
  ['POST', '/api/watchers/docker/local'],
  ['POST', '/api/watchers/docker/local/inventory'],
  ['POST', '/api/watchers/docker/local/container/abc'],
];

describe('Agent API on real Express', () => {
  const originalEnv = { ...process.env };
  let baseUrl: string;
  const servers: { close: (cb?: () => void) => unknown }[] = [];
  let listenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({ watcher: { 'docker.local': {} } });
    process.env.DD_AGENT_SECRET = SECRET;
    const originalListen = express.application.listen;
    let resolveServer: (server: import('node:http').Server) => void;
    const serverReady = new Promise<import('node:http').Server>((resolve) => {
      resolveServer = resolve;
    });
    listenSpy = vi.spyOn(express.application, 'listen').mockImplementation(function (
      this: unknown,
      ...args: unknown[]
    ) {
      const server = (originalListen as (...a: unknown[]) => import('node:http').Server).call(
        this,
        0,
        '127.0.0.1',
        args[args.length - 1],
      );
      servers.push(server);
      server.once('listening', () => resolveServer(server));
      return server;
    } as never);
    await init();
    const server = await serverReady;
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    listenSpy.mockRestore();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
            server.close(() => resolve());
          }),
      ),
    );
    process.env = { ...originalEnv };
  });

  test.each(PROTECTED_ROUTES)(
    'rejects %s %s without the agent secret before any handler runs',
    async (method, path) => {
      const response = await fetch(`${baseUrl}${path}`, { method });

      expect(response.status).toBe(401);
      expect(handlerCalls).not.toHaveBeenCalled();
    },
  );

  test.each(PROTECTED_ROUTES)('rejects %s %s with a wrong agent secret', async (method, path) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'x-dd-agent-secret': 'wrong-secret' },
    });

    expect(response.status).toBe(401);
    expect(handlerCalls).not.toHaveBeenCalled();
  });

  test('keeps /health unauthenticated', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
  });

  test('reaches the handler when the correct secret is presented', async () => {
    const response = await fetch(`${baseUrl}/api/containers/abc/env`, {
      headers: { 'x-dd-agent-secret': SECRET },
    });

    expect(response.status).toBe(200);
    expect(handlerCalls).toHaveBeenCalledWith('getContainerEnv');
  });

  test('throttles wrong-secret attempts with the real limiter: request 301 gets 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 301; i += 1) {
      const response = await fetch(`${baseUrl}/api/containers`, {
        headers: { 'x-dd-agent-secret': 'wrong-secret' },
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 300).every((status) => status === 401)).toBe(true);
    expect(statuses[300]).toBe(429);
    expect(handlerCalls).not.toHaveBeenCalled();
  }, 60_000);

  test('leaves /health unthrottled when the limiter is exhausted', async () => {
    for (let i = 0; i < 301; i += 1) {
      await fetch(`${baseUrl}/api/containers`);
    }

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
  }, 60_000);
});
