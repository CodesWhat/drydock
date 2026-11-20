import { describe, expect, test } from 'vitest';
import { cancelRollbackMonitor, registerRollbackMonitor } from './rollback-monitor-registry.js';

const container = { name: 'registry-web', watcher: 'local' };

describe('rollback monitor registry', () => {
  test('cancelling aborts the registered monitor once', () => {
    const controller = new AbortController();
    registerRollbackMonitor(container, controller);

    expect(cancelRollbackMonitor(container)).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(cancelRollbackMonitor(container)).toBe(false);
  });

  test('arming a second monitor supersedes the first', () => {
    const first = new AbortController();
    const second = new AbortController();
    registerRollbackMonitor(container, first);
    registerRollbackMonitor(container, second);

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    cancelRollbackMonitor(container);
  });

  test('monitors are keyed per watcher and name', () => {
    const controller = new AbortController();
    registerRollbackMonitor(container, controller);

    expect(cancelRollbackMonitor({ name: 'registry-web', watcher: 'other' })).toBe(false);
    expect(controller.signal.aborted).toBe(false);
    cancelRollbackMonitor(container);
  });
});
