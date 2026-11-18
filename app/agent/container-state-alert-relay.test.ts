/**
 * End to end for agent-watched containers: a real tracker classifies Docker events on the
 * "agent", the agent SSE API ships the one classified alert, and AgentClient raises it on
 * the controller's event bus. Older agents send no such event and raise nothing.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockGetContainer = vi.hoisted(() => vi.fn());
const mockGetOperations = vi.hoisted(() => vi.fn(() => []));

vi.mock('axios');
vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  },
}));
vi.mock('../store/index.js', () => ({
  getConfiguration: vi.fn(() => ({ path: '/store', file: 'dd.json' })),
}));
vi.mock('../store/container.js', () => ({
  getContainer: mockGetContainer,
  getContainerRaw: vi.fn(),
  getContainers: vi.fn(() => []),
  getContainersForStats: vi.fn(() => []),
}));
vi.mock('../store/update-operation.js', () => ({
  getOperationById: vi.fn(),
  getOperationsByContainerId: mockGetOperations,
}));
vi.mock('../registry/index.js', () => ({
  getState: vi.fn(() => ({ watcher: {}, trigger: {}, registry: {}, authentication: {} })),
}));

import * as event from '../event/index.js';
import type { Container } from '../model/container.js';
import {
  createContainerStateAlertTracker,
  STATE_ALERT_SETTLE_MS,
} from '../watchers/providers/docker/container-state-alerts.js';
import { AgentClient } from './AgentClient.js';
import * as agentEvents from './api/event.js';

const container = { id: 'c1', name: 'web', watcher: 'local' } as Container;

function dockerEvent(action: string, attributes: Record<string, string> = {}) {
  return { Type: 'container', Action: action, Actor: { ID: 'c1', Attributes: attributes } };
}

describe('agent container state alert relay', () => {
  let tracker: ReturnType<typeof createContainerStateAlertTracker>;
  let client: AgentClient;
  let writes: string[];
  let controllerAlerts: event.ContainerStateAlertEventPayload[];
  let unregister: () => void;
  let inspect: ReturnType<typeof vi.fn>;

  // Agent and controller share one process bus here, so the controller's own emit would
  // be forwarded again by the agent's SSE handler, and the agent's emit reaches the
  // controller listener. Only count what AgentClient raises while relaying. Real deployments have two buses.
  let relaying = false;

  async function relay() {
    relaying = true;
    for (const chunk of writes.splice(0)) {
      const message = JSON.parse(chunk.replace(/^data: /, ''));
      await client.handleEvent(message.type, message.data);
    }
    relaying = false;
  }

  const settle = () => vi.advanceTimersByTimeAsync(STATE_ALERT_SETTLE_MS + 10);

  beforeEach(() => {
    vi.useFakeTimers();
    writes = [];
    relaying = false;
    controllerAlerts = [];
    mockGetContainer.mockReturnValue(container);
    mockGetOperations.mockReturnValue([]);
    inspect = vi.fn().mockResolvedValue({ State: {} });
    unregister = event.registerContainerStateAlert((payload) => {
      if (relaying) {
        controllerAlerts.push(payload);
      }
    });
    // Agent side: a fresh SSE client and a real tracker emitting on the agent's own bus.
    agentEvents._resetAgentEventStateForTests();
    agentEvents.subscribeEvents(
      { ip: '127.0.0.1', on: vi.fn() } as never,
      {
        writeHead: vi.fn(),
        write: vi.fn((chunk: string) => {
          if (!relaying && chunk.includes('dd:container-state-alert')) {
            writes.push(chunk);
          }
          return true;
        }),
      } as never,
    );
    agentEvents.initEvents();
    tracker = createContainerStateAlertTracker({
      dockerApi: { getContainer: () => ({ inspect }) },
      log: { debug: vi.fn() },
      configuration: {},
    });
    client = new AgentClient('edge-1', { host: 'h', port: 3000, secret: '' });
  });

  afterEach(() => {
    tracker.dispose();
    unregister();
    agentEvents._resetAgentEventStateForTests();
    event.clearAllListenersForTests?.();
    vi.useRealTimers();
  });

  test('a crash on the agent raises container-exited on the controller', async () => {
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    await settle();
    await relay();

    expect(controllerAlerts).toHaveLength(1);
    expect(controllerAlerts[0]).toMatchObject({
      kind: 'container-exited',
      containerName: 'web',
      exitCode: 1,
      container: { id: 'c1', agent: 'edge-1' },
    });
  });

  test('a clean stop raises container-stopped', async () => {
    tracker.observe(dockerEvent('die', { exitCode: '0' }));
    tracker.observe(dockerEvent('stop'));
    await settle();
    await relay();

    expect(controllerAlerts.map((a) => a.kind)).toEqual(['container-stopped']);
  });

  test('die plus oom coalesce into one container-oom-killed', async () => {
    tracker.observe(dockerEvent('oom'));
    tracker.observe(dockerEvent('die', { exitCode: '137' }));
    await settle();
    await relay();

    expect(controllerAlerts.map((a) => a.kind)).toEqual(['container-oom-killed']);
  });

  test('repeated crashes raise one restart-loop alert and pause per-crash alerts', async () => {
    for (let i = 0; i < 5; i += 1) {
      tracker.observe(dockerEvent('die', { exitCode: '1' }));
      await settle();
    }
    await relay();

    expect(controllerAlerts.map((a) => a.kind)).toEqual([
      'container-exited',
      'container-exited',
      'container-restart-loop',
    ]);
    expect(controllerAlerts[2]).toMatchObject({ restartCount: 3, windowSeconds: 300 });
  });

  test('an agent-side update suppresses the alert before it is shipped', async () => {
    mockGetOperations.mockReturnValue([{ status: 'in-progress' }] as never);
    tracker.observe(dockerEvent('die', { exitCode: '0' }));
    await settle();
    await relay();

    expect(writes).toHaveLength(0);
    expect(controllerAlerts).toHaveLength(0);
  });

  test('an unwatched container raises nothing', async () => {
    mockGetContainer.mockReturnValue(undefined);
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    await settle();
    await relay();

    expect(controllerAlerts).toHaveLength(0);
  });

  test('an older agent sends no state alert event, so the controller raises none and logs no error', async () => {
    await client.handleEvent('dd:container-updated', undefined);
    await client.handleEvent('dd:ack', { version: '1.8.0' });

    expect(controllerAlerts).toHaveLength(0);
  });
});
