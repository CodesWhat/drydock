import axios from 'axios';
import joi from 'joi';
import Githubdispatch from './Githubdispatch.js';

vi.mock('axios');

const configurationValid = {
  repository: 'acme/app',
  token: 'ghp_sekret',
  eventtype: 'drydock-base-image-update',
  url: 'https://api.github.com',
  baseimageonly: true,
  insecure: false,
  threshold: 'all',
  mode: 'simple',
  once: true,
  auto: 'all',
  order: 100,
  simpletitle:
    '${isDigestUpdate ? "New image available for container " + container.name + " (tag " + currentTag + ")" : "New " + container.updateKind.kind + " found for container " + container.name}',
  simplebody: 'x',
  batchtitle: '${containers.length} updates available',
  resolvenotifications: false,
  securitymode: 'simple',
  digestcron: '0 8 * * *',
};

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

let trigger: Githubdispatch;

beforeEach(() => {
  vi.resetAllMocks();
  trigger = new Githubdispatch();
  trigger.configuration = { ...configurationValid } as any;
  vi.mocked(axios).mockResolvedValue({ data: '' } as never);
});

test('validateConfiguration accepts a valid configuration and applies defaults', () => {
  const validated = trigger.validateConfiguration({
    repository: 'acme/app',
    token: 't',
  }) as any;
  expect(validated.eventtype).toBe('drydock-base-image-update');
  expect(validated.url).toBe('https://api.github.com');
  expect(validated.baseimageonly).toBe(true);
  expect(validated.insecure).toBe(false);
});

test.each([
  { repository: 'acme', token: 't' },
  { repository: 'acme/app' },
  { repository: 'acme/app', token: 't', url: 'git://x' },
])('validateConfiguration rejects %j', (configuration) => {
  expect(() => trigger.validateConfiguration(configuration)).toThrowError(joi.ValidationError);
});

test('maskConfiguration masks the token and proxy credentials', () => {
  trigger.configuration = {
    ...configurationValid,
    proxy: 'http://user:proxypw@proxy.local:3128',
  } as any;
  const masked = trigger.maskConfiguration();
  expect(masked.token).toBe('[REDACTED]');
  expect(masked.proxy).toBe('http://[REDACTED]@proxy.local:3128');
  expect(JSON.stringify(masked)).not.toContain('ghp_sekret');
  expect(JSON.stringify(masked)).not.toContain('proxypw');
});

test('maskConfiguration leaves an absent proxy alone', () => {
  expect(trigger.maskConfiguration().proxy).toBeUndefined();
});

test('trigger posts a repository_dispatch for a base image update', async () => {
  await trigger.trigger(localBuild);
  expect(axios).toHaveBeenCalledTimes(1);
  const options = vi.mocked(axios).mock.calls[0][0] as any;
  expect(options.method).toBe('POST');
  expect(options.url).toBe('https://api.github.com/repos/acme/app/dispatches');
  expect(options.headers).toEqual({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'drydock',
    Authorization: 'Bearer ghp_sekret',
  });
  expect(options.maxRedirects).toBe(0);
  expect(options.timeout).toBeGreaterThan(0);
  expect(options.data).toEqual({
    event_type: 'drydock-base-image-update',
    client_payload: {
      source: 'drydock',
      event: 'base-image-update',
      count: 1,
      containers: [
        {
          name: 'web',
          image: 'acme/web',
          localTag: '1.24.0',
          baseImage: 'library/nginx',
          currentBaseTag: '1.24.0',
          newBaseTag: '1.25.0',
          currentBaseDigest: 'sha256:old',
          newBaseDigest: 'sha256:new',
          updateKind: { kind: 'tag', baseImage: true },
        },
      ],
    },
  });
});

test('trigger honours a GHES api url with a trailing slash, custom event and proxy', async () => {
  trigger.configuration = {
    ...configurationValid,
    url: 'https://ghe.example.com/api/v3/',
    eventtype: 'rebuild',
    proxy: 'http://proxy.local:3128',
  } as any;
  await trigger.trigger(localBuild);
  const options = vi.mocked(axios).mock.calls[0][0] as any;
  expect(options.url).toBe('https://ghe.example.com/api/v3/repos/acme/app/dispatches');
  expect(options.data.event_type).toBe('rebuild');
  expect(options.proxy).toMatchObject({ host: 'proxy.local', port: 3128 });
});

test('trigger skips a regular update by default', async () => {
  await expect(trigger.trigger(regular)).resolves.toBeUndefined();
  expect(axios).not.toHaveBeenCalled();
});

test('baseimageonly=false widens the trigger to any update', async () => {
  trigger.configuration = { ...configurationValid, baseimageonly: false } as any;
  await trigger.trigger(regular);
  expect(axios).toHaveBeenCalledTimes(1);
});

test('baseimageonly falls back to true when unset', async () => {
  const { baseimageonly, ...rest } = configurationValid;
  trigger.configuration = rest as any;
  await trigger.trigger(regular);
  expect(axios).not.toHaveBeenCalled();
});

test('triggerBatch sends one dispatch with only the base image updates', async () => {
  await trigger.triggerBatch([localBuild, regular]);
  expect(axios).toHaveBeenCalledTimes(1);
  const payload = (vi.mocked(axios).mock.calls[0][0] as any).data.client_payload;
  expect(payload.count).toBe(1);
  expect(payload.containers.map((c) => c.name)).toEqual(['web']);
});

test('triggerBatch sends nothing when no container qualifies', async () => {
  await trigger.triggerBatch([regular]);
  expect(axios).not.toHaveBeenCalled();
});

test('triggerBatch ignores security alert digests', async () => {
  await trigger.triggerBatch([localBuild], { eventKind: 'security-alert-digest' });
  expect(axios).not.toHaveBeenCalled();
});

test('a failing dispatch is reported without the token', async () => {
  vi.mocked(axios).mockRejectedValueOnce(
    Object.assign(new Error('Request failed'), {
      config: { headers: { Authorization: 'Bearer ghp_sekret' } },
      response: { status: 404, data: { message: 'Not Found' } },
    }) as never,
  );
  const error = await trigger.trigger(localBuild).catch((e) => e);
  expect(error.message).toContain('HTTP 404 - Not Found');
  expect(JSON.stringify(error)).not.toContain('ghp_sekret');
});

test('a timeout is reported', async () => {
  vi.mocked(axios).mockRejectedValueOnce(
    Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }) as never,
  );
  await expect(trigger.trigger(localBuild)).rejects.toThrow('timeout of 30000ms exceeded');
});

test('a missing token fails closed before any request', async () => {
  trigger.configuration = { ...configurationValid, token: undefined } as any;
  await expect(trigger.trigger(localBuild)).rejects.toThrow('token is missing');
  expect(axios).not.toHaveBeenCalled();
});

test('is a notification trigger, so a local build is never replaced', () => {
  expect(trigger.getCategory()).toBe('notification');
});
