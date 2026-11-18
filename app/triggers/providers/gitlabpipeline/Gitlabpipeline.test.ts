import axios from 'axios';
import joi from 'joi';
import Gitlabpipeline from './Gitlabpipeline.js';

vi.mock('axios');

const configurationValid = {
  project: 'group/app',
  token: 'glptt-sekret',
  ref: 'main',
  url: 'https://gitlab.com',
  baseimageonly: true,
  insecure: false,
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

const otherBuild = {
  ...localBuild,
  name: 'api',
  image: { ...localBuild.image, name: 'acme/api' },
} as any;

const regular = {
  name: 'db',
  image: { name: 'postgres', registry: {}, tag: { value: '16' }, digest: {} },
  result: { tag: '17' },
  updateKind: { kind: 'tag' },
} as any;

let trigger: Gitlabpipeline;

const sentForm = () => {
  const options = vi.mocked(axios).mock.calls[0][0] as any;
  return { options, form: new URLSearchParams(options.data) };
};

beforeEach(() => {
  vi.resetAllMocks();
  trigger = new Gitlabpipeline();
  trigger.configuration = { ...configurationValid } as any;
  vi.mocked(axios).mockResolvedValue({ data: { id: 7 } } as never);
});

test('validateConfiguration applies defaults', () => {
  const validated = trigger.validateConfiguration({ project: '42', token: 't' }) as any;
  expect(validated.ref).toBe('main');
  expect(validated.url).toBe('https://gitlab.com');
  expect(validated.baseimageonly).toBe(true);
});

test.each([
  { token: 't' },
  { project: '42' },
  { project: '42', token: 't', url: 'git://x' },
  { project: '42', token: 't', variables: { 'bad name': 'x' } },
])('validateConfiguration rejects %j', (configuration) => {
  expect(() => trigger.validateConfiguration(configuration)).toThrowError(joi.ValidationError);
});

test('maskConfiguration masks the token, variables and proxy credentials', () => {
  trigger.configuration = {
    ...configurationValid,
    variables: { DEPLOY_KEY: 'sekret-variable', EMPTY: '' },
    proxy: 'http://user:proxypw@proxy.local:3128',
  } as any;
  const masked = trigger.maskConfiguration();
  expect(masked.token).toBe('[REDACTED]');
  expect(masked.variables).toEqual({ DEPLOY_KEY: '[REDACTED]', EMPTY: '' });
  expect(masked.proxy).toBe('http://[REDACTED]@proxy.local:3128');
  const serialized = JSON.stringify(masked);
  for (const leaked of ['glptt-sekret', 'sekret-variable', 'proxypw']) {
    expect(serialized).not.toContain(leaked);
  }
});

test('maskConfiguration works with no variables or proxy', () => {
  const masked = trigger.maskConfiguration();
  expect(masked.variables).toBeUndefined();
  expect(masked.proxy).toBeUndefined();
});

test('trigger posts the pipeline request for a single base image update', async () => {
  await expect(trigger.trigger(localBuild)).resolves.toEqual({ id: 7 });
  const { options, form } = sentForm();
  expect(options.method).toBe('POST');
  expect(options.url).toBe('https://gitlab.com/api/v4/projects/group%2Fapp/trigger/pipeline');
  expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  expect(options.maxRedirects).toBe(0);
  expect(options.timeout).toBeGreaterThan(0);
  expect(form.get('token')).toBe('glptt-sekret');
  expect(form.get('ref')).toBe('main');
  expect(form.get('variables[DD_EVENT]')).toBe('base-image-update');
  expect(form.get('variables[DD_CONTAINER_COUNT]')).toBe('1');
  expect(form.get('variables[DD_CONTAINER_NAMES]')).toBe('web');
  expect(form.get('variables[DD_CONTAINER_NAME]')).toBe('web');
  expect(form.get('variables[DD_IMAGE]')).toBe('acme/web');
  expect(form.get('variables[DD_LOCAL_TAG]')).toBe('1.24.0');
  expect(form.get('variables[DD_BASE_IMAGE]')).toBe('library/nginx');
  expect(form.get('variables[DD_CURRENT_BASE_TAG]')).toBe('1.24.0');
  expect(form.get('variables[DD_NEW_BASE_TAG]')).toBe('1.25.0');
  expect(form.get('variables[DD_CURRENT_BASE_DIGEST]')).toBe('sha256:old');
  expect(form.get('variables[DD_NEW_BASE_DIGEST]')).toBe('sha256:new');
  const payload = JSON.parse(form.get('variables[DD_PAYLOAD]') as string);
  expect(payload).toMatchObject({ source: 'drydock', count: 1 });
  expect(payload.containers[0].name).toBe('web');
});

test('trigger uses a numeric project id, custom ref, self-hosted url, variables and proxy', async () => {
  trigger.configuration = {
    ...configurationValid,
    project: '42',
    ref: 'release',
    url: 'https://git.internal/gitlab/',
    variables: { rebuild_reason: 'base' },
    proxy: 'http://proxy.local:3128',
  } as any;
  await trigger.trigger(localBuild);
  const { options, form } = sentForm();
  expect(options.url).toBe('https://git.internal/gitlab/api/v4/projects/42/trigger/pipeline');
  expect(options.proxy).toMatchObject({ host: 'proxy.local', port: 3128 });
  expect(form.get('ref')).toBe('release');
  expect(form.get('variables[REBUILD_REASON]')).toBe('base');
});

test('trigger omits per-container variables whose value is unknown', async () => {
  await trigger.trigger({
    ...localBuild,
    result: { tag: '1.25.0' },
    image: { ...localBuild.image, digest: {} },
  });
  const { form } = sentForm();
  expect(form.has('variables[DD_NEW_BASE_DIGEST]')).toBe(false);
  expect(form.has('variables[DD_CURRENT_BASE_DIGEST]')).toBe(false);
});

test('trigger skips a regular update by default and sends it when widened', async () => {
  await expect(trigger.trigger(regular)).resolves.toBeUndefined();
  expect(axios).not.toHaveBeenCalled();
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

test('triggerBatch sends one pipeline with the aggregate variables only', async () => {
  await trigger.triggerBatch([localBuild, otherBuild, regular]);
  expect(axios).toHaveBeenCalledTimes(1);
  const { form } = sentForm();
  expect(form.get('variables[DD_CONTAINER_COUNT]')).toBe('2');
  expect(form.get('variables[DD_CONTAINER_NAMES]')).toBe('web,api');
  expect(form.has('variables[DD_CONTAINER_NAME]')).toBe(false);
  expect(JSON.parse(form.get('variables[DD_PAYLOAD]') as string).count).toBe(2);
});

test('triggerBatch sends nothing when no container qualifies or for security digests', async () => {
  await trigger.triggerBatch([regular]);
  await trigger.triggerBatch([localBuild], { eventKind: 'security-alert-digest' });
  expect(axios).not.toHaveBeenCalled();
});

test('a failing pipeline request is reported without the trigger token', async () => {
  vi.mocked(axios).mockRejectedValueOnce(
    Object.assign(new Error('Request failed'), {
      config: { data: 'token=glptt-sekret' },
      response: { status: 401, data: { message: '401 Unauthorized' } },
    }) as never,
  );
  const error = await trigger.trigger(localBuild).catch((e) => e);
  expect(error.message).toContain('HTTP 401 - 401 Unauthorized');
  expect(JSON.stringify(error)).not.toContain('glptt-sekret');
});

test('a timeout is reported', async () => {
  vi.mocked(axios).mockRejectedValueOnce(
    Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }) as never,
  );
  await expect(trigger.trigger(localBuild)).rejects.toThrow('timeout of 30000ms exceeded');
});

test('is a notification trigger, so a local build is never replaced', () => {
  expect(trigger.getCategory()).toBe('notification');
});
