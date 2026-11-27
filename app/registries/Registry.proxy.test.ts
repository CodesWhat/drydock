import axios from 'axios';
import log from '../log/index.js';
import BaseRegistry from './BaseRegistry.js';
import Custom from './providers/custom/Custom.js';
import Ghcr from './providers/ghcr/Ghcr.js';
import Hub from './providers/hub/Hub.js';
import { ConnectProxyAgent } from './proxy.js';

vi.mock('axios');
vi.mock('./http-retry.js', () => ({
  withRetry: vi.fn(async (requestFn) => requestFn()),
}));
vi.mock('./token-bucket.js', () => ({
  acquireToken: vi.fn(() => Promise.resolve()),
  getBucketForUrl: vi.fn(() => ({ key: 'mock-host', ratePerSec: 10, burst: 10 })),
}));

const PROXY_ENV = [
  'DD_HTTP_PROXY',
  'DD_HTTPS_PROXY',
  'DD_NO_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
];

function clearProxyEnv() {
  for (const key of PROXY_ENV) {
    delete process.env[key];
  }
}

const image = {
  name: 'team/app',
  tag: { value: '1.0.0' },
  registry: { name: 'custom', url: 'https://registry.example.com/v2' },
};

describe('registry outbound proxy', () => {
  beforeEach(() => {
    clearProxyEnv();
    vi.mocked(axios).mockReset();
    vi.mocked(axios).mockResolvedValue({ status: 200, headers: {}, data: { tags: [] } } as never);
  });

  afterEach(() => {
    clearProxyEnv();
  });

  async function register(custom: Record<string, unknown>) {
    const registry = new Custom();
    registry.log = log;
    await registry.register('registry', 'custom', 'private', {
      url: 'https://registry.example.com',
      ...custom,
    });
    return registry;
  }

  describe('configuration', () => {
    test('accepts a proxy on any provider and keeps it out of the provider schema', async () => {
      const registry = await register({ proxy: 'http://alice:secret@proxy.local:3128' });
      expect(registry.configuration.proxy).toBe('http://alice:secret@proxy.local:3128');
      expect(registry.configuration.url).toBe('https://registry.example.com');
    });

    test('still validates the rest of the configuration', async () => {
      await expect(register({ proxy: 'http://p:1', login: 'only-login' })).rejects.toThrow();
    });

    test('rejects an invalid proxy without leaking it', async () => {
      const error = await register({ proxy: 'ftp://alice:secret@proxy.local' }).catch((e) => e);
      expect(error.message).toContain('registry custom.private');
      expect(error.message).not.toContain('secret');
    });

    test('accepts a proxy on a provider whose config is otherwise empty', async () => {
      const hub = new Hub();
      hub.log = log;
      await hub.register('registry', 'hub', 'public', { proxy: 'http://proxy.local:3128' });
      expect(hub.configuration.proxy).toBe('http://proxy.local:3128');
    });

    test('leaves configurations without a proxy untouched', async () => {
      const registry = await register({});
      expect('proxy' in registry.configuration).toBe(false);
    });

    test('tolerates a non-object configuration', () => {
      const hub = new Hub();
      hub.log = log;
      expect(hub.validateConfiguration('' as never)).toEqual({});
    });
  });

  describe('masking', () => {
    test('masks proxy credentials in maskConfiguration and the registration log', async () => {
      const infoSpy = vi.spyOn(log, 'child').mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
      } as never);
      const registry = new Custom();
      await registry.register('registry', 'custom', 'private', {
        url: 'https://registry.example.com',
        password: 'pw',
        login: 'robot',
        proxy: 'http://alice:secret@proxy.local:3128',
      });
      const masked = registry.maskConfiguration() as Record<string, string>;
      expect(masked.proxy).not.toContain('secret');
      expect(masked.proxy).not.toContain('alice');
      expect(masked.proxy).toContain('proxy.local:3128');
      expect(masked.password).not.toBe('pw');
      const logged = JSON.stringify((registry.log.info as ReturnType<typeof vi.fn>).mock.calls);
      expect(logged).not.toContain('secret');
      infoSpy.mockRestore();
    });

    test('does not add a proxy key when none is configured', async () => {
      const registry = await register({});
      expect('proxy' in (registry.maskConfiguration() as object)).toBe(false);
    });
  });

  describe('request routing', () => {
    test('callRegistry tunnels through the configured proxy', async () => {
      const registry = await register({ proxy: 'http://alice:secret@proxy.local:3128' });
      await registry.callRegistry({
        image,
        url: 'https://registry.example.com/v2/team/app/tags/list',
      });
      const options = vi.mocked(axios).mock.calls[0][0] as Record<string, unknown>;
      expect(options.proxy).toBe(false);
      expect(options.httpsAgent).toBeInstanceOf(ConnectProxyAgent);
    });

    test('callRegistry honours the global environment proxy and NO_PROXY', async () => {
      process.env.DD_HTTPS_PROXY = 'http://proxy.local:3128';
      const registry = await register({});
      await registry.callRegistry({ image, url: 'https://registry.example.com/v2/x' });
      expect(
        (vi.mocked(axios).mock.calls[0][0] as Record<string, unknown>).httpsAgent,
      ).toBeInstanceOf(ConnectProxyAgent);

      process.env.DD_NO_PROXY = '.example.com';
      await registry.callRegistry({ image, url: 'https://registry.example.com/v2/y' });
      const second = vi.mocked(axios).mock.calls[1][0] as Record<string, unknown>;
      expect(second.proxy).toBe(false);
      expect(second.httpsAgent).not.toBeInstanceOf(ConnectProxyAgent);
    });

    test('callRegistry does not touch axios options without any proxy setting', async () => {
      const registry = await register({});
      await registry.callRegistry({ image, url: 'https://registry.example.com/v2/z' });
      expect('proxy' in (vi.mocked(axios).mock.calls[0][0] as object)).toBe(false);
    });

    test('bearer token exchange goes through the proxy too', async () => {
      const registry = new BaseRegistry();
      registry.log = log;
      registry.configuration = { proxy: 'http://proxy.local:3128' } as never;
      registry.getId = () => 'base.test';
      vi.mocked(axios).mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: { token: 'abc' },
      } as never);
      await registry.authenticateBearerFromAuthUrl(
        { url: 'https://registry.example.com/v2/' },
        'https://registry.example.com/token',
        undefined,
      );
      const tokenRequest = vi.mocked(axios).mock.calls[0][0] as Record<string, unknown>;
      expect(tokenRequest.url).toBe('https://registry.example.com/token');
      expect(tokenRequest.proxy).toBe(false);
      expect(tokenRequest.httpsAgent).toBeInstanceOf(ConnectProxyAgent);
    });

    test('Hub tag metadata lookups go through the proxy', async () => {
      const hub = new Hub();
      hub.log = log;
      await hub.register('registry', 'hub', 'public', { proxy: 'http://proxy.local:3128' });
      vi.mocked(axios).mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: { last_updated: '2024-01-01T00:00:00Z' },
      } as never);
      await (
        hub as unknown as { fetchImagePublishedAt: (i: unknown, t: string) => Promise<unknown> }
      ).fetchImagePublishedAt({ name: 'library/nginx' }, '1.0');
      const request = vi.mocked(axios).mock.calls[0][0] as Record<string, unknown>;
      expect(request.httpsAgent).toBeInstanceOf(ConnectProxyAgent);
    });

    test('GHCR version pages go through the proxy', async () => {
      const ghcr = new Ghcr();
      ghcr.log = log;
      await ghcr.register('registry', 'ghcr', 'public', {
        username: 'u',
        token: 't',
        proxy: 'http://proxy.local:3128',
      });
      vi.mocked(axios).mockResolvedValueOnce({ status: 200, headers: {}, data: [] } as never);
      await (
        ghcr as unknown as {
          fetchVersionsPagedForOwner: (u: string, t: string) => Promise<unknown>;
        }
      ).fetchVersionsPagedForOwner(
        'https://api.github.com/users/o/packages/container/p/versions',
        '1',
      );
      const request = vi.mocked(axios).mock.calls[0][0] as Record<string, unknown>;
      expect(request.httpsAgent).toBeInstanceOf(ConnectProxyAgent);
    });
  });
});
