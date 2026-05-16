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
    const client = { name: 'agent1', stop: vi.fn() };
    manager.addAgent(client);
    expect(manager.getAgents()).toHaveLength(1);
    expect(manager.getAgents()[0]).toBe(client);
  });

  test('getAgent should return client by name', () => {
    const client = { name: 'agent1', stop: vi.fn() };
    manager.addAgent(client);
    expect(manager.getAgent('agent1')).toBe(client);
  });

  test('getAgent should return undefined for unknown name', () => {
    expect(manager.getAgent('unknown')).toBeUndefined();
  });

  test('addAgent should support multiple agents', () => {
    const c1 = { name: 'a1', stop: vi.fn() };
    const c2 = { name: 'a2', stop: vi.fn() };
    manager.addAgent(c1);
    manager.addAgent(c2);
    expect(manager.getAgents()).toHaveLength(2);
    expect(manager.getAgent('a1')).toBe(c1);
    expect(manager.getAgent('a2')).toBe(c2);
  });

  test('removeAgent should remove a client by name', () => {
    const c1 = { name: 'a1', stop: vi.fn() };
    const c2 = { name: 'a2', stop: vi.fn() };
    manager.addAgent(c1);
    manager.addAgent(c2);

    expect(manager.removeAgent('a1')).toBe(true);
    expect(manager.getAgents()).toHaveLength(1);
    expect(manager.getAgent('a1')).toBeUndefined();
    expect(manager.getAgent('a2')).toBe(c2);
  });

  test('removeAgent should return false when client does not exist', () => {
    expect(manager.removeAgent('missing-agent')).toBe(false);
  });

  test('removeAgent should call stop() on each removed client before splicing', () => {
    const stop1 = vi.fn();
    const stop2 = vi.fn();
    const c1 = { name: 'target', stop: stop1 };
    const c2 = { name: 'other', stop: stop2 };
    manager.addAgent(c1);
    manager.addAgent(c2);

    manager.removeAgent('target');

    expect(stop1).toHaveBeenCalledTimes(1);
    expect(stop2).not.toHaveBeenCalled();
    expect(manager.getAgents()).toHaveLength(1);
    expect(manager.getAgent('target')).toBeUndefined();
  });

  test('removeAgent should call stop() on all matching clients when duplicates exist', () => {
    const stop1 = vi.fn();
    const stop2 = vi.fn();
    const c1 = { name: 'dup', stop: stop1 };
    const c2 = { name: 'dup', stop: stop2 };
    manager.addAgent(c1);
    manager.addAgent(c2);

    manager.removeAgent('dup');

    expect(stop1).toHaveBeenCalledTimes(1);
    expect(stop2).toHaveBeenCalledTimes(1);
    expect(manager.getAgents()).toHaveLength(0);
  });
});
