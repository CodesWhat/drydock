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

    // Regression test for a duplicate-notification bug: a manual recheck bypasses the
    // registry poll cache, so suggestedTag/created can come back drifted even though the
    // candidate (tag + digest) is unchanged. The hash must NOT change here, or
    // hasAlreadyNotifiedForResult sees a "new" result and a once:true trigger fires again
    // for the same update. This replaces a prior version of this test that asserted the
    // opposite (a `created` change producing a different hash), which pinned the bug.
    test('returns the same hash when only display-only metadata drifts (digest present)', () => {
      const base = {
        result: { tag: '2.0', digest: 'sha256:abc', created: '2026-04-15', suggestedTag: '2.0' },
        updateKind: { kind: 'tag', remoteValue: '2.0' },
      } as any;
      const drifted = {
        ...base,
        result: { ...base.result, created: '2026-04-20', suggestedTag: '2.1' },
      };
      expect(notificationHistory.computeResultHash(drifted)).toBe(
        notificationHistory.computeResultHash(base),
      );
    });

    // Regression test for #972: a transient registry rate limit
    // (`Digest watch failed (429)`) drops the digest lookup for a tag-kind
    // update on one scan and succeeds on the next. Before this fix, digest
    // absence flipped `created` into the hash on the failed scan and back out
    // on the next, so the once=true history no longer matched and the
    // trigger re-fired for a tag update it had already announced.
    test('returns the same hash for a tag-kind update whether the digest lookup succeeded or failed', () => {
      const digestSucceeded = {
        result: {
          tag: '2.29.2-pg17',
          digest: 'sha256:abc',
          created: '2026-04-15',
        },
        updateKind: { kind: 'tag', remoteValue: '2.29.2-pg17' },
        image: { digest: { watch: true } },
      } as any;
      const digestFailed = {
        result: {
          tag: '2.29.2-pg17',
          // Digest watch failed (429): no digest, and created falls back to
          // whatever this scan's enumeration produced.
          digest: undefined,
          created: '2026-04-15T12:59:48.000Z',
        },
        updateKind: { kind: 'tag', remoteValue: '2.29.2-pg17' },
        image: { digest: { watch: true } },
      } as any;
      expect(notificationHistory.computeResultHash(digestFailed)).toBe(
        notificationHistory.computeResultHash(digestSucceeded),
      );
    });

    test('keeps created as the discriminator for a tag-kind update when digest watching is not configured', () => {
      const base = {
        result: { tag: 'latest', digest: undefined, created: '2026-04-15' },
        updateKind: { kind: 'tag', remoteValue: 'latest' },
        image: { digest: { watch: false } },
      } as any;
      const differentImage = {
        ...base,
        result: { ...base.result, created: '2026-04-16' },
      };
      expect(notificationHistory.computeResultHash(differentImage)).not.toBe(
        notificationHistory.computeResultHash(base),
      );
    });

    test('still keys a digest-kind update on the digest (no tag-kind carve-out)', () => {
      const base = {
        result: { tag: 'latest', digest: 'sha256:abc', created: '2026-04-15' },
        updateKind: { kind: 'digest', remoteValue: 'sha256:abc' },
      } as any;
      const differentDigest = {
        ...base,
        result: { ...base.result, digest: 'sha256:def' },
        updateKind: { kind: 'digest', remoteValue: 'sha256:def' },
      };
      expect(notificationHistory.computeResultHash(differentDigest)).not.toBe(
        notificationHistory.computeResultHash(base),
      );
    });

    test('a genuinely new tag for a tag-kind update still produces a different hash', () => {
      const base = {
        result: { tag: '2.29.1-pg17', digest: undefined, created: '2026-04-15' },
        updateKind: { kind: 'tag', remoteValue: '2.29.1-pg17' },
        image: { digest: { watch: true } },
      } as any;
      const newTag = {
        result: { tag: '2.29.2-pg17', digest: undefined, created: '2026-04-15' },
        updateKind: { kind: 'tag', remoteValue: '2.29.2-pg17' },
        image: { digest: { watch: true } },
      } as any;
      expect(notificationHistory.computeResultHash(newTag)).not.toBe(
        notificationHistory.computeResultHash(base),
      );
    });

    test('returns a different hash when the candidate identity or updateKind changes', () => {
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
      // Digest is intentionally excluded from the hash for a tag-kind update
      // (see the dedicated tag-kind tests below, #972) — assert the digest
      // change matters here against a digest-kind base instead, which is
      // still keyed on it.
      const digestKindBase = { ...base, updateKind: { kind: 'digest', remoteValue: 'sha256:abc' } };
      expect(
        notificationHistory.computeResultHash({
          ...digestKindBase,
          result: { ...digestKindBase.result, digest: 'sha256:def' },
        }),
      ).not.toBe(notificationHistory.computeResultHash(digestKindBase));
      expect(
        notificationHistory.computeResultHash({
          ...base,
          updateKind: { ...base.updateKind, remoteValue: '2.1' },
        }),
      ).not.toBe(baseHash);
      expect(
        notificationHistory.computeResultHash({
          ...base,
          updateKind: { ...base.updateKind, kind: 'digest' },
        }),
      ).not.toBe(baseHash);
    });

    test('treats created as the sole discriminator when no digest is present (legacy manifest path)', () => {
      const base = {
        result: { tag: 'latest', created: '2026-04-15' },
        updateKind: { kind: 'tag', remoteValue: 'latest' },
      } as any;
      const baseHash = notificationHistory.computeResultHash(base);
      expect(
        notificationHistory.computeResultHash({
          ...base,
          result: { ...base.result, created: '2026-04-16' },
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

    test('security-alert and security-alert-digest track independently', () => {
      notificationHistory.recordNotification('trigger.a', 'c1', 'security-alert', 'hash-immediate');
      notificationHistory.recordNotification(
        'trigger.a',
        'c1',
        'security-alert-digest',
        'hash-cycle',
      );
      expect(notificationHistory.getLastNotifiedHash('trigger.a', 'c1', 'security-alert')).toBe(
        'hash-immediate',
      );
      expect(
        notificationHistory.getLastNotifiedHash('trigger.a', 'c1', 'security-alert-digest'),
      ).toBe('hash-cycle');
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
