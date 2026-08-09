import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Container } from '../../../model/container.js';
import {
  DEFAULT_DISCOVERY_SETTLE_MS,
  filterPendingDiscoveries,
  getPendingDiscoverySettleDelayMs,
  getSettledContainersToWatch,
} from './container-init.js';

function createSummary(overrides: Record<string, unknown> = {}) {
  return {
    Id: 'a1b2c3d4e5f60000000000000000000000000000000000000000000000000',
    Names: ['/app'],
    ...overrides,
  } as any;
}

function createStoreContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'stored-id',
    name: 'stored',
    watcher: 'docker',
    ...overrides,
  } as Container;
}

describe('filterPendingDiscoveries (#156)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('holds a new container pending and registers it once the settling window elapses', () => {
    const pendingDiscoveries = new Map();
    const container = createSummary();
    const debug = vi.fn();

    const first = filterPendingDiscoveries([container], [], {
      settleMs: 30_000,
      pendingDiscoveries,
      debug,
    });

    expect(first.containersToWatch).toEqual([]);
    expect(first.pendingContainerIds.has(container.Id)).toBe(true);
    expect(pendingDiscoveries.has(container.Id)).toBe(true);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('New container discovered'));

    // Still within the window — stays pending.
    vi.advanceTimersByTime(29_999);
    const second = filterPendingDiscoveries([container], [], {
      settleMs: 30_000,
      pendingDiscoveries,
      debug,
    });
    expect(second.containersToWatch).toEqual([]);
    expect(pendingDiscoveries.has(container.Id)).toBe(true);
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('Still within discovery settling window'),
    );

    // Window elapses — now registered.
    vi.advanceTimersByTime(1);
    const third = filterPendingDiscoveries([container], [], {
      settleMs: 30_000,
      pendingDiscoveries,
      debug,
    });
    expect(third.containersToWatch).toEqual([container]);
    expect(third.pendingContainerIds.size).toBe(0);
    expect(pendingDiscoveries.has(container.Id)).toBe(false);
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('Discovery settling window elapsed'),
    );
  });

  test('registers under the FINAL name when the container is renamed mid-window', () => {
    const pendingDiscoveries = new Map();
    const debug = vi.fn();
    const containerId = 'aaaabbbbccccddddeeeeffff000000000000000000000000000000000000';

    filterPendingDiscoveries(
      [createSummary({ Id: containerId, Names: ['/transient-alias'] })],
      [],
      {
        settleMs: 10_000,
        pendingDiscoveries,
        debug,
      },
    );
    expect(pendingDiscoveries.get(containerId)?.name).toBe('transient-alias');

    vi.advanceTimersByTime(5_000);
    filterPendingDiscoveries([createSummary({ Id: containerId, Names: ['/final-name'] })], [], {
      settleMs: 10_000,
      pendingDiscoveries,
      debug,
    });
    expect(pendingDiscoveries.get(containerId)?.name).toBe('final-name');
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining(
        'Container renamed during discovery settling window (transient-alias -> final-name)',
      ),
    );

    vi.advanceTimersByTime(5_000);
    const result = filterPendingDiscoveries(
      [createSummary({ Id: containerId, Names: ['/final-name'] })],
      [],
      { settleMs: 10_000, pendingDiscoveries, debug },
    );

    expect(result.containersToWatch).toHaveLength(1);
    expect(result.containersToWatch[0].Names).toEqual(['/final-name']);
    expect(pendingDiscoveries.has(containerId)).toBe(false);
  });

  test('silently discards a container that disappears mid-window', () => {
    const pendingDiscoveries = new Map();
    const debug = vi.fn();
    const container = createSummary();

    filterPendingDiscoveries([container], [], { settleMs: 30_000, pendingDiscoveries, debug });
    expect(pendingDiscoveries.has(container.Id)).toBe(true);

    vi.advanceTimersByTime(5_000);
    const result = filterPendingDiscoveries([], [], {
      settleMs: 30_000,
      pendingDiscoveries,
      debug,
    });

    expect(result.containersToWatch).toEqual([]);
    expect(pendingDiscoveries.has(container.Id)).toBe(false);
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('disappeared during discovery settling window'),
    );
  });

  test('bypasses settling for a container already known to the store', () => {
    const pendingDiscoveries = new Map();
    const container = createSummary();
    const storeContainer = createStoreContainer({ id: container.Id, name: 'app' });

    const result = filterPendingDiscoveries([container], [storeContainer], {
      settleMs: 30_000,
      pendingDiscoveries,
    });

    expect(result.containersToWatch).toEqual([container]);
    expect(result.pendingContainerIds.size).toBe(0);
    expect(pendingDiscoveries.has(container.Id)).toBe(false);
  });

  test('drops a stray pending entry once the container appears in the store', () => {
    const container = createSummary();
    const pendingDiscoveries = new Map([[container.Id, { firstSeenAtMs: 0, name: 'app' }]]);
    const storeContainer = createStoreContainer({ id: container.Id, name: 'app' });

    const result = filterPendingDiscoveries([container], [storeContainer], {
      settleMs: 30_000,
      pendingDiscoveries,
    });

    expect(result.containersToWatch).toEqual([container]);
    expect(pendingDiscoveries.has(container.Id)).toBe(false);
  });

  test('settleMs=0 disables settling entirely — new containers register immediately', () => {
    const pendingDiscoveries = new Map();
    const container = createSummary();

    const result = filterPendingDiscoveries([container], [], {
      settleMs: 0,
      pendingDiscoveries,
    });

    expect(result.containersToWatch).toEqual([container]);
    expect(result.pendingContainerIds.size).toBe(0);
    expect(pendingDiscoveries.size).toBe(0);
  });

  test('negative settleMs is also treated as disabled', () => {
    const pendingDiscoveries = new Map();
    const container = createSummary();

    const result = filterPendingDiscoveries([container], [], {
      settleMs: -1,
      pendingDiscoveries,
    });

    expect(result.containersToWatch).toEqual([container]);
    expect(pendingDiscoveries.size).toBe(0);
  });

  test('tracks multiple pending containers independently', () => {
    const pendingDiscoveries = new Map();
    const containerA = createSummary({
      Id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      Names: ['/a'],
    });

    filterPendingDiscoveries([containerA], [], { settleMs: 10_000, pendingDiscoveries });

    vi.advanceTimersByTime(6_000);
    const containerB = createSummary({
      Id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      Names: ['/b'],
    });
    const midResult = filterPendingDiscoveries([containerA, containerB], [], {
      settleMs: 10_000,
      pendingDiscoveries,
    });
    // A is 6s in, B just discovered — neither has settled yet.
    expect(midResult.containersToWatch).toEqual([]);
    expect(midResult.pendingContainerIds.has(containerA.Id)).toBe(true);
    expect(midResult.pendingContainerIds.has(containerB.Id)).toBe(true);

    // Advance 4.5s more: A is now at 10.5s (settled), B is at 4.5s (still pending).
    vi.advanceTimersByTime(4_500);
    const finalResult = filterPendingDiscoveries([containerA, containerB], [], {
      settleMs: 10_000,
      pendingDiscoveries,
    });
    expect(finalResult.containersToWatch).toEqual([containerA]);
    expect(finalResult.pendingContainerIds.has(containerA.Id)).toBe(false);
    expect(finalResult.pendingContainerIds.has(containerB.Id)).toBe(true);
    expect(pendingDiscoveries.has(containerA.Id)).toBe(false);
    expect(pendingDiscoveries.has(containerB.Id)).toBe(true);
  });

  test('passes through a container with no usable id unmodified', () => {
    const pendingDiscoveries = new Map();
    const container = createSummary({ Id: undefined });

    const result = filterPendingDiscoveries([container], [], {
      settleMs: 30_000,
      pendingDiscoveries,
    });

    expect(result.containersToWatch).toEqual([container]);
    expect(result.pendingContainerIds.size).toBe(0);
    expect(pendingDiscoveries.size).toBe(0);
  });

  test('falls back to the shortened container id in debug output when the name is unknown', () => {
    const pendingDiscoveries = new Map();
    const debug = vi.fn();
    const container = createSummary({ Names: [] });

    filterPendingDiscoveries([container], [], { settleMs: 30_000, pendingDiscoveries, debug });

    expect(debug).toHaveBeenCalledWith(expect.stringContaining(container.Id.substring(0, 12)));
  });

  test('works across the full discover/rename/settle/disappear lifecycle without a debug callback', () => {
    const pendingDiscoveries = new Map();
    const containerId = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    const disappearingId = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

    expect(() => {
      filterPendingDiscoveries(
        [
          createSummary({ Id: containerId, Names: ['/first-name'] }),
          createSummary({ Id: disappearingId, Names: ['/gone-soon'] }),
        ],
        [],
        { settleMs: 5_000, pendingDiscoveries },
      );

      vi.advanceTimersByTime(2_000);
      filterPendingDiscoveries([createSummary({ Id: containerId, Names: ['/renamed'] })], [], {
        settleMs: 5_000,
        pendingDiscoveries,
      });

      vi.advanceTimersByTime(3_000);
      filterPendingDiscoveries([createSummary({ Id: containerId, Names: ['/renamed'] })], [], {
        settleMs: 5_000,
        pendingDiscoveries,
      });
    }).not.toThrow();

    expect(pendingDiscoveries.has(containerId)).toBe(false);
    expect(pendingDiscoveries.has(disappearingId)).toBe(false);
  });

  test('defaults to Date.now() when nowMs is not supplied', () => {
    const pendingDiscoveries = new Map();
    const container = createSummary();

    vi.setSystemTime(1_700_000_000_000);
    filterPendingDiscoveries([container], [], { settleMs: 1_000, pendingDiscoveries });
    expect(pendingDiscoveries.get(container.Id)?.firstSeenAtMs).toBe(1_700_000_000_000);

    vi.setSystemTime(1_700_000_001_000);
    const result = filterPendingDiscoveries([container], [], {
      settleMs: 1_000,
      pendingDiscoveries,
    });
    expect(result.containersToWatch).toEqual([container]);
  });

  test('exports the default settle window used by the Docker watcher config schema', () => {
    expect(DEFAULT_DISCOVERY_SETTLE_MS).toBe(30_000);
  });

  test('logs "(unknown)" in the rename message on either side of an unnamed rename', () => {
    const pendingDiscoveries = new Map();
    const debug = vi.fn();
    const containerId = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

    // Discovered with no usable name yet.
    filterPendingDiscoveries([createSummary({ Id: containerId, Names: [] })], [], {
      settleMs: 10_000,
      pendingDiscoveries,
      debug,
    });
    expect(pendingDiscoveries.get(containerId)?.name).toBe('');

    // Renamed from "(unknown)" to a real name — covers the existingEntry.name fallback.
    vi.advanceTimersByTime(1_000);
    filterPendingDiscoveries([createSummary({ Id: containerId, Names: ['/named'] })], [], {
      settleMs: 10_000,
      pendingDiscoveries,
      debug,
    });
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining(
        'Container renamed during discovery settling window ((unknown) -> named)',
      ),
    );

    // Renamed back to no usable name — covers the containerName fallback.
    vi.advanceTimersByTime(1_000);
    filterPendingDiscoveries([createSummary({ Id: containerId, Names: [] })], [], {
      settleMs: 10_000,
      pendingDiscoveries,
      debug,
    });
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining(
        'Container renamed during discovery settling window (named -> (unknown))',
      ),
    );
  });

  test('falls back to the shortened container id when a nameless container disappears mid-window', () => {
    const pendingDiscoveries = new Map();
    const debug = vi.fn();
    const container = createSummary({ Names: [] });

    filterPendingDiscoveries([container], [], { settleMs: 30_000, pendingDiscoveries, debug });
    expect(pendingDiscoveries.get(container.Id)?.name).toBe('');

    vi.advanceTimersByTime(5_000);
    filterPendingDiscoveries([], [], { settleMs: 30_000, pendingDiscoveries, debug });

    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining(
        `${container.Id.substring(0, 12)} - Container disappeared during discovery settling window`,
      ),
    );
  });
});

describe('getSettledContainersToWatch (#156)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('falls back to DEFAULT_DISCOVERY_SETTLE_MS when the watcher has no discoverysettlems configured', () => {
    const container = createSummary();
    const watcher = {
      configuration: { cron: '0 */6 * * *' },
      pendingDiscoveries: new Map(),
      log: { debug: vi.fn() },
    };

    const result = getSettledContainersToWatch([container], [], watcher);

    expect(result).toEqual([]);
    expect(watcher.pendingDiscoveries.has(container.Id)).toBe(true);

    vi.advanceTimersByTime(DEFAULT_DISCOVERY_SETTLE_MS);
    expect(getSettledContainersToWatch([container], [], watcher)).toEqual([container]);
  });

  test('honors an explicitly configured discoverysettlems', () => {
    const container = createSummary();
    const watcher = {
      configuration: { cron: '0 */6 * * *', discoverysettlems: 0 },
      pendingDiscoveries: new Map(),
      log: { debug: vi.fn() },
    };

    expect(getSettledContainersToWatch([container], [], watcher)).toEqual([container]);
  });
});

describe('getPendingDiscoverySettleDelayMs (#156)', () => {
  function createWatcher(overrides: Record<string, unknown> = {}) {
    return {
      configuration: { cron: '0 */6 * * *' },
      pendingDiscoveries: new Map(),
      log: { debug: vi.fn() },
      ...overrides,
    };
  }

  test('returns undefined when nothing is pending', () => {
    expect(getPendingDiscoverySettleDelayMs(createWatcher(), 1_000)).toBeUndefined();
  });

  test('returns undefined when settling is disabled, even with pending entries', () => {
    const watcher = createWatcher({
      configuration: { cron: '0 */6 * * *', discoverysettlems: 0 },
      pendingDiscoveries: new Map([['id-1', { firstSeenAtMs: 1_000, name: 'app' }]]),
    });

    expect(getPendingDiscoverySettleDelayMs(watcher, 2_000)).toBeUndefined();
  });

  test('computes the delay from the earliest pending entry', () => {
    const watcher = createWatcher({
      pendingDiscoveries: new Map([
        ['late', { firstSeenAtMs: 50_000, name: 'late' }],
        ['early', { firstSeenAtMs: 10_000, name: 'early' }],
        ['middle', { firstSeenAtMs: 20_000, name: 'middle' }],
      ]),
    });

    expect(getPendingDiscoverySettleDelayMs(watcher, 15_000)).toBe(
      10_000 + DEFAULT_DISCOVERY_SETTLE_MS - 15_000,
    );
  });

  test('honors an explicitly configured discoverysettlems', () => {
    const watcher = createWatcher({
      configuration: { cron: '0 */6 * * *', discoverysettlems: 5_000 },
      pendingDiscoveries: new Map([['id-1', { firstSeenAtMs: 1_000, name: 'app' }]]),
    });

    expect(getPendingDiscoverySettleDelayMs(watcher, 2_000)).toBe(4_000);
  });

  test('clamps overdue deadlines to 0', () => {
    const watcher = createWatcher({
      pendingDiscoveries: new Map([['id-1', { firstSeenAtMs: 0, name: 'app' }]]),
    });

    expect(getPendingDiscoverySettleDelayMs(watcher, DEFAULT_DISCOVERY_SETTLE_MS * 10)).toBe(0);
  });
});
