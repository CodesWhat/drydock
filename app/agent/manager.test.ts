import { beforeEach, describe, expect, test } from 'vitest';

// We need to reset module state between tests
let manager;

beforeEach(async () => {
  vi.resetModules();
  manager = await import('./manager.js');
});

describe('manager', () => {
  test('getAgents should return empty array initially', () => {
    expect(manager.getAgents()).toEqual([]);
  });

  test('addAgent should add a client', () => {
    const client = { name: 'agent1' };
    manager.addAgent(client);
    expect(manager.getAgents()).toHaveLength(1);
    expect(manager.getAgents()[0]).toBe(client);
  });

  test('getAgent should return client by name', () => {
    const client = { name: 'agent1' };
    manager.addAgent(client);
    expect(manager.getAgent('agent1')).toBe(client);
  });

  test('getAgent should return undefined for unknown name', () => {
    expect(manager.getAgent('unknown')).toBeUndefined();
  });

  test('addAgent should support multiple agents', () => {
    const c1 = { name: 'a1' };
    const c2 = { name: 'a2' };
    manager.addAgent(c1);
    manager.addAgent(c2);
    expect(manager.getAgents()).toHaveLength(2);
    expect(manager.getAgent('a1')).toBe(c1);
    expect(manager.getAgent('a2')).toBe(c2);
  });
});
