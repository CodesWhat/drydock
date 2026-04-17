import Loki from 'lokijs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as notificationHistory from './notification-history.js';

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('notification-history store', () => {
  beforeEach(() => {
    const db = new Loki('test.db', { autosave: false });
    notificationHistory.createCollections(db);
    notificationHistory.resetForTesting();
  });

  afterEach(() => {
    notificationHistory.resetForTesting();
  });

  test('createCollections tolerates undefined db gracefully', () => {
    expect(() => notificationHistory.createCollections(undefined)).not.toThrow();
  });

  describe('computeResultHash', () => {
    test('returns the same hash for identical result + updateKind', () => {
      const container = {
        result: { tag: '2.0', digest: 'sha256:abc', created: '2026-04-15', suggestedTag: '2.0' },
        updateKind: { kind: 'tag', remoteValue: '2.0' },
      } as any;
      expect(notificationHistory.computeResultHash(container)).toBe(
        notificationHistory.computeResultHash({ ...container }),
      );
    });

    test('returns a different hash when any result field changes', () => {
      const base = {
        result: { tag: '2.0', digest: 'sha256:abc', created: '2026-04-15' },
        updateKind: { kind: 'tag', remoteValue: '2.0' },
      } as any;
      const baseHash = notificationHistory.computeResultHash(base);
      expect(
        notificationHistory.computeResultHash({
          ...base,
          result: { ...base.result, tag: '2.1' },
        }),
      ).not.toBe(baseHash);
      expect(
        notificationHistory.computeResultHash({
          ...base,
          result: { ...base.result, digest: 'sha256:def' },
        }),
      ).not.toBe(baseHash);
      expect(
        notificationHistory.computeResultHash({
          ...base,
          result: { ...base.result, created: '2026-04-16' },
        }),
      ).not.toBe(baseHash);
      expect(
        notificationHistory.computeResultHash({
          ...base,
          updateKind: { ...base.updateKind, remoteValue: '2.1' },
        }),
      ).not.toBe(baseHash);
    });

    test('tolerates missing result and updateKind fields', () => {
      expect(notificationHistory.computeResultHash({} as any)).toBe(
        notificationHistory.computeResultHash({} as any),
      );
    });
  });

  describe('record / get', () => {
    test('recordNotification persists an entry retrievable via getLastNotifiedHash', () => {
      notificationHistory.recordNotification('trigger.a', 'c1', 'update-available', 'hash-1');
      expect(notificationHistory.getLastNotifiedHash('trigger.a', 'c1', 'update-available')).toBe(
        'hash-1',
      );
    });

    test('recordNotification overwrites the previous entry for the same key', () => {
      notificationHistory.recordNotification('trigger.a', 'c1', 'update-available', 'hash-1');
      notificationHistory.recordNotification('trigger.a', 'c1', 'update-available', 'hash-2');
      expect(notificationHistory.getLastNotifiedHash('trigger.a', 'c1', 'update-available')).toBe(
        'hash-2',
      );
    });

    test('getLastNotifiedHash returns undefined for unknown keys', () => {
      expect(
        notificationHistory.getLastNotifiedHash('trigger.a', 'missing', 'update-available'),
      ).toBeUndefined();
    });

    test('separate containers and triggers get independent entries', () => {
      notificationHistory.recordNotification('trigger.a', 'c1', 'update-available', 'h1');
      notificationHistory.recordNotification('trigger.a', 'c2', 'update-available', 'h2');
      notificationHistory.recordNotification('trigger.b', 'c1', 'update-available', 'h3');
      expect(notificationHistory.getLastNotifiedHash('trigger.a', 'c1', 'update-available')).toBe(
        'h1',
      );
      expect(notificationHistory.getLastNotifiedHash('trigger.a', 'c2', 'update-available')).toBe(
        'h2',
      );
      expect(notificationHistory.getLastNotifiedHash('trigger.b', 'c1', 'update-available')).toBe(
        'h3',
      );
    });

    test('event kinds are part of the key', () => {
      notificationHistory.recordNotification('trigger.a', 'c1', 'update-available', 'h1');
      notificationHistory.recordNotification('trigger.a', 'c1', 'update-applied', 'h2');
      expect(notificationHistory.getLastNotifiedHash('trigger.a', 'c1', 'update-available')).toBe(
        'h1',
      );
      expect(notificationHistory.getLastNotifiedHash('trigger.a', 'c1', 'update-applied')).toBe(
        'h2',
      );
    });

    test('update-available and update-available-digest track independently', () => {
      notificationHistory.recordNotification('trigger.a', 'c1', 'update-available', 'hash-batch');
      notificationHistory.recordNotification(
        'trigger.a',
        'c1',
        'update-available-digest',
        'hash-digest',
      );
      expect(notificationHistory.getLastNotifiedHash('trigger.a', 'c1', 'update-available')).toBe(
        'hash-batch',
      );
      expect(
        notificationHistory.getLastNotifiedHash('trigger.a', 'c1', 'update-available-digest'),
      ).toBe('hash-digest');
    });
  });

  describe('clear', () => {
    test('clearNotificationsForContainer removes only that container', () => {
      notificationHistory.recordNotification('trigger.a', 'c1', 'update-available', 'h1');
      notificationHistory.recordNotification('trigger.a', 'c2', 'update-available', 'h2');
      notificationHistory.recordNotification('trigger.b', 'c1', 'update-available', 'h3');

      expect(notificationHistory.clearNotificationsForContainer('c1')).toBe(2);

      expect(
        notificationHistory.getLastNotifiedHash('trigger.a', 'c1', 'update-available'),
      ).toBeUndefined();
      expect(
        notificationHistory.getLastNotifiedHash('trigger.b', 'c1', 'update-available'),
      ).toBeUndefined();
      expect(notificationHistory.getLastNotifiedHash('trigger.a', 'c2', 'update-available')).toBe(
        'h2',
      );
    });

    test('clearNotificationsForTrigger removes only that trigger', () => {
      notificationHistory.recordNotification('trigger.a', 'c1', 'update-available', 'h1');
      notificationHistory.recordNotification('trigger.a', 'c2', 'update-available', 'h2');
      notificationHistory.recordNotification('trigger.b', 'c1', 'update-available', 'h3');

      expect(notificationHistory.clearNotificationsForTrigger('trigger.a')).toBe(2);

      expect(
        notificationHistory.getLastNotifiedHash('trigger.a', 'c1', 'update-available'),
      ).toBeUndefined();
      expect(
        notificationHistory.getLastNotifiedHash('trigger.a', 'c2', 'update-available'),
      ).toBeUndefined();
      expect(notificationHistory.getLastNotifiedHash('trigger.b', 'c1', 'update-available')).toBe(
        'h3',
      );
    });

    test('clearNotificationsForContainerAndEvent removes only matching (container, event) entries', () => {
      notificationHistory.recordNotification('trigger.a', 'c1', 'update-available', 'h1');
      notificationHistory.recordNotification('trigger.a', 'c1', 'update-applied', 'h2');
      notificationHistory.recordNotification('trigger.b', 'c1', 'update-available', 'h3');

      expect(
        notificationHistory.clearNotificationsForContainerAndEvent('c1', 'update-available'),
      ).toBe(2);

      expect(
        notificationHistory.getLastNotifiedHash('trigger.a', 'c1', 'update-available'),
      ).toBeUndefined();
      expect(
        notificationHistory.getLastNotifiedHash('trigger.b', 'c1', 'update-available'),
      ).toBeUndefined();
      expect(notificationHistory.getLastNotifiedHash('trigger.a', 'c1', 'update-applied')).toBe(
        'h2',
      );
    });

    test('getAllForTesting returns all entries', () => {
      notificationHistory.recordNotification('trigger.a', 'c1', 'update-available', 'h1');
      notificationHistory.recordNotification('trigger.a', 'c2', 'update-available', 'h2');
      expect(notificationHistory.getAllForTesting()).toHaveLength(2);
    });

    test('resetForTesting clears every entry', () => {
      notificationHistory.recordNotification('trigger.a', 'c1', 'update-available', 'h1');
      notificationHistory.recordNotification('trigger.a', 'c2', 'update-available', 'h2');
      notificationHistory.resetForTesting();
      expect(notificationHistory.getAllForTesting()).toHaveLength(0);
    });
  });

  test('recordNotification accepts a custom notifiedAt', () => {
    const when = '2026-04-01T00:00:00Z';
    notificationHistory.recordNotification('trigger.a', 'c1', 'update-available', 'h1', when);
    const entry = notificationHistory
      .getAllForTesting()
      .find((e) => e.triggerId === 'trigger.a' && e.containerId === 'c1');
    expect(entry?.notifiedAt).toBe(when);
  });

  test('uninitialized helpers return empty results without throwing', async () => {
    vi.resetModules();
    const fresh = await import('./notification-history.js');

    expect(() =>
      fresh.recordNotification('trigger.a', 'c1', 'update-available', 'hash-1'),
    ).not.toThrow();
    expect(fresh.getLastNotifiedHash('trigger.a', 'c1', 'update-available')).toBeUndefined();
    expect(fresh.clearNotificationsForContainer('c1')).toBe(0);
    expect(fresh.clearNotificationsForTrigger('trigger.a')).toBe(0);
    expect(fresh.clearNotificationsForContainerAndEvent('c1', 'update-available')).toBe(0);
    expect(fresh.getAllForTesting()).toEqual([]);
    expect(() => fresh.resetForTesting()).not.toThrow();
  });
});
