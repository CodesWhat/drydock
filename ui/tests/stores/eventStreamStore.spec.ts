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
