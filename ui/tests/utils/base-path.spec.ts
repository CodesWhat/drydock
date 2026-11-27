import { buildContainerLogStreamUrl } from '@/services/logs';
import { buildSystemLogStreamUrl } from '@/services/system-log-stream';
import {
  getBasePath,
  installBasePathFetch,
  resetBasePathFetchForTests,
  stripBasePath,
  withBasePath,
} from '@/utils/base-path';

function setBasePathMeta(content: string | undefined) {
  document.head.querySelectorAll('meta[name="dd-base-path"]').forEach((meta) => {
    meta.remove();
  });
  if (content !== undefined) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'dd-base-path');
    meta.setAttribute('content', content);
    document.head.appendChild(meta);
  }
}

describe('base path helpers', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    setBasePathMeta(undefined);
    globalThis.fetch = realFetch;
    resetBasePathFetchForTests();
  });

  test('getBasePath is empty without the meta tag or for the root', () => {
    expect(getBasePath()).toBe('');
    setBasePathMeta('');
    expect(getBasePath()).toBe('');
    setBasePathMeta('/');
    expect(getBasePath()).toBe('');
  });

  test('getBasePath normalizes slashes', () => {
    setBasePathMeta('/drydock/');
    expect(getBasePath()).toBe('/drydock');
    setBasePathMeta('tools/drydock');
    expect(getBasePath()).toBe('/tools/drydock');
  });

  test('withBasePath is a no-op without a base path', () => {
    expect(withBasePath('/api/v1/app')).toBe('/api/v1/app');
  });

  test('withBasePath prefixes root-relative urls only', () => {
    setBasePathMeta('/drydock');
    expect(withBasePath('/api/v1/app')).toBe('/drydock/api/v1/app');
    expect(withBasePath('/login')).toBe('/drydock/login');
    expect(withBasePath('https://example.com/api')).toBe('https://example.com/api');
    expect(withBasePath('//cdn.example.com/x')).toBe('//cdn.example.com/x');
    expect(withBasePath('relative/path')).toBe('relative/path');
  });

  test('withBasePath does not double-prefix', () => {
    setBasePathMeta('/drydock');
    expect(withBasePath('/drydock')).toBe('/drydock');
    expect(withBasePath('/drydock/api')).toBe('/drydock/api');
    expect(withBasePath('/drydock?x=1')).toBe('/drydock?x=1');
    expect(withBasePath('/drydockery/api')).toBe('/drydock/drydockery/api');
  });

  test('stripBasePath removes the prefix only on a segment boundary', () => {
    expect(stripBasePath('/api/v1/app')).toBe('/api/v1/app');
    setBasePathMeta('/drydock');
    expect(stripBasePath('/drydock/api/v1/app')).toBe('/api/v1/app');
    expect(stripBasePath('/drydock')).toBe('/');
    expect(stripBasePath('/drydockery/api')).toBe('/drydockery/api');
    expect(stripBasePath('/api/v1/app')).toBe('/api/v1/app');
  });

  test('installBasePathFetch leaves fetch alone without a base path', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    installBasePathFetch();
    expect(globalThis.fetch).toBe(fetchMock);
  });

  test('installBasePathFetch prefixes string urls and passes Request objects through', async () => {
    setBasePathMeta('/drydock');
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    installBasePathFetch();
    installBasePathFetch();
    await globalThis.fetch('/api/v1/containers', { credentials: 'include' });
    expect(fetchMock).toHaveBeenLastCalledWith('/drydock/api/v1/containers', {
      credentials: 'include',
    });

    const request = new Request('http://localhost/api/v1/app');
    await globalThis.fetch(request);
    expect(fetchMock).toHaveBeenLastCalledWith(request, undefined);
  });
});

describe('base path in realtime URLs', () => {
  const location = { protocol: 'https:', host: 'example.com' } as Location;

  afterEach(() => setBasePathMeta(undefined));

  test('websocket urls include the base path', () => {
    setBasePathMeta('/drydock');
    expect(buildSystemLogStreamUrl({}, location)).toMatch(
      /^wss:\/\/example\.com\/drydock\/api\/v1\/log\/stream\?/,
    );
    expect(buildContainerLogStreamUrl('abc', {}, location)).toMatch(
      /^wss:\/\/example\.com\/drydock\/api\/v1\/containers\/abc\/logs\/stream\?/,
    );
  });

  test('websocket urls are unchanged without a base path', () => {
    expect(buildSystemLogStreamUrl({}, location)).toMatch(
      /^wss:\/\/example\.com\/api\/v1\/log\/stream\?/,
    );
  });
});
