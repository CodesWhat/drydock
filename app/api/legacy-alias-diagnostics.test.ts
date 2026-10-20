import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockLogInfo } = vi.hoisted(() => ({ mockLogInfo: vi.fn() }));

vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: mockLogInfo, warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

import {
  buildLegacyApiAliasKey,
  classifyLegacyApiClient,
  getLegacyApiAliasResourceKey,
  LEGACY_API_ALIAS_CLIENTS,
  LEGACY_API_ALIAS_RESOURCES,
  logLegacyApiAliasHit,
  resetLegacyApiAliasLogState,
} from './legacy-alias-diagnostics.js';

describe('getLegacyApiAliasResourceKey', () => {
  test.each([
    ['/containers', '/api/containers/*'],
    ['/containers/abc123/stats', '/api/containers/*'],
    ['/Containers/ABC', '/api/containers/*'],
    ['/containers?x=1', '/api/containers/*'],
    ['/containers#frag', '/api/containers/*'],
    ['/app', '/api/app/*'],
    ['/events/ui', '/api/events/*'],
    ['/update-operations/op-1', '/api/update-operations/*'],
    ['/api-keys', '/api/api-keys/*'],
    ['/', '/api'],
    ['', '/api'],
    ['/bogus', 'unmatched'],
    ['/bogus/containers', 'unmatched'],
    ['/containers%2Fx', 'unmatched'],
    ['//containers', 'unmatched'],
    ['containers', 'unmatched'],
  ])('%s -> %s', (path, expected) => {
    expect(getLegacyApiAliasResourceKey(path)).toBe(expected);
  });

  test('never leaks ids, query strings or credentials', () => {
    const key = getLegacyApiAliasResourceKey('/containers/deadbeef1234?apikey=secret&token=x');
    expect(key).toBe('/api/containers/*');
    expect(key).not.toMatch(/deadbeef|secret|token|\?/);
  });

  test('every allowlist entry is a lowercase single segment', () => {
    LEGACY_API_ALIAS_RESOURCES.forEach((resource) => {
      expect(resource).toMatch(/^[a-z0-9.-]+$/);
    });
  });
});

describe('classifyLegacyApiClient', () => {
  test.each([
    [undefined, 'none'],
    ['', 'none'],
    ['Homepage/1.2 (gethomepage)', 'homepage'],
    ['HomeAssistant/2024.5 aiohttp/3', 'home-assistant'],
    ['Home Assistant', 'home-assistant'],
    ['curl/8.4.0', 'curl'],
    ['Wget/1.21', 'wget'],
    ['python-requests/2.31', 'python'],
    ['Python-urllib/3.11', 'python'],
    ['aiohttp/3.9', 'python'],
    ['Go-http-client/2.0', 'go-http'],
    ['node', 'node'],
    ['axios/1.6', 'node'],
    ['undici', 'node'],
    ['Mozilla/5.0 (X11) Chrome/120', 'browser'],
    ['SomethingElse/1', 'other'],
  ])('%s -> %s', (ua, expected) => {
    expect(classifyLegacyApiClient(ua)).toBe(expected);
  });

  test('handles an array-valued header by using the first value', () => {
    expect(classifyLegacyApiClient(['curl/8', 'x'] as unknown as string)).toBe('curl');
  });

  test('only returns members of the fixed client set', () => {
    expect(LEGACY_API_ALIAS_CLIENTS).toContain(classifyLegacyApiClient('whatever'));
  });
});

describe('buildLegacyApiAliasKey', () => {
  test('uses the matched route pattern when a route matched', () => {
    const req = { baseUrl: '/api/containers', route: { path: '/:id/stats' }, headers: {} };
    expect(buildLegacyApiAliasKey(req as never)).toBe('/api/containers/:id/stats via none');
  });

  test('combines the resource key and client for unmatched hits', () => {
    const req = { path: '/containers/abc', headers: { 'user-agent': 'curl/8' } };
    expect(buildLegacyApiAliasKey(req as never)).toBe('/api/containers/* via curl');
  });

  test('keeps unmatched for non-allowlisted resources', () => {
    const req = { path: '/zzz', headers: {} };
    expect(buildLegacyApiAliasKey(req as never)).toBe('unmatched via none');
  });
});

describe('logLegacyApiAliasHit', () => {
  beforeEach(() => {
    mockLogInfo.mockClear();
    resetLegacyApiAliasLogState();
  });

  const makeReq = (overrides = {}) => ({
    method: 'GET',
    originalUrl: '/api/containers/abc123?apikey=secret',
    path: '/containers/abc123',
    ip: '10.0.0.5',
    headers: { 'user-agent': 'Homepage/1.0' },
    ...overrides,
  });

  test('logs method, path without query, client, user agent and address', () => {
    logLegacyApiAliasHit(makeReq() as never, 1000);
    expect(mockLogInfo).toHaveBeenCalledTimes(1);
    const line = mockLogInfo.mock.calls[0][0] as string;
    expect(line).toContain('GET');
    expect(line).toContain('/api/containers/abc123');
    expect(line).not.toContain('secret');
    expect(line).not.toContain('?');
    expect(line).toContain('homepage');
    expect(line).toContain('Homepage/1.0');
    expect(line).toContain('10.0.0.5');
    expect(line).toContain('/api/containers/*');
  });

  test('rate-limits to one line per resource key and client per hour', () => {
    logLegacyApiAliasHit(makeReq() as never, 0);
    logLegacyApiAliasHit(makeReq({ originalUrl: '/api/containers/zzz' }) as never, 59 * 60 * 1000);
    expect(mockLogInfo).toHaveBeenCalledTimes(1);
    logLegacyApiAliasHit(makeReq() as never, 60 * 60 * 1000);
    expect(mockLogInfo).toHaveBeenCalledTimes(2);
  });

  test('a different client or resource logs separately', () => {
    logLegacyApiAliasHit(makeReq() as never, 0);
    logLegacyApiAliasHit(makeReq({ headers: { 'user-agent': 'curl/8' } }) as never, 1);
    logLegacyApiAliasHit(makeReq({ path: '/app', originalUrl: '/api/app' }) as never, 2);
    expect(mockLogInfo).toHaveBeenCalledTimes(3);
  });

  test('truncates path to 200 chars and user agent to 120 chars, strips control characters', () => {
    const longPath = `/api/containers/${'a'.repeat(500)}`;
    const longUa = `curl/${'b'.repeat(500)}\nforged line`;
    logLegacyApiAliasHit(
      makeReq({ originalUrl: longPath, headers: { 'user-agent': longUa } }) as never,
      0,
    );
    const line = mockLogInfo.mock.calls[0][0] as string;
    expect(line).not.toContain('a'.repeat(201));
    expect(line).not.toContain('b'.repeat(121));
    expect(line).not.toContain('\n');
  });

  test('falls back when originalUrl, ip and user agent are missing', () => {
    logLegacyApiAliasHit({ method: 'POST', path: '/zzz', headers: {} } as never, 0);
    const line = mockLogInfo.mock.calls[0][0] as string;
    expect(line).toContain('POST');
    expect(line).toContain('/zzz');
    expect(line).toContain('none');
    expect(line).toContain('unknown');
  });

  test('prunes expired entries so the map stays bounded', () => {
    for (let i = 0; i < LEGACY_API_ALIAS_RESOURCES.length; i += 1) {
      logLegacyApiAliasHit(
        makeReq({ path: `/${LEGACY_API_ALIAS_RESOURCES[i]}`, originalUrl: '/x' }) as never,
        0,
      );
    }
    logLegacyApiAliasHit(makeReq() as never, 2 * 60 * 60 * 1000);
    expect(mockLogInfo.mock.calls.length).toBe(LEGACY_API_ALIAS_RESOURCES.length + 1);
  });
});
