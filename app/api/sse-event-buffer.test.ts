var { mockRandomUUID } = vi.hoisted(() => {
  let uuidCounter = 0;
  return {
    mockRandomUUID: vi.fn(() => {
      uuidCounter += 1;
      return `boot-uuid-${uuidCounter}`;
    }),
  };
});

vi.mock('node:crypto', () => ({
  randomUUID: mockRandomUUID,
}));

import { bootId, SseEventBuffer } from './sse-event-buffer.js';

describe('bootId', () => {
  test('is a non-empty string minted at module load', () => {
    expect(typeof bootId).toBe('string');
    expect(bootId.length).toBeGreaterThan(0);
    expect(bootId).toBe('boot-uuid-1');
  });
});

describe('SseEventBuffer', () => {
  const NOW = 1_000_000;
  const WINDOW_MS = 60_000; // 1 minute for tests

  function makeBuffer(windowMs = WINDOW_MS) {
    return new SseEventBuffer(windowMs);
  }

  function makeId(counter: number) {
    return `${bootId}:${counter}`;
  }

  describe('push + replaySince happy path', () => {
    test('returns events with counter > lastEventId counter', () => {
      const buf = makeBuffer();
      buf.push(makeId(1), 'dd:scan-started', { containerId: 'c1' }, NOW);
      buf.push(makeId(2), 'dd:scan-completed', { containerId: 'c1' }, NOW + 1000);
      buf.push(makeId(3), 'dd:container-updated', { id: 'c1' }, NOW + 2000);

      const result = buf.replaySince(makeId(1), NOW + 3000);

      expect(result.kind).toBe('replay');
      if (result.kind === 'replay') {
        expect(result.events).toHaveLength(2);
        expect(result.events[0].id).toBe(makeId(2));
        expect(result.events[1].id).toBe(makeId(3));
      }
    });

    test('returns all events when lastEventId counter is 0', () => {
      const buf = makeBuffer();
      buf.push(makeId(1), 'dd:scan-started', {}, NOW);
      buf.push(makeId(2), 'dd:scan-completed', {}, NOW + 1000);

      const result = buf.replaySince(makeId(0), NOW + 2000);

      expect(result.kind).toBe('replay');
      if (result.kind === 'replay') {
        expect(result.events).toHaveLength(2);
      }
    });

    test('returns empty events when all buffered events are already seen', () => {
      const buf = makeBuffer();
      buf.push(makeId(1), 'dd:scan-started', {}, NOW);

      const result = buf.replaySince(makeId(1), NOW + 1000);

      expect(result.kind).toBe('replay');
      if (result.kind === 'replay') {
        expect(result.events).toHaveLength(0);
      }
    });

    test('events are returned in chronological order', () => {
      const buf = makeBuffer();
      buf.push(makeId(5), 'dd:container-updated', { n: 5 }, NOW + 5000);
      buf.push(makeId(10), 'dd:container-updated', { n: 10 }, NOW + 10000);
      buf.push(makeId(15), 'dd:container-updated', { n: 15 }, NOW + 15000);

      const result = buf.replaySince(makeId(4), NOW + 20000);

      expect(result.kind).toBe('replay');
      if (result.kind === 'replay') {
        expect(result.events.map((e) => e.id)).toEqual([makeId(5), makeId(10), makeId(15)]);
      }
    });

    test('replayed events carry original event name and data', () => {
      const buf = makeBuffer();
      const payload = { containerId: 'abc', status: 'success' };
      buf.push(makeId(7), 'dd:scan-completed', payload, NOW);

      const result = buf.replaySince(makeId(6), NOW + 1000);

      expect(result.kind).toBe('replay');
      if (result.kind === 'replay') {
        expect(result.events[0].event).toBe('dd:scan-completed');
        expect(result.events[0].data).toEqual(payload);
        expect(result.events[0].timestamp).toBe(NOW);
      }
    });
  });

  describe('eviction by age', () => {
    test('evicts events older than windowMs from push', () => {
      const buf = makeBuffer(5000);
      buf.push(makeId(1), 'dd:scan-started', {}, NOW);
      buf.push(makeId(2), 'dd:scan-completed', {}, NOW + 1000);

      // Push at NOW + 6000 — first event at NOW is now 6s old, beyond 5s window
      buf.push(makeId(3), 'dd:container-updated', {}, NOW + 6000);

      // Asking for events after counter 0: event 1 was evicted, so there is a
      // gap between counter 0 and the oldest retained (2). resync-required.
      const resultWithGap = buf.replaySince(makeId(0), NOW + 6000);
      expect(resultWithGap.kind).toBe('resync-required');

      // Asking for events after counter 1 (adjacent to oldest): no gap, replay ok.
      const resultAdjacent = buf.replaySince(makeId(1), NOW + 6000);
      expect(resultAdjacent.kind).toBe('replay');
      if (resultAdjacent.kind === 'replay') {
        const ids = resultAdjacent.events.map((e) => e.id);
        expect(ids).toContain(makeId(2));
        expect(ids).toContain(makeId(3));
      }
    });

    test('evict() removes events older than windowMs', () => {
      const buf = makeBuffer(5000);
      buf.push(makeId(1), 'dd:scan-started', {}, NOW);
      buf.push(makeId(2), 'dd:scan-completed', {}, NOW + 3000);

      buf.evict(NOW + 10000); // 10s later — both events are stale

      const result = buf.replaySince(makeId(0), NOW + 10000);
      expect(result.kind).toBe('replay');
      if (result.kind === 'replay') {
        expect(result.events).toHaveLength(0);
      }
    });

    test('evict() is a no-op when ring is empty', () => {
      const buf = makeBuffer();
      expect(() => buf.evict(NOW)).not.toThrow();
    });

    test('events exactly at the cutoff boundary are retained', () => {
      const buf = makeBuffer(5000);
      // Pushed exactly at cutoff time (NOW + 5000 - 5000 = NOW)
      buf.push(makeId(1), 'dd:scan-started', {}, NOW);
      buf.push(makeId(2), 'dd:scan-completed', {}, NOW + 1);

      buf.evict(NOW + 5000); // cutoff = NOW + 5000 - 5000 = NOW → events at NOW are NOT < NOW

      const result = buf.replaySince(makeId(0), NOW + 5000);
      expect(result.kind).toBe('replay');
      if (result.kind === 'replay') {
        // Event at NOW is not strictly < NOW, so it's retained
        expect(result.events.some((e) => e.id === makeId(1))).toBe(true);
      }
    });
  });

  describe('eviction by size', () => {
    test('keeps only the newest maxEntries events', () => {
      const buf = new SseEventBuffer(WINDOW_MS, 2);
      buf.push(makeId(1), 'dd:scan-started', { n: 1 }, NOW);
      buf.push(makeId(2), 'dd:scan-started', { n: 2 }, NOW + 1);
      buf.push(makeId(3), 'dd:scan-started', { n: 3 }, NOW + 2);

      const resultWithGap = buf.replaySince(makeId(0), NOW + 3);
      expect(resultWithGap.kind).toBe('resync-required');

      const resultAdjacent = buf.replaySince(makeId(1), NOW + 3);
      expect(resultAdjacent.kind).toBe('replay');
      if (resultAdjacent.kind === 'replay') {
        expect(resultAdjacent.events.map((event) => event.id)).toEqual([makeId(2), makeId(3)]);
      }
    });

    test('keeps no replayable events when maxEntries is zero', () => {
      const buf = new SseEventBuffer(WINDOW_MS, 0);
      buf.push(makeId(1), 'dd:scan-started', { n: 1 }, NOW);

      const result = buf.replaySince(makeId(0), NOW + 1);

      expect(result.kind).toBe('replay');
      if (result.kind === 'replay') {
        expect(result.events).toHaveLength(0);
      }
    });
  });

  describe('boot-mismatch', () => {
    test('returns resync-required when lastEventId has a different bootId prefix', () => {
      const buf = makeBuffer();
      buf.push(makeId(1), 'dd:scan-started', {}, NOW);

      const result = buf.replaySince('old-boot-id:1', NOW + 1000);

      expect(result.kind).toBe('resync-required');
      expect(result.events).toHaveLength(0);
    });

    test('resync-required when bootId prefix is empty', () => {
      const buf = makeBuffer();
      const result = buf.replaySince(':5', NOW);
      expect(result.kind).toBe('resync-required');
    });
  });

  describe('buffer-evicted (lastEventId older than oldest retained)', () => {
    test('returns resync-required when lastEventId counter predates oldest buffered event', () => {
      const buf = makeBuffer(5000);

      // Simulate: events 1 and 2 were pushed and then evicted by the time
      // event 10 is in the buffer.
      buf.push(makeId(10), 'dd:scan-started', {}, NOW);

      // lastEventId counter 1 is older than oldest retained (10), gap is unbridgeable
      const result = buf.replaySince(makeId(1), NOW + 1000);

      expect(result.kind).toBe('resync-required');
    });

    test('does NOT return resync-required when lastEventId counter == oldest retained - 1', () => {
      const buf = makeBuffer();
      buf.push(makeId(10), 'dd:scan-started', {}, NOW);

      // Counter 9 is exactly one before oldest (10) — adjacent, no gap
      const result = buf.replaySince(makeId(9), NOW + 1000);

      expect(result.kind).toBe('replay');
      if (result.kind === 'replay') {
        expect(result.events[0].id).toBe(makeId(10));
      }
    });
  });

  describe('empty-buffer replay', () => {
    test('returns replay with empty events when buffer has no events', () => {
      const buf = makeBuffer();
      const result = buf.replaySince(makeId(5), NOW);

      expect(result.kind).toBe('replay');
      if (result.kind === 'replay') {
        expect(result.events).toHaveLength(0);
      }
    });
  });

  describe('malformed lastEventId', () => {
    test('returns resync-required for lastEventId with no colon', () => {
      const buf = makeBuffer();
      const result = buf.replaySince('nocolon', NOW);
      expect(result.kind).toBe('resync-required');
    });

    test('returns resync-required for lastEventId with non-numeric counter', () => {
      const buf = makeBuffer();
      const result = buf.replaySince(`${bootId}:abc`, NOW);
      expect(result.kind).toBe('resync-required');
    });

    test('returns resync-required for lastEventId with negative counter', () => {
      const buf = makeBuffer();
      const result = buf.replaySince(`${bootId}:-1`, NOW);
      expect(result.kind).toBe('resync-required');
    });

    test('returns resync-required for empty string', () => {
      const buf = makeBuffer();
      const result = buf.replaySince('', NOW);
      expect(result.kind).toBe('resync-required');
    });

    test('returns resync-required for colon-only string', () => {
      const buf = makeBuffer();
      const result = buf.replaySince(':', NOW);
      expect(result.kind).toBe('resync-required');
    });
  });
});
