import axios from 'axios';
import {
  buildRebuildContainerContext,
  buildRebuildPayload,
  buildRebuildRequestOptions,
  maskProxyUrl,
  parseProxyConfiguration,
  selectRebuildContainers,
  sendRebuildRequest,
} from './ci-rebuild-shared.js';

vi.mock('axios');

const localBuild = {
  name: 'web',
  image: {
    name: 'acme/web',
    registry: { lookupImage: 'library/nginx' },
    tag: { value: '1.24.0' },
    digest: { value: 'sha256:old' },
  },
  result: { tag: '1.25.0', digest: 'sha256:new' },
  updateKind: { kind: 'tag', baseImage: true, localValue: '1.24.0', remoteValue: '1.25.0' },
} as any;

const regular = {
  name: 'db',
  image: { name: 'postgres', registry: {}, tag: { value: '16' }, digest: {} },
  result: { tag: '17' },
  updateKind: { kind: 'tag' },
} as any;

beforeEach(() => {
  vi.resetAllMocks();
});

describe('buildRebuildContainerContext', () => {
  test('maps a local build with its upstream base', () => {
    expect(buildRebuildContainerContext(localBuild)).toEqual({
      name: 'web',
      image: 'acme/web',
      localTag: '1.24.0',
      baseImage: 'library/nginx',
      currentBaseTag: '1.24.0',
      newBaseTag: '1.25.0',
      currentBaseDigest: 'sha256:old',
      newBaseDigest: 'sha256:new',
      updateKind: { kind: 'tag', baseImage: true, semverDiff: undefined },
    });
  });

  test('falls back to the image and result when there is no lookup image or update kind', () => {
    const context = buildRebuildContainerContext({
      name: 'x',
      image: { name: 'img', registry: {}, tag: { value: 't' }, digest: {} },
      result: { tag: 'n' },
    } as any);
    expect(context.baseImage).toBe('img');
    expect(context.currentBaseTag).toBe('t');
    expect(context.newBaseTag).toBe('n');
    expect(context.updateKind.baseImage).toBe(false);
  });

  test('tolerates a container without image details', () => {
    const context = buildRebuildContainerContext({ name: 'x' } as any);
    expect(context.name).toBe('x');
    expect(context.baseImage).toBeUndefined();
  });
});

describe('selectRebuildContainers / buildRebuildPayload', () => {
  test('keeps only base image updates by default and everything when widened', () => {
    expect(selectRebuildContainers([localBuild, regular], true)).toEqual([localBuild]);
    expect(selectRebuildContainers([localBuild, regular], false)).toEqual([localBuild, regular]);
  });

  test('builds a payload with at most ten top-level fields', () => {
    const payload = buildRebuildPayload([localBuild]);
    expect(payload).toMatchObject({ source: 'drydock', event: 'base-image-update', count: 1 });
    expect(Object.keys(payload).length).toBeLessThanOrEqual(10);
  });
});

describe('proxy handling', () => {
  test('parses host, port, default ports and credentials', () => {
    expect(parseProxyConfiguration('http://u%40x:p%zz@proxy.local:3128', 'l')).toEqual({
      host: 'proxy.local',
      port: 3128,
      protocol: 'http',
      auth: { username: 'u@x', password: 'p%zz' },
    });
    expect(parseProxyConfiguration('https://proxy.local', 'l')).toEqual({
      host: 'proxy.local',
      port: 443,
      protocol: 'https',
    });
    expect(parseProxyConfiguration('http://proxy.local', 'l')?.port).toBe(80);
  });

  test('rejects an unsupported proxy scheme', () => {
    expect(() => parseProxyConfiguration('socks5://proxy.local:1080', 'label')).toThrow(
      'label: proxy URL scheme "socks5:" is unsupported',
    );
  });

  test('masks proxy credentials and fails closed on malformed values', () => {
    expect(maskProxyUrl('http://u:p@proxy.local:3128')).toBe('http://[REDACTED]@proxy.local:3128');
    expect(maskProxyUrl('https://u:p@proxy.local/a?x=1#h')).toBe(
      'https://[REDACTED]@proxy.local/a?x=1#h',
    );
    expect(maskProxyUrl('http://proxy.local:3128')).toBe('http://proxy.local:3128');
    expect(maskProxyUrl('not a url')).toBe('[REDACTED]');
    expect(maskProxyUrl('user:pw@host')).toBe('[REDACTED]');
  });
});

describe('buildRebuildRequestOptions', () => {
  afterEach(() => {
    delete process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
  });

  test('uses the outbound timeout and refuses redirects', () => {
    process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = '1234';
    expect(buildRebuildRequestOptions({}, 'l')).toEqual({
      method: 'POST',
      timeout: 1234,
      maxRedirects: 0,
    });
  });

  test('adds a proxy and an insecure TLS agent when configured', () => {
    const options = buildRebuildRequestOptions(
      { proxy: 'http://proxy.local:3128', insecure: true },
      'l',
    );
    expect(options.proxy?.host).toBe('proxy.local');
    expect((options.httpsAgent as any).options.rejectUnauthorized).toBe(false);
  });
});

describe('sendRebuildRequest', () => {
  test('returns the response body', async () => {
    vi.mocked(axios).mockResolvedValueOnce({ data: { id: 1 } } as never);
    await expect(sendRebuildRequest({ url: 'u' }, 'L')).resolves.toEqual({ id: 1 });
  });

  test('reports an HTTP failure with the API message and no credential', async () => {
    vi.mocked(axios).mockRejectedValueOnce(
      Object.assign(new Error('Request failed'), {
        config: { data: 'token=sekret' },
        response: { status: 404, data: { message: 'Not Found' } },
      }) as never,
    );
    const error = await sendRebuildRequest({ url: 'u' }, 'L').catch((e) => e);
    expect(error.message).toBe('L rebuild request failed: HTTP 404 - Not Found');
    expect(JSON.stringify(error)).not.toContain('sekret');
  });

  test('reports an HTTP failure without a message body', async () => {
    vi.mocked(axios).mockRejectedValueOnce(
      Object.assign(new Error('x'), { response: { status: 500, data: 'oops' } }) as never,
    );
    await expect(sendRebuildRequest({ url: 'u' }, 'L')).rejects.toThrow(
      'L rebuild request failed: HTTP 500',
    );
  });

  test('reports a timeout', async () => {
    vi.mocked(axios).mockRejectedValueOnce(
      Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }) as never,
    );
    await expect(sendRebuildRequest({ url: 'u' }, 'L')).rejects.toThrow(
      'L rebuild request failed: ECONNABORTED - timeout of 30000ms exceeded',
    );
  });

  test('reports an unknown error', async () => {
    vi.mocked(axios).mockRejectedValueOnce({} as never);
    await expect(sendRebuildRequest({ url: 'u' }, 'L')).rejects.toThrow(
      'L rebuild request failed: unknown error',
    );
  });
});
