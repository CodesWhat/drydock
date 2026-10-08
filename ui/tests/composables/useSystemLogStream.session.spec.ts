import { effectScope } from 'vue';
import { useSystemLogStream } from '@/composables/useSystemLogStream';

// The real stream service runs here, over a socket the test drives: what is
// under test is what happens to the socket itself when its session ends.
class FakeWebSocket {
  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
  }

  open() {
    this.onopen?.(new Event('open'));
  }

  receive(msg: string) {
    this.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          timestamp: 1,
          displayTimestamp: '08:00:00.000',
          level: 'info',
          component: 'drydock',
          msg,
        }),
      }),
    );
  }

  fail() {
    this.onerror?.(new Event('error'));
    this.onclose?.(new CloseEvent('close', { code: 1006 }));
  }

  /** What the server does when the session behind the socket is revoked. */
  endSession() {
    this.onclose?.(new CloseEvent('close', { code: 1008, reason: 'Session revoked' }));
  }
}

/** AppLayout raises this each time the app's event stream connects, which takes a session the server accepts. */
function sessionIsBack() {
  globalThis.dispatchEvent(new CustomEvent('dd:sse-connected'));
}

describe('the system log stream when its session ends', () => {
  const scopes: Array<ReturnType<typeof effectScope>> = [];

  function openStream() {
    const sockets: FakeWebSocket[] = [];
    const scope = effectScope();
    scopes.push(scope);
    const stream = scope.run(() =>
      useSystemLogStream({
        webSocketFactory: (url) => {
          const socket = new FakeWebSocket(url);
          sockets.push(socket);
          return socket as unknown as WebSocket;
        },
        location: { protocol: 'http:', host: 'localhost:3000' } as Location,
      }),
    );
    if (!stream) {
      throw new Error('the stream was not created');
    }
    return { scope, stream, sockets };
  }

  afterEach(() => {
    for (const scope of scopes.splice(0)) {
      scope.stop();
    }
  });

  it('stays closed while the session is gone and reopens, with the same filters, once the app has one again', () => {
    const { stream, sockets } = openStream();
    stream.connect({ level: 'warn', component: 'api', tail: 50 });
    sockets[0].open();
    sockets[0].receive('before the session ended');

    sockets[0].endSession();

    expect(stream.status.value).toBe('disconnected');
    // Nothing retries against a session the server just refused.
    expect(sockets).toHaveLength(1);

    sessionIsBack();

    expect(sockets).toHaveLength(2);
    expect(sockets[1].url).toBe(sockets[0].url);
    expect(sockets[1].url).toContain('level=warn&component=api&tail=50');
    // The reopened socket sends the tail again, so what was shown is dropped.
    expect(stream.entries.value).toEqual([]);

    sockets[1].open();
    sockets[1].receive('after signing in again');
    expect(stream.status.value).toBe('connected');
    expect(stream.entries.value.map((entry) => entry.msg)).toEqual(['after signing in again']);
  });

  it('leaves a live socket alone when the app’s event stream reconnects', () => {
    const { stream, sockets } = openStream();
    stream.connect();
    sockets[0].open();
    sockets[0].receive('still streaming');

    sessionIsBack();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].close).not.toHaveBeenCalled();
    expect(stream.entries.value).toHaveLength(1);
  });

  it('does not open a second socket while the first is still opening, as on page load', () => {
    const { stream, sockets } = openStream();
    stream.connect();

    sessionIsBack();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].close).not.toHaveBeenCalled();
  });

  it('does not double up on a filter change that is still opening', () => {
    const { stream, sockets } = openStream();
    stream.connect();
    sockets[0].open();
    stream.updateFilters({ level: 'error' });

    sessionIsBack();

    expect(sockets).toHaveLength(2);
  });

  it('tries once each time the session comes back, never in a loop', () => {
    const { stream, sockets } = openStream();
    stream.connect();
    sockets[0].open();
    sockets[0].endSession();

    sessionIsBack();
    // Still opening: a second signal does not stack a second attempt.
    sessionIsBack();
    expect(sockets).toHaveLength(2);

    // The attempt was refused, and nothing retries it by itself.
    sockets[1].fail();
    expect(stream.status.value).toBe('disconnected');
    expect(sockets).toHaveLength(2);

    sessionIsBack();
    expect(sockets).toHaveLength(3);
  });

  it('stays closed once streaming was stopped', () => {
    const { stream, sockets } = openStream();
    stream.connect();
    sockets[0].open();
    stream.disconnect();

    sessionIsBack();

    expect(sockets).toHaveLength(1);
  });

  it('never opens a socket for a view that has not started streaming', () => {
    const { sockets } = openStream();

    sessionIsBack();

    expect(sockets).toHaveLength(0);
  });

  it('stops listening when the view goes away', () => {
    const { scope, stream, sockets } = openStream();
    stream.connect();
    sockets[0].open();
    sockets[0].endSession();
    const removeEventListener = vi.spyOn(globalThis, 'removeEventListener');

    scope.stop();
    sessionIsBack();

    expect(removeEventListener).toHaveBeenCalledWith('dd:sse-connected', expect.any(Function));
    expect(sockets).toHaveLength(1);
    removeEventListener.mockRestore();
  });
});
