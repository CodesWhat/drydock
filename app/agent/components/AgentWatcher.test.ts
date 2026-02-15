import { beforeEach, describe, expect, test } from 'vitest';
import * as manager from '../manager.js';
import AgentWatcher from './AgentWatcher.js';

vi.mock('../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../manager.js', () => ({
  getAgent: vi.fn(),
}));

describe('AgentWatcher', () => {
  let watcher;

  beforeEach(() => {
    vi.clearAllMocks();
    watcher = new AgentWatcher();
    watcher.type = 'docker';
    watcher.name = 'local';
  });

  describe('watch', () => {
    test('should throw when no agent is assigned', async () => {
      watcher.agent = undefined;
      await expect(watcher.watch()).rejects.toThrow('AgentWatcher must have an agent assigned');
    });

    test('should throw when agent is not found', async () => {
      watcher.agent = 'remote-agent';
      manager.getAgent.mockReturnValue(undefined);
      await expect(watcher.watch()).rejects.toThrow('Agent remote-agent not found');
    });

    test('should delegate to client.watch', async () => {
      watcher.agent = 'remote-agent';
      const mockClient = { watch: vi.fn().mockResolvedValue([{ container: {} }]) };
      manager.getAgent.mockReturnValue(mockClient);
      const result = await watcher.watch();
      expect(mockClient.watch).toHaveBeenCalledWith('docker', 'local');
      expect(result).toEqual([{ container: {} }]);
    });
  });

  describe('watchContainer', () => {
    test('should throw when no agent is assigned', async () => {
      watcher.agent = undefined;
      await expect(watcher.watchContainer({ id: 'c1' })).rejects.toThrow(
        'AgentWatcher must have an agent assigned',
      );
    });

    test('should throw when agent is not found', async () => {
      watcher.agent = 'remote-agent';
      manager.getAgent.mockReturnValue(undefined);
      await expect(watcher.watchContainer({ id: 'c1' })).rejects.toThrow(
        'Agent remote-agent not found',
      );
    });

    test('should delegate to client.watchContainer', async () => {
      watcher.agent = 'remote-agent';
      const mockClient = {
        watchContainer: vi.fn().mockResolvedValue({ container: { id: 'c1' } }),
      };
      manager.getAgent.mockReturnValue(mockClient);
      const container = { id: 'c1' };
      const result = await watcher.watchContainer(container);
      expect(mockClient.watchContainer).toHaveBeenCalledWith('docker', 'local', container);
      expect(result).toEqual({ container: { id: 'c1' } });
    });
  });

  describe('getConfigurationSchema', () => {
    test('should return a schema that allows unknown keys', () => {
      const schema = watcher.getConfigurationSchema();
      const result = schema.validate({ foo: 'bar', baz: 123 });
      expect(result.error).toBeUndefined();
    });
  });
});
