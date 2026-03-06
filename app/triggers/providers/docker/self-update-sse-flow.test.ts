import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockDockerodeCtor = vi.hoisted(() => vi.fn());

vi.mock('dockerode', () => ({
  default: mockDockerodeCtor,
}));

import * as sseRouter from '../../../api/sse.js';
import { clearAllListenersForTests, emitSelfUpdateStarting } from '../../../event/index.js';
import { executeSelfUpdateTransition } from './SelfUpdateTransitionShared.js';
import { runSelfUpdateController } from './self-update-controller.js';

const CONTROLLER_ENV_KEYS = [
  'DD_SELF_UPDATE_OP_ID',
  'DD_SELF_UPDATE_OLD_CONTAINER_ID',
  'DD_SELF_UPDATE_NEW_CONTAINER_ID',
  'DD_SELF_UPDATE_OLD_CONTAINER_NAME',
  'DD_SELF_UPDATE_START_TIMEOUT_MS',
  'DD_SELF_UPDATE_HEALTH_TIMEOUT_MS',
  'DD_SELF_UPDATE_POLL_INTERVAL_MS',
] as const;

function getRouteHandler(router: any, path: string, method: 'get' | 'post') {
  const layer = router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods?.[method],
  );
  if (!layer) {
    throw new Error(`Unable to find route handler for ${method.toUpperCase()} ${path}`);
  }
  return layer.route.stack[0].handle;
}

function createSseRequest(ip = '127.0.0.1', sessionID = `session-${ip}`) {
  const listeners: Record<string, () => void> = {};
  return {
    ip,
    sessionID,
    on: vi.fn((event: string, handler: () => void) => {
      listeners[event] = handler;
    }),
    _listeners: listeners,
  };
}

function createSseResponse() {
  const listeners: Record<string, () => void> = {};
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    flush: vi.fn(),
    flushHeaders: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      listeners[event] = handler;
    }),
    _listeners: listeners,
  };
}

function createJsonResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

function parseSseEventPayload(res: ReturnType<typeof createSseResponse>, eventName: string) {
  const call = res.write.mock.calls.find(
    ([payload]) => typeof payload === 'string' && payload.startsWith(`event: ${eventName}\n`),
  );
  if (!call) {
    throw new Error(`Missing SSE event ${eventName}`);
  }
  const dataSection = call[0].split('\ndata: ')[1];
  return JSON.parse((dataSection || '{}').trim());
}

function parseEnvEntry(entry: string): [string, string] {
  const separatorIndex = entry.indexOf('=');
  if (separatorIndex < 0) {
    return [entry, ''];
  }
  return [entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1)];
}

async function runControllerWithEnvFromHelper(helperEnv: string[], runner: () => Promise<void>) {
  const previous = new Map<string, string | undefined>();
  const helperEnvMap = new Map(helperEnv.map(parseEnvEntry));

  for (const key of CONTROLLER_ENV_KEYS) {
    previous.set(key, process.env[key]);
    const value = helperEnvMap.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await runner();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('self-update SSE flow integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseRouter._resetInitializationStateForTests();
    sseRouter._clients.clear();
    sseRouter._activeSseClientRegistry.clear();
    sseRouter._connectionsPerIp.clear();
    sseRouter._connectionsPerSession.clear();
    sseRouter._clearPendingSelfUpdateAcks();
    clearAllListenersForTests();
  });

  afterEach(() => {
    sseRouter._resetInitializationStateForTests();
    sseRouter._clients.clear();
    sseRouter._activeSseClientRegistry.clear();
    sseRouter._connectionsPerIp.clear();
    sseRouter._connectionsPerSession.clear();
    sseRouter._clearPendingSelfUpdateAcks();
    clearAllListenersForTests();
    vi.restoreAllMocks();
  });

  test('broadcasts self-update, accepts ACK, then runs controller health gate', async () => {
    const operationId = 'op-self-update-flow';
    const router = sseRouter.init();
    const eventsHandler = getRouteHandler(router, '/', 'get');
    const ackHandler = getRouteHandler(router, '/self-update/:operationId/ack', 'post');
    const sseReq = createSseRequest();
    const sseRes = createSseResponse();
    eventsHandler(sseReq, sseRes);

    const connectedPayload = parseSseEventPayload(sseRes, 'dd:connected');
    expect(connectedPayload.clientId).toMatch(/^sse-client-/);
    expect(connectedPayload.clientToken).toMatch(/^sse-token-/);

    const emitPromise = emitSelfUpdateStarting({
      opId: operationId,
      requiresAck: true,
      ackTimeoutMs: 1000,
      startedAt: new Date().toISOString(),
    });

    await Promise.resolve();
    expect(sseRes.write).toHaveBeenCalledWith(
      expect.stringContaining(`event: dd:self-update\ndata: {"opId":"${operationId}"`),
    );
    expect(sseRouter._pendingSelfUpdateAcks.has(operationId)).toBe(true);

    const ackRes = createJsonResponse();
    ackHandler(
      {
        params: { operationId },
        body: {
          clientId: connectedPayload.clientId,
          clientToken: connectedPayload.clientToken,
        },
      },
      ackRes,
    );

    await emitPromise;
    expect(ackRes.status).toHaveBeenCalledWith(202);
    expect(ackRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'accepted',
        operationId,
      }),
    );
    expect(sseRouter._pendingSelfUpdateAcks.has(operationId)).toBe(false);

    const controllerOldContainer = {
      stop: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({ State: { Running: false }, Name: '/drydock' }),
      start: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const controllerNewContainer = {
      start: vi.fn().mockResolvedValue(undefined),
      inspect: vi
        .fn()
        .mockResolvedValueOnce({ State: { Running: true } })
        .mockResolvedValueOnce({ State: { Running: true, Health: { Status: 'starting' } } })
        .mockResolvedValueOnce({ State: { Running: true, Health: { Status: 'healthy' } } }),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    mockDockerodeCtor.mockImplementation(function DockerodeMock() {
      return {
        getContainer: (containerId: string) => {
          if (containerId === 'old-container-id') {
            return controllerOldContainer;
          }
          if (containerId === 'new-container-id') {
            return controllerNewContainer;
          }
          throw new Error(`Unexpected controller container id: ${containerId}`);
        },
      };
    });

    let helperEnv: string[] | undefined;
    const helperStart = vi.fn(async () => {
      if (!helperEnv) {
        throw new Error('Missing helper environment for self-update controller');
      }
      await runControllerWithEnvFromHelper(helperEnv, async () => {
        await runSelfUpdateController();
      });
    });
    const transitionNewContainer = {
      inspect: vi.fn().mockResolvedValue({ Id: 'new-container-id' }),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const transitionContext = {
      dockerApi: {
        createContainer: vi.fn().mockImplementation((spec: { Env: string[] }) => {
          helperEnv = spec.Env;
          return Promise.resolve({
            start: helperStart,
          });
        }),
      },
      auth: { username: 'bot', password: 'token' },
      newImage: 'ghcr.io/acme/drydock:2.0.0',
      currentContainer: {
        rename: vi.fn().mockResolvedValue(undefined),
      },
      currentContainerSpec: {
        Name: '/drydock',
        Id: 'old-container-id',
        HostConfig: {
          Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
        },
      },
    };
    const logContainer = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(
      executeSelfUpdateTransition(
        {
          getConfiguration: () => ({ dryrun: false }),
          findDockerSocketBind: (spec) => spec?.HostConfig?.Binds?.[0]?.split(':')?.[0],
          insertContainerImageBackup: vi.fn(),
          pullImage: vi.fn().mockResolvedValue(undefined),
          getCloneRuntimeConfigOptions: vi.fn().mockResolvedValue({ runtime: true }),
          cloneContainer: vi.fn(() => ({ cloned: true })),
          createContainer: vi.fn().mockResolvedValue(transitionNewContainer),
          createOperationId: vi.fn(() => 'unused-operation-id'),
        },
        transitionContext as any,
        {
          image: {
            name: 'ghcr.io/acme/drydock',
          },
        },
        logContainer,
        operationId,
      ),
    ).resolves.toBe(true);

    expect(helperStart).toHaveBeenCalledTimes(1);
    expect(controllerOldContainer.stop).toHaveBeenCalledTimes(1);
    expect(controllerNewContainer.start).toHaveBeenCalledTimes(1);
    expect(controllerOldContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(
      logSpy.mock.calls.some(([message]) =>
        String(message).includes(`[self-update:${operationId}] HEALTH_GATE`),
      ),
    ).toBe(true);
  });
});
