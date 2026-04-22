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

import log from '../log/index.js';
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

  test('AgentClient is called with correct name and config for each agent', async () => {
    const config1 = { host: 'host1', port: 3001, secret: 'secret1' };
    const config2 = { host: 'host2', port: 3002, secret: 'secret2' };
    registry.getState.mockReturnValue({
      agent: {
        'dd.agent1': { name: 'agent1', configuration: config1 },
        'dd.agent2': { name: 'agent2', configuration: config2 },
      },
    });

    await agentIndex.init();

    expect(AgentClient).toHaveBeenCalledWith('agent1', config1);
    expect(AgentClient).toHaveBeenCalledWith('agent2', config2);
  });

  test('addAgent receives the same instance AgentClient constructed', async () => {
    const config = { host: 'host1', port: 3001, secret: 'secret1' };
    registry.getState.mockReturnValue({
      agent: {
        'dd.agent1': { name: 'agent1', configuration: config },
      },
    });

    await agentIndex.init();

    const constructedInstance = vi.mocked(AgentClient).mock.instances[0];
    expect(manager.addAgent).toHaveBeenCalledWith(constructedInstance);
  });

  test('client.init() is called but does not block agentIndex.init() from resolving', async () => {
    let resolveClientInit: () => void;
    const neverResolves = new Promise<void>((resolve) => {
      resolveClientInit = resolve;
    });

    vi.mocked(AgentClient).mockImplementationOnce(function (name, config) {
      this.name = name;
      this.config = config;
      this.init = vi.fn().mockReturnValue(neverResolves);
    });

    registry.getState.mockReturnValue({
      agent: {
        'dd.agent1': { name: 'agent1', configuration: { host: 'host1', secret: 'secret1' } },
      },
    });

    // agentIndex.init() must resolve even though client.init() never does
    await expect(agentIndex.init()).resolves.toBeUndefined();

    const instance = vi.mocked(AgentClient).mock.instances[0];
    expect(instance.init).toHaveBeenCalledTimes(1);

    // Avoid unhandled-rejection leaks
    resolveClientInit!();
  });

  test('log.warn is called with a message containing the agent name when host is missing', async () => {
    registry.getState.mockReturnValue({
      agent: {
        'dd.agentX': { name: 'agentX', configuration: { secret: 'secret1' } },
      },
    });

    await agentIndex.init();

    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(expect.stringContaining('agentX'));
  });

  test('log.warn is called with a message containing the agent name when secret is missing', async () => {
    registry.getState.mockReturnValue({
      agent: {
        'dd.agentY': { name: 'agentY', configuration: { host: 'host1' } },
      },
    });

    await agentIndex.init();

    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(expect.stringContaining('agentY'));
  });

  test('valid agent is constructed and invalid agent is skipped in mixed registry state', async () => {
    const validConfig = { host: 'host1', port: 3001, secret: 'secret1' };
    registry.getState.mockReturnValue({
      agent: {
        'dd.valid': { name: 'validAgent', configuration: validConfig },
        'dd.invalid': { name: 'invalidAgent', configuration: { host: 'host2' } },
      },
    });

    await agentIndex.init();

    expect(AgentClient).toHaveBeenCalledTimes(1);
    expect(AgentClient).toHaveBeenCalledWith('validAgent', validConfig);
    expect(manager.addAgent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(expect.stringContaining('invalidAgent'));
  });
});
