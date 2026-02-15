import { beforeEach, describe, expect, test } from 'vitest';
import * as manager from '../manager.js';
import AgentTrigger from './AgentTrigger.js';

vi.mock('../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../../event/index.js', () => ({
  registerContainerReport: vi.fn(),
  registerContainerReports: vi.fn(),
}));

vi.mock('../../prometheus/trigger.js', () => ({
  getTriggerCounter: () => ({ inc: vi.fn() }),
}));

vi.mock('../manager.js', () => ({
  getAgent: vi.fn(),
}));

describe('AgentTrigger', () => {
  let trigger;

  beforeEach(() => {
    vi.clearAllMocks();
    trigger = new AgentTrigger();
    trigger.type = 'docker';
    trigger.name = 'update';
  });

  describe('trigger', () => {
    test('should throw when no agent is assigned', async () => {
      trigger.agent = undefined;
      await expect(trigger.trigger({ id: 'c1' })).rejects.toThrow(
        'AgentTrigger must have an agent assigned',
      );
    });

    test('should throw when agent is not found', async () => {
      trigger.agent = 'remote-agent';
      manager.getAgent.mockReturnValue(undefined);
      await expect(trigger.trigger({ id: 'c1' })).rejects.toThrow('Agent remote-agent not found');
    });

    test('should delegate to client.runRemoteTrigger', async () => {
      trigger.agent = 'remote-agent';
      const mockClient = { runRemoteTrigger: vi.fn().mockResolvedValue('ok') };
      manager.getAgent.mockReturnValue(mockClient);
      const container = { id: 'c1' };
      const result = await trigger.trigger(container);
      expect(mockClient.runRemoteTrigger).toHaveBeenCalledWith(container, 'docker', 'update');
      expect(result).toBe('ok');
    });
  });

  describe('triggerBatch', () => {
    test('should throw when no agent is assigned', async () => {
      trigger.agent = undefined;
      await expect(trigger.triggerBatch([{ id: 'c1' }])).rejects.toThrow(
        'AgentTrigger must have an agent assigned',
      );
    });

    test('should throw when agent is not found', async () => {
      trigger.agent = 'remote-agent';
      manager.getAgent.mockReturnValue(undefined);
      await expect(trigger.triggerBatch([{ id: 'c1' }])).rejects.toThrow(
        'Agent remote-agent not found',
      );
    });

    test('should delegate to client.runRemoteTriggerBatch', async () => {
      trigger.agent = 'remote-agent';
      const mockClient = { runRemoteTriggerBatch: vi.fn().mockResolvedValue('ok') };
      manager.getAgent.mockReturnValue(mockClient);
      const containers = [{ id: 'c1' }, { id: 'c2' }];
      const result = await trigger.triggerBatch(containers);
      expect(mockClient.runRemoteTriggerBatch).toHaveBeenCalledWith(containers, 'docker', 'update');
      expect(result).toBe('ok');
    });
  });

  describe('getConfigurationSchema', () => {
    test('should return a schema that allows unknown keys', () => {
      const schema = trigger.getConfigurationSchema();
      const result = schema.validate({ foo: 'bar', baz: 123 });
      expect(result.error).toBeUndefined();
    });
  });
});
