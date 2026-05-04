import { randomUUID } from 'node:crypto';

// Minted once on module load. Any client reconnecting with a different bootId
// gets a resync-required response because the event log is not continuous.
export const bootId: string = randomUUID();

export interface BufferedEvent {
  id: string;
  event: string;
  data: unknown;
  timestamp: number;
}

export type ReplaySinceResult =
  | { kind: 'replay'; events: BufferedEvent[] }
  | { kind: 'resync-required'; events: [] };

const RESYNC_REQUIRED: ReplaySinceResult = { kind: 'resync-required', events: [] };

function parseEventId(lastEventId: string): { bootIdPart: string; counter: number } | null {
  const colonIdx = lastEventId.indexOf(':');
  if (colonIdx < 1) {
    return null;
  }
  const bootIdPart = lastEventId.slice(0, colonIdx);
  const counterStr = lastEventId.slice(colonIdx + 1);
  const counter = Number.parseInt(counterStr, 10);
  if (!Number.isFinite(counter) || counter < 0) {
    return null;
  }
  return { bootIdPart, counter };
}

export class SseEventBuffer {
  private readonly windowMs: number;
  private readonly maxEntries: number;
  private readonly ring: BufferedEvent[] = [];

  constructor(windowMs = 5 * 60 * 1000, maxEntries = 500) {
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
  }

  push(id: string, event: string, data: unknown, timestamp: number): void {
    this.evict(timestamp);
    this.ring.push({ id, event, data, timestamp });
    this.evictOverflow();
  }

  replaySince(lastEventId: string, now: number): ReplaySinceResult {
    this.evict(now);

    const parsed = parseEventId(lastEventId);
    if (!parsed) {
      // Malformed id — treat as stale so the client does a full refetch.
      return RESYNC_REQUIRED;
    }

    if (parsed.bootIdPart !== bootId) {
      return RESYNC_REQUIRED;
    }

    // If the buffer is non-empty and the requested counter is older than the
    // oldest retained event, the gap cannot be filled.
    if (this.ring.length > 0) {
      const oldestParsed = parseEventId(this.ring[0].id);
      if (oldestParsed && parsed.counter < oldestParsed.counter - 1) {
        return RESYNC_REQUIRED;
      }
    }

    const events = this.ring.filter((e) => {
      const p = parseEventId(e.id);
      return p !== null && p.counter > parsed.counter;
    });

    return { kind: 'replay', events };
  }

  evict(now: number): void {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.ring.length && this.ring[i].timestamp < cutoff) {
      i += 1;
    }
    if (i > 0) {
      this.ring.splice(0, i);
    }
  }

  private evictOverflow(): void {
    if (this.maxEntries <= 0) {
      this.ring.length = 0;
      return;
    }
    const overflow = this.ring.length - this.maxEntries;
    if (overflow > 0) {
      this.ring.splice(0, overflow);
    }
  }
}
