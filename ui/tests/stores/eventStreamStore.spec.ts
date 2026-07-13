import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFixedRingBuffer, useEventStreamStore } from '@/stores/eventStream';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onerror: (() => void) | undefined;
  addEventListener = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
}

describe('createFixedRingBuffer', () => {
  it('rejects non-positive and unsafe capacities', () => {
    expect(() => createFixedRingBuffer<number>(0)).toThrow(
      'Ring buffer capacity must be a positive safe integer',
    );
    expect(() => createFixedRingBuffer<number>(1.5)).toThrow(
      'Ring buffer capacity must be a positive safe integer',
    );
  });

  it('retains entries in chronological order up to its fixed capacity', () => {
    const buffer = createFixedRingBuffer<number>(3);

    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4);

    expect(buffer.size).toBe(3);
    expect(buffer.toArray()).toEqual([2, 3, 4]);
  });

  it('can be cleared and reused', () => {
    const buffer = createFixedRingBuffer<string>(2);

    buffer.push('first');
    buffer.push('second');
    buffer.clear();
    buffer.push('third');

    expect(buffer.size).toBe(1);
    expect(buffer.toArray()).toEqual(['third']);
  });
});

describe('useEventStreamStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('keeps subscriber sets until the last callback unsubscribes', () => {
    const store = useEventStreamStore();
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = store.subscribe('update-applied', first);
    const unsubscribeSecond = store.subscribe('update-applied', second);

    unsubscribeFirst();
    store.publish('update-applied', { operationId: 'op-1' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(
      { operationId: 'op-1' },
      expect.objectContaining({ event: 'update-applied' }),
    );

    unsubscribeSecond();
    second.mockClear();
    store.publish('update-applied', { operationId: 'op-2' });

    expect(second).not.toHaveBeenCalled();
  });

  it('keeps a bounded recent event history in chronological order', () => {
    const store = useEventStreamStore();

    for (let index = 0; index < 505; index += 1) {
      store.publish('container-updated', { index }, `event-${index}`);
    }

    expect(store.recentEvents).toHaveLength(500);
    expect(store.recentEvents[0]).toMatchObject({
      id: 'event-5',
      event: 'container-updated',
      payload: { index: 5 },
    });
    expect(store.recentEvents.at(-1)).toMatchObject({
      id: 'event-504',
      event: 'container-updated',
      payload: { index: 504 },
    });
  });
});

describe('doConnect SSE URL construction', () => {
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    setActivePinia(createPinia());
    MockEventSource.instances = [];
    originalEventSource = globalThis.EventSource;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
  });

  it('uses the base URL on first connect when no lastEventId is recorded', () => {
    const store = useEventStreamStore();
    store.connect();

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('/api/v1/events/ui');
  });

  it('appends last-event-id query param on reconnect after an event is received', () => {
    const store = useEventStreamStore();

    // Simulate an event arriving (sets lastEventId via publish)
    store.publish('container-updated', {}, 'evt-001');
    expect(store.lastEventId).toBe('evt-001');

    // Reconnect — should include the last-event-id query param
    store.connect();

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('/api/v1/events/ui?last-event-id=evt-001');
  });

  it('URL-encodes the last-event-id value on reconnect', () => {
    const store = useEventStreamStore();

    store.publish('container-updated', {}, 'boot-id-with-colon:42');
    expect(store.lastEventId).toBe('boot-id-with-colon:42');

    store.connect();

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(
      '/api/v1/events/ui?last-event-id=boot-id-with-colon%3A42',
    );
  });
});

describe('SSE event listener: dd:agent-stats-changed', () => {
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    setActivePinia(createPinia());
    MockEventSource.instances = [];
    originalEventSource = globalThis.EventSource;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
  });

  it('maps dd:agent-stats-changed to agent-status-changed bus event', () => {
    const store = useEventStreamStore();
    const bus = { emit: vi.fn() };
    store.connect(bus);

    const source = MockEventSource.instances[0];
    expect(source).toBeDefined();

    // Find the dd:agent-stats-changed listener registered via addEventListener
    const registeredCall = source.addEventListener.mock.calls.find(
      (call) => call[0] === 'dd:agent-stats-changed',
    );
    expect(registeredCall).toBeDefined();

    const listener = registeredCall![1];
    const fakeEvent = { lastEventId: 'boot:42' };
    listener(fakeEvent);

    expect(bus.emit).toHaveBeenCalledWith('agent-status-changed');
  });

  it('maps dd:agent-stats-changed to agent-status-changed when the event carries no lastEventId', () => {
    const store = useEventStreamStore();
    const bus = { emit: vi.fn() };
    store.connect(bus);

    const source = MockEventSource.instances[0];
    expect(source).toBeDefined();

    const registeredCall = source.addEventListener.mock.calls.find(
      (call) => call[0] === 'dd:agent-stats-changed',
    );
    expect(registeredCall).toBeDefined();

    const listener = registeredCall![1];
    listener(undefined);

    expect(bus.emit).toHaveBeenCalledWith('agent-status-changed');
  });

  it('registers dd:agent-connected, dd:agent-disconnected, and dd:agent-stats-changed listeners', () => {
    const store = useEventStreamStore();
    store.connect();

    const source = MockEventSource.instances[0];
    const registeredEventNames = source.addEventListener.mock.calls.map((call) => call[0]);

    expect(registeredEventNames).toContain('dd:agent-connected');
    expect(registeredEventNames).toContain('dd:agent-disconnected');
    expect(registeredEventNames).toContain('dd:agent-stats-changed');
  });
});

describe('SSE event listener: dd:container-unhealthy', () => {
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    setActivePinia(createPinia());
    MockEventSource.instances = [];
    originalEventSource = globalThis.EventSource;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
  });

  it('maps the post-audit health event to a bell invalidation event', () => {
    const store = useEventStreamStore();
    const bus = { emit: vi.fn() };
    store.connect(bus);

    const source = MockEventSource.instances[0];
    const registeredCall = source.addEventListener.mock.calls.find(
      (call) => call[0] === 'dd:container-unhealthy',
    );
    expect(registeredCall).toBeDefined();

    registeredCall![1](
      new MessageEvent('dd:container-unhealthy', {
        data: JSON.stringify({ containerName: 'web', health: 'unhealthy' }),
        lastEventId: 'boot:health-1',
      }),
    );

    expect(bus.emit).toHaveBeenCalledWith('container-unhealthy', {
      containerName: 'web',
      health: 'unhealthy',
    });

    registeredCall![1](
      new MessageEvent('dd:container-unhealthy', {
        data: JSON.stringify({ containerName: 'api', health: 'unhealthy' }),
      }),
    );
    expect(bus.emit).toHaveBeenLastCalledWith('container-unhealthy', {
      containerName: 'api',
      health: 'unhealthy',
    });
  });
});

describe('SSE event listener: dd:preferences-updated', () => {
  let originalEventSource: typeof EventSource;
  beforeEach(() => {
    setActivePinia(createPinia());
    MockEventSource.instances = [];
    originalEventSource = globalThis.EventSource;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  });
  afterEach(() => {
    globalThis.EventSource = originalEventSource;
  });

  it('maps the server event to the sibling bus event with parsed payload and id', () => {
    const store = useEventStreamStore();
    const bus = { emit: vi.fn() };
    store.connect(bus);
    const call = MockEventSource.instances[0].addEventListener.mock.calls.find(
      ([name]) => name === 'dd:preferences-updated',
    );
    expect(call).toBeDefined();
    call![1]({ data: '{"username":"alice"}', lastEventId: 'boot:7' });
    expect(bus.emit).toHaveBeenCalledWith('preferences-updated', { username: 'alice' });
    expect(store.recentEvents.at(-1)).toMatchObject({
      id: 'boot:7',
      event: 'preferences-updated',
      payload: { username: 'alice' },
    });
  });

  it('maps a preference event without a last-event id', () => {
    const store = useEventStreamStore();
    const bus = { emit: vi.fn() };
    store.connect(bus);
    const call = MockEventSource.instances[0].addEventListener.mock.calls.find(
      ([name]) => name === 'dd:preferences-updated',
    );
    call![1]({ data: '{"username":"alice"}', lastEventId: '' });
    expect(store.recentEvents.at(-1)).toMatchObject({
      id: undefined,
      event: 'preferences-updated',
    });
  });
});

describe('SSE reconnect backoff', () => {
  let originalEventSource: typeof EventSource;
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    MockEventSource.instances = [];
    originalEventSource = globalThis.EventSource;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    // Spy on setTimeout so we can capture the delay without actually waiting
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
    setTimeoutSpy.mockRestore();
  });

  function triggerOnerror(instanceIndex = 0): void {
    const source = MockEventSource.instances[instanceIndex];
    if (source?.onerror) {
      source.onerror();
    }
  }

  it('uses exponential backoff: delay doubles with each consecutive error', () => {
    // Seed Math.random to 0 so jitter factor is always 0.5 (lower bound)
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const store = useEventStreamStore();
    store.connect();

    // Error 1 → consecutiveErrors = 1 → capped = min(30000, 1000 * 2^1) = 2000 → delay = 2000 * 0.5 = 1000
    triggerOnerror(0);
    const delay1 = setTimeoutSpy.mock.calls.at(-1)?.[1] as number;
    expect(delay1).toBeGreaterThanOrEqual(1000);
    expect(delay1).toBeLessThanOrEqual(2000);

    // Error 2 → consecutiveErrors = 2 → capped = min(30000, 1000 * 2^2) = 4000 → delay = 4000 * 0.5 = 2000
    triggerOnerror(0);
    const delay2 = setTimeoutSpy.mock.calls.at(-1)?.[1] as number;
    expect(delay2).toBeGreaterThan(delay1);
    expect(delay2).toBeGreaterThanOrEqual(2000);
    expect(delay2).toBeLessThanOrEqual(4000);

    // Error 3 → consecutiveErrors = 3 → capped = min(30000, 1000 * 2^3) = 8000 → delay range [4000, 8000]
    triggerOnerror(0);
    const delay3 = setTimeoutSpy.mock.calls.at(-1)?.[1] as number;
    expect(delay3).toBeGreaterThan(delay2);
    expect(delay3).toBeGreaterThanOrEqual(4000);
    expect(delay3).toBeLessThanOrEqual(8000);

    vi.spyOn(Math, 'random').mockRestore();
  });

  it('caps reconnect delay at 30 seconds regardless of error count', () => {
    // Use random = 1 to hit the upper bound: cappedMs * (0.5 + 1/2) = cappedMs
    vi.spyOn(Math, 'random').mockReturnValue(1);

    const store = useEventStreamStore();
    store.connect();

    // Trigger many errors to push past the 30s cap (2^6 = 64000 → capped at 30000)
    for (let i = 0; i < 10; i++) {
      triggerOnerror(0);
    }

    const lastDelay = setTimeoutSpy.mock.calls.at(-1)?.[1] as number;
    expect(lastDelay).toBeLessThanOrEqual(30000);

    vi.spyOn(Math, 'random').mockRestore();
  });

  it('jitter keeps delay within [cappedMs * 0.5, cappedMs] for any Math.random value', () => {
    // Lower-bound check: random = 0 → factor = 0.5 → delay = cappedMs * 0.5
    // Error 1 → cappedMs = min(30000, 1000 * 2^1) = 2000 → delay = 1000
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const storeLow = useEventStreamStore();
    storeLow.connect();
    triggerOnerror(0);
    const lowerBoundDelay = setTimeoutSpy.mock.calls.at(-1)?.[1] as number;
    expect(lowerBoundDelay).toBeCloseTo(1000, 0);
    storeLow.disconnect();
    vi.spyOn(Math, 'random').mockRestore();

    // Upper-bound check: random = 1 → factor = 1.0 → delay = cappedMs = 2000
    setActivePinia(createPinia());
    MockEventSource.instances = [];
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const storeHigh = useEventStreamStore();
    storeHigh.connect();
    triggerOnerror(0);
    const upperBoundDelay = setTimeoutSpy.mock.calls.at(-1)?.[1] as number;
    expect(upperBoundDelay).toBeCloseTo(2000, 0);
    storeHigh.disconnect();
    vi.spyOn(Math, 'random').mockRestore();
  });

  it('resets consecutiveErrors to 0 on successful reconnect', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const store = useEventStreamStore();
    store.connect();

    // Accumulate errors
    triggerOnerror(0);
    triggerOnerror(0);

    // Now simulate a successful connection (dd:connected resets consecutiveErrors)
    const connectedCall = MockEventSource.instances[0].addEventListener.mock.calls.find(
      ([event]) => event === 'dd:connected',
    );
    if (connectedCall) {
      const listener = connectedCall[1] as (e: MessageEvent) => void;
      listener({ data: '{}', lastEventId: 'evt-1' } as unknown as MessageEvent);
    }

    // After reset, next error should use delay based on consecutiveErrors = 1 again
    triggerOnerror(MockEventSource.instances.length - 1);
    const delayAfterReset = setTimeoutSpy.mock.calls.at(-1)?.[1] as number;
    // consecutiveErrors = 1 → cappedMs = 2000 → delay = 2000 * 0.5 = 1000 (random=0)
    expect(delayAfterReset).toBeCloseTo(1000, 0);

    vi.spyOn(Math, 'random').mockRestore();
  });
});
