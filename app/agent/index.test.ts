import { beforeEach, describe, expect, test } from 'vitest';

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../registry/index.js', () => ({
  getState: vi.fn(),
}));

vi.mock('./AgentClient.js', () => ({
  AgentClient: vi.fn().mockImplementation(function (name, config) {
    this.name = name;
    this.config = config;
    this.init = vi.fn();
  }),
}));

vi.mock('./manager.js', () => ({
  addAgent: vi.fn(),
  getAgents: vi.fn().mockReturnValue([]),
  getAgent: vi.fn(),
}));

import * as registry from '../registry/index.js';
import { AgentClient } from './AgentClient.js';
import * as agentIndex from './index.js';
import * as manager from './manager.js';

describe('agent/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('init should create and add agent clients from registry state', async () => {
    registry.getState.mockReturnValue({
      agent: {
        'dd.agent1': {
          name: 'agent1',
          configuration: { host: 'host1', port: 3001, secret: 'secret1' },
        },
        'dd.agent2': {
          name: 'agent2',
          configuration: { host: 'host2', port: 3002, secret: 'secret2' },
        },
      },
    });

    await agentIndex.init();

    expect(AgentClient).toHaveBeenCalledTimes(2);
    expect(manager.addAgent).toHaveBeenCalledTimes(2);
  });

  test('init should skip agents missing host', async () => {
    registry.getState.mockReturnValue({
      agent: {
        'dd.agent1': {
          name: 'agent1',
          configuration: { secret: 'secret1' },
        },
      },
    });

    await agentIndex.init();

    expect(AgentClient).not.toHaveBeenCalled();
    expect(manager.addAgent).not.toHaveBeenCalled();
  });

  test('init should skip agents missing secret', async () => {
    registry.getState.mockReturnValue({
      agent: {
        'dd.agent1': {
          name: 'agent1',
          configuration: { host: 'host1' },
        },
      },
    });

    await agentIndex.init();

    expect(AgentClient).not.toHaveBeenCalled();
    expect(manager.addAgent).not.toHaveBeenCalled();
  });

  test('init should handle empty agents object', async () => {
    registry.getState.mockReturnValue({ agent: {} });
    await agentIndex.init();
    expect(AgentClient).not.toHaveBeenCalled();
  });

  test('should re-export manager functions', () => {
    expect(agentIndex.getAgents).toBeDefined();
    expect(agentIndex.getAgent).toBeDefined();
    expect(agentIndex.addAgent).toBeDefined();
  });
});
