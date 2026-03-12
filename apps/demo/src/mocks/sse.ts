/**
 * FakeEventSource — replaces the native EventSource so the UI's SSE service
 * gets the events it expects without a real backend.
 */

type EventSourceListener = (event: MessageEvent) => void;

export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;

  readyState = FakeEventSource.CONNECTING;
  url: string;
  withCredentials = false;

  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  private listeners = new Map<string, Set<EventSourceListener>>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(url: string, _init?: EventSourceInit) {
    this.url = url;

    // Simulate async connection — fire connected on next microtask
    queueMicrotask(() => {
      if (this.readyState === FakeEventSource.CLOSED) return;
      this.readyState = FakeEventSource.OPEN;
      this.onopen?.(new Event('open'));

      // Fire dd:connected immediately with a client ID
      this.dispatch(
        'dd:connected',
        JSON.stringify({ clientId: 'demo-client', clientToken: 'demo-token' }),
      );

      // Fire dd:container-updated every 30 s to keep the UI refreshing
      this.timer = setInterval(() => {
        if (this.readyState !== FakeEventSource.OPEN) return;
        this.dispatch('dd:container-updated', '');
      }, 30_000);
    });
  }

  addEventListener(type: string, listener: EventSourceListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: EventSourceListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(_event: Event): boolean {
    return true;
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private dispatch(type: string, data: string): void {
    const event = new MessageEvent(type, { data });
    if (type === 'message') {
      this.onmessage?.(event);
    }
    this.listeners.get(type)?.forEach((fn) => fn(event));
  }
}
