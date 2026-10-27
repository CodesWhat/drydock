/**
 * FakeWebSocket — stands in for the log stream sockets (`/api/v1/log/stream`,
 * `/api/v1/containers/:id/logs/stream`). MSW can't intercept WebSocket
 * upgrades in the page, so without this the browser hits the static host and
 * reports a failed handshake. The fake opens, replays the tail from the seed
 * data and stays open.
 */

import { containerLogLines, logEntries } from './data/logs';

const API_SOCKET_PATH = '/api/v1/';

export function isDemoSocketUrl(url: string | URL): boolean {
  try {
    return new URL(String(url), 'http://localhost').pathname.startsWith(API_SOCKET_PATH);
  } catch {
    return false;
  }
}

function displayTime(iso: string): string {
  return iso.slice(11, 19);
}

function readTail(url: URL): number {
  const tail = Number(url.searchParams.get('tail'));
  return Number.isFinite(tail) && tail > 0 ? tail : 100;
}

export function buildSystemLogFrames(url: URL): string[] {
  const level = url.searchParams.get('level');
  const component = url.searchParams.get('component');
  return logEntries
    .filter((entry) => !level || level === 'all' || entry.level === level)
    .filter((entry) => !component || entry.component === component)
    .slice(-readTail(url))
    .map((entry) =>
      JSON.stringify({
        timestamp: Date.parse(entry.timestamp),
        displayTimestamp: displayTime(entry.timestamp),
        level: entry.level,
        component: entry.component,
        msg: entry.message,
      }),
    );
}

export function buildContainerLogFrames(url: URL): string[] {
  const now = Date.now();
  return containerLogLines.slice(-readTail(url)).map((line, index, lines) => {
    const ts = new Date(now - (lines.length - index) * 1000).toISOString();
    return JSON.stringify({ type: 'stdout', ts, displayTs: displayTime(ts), line });
  });
}

function framesFor(rawUrl: string): string[] {
  const url = new URL(rawUrl, 'http://localhost');
  if (url.pathname === '/api/v1/log/stream') return buildSystemLogFrames(url);
  if (/^\/api\/v1\/containers\/[^/]+\/logs\/stream$/.test(url.pathname)) {
    return buildContainerLogFrames(url);
  }
  return [];
}

export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = FakeWebSocket.CONNECTING;
  url: string;
  protocol = '';
  extensions = '';
  binaryType = 'blob';
  bufferedAmount = 0;

  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  constructor(url: string | URL, _protocols?: string | string[]) {
    this.url = String(url);
    setTimeout(() => {
      if (this.readyState !== FakeWebSocket.CONNECTING) return;
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.(new Event('open'));
      for (const data of framesFor(this.url)) {
        if (this.readyState !== FakeWebSocket.OPEN) return;
        this.onmessage?.(new MessageEvent('message', { data }));
      }
    }, 0);
  }

  send(_data: unknown): void {}

  addEventListener(): void {}

  removeEventListener(): void {}

  close(code = 1000, reason = ''): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    setTimeout(() => {
      this.onclose?.(new CloseEvent('close', { code, reason, wasClean: true }));
    }, 0);
  }
}

export function installFakeWebSocket(): void {
  const NativeWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args: [string | URL, (string | string[])?]) {
      if (isDemoSocketUrl(args[0])) {
        return new FakeWebSocket(args[0], args[1]) as unknown as WebSocket;
      }
      return Reflect.construct(target, args) as WebSocket;
    },
  });
}
