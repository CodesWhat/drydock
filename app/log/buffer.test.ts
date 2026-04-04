import {
  addEntry,
  getComponents,
  getEntries,
  getMinLevel,
  matchesComponent,
  meetsMinLevel,
  onEntry,
} from './buffer.js';

function makeEntry(overrides = {}) {
  return {
    timestamp: Date.now(),
    level: 'info',
    component: 'drydock',
    msg: 'test message',
    ...overrides,
  };
}

describe('Ring Buffer', () => {
  beforeEach(() => {
    // Reset the buffer by filling and clearing via module re-import isn't
    // practical, so we test in an order that accounts for shared state.
    // Tests that need a clean buffer are grouped at the top.
  });

  describe('empty buffer', () => {
    // This test relies on running first before any entries are added.
    // Since vitest isolates each test file by default, the module state
    // starts fresh.
    test('should return empty array when buffer is empty', () => {
      const entries = getEntries();
      expect(entries).toEqual([]);
    });

    test('should return no components when buffer is empty', () => {
      expect(getComponents()).toEqual([]);
    });
  });

  describe('addEntry and getEntries', () => {
    test('should store entries and return them', () => {
      const entry = makeEntry({ msg: 'hello' });
      addEntry(entry);
      const results = getEntries({ tail: 1000 });
      expect(results).toContainEqual(entry);
    });

    test('should return entries newest last', () => {
      addEntry(makeEntry({ msg: 'first', timestamp: 1000 }));
      addEntry(makeEntry({ msg: 'second', timestamp: 2000 }));
      const results = getEntries({ tail: 1000 });
      const lastTwo = results.slice(-2);
      expect(lastTwo[0].msg).toBe('first');
      expect(lastTwo[1].msg).toBe('second');
    });
  });

  describe('tail parameter', () => {
    test('should limit results to last N entries', () => {
      for (let i = 0; i < 10; i++) {
        addEntry(makeEntry({ msg: `msg-${i}` }));
      }
      const results = getEntries({ tail: 3 });
      expect(results).toHaveLength(3);
    });

    test('should default to 100 when tail is not specified', () => {
      for (let i = 0; i < 150; i++) {
        addEntry(makeEntry({ msg: `bulk-${i}` }));
      }
      const results = getEntries();
      expect(results.length).toBeLessThanOrEqual(100);
    });
  });

  describe('level filtering', () => {
    test('should filter entries by minimum level', () => {
      addEntry(makeEntry({ level: 'debug', msg: 'debug-msg' }));
      addEntry(makeEntry({ level: 'info', msg: 'info-msg' }));
      addEntry(makeEntry({ level: 'warn', msg: 'warn-msg' }));
      addEntry(makeEntry({ level: 'error', msg: 'error-msg' }));

      const results = getEntries({ level: 'warn', tail: 1000 });
      const levels = results.map((e) => e.level);
      expect(levels).not.toContain('debug');
      expect(levels).not.toContain('info');
      expect(levels).toContain('warn');
      expect(levels).toContain('error');
    });
  });

  describe('component filtering', () => {
    test('should filter entries by component substring', () => {
      addEntry(makeEntry({ component: 'api-server', msg: 'api-entry' }));
      addEntry(makeEntry({ component: 'watcher-hub', msg: 'watcher-entry' }));

      const results = getEntries({ component: 'api', tail: 1000 });
      expect(results.every((e) => e.component.includes('api'))).toBe(true);
    });
  });

  describe('since filtering', () => {
    test('should filter entries by timestamp', () => {
      addEntry(makeEntry({ timestamp: 1000, msg: 'old' }));
      addEntry(makeEntry({ timestamp: 5000, msg: 'new' }));

      const results = getEntries({ since: 3000, tail: 1000 });
      expect(results.every((e) => e.timestamp >= 3000)).toBe(true);
    });
  });

  describe('combined filters', () => {
    test('should apply level + component + since filters together', () => {
      addEntry(
        makeEntry({ level: 'debug', component: 'api', timestamp: 1000, msg: 'old-debug-api' }),
      );
      addEntry(
        makeEntry({ level: 'warn', component: 'api', timestamp: 2000, msg: 'old-warn-api' }),
      );
      addEntry(
        makeEntry({ level: 'warn', component: 'api', timestamp: 5000, msg: 'new-warn-api' }),
      );
      addEntry(
        makeEntry({
          level: 'warn',
          component: 'watcher',
          timestamp: 5000,
          msg: 'new-warn-watcher',
        }),
      );
      addEntry(
        makeEntry({ level: 'error', component: 'api', timestamp: 6000, msg: 'new-error-api' }),
      );

      const results = getEntries({ level: 'warn', component: 'api', since: 3000, tail: 1000 });
      expect(results).toHaveLength(2);
      expect(results[0].msg).toBe('new-warn-api');
      expect(results[1].msg).toBe('new-error-api');
    });

    test('should return empty array when filters match nothing', () => {
      addEntry(makeEntry({ level: 'debug', component: 'test', timestamp: 100 }));

      const results = getEntries({ level: 'error', component: 'nonexistent', tail: 1000 });
      expect(results).toEqual([]);
    });
  });

  describe('edge cases', () => {
    test('should treat unknown level as 0 in LEVEL_ORDER', () => {
      addEntry(makeEntry({ level: 'custom', msg: 'custom-level' }));
      addEntry(makeEntry({ level: 'info', msg: 'info-level' }));

      // Filtering by 'info' (20) should exclude 'custom' (0)
      const results = getEntries({ level: 'info', tail: 1000 });
      expect(results.find((e) => e.msg === 'custom-level')).toBeUndefined();
      expect(results.find((e) => e.msg === 'info-level')).toBeDefined();
    });

    test('should return empty when tail is 0', () => {
      addEntry(makeEntry({ msg: 'some-entry' }));
      const results = getEntries({ tail: 0 });
      expect(results).toEqual([]);
    });

    test('should handle unknown filter level by returning all entries', () => {
      addEntry(makeEntry({ level: 'info', msg: 'info-entry' }));

      // Unknown level maps to 0 in LEVEL_ORDER, minLevel = 0 => no filtering
      const results = getEntries({ level: 'unknown', tail: 1000 });
      expect(results.find((e) => e.msg === 'info-entry')).toBeDefined();
    });
  });

  describe('circular buffer wrapping', () => {
    test('should wrap at MAX_SIZE and drop oldest entries', () => {
      for (let i = 0; i < 1001; i++) {
        addEntry(makeEntry({ msg: `wrap-${i}`, timestamp: i }));
      }
      const results = getEntries({ tail: 1000 });
      expect(results).toHaveLength(1000);
      // Oldest entry (wrap-0) should be dropped
      expect(results.find((e) => e.msg === 'wrap-0')).toBeUndefined();
      // Most recent entry should be present
      expect(results.find((e) => e.msg === 'wrap-1000')).toBeDefined();
    });
  });

  describe('onEntry subscription', () => {
    test('should emit entries to subscriber when addEntry is called', () => {
      const listener = vi.fn();
      const unsubscribe = onEntry(listener);

      const entry = makeEntry({ msg: 'streamed-entry' });
      addEntry(entry);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(entry);

      unsubscribe();
    });

    test('should stop emitting after unsubscribe is called', () => {
      const listener = vi.fn();
      const unsubscribe = onEntry(listener);

      addEntry(makeEntry({ msg: 'before-unsub' }));
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      addEntry(makeEntry({ msg: 'after-unsub' }));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    test('should support multiple subscribers independently', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const unsub1 = onEntry(listener1);
      const unsub2 = onEntry(listener2);

      addEntry(makeEntry({ msg: 'multi-sub' }));
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);

      unsub1();

      addEntry(makeEntry({ msg: 'after-unsub1' }));
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(2);

      unsub2();
    });
  });

  describe('exported filter helpers', () => {
    test('getMinLevel returns 0 for undefined or unknown levels', () => {
      expect(getMinLevel(undefined)).toBe(0);
      expect(getMinLevel('unknown')).toBe(0);
    });

    test('getMinLevel returns correct order value for known levels', () => {
      expect(getMinLevel('debug')).toBe(10);
      expect(getMinLevel('info')).toBe(20);
      expect(getMinLevel('warn')).toBe(30);
      expect(getMinLevel('error')).toBe(40);
    });

    test('meetsMinLevel returns true when minLevel is 0', () => {
      const entry = makeEntry({ level: 'debug' });
      expect(meetsMinLevel(entry, 0)).toBe(true);
    });

    test('meetsMinLevel filters by minimum level threshold', () => {
      const debugEntry = makeEntry({ level: 'debug' });
      const warnEntry = makeEntry({ level: 'warn' });

      expect(meetsMinLevel(debugEntry, 30)).toBe(false);
      expect(meetsMinLevel(warnEntry, 30)).toBe(true);
    });

    test('matchesComponent returns true when component is undefined', () => {
      const entry = makeEntry({ component: 'anything' });
      expect(matchesComponent(entry, undefined)).toBe(true);
    });

    test('matchesComponent checks substring match', () => {
      const entry = makeEntry({ component: 'api-server' });
      expect(matchesComponent(entry, 'api')).toBe(true);
      expect(matchesComponent(entry, 'watcher')).toBe(false);
    });
  });

  describe('getComponents', () => {
    test('returns sorted unique component names from the buffer', () => {
      addEntry(makeEntry({ component: 'watcher.docker.local' }));
      addEntry(makeEntry({ component: 'registry.ghcr' }));
      addEntry(makeEntry({ component: 'trigger.mqtt.qa' }));
      addEntry(makeEntry({ component: 'registry.ghcr' }));
      addEntry(makeEntry({ component: 'drydock' }));

      const components = getComponents();

      expect(components).toEqual([
        'drydock',
        'registry.ghcr',
        'trigger.mqtt.qa',
        'watcher.docker.local',
      ]);
    });

    test('skips entries whose component is empty', () => {
      addEntry(makeEntry({ component: '' }));
      addEntry(makeEntry({ component: 'api.server' }));

      expect(getComponents()).toContain('api.server');
      expect(getComponents()).not.toContain('');
    });
  });
});
