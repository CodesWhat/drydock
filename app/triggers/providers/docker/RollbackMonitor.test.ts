// @ts-nocheck
import { describe, expect, test, vi } from 'vitest';

import RollbackMonitor from './RollbackMonitor.js';

function createLogger() {
  return {
    child: vi.fn(() => ({ warn: vi.fn() })),
  };
}

function createContainer(overrides = {}) {
  return {
    name: 'web',
    image: {
      tag: { value: '1.2.3' },
      digest: { repo: 'sha256:abc' },
    },
    labels: {},
    ...overrides,
  };
}

function createMonitor(overrides = {}) {
  return new RollbackMonitor({
    getPreferredLabelValue: (labels, ddKey, wudKey) => labels?.[ddKey] ?? labels?.[wudKey],
    getLogger: () => ({ child: () => ({ warn: vi.fn() }) }),
    getCurrentContainer: vi.fn(),
    inspectContainer: vi.fn(),
    startHealthMonitor: vi.fn(),
    getTriggerInstance: vi.fn(() => ({ marker: true })),
    ...overrides,
  });
}

describe('RollbackMonitor', () => {
  test('constructor provides default logger and trigger-instance fallbacks', () => {
    const monitor = new RollbackMonitor({
      getPreferredLabelValue: () => undefined,
    });

    expect(monitor.getLogger()).toBeUndefined();
    expect(monitor.getTriggerInstance()).toBeUndefined();
  });

  test('getConfig parses rollback labels and applies defaults for invalid values', () => {
    const logger = createLogger();
    const monitor = createMonitor({
      getLogger: () => logger,
    });

    const config = monitor.getConfig(
      createContainer({
        labels: {
          'dd.rollback.auto': 'TrUe',
          'dd.rollback.window': '120000',
          'dd.rollback.interval': '5000',
        },
      }),
    );

    expect(config).toEqual({
      autoRollback: true,
      rollbackWindow: 120000,
      rollbackInterval: 5000,
    });

    const configWithInvalidValues = monitor.getConfig(
      createContainer({
        labels: {
          'dd.rollback.auto': 'false',
          'dd.rollback.window': '-1',
          'dd.rollback.interval': 'NaN',
        },
      }),
    );

    expect(configWithInvalidValues).toEqual({
      autoRollback: false,
      rollbackWindow: 300000,
      rollbackInterval: 10000,
    });

    const warnCalls = logger.child.mock.results
      .map((result) => result.value?.warn)
      .filter(Boolean)
      .flatMap((warnSpy) => warnSpy.mock.calls.map((call) => call[0]));
    expect(warnCalls).toContain('Invalid rollback window label value — using default 300000ms');
    expect(warnCalls).toContain('Invalid rollback interval label value — using default 10000ms');
  });

  test('start should no-op when auto-rollback is disabled', async () => {
    const startHealthMonitor = vi.fn();
    const monitor = createMonitor({
      getCurrentContainer: vi.fn(),
      startHealthMonitor,
    });

    await monitor.start({}, createContainer(), { autoRollback: false }, { info: vi.fn(), warn: vi.fn() });

    expect(startHealthMonitor).not.toHaveBeenCalled();
  });

  test('start should warn when recreated container cannot be found', async () => {
    const warn = vi.fn();
    const getCurrentContainer = vi.fn().mockResolvedValue(undefined);
    const monitor = createMonitor({
      getCurrentContainer,
    });

    await monitor.start({}, createContainer(), { autoRollback: true, rollbackWindow: 1, rollbackInterval: 1 }, { info: vi.fn(), warn });

    expect(getCurrentContainer).toHaveBeenCalledWith({}, { id: 'web' });
    expect(warn).toHaveBeenCalledWith(
      'Cannot find recreated container by name — skipping health monitoring',
    );
  });

  test('start should warn when recreated container has no healthcheck', async () => {
    const warn = vi.fn();
    const newContainer = { id: 'new-container' };
    const monitor = createMonitor({
      getCurrentContainer: vi.fn().mockResolvedValue(newContainer),
      inspectContainer: vi.fn().mockResolvedValue({ Id: 'new-container', State: {} }),
    });

    await monitor.start(
      {},
      createContainer(),
      { autoRollback: true, rollbackWindow: 60_000, rollbackInterval: 5_000 },
      { info: vi.fn(), warn },
    );

    expect(warn).toHaveBeenCalledWith(
      'Auto-rollback enabled but container has no HEALTHCHECK defined — skipping health monitoring',
    );
  });

  test('start should launch health monitor with rollback parameters when container is healthy-check capable', async () => {
    const info = vi.fn();
    const startHealthMonitor = vi.fn();
    const getTriggerInstance = vi.fn(() => ({ triggerMarker: true }));
    const newContainer = { id: 'new-container' };
    const monitor = createMonitor({
      getCurrentContainer: vi.fn().mockResolvedValue(newContainer),
      inspectContainer: vi.fn().mockResolvedValue({
        Id: 'new-container-id',
        State: { Health: { Status: 'starting' } },
      }),
      startHealthMonitor,
      getTriggerInstance,
    });

    await monitor.start(
      { api: true },
      createContainer({ image: { tag: { value: '2.0.0' }, digest: {} } }),
      { autoRollback: true, rollbackWindow: 120_000, rollbackInterval: 3_000 },
      { info, warn: vi.fn() },
    );

    expect(info).toHaveBeenCalledWith(
      'Starting health monitor (window=120000ms, interval=3000ms)',
    );
    expect(startHealthMonitor).toHaveBeenCalledWith({
      dockerApi: { api: true },
      containerId: 'new-container-id',
      containerName: 'web',
      backupImageTag: '2.0.0',
      backupImageDigest: undefined,
      window: 120_000,
      interval: 3_000,
      triggerInstance: { triggerMarker: true },
      log: { info, warn: expect.any(Function) },
    });
    expect(getTriggerInstance).toHaveBeenCalledTimes(1);
  });
});
