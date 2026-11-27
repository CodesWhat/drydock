import axios from 'axios';
import joi from 'joi';
import Prowl from './Prowl.js';

vi.mock('axios');

const prowl = new Prowl();
const container = {
  name: 'container1',
  updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
};

function configure(overrides = {}) {
  prowl.configuration = prowl.validateConfiguration({ apikey: 'key123', ...overrides });
}

function lastForm() {
  return new URLSearchParams(vi.mocked(axios.post).mock.calls[0][1] as string);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(axios.post).mockResolvedValue({ data: '<prowl/>' });
});

test('validateConfiguration should apply defaults', () => {
  expect(prowl.validateConfiguration({ apikey: 'key123' })).toMatchObject({
    apikey: 'key123',
    priority: 0,
    application: 'drydock',
    url: 'https://api.prowlapp.com/publicapi/add',
    disabletitle: false,
  });
});

test.each([{}, { apikey: 'k', priority: 3 }, { apikey: 'k', priority: 1.5 }, { apikey: 'k', openurl: 'x' }])(
  'validateConfiguration should reject %j',
  (configuration) => {
    expect(() => prowl.validateConfiguration(configuration)).toThrowError(joi.ValidationError);
  },
);

test('maskConfiguration should mask the api key and provider key', () => {
  configure({ providerkey: 'prov' });
  expect(prowl.maskConfiguration()).toMatchObject({
    apikey: '[REDACTED]',
    providerkey: '[REDACTED]',
  });
});

test('maskConfiguration should leave an unset provider key alone', () => {
  configure();
  expect(prowl.maskConfiguration()).not.toHaveProperty('providerkey');
});

test('trigger should post a form-encoded request', async () => {
  configure({ priority: -1 });
  await expect(prowl.trigger(container)).resolves.toBe('<prowl/>');
  expect(axios.post).toHaveBeenCalledWith('https://api.prowlapp.com/publicapi/add', expect.any(String), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30000,
  });
  const form = lastForm();
  expect(form.get('apikey')).toBe('key123');
  expect(form.get('priority')).toBe('-1');
  expect(form.get('application')).toBe('drydock');
  expect(form.get('event')).toBe('New tag found for container container1');
  expect(form.get('description')).toBe(
    'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
  );
  expect(form.has('url')).toBe(false);
  expect(form.has('providerkey')).toBe(false);
});

test('trigger should send the provider key and prefer openurl over the result link', async () => {
  configure({ providerkey: 'prov', openurl: 'https://dd.example' });
  await prowl.trigger({ ...container, result: { link: 'https://registry.example' } });
  const form = lastForm();
  expect(form.get('providerkey')).toBe('prov');
  expect(form.get('url')).toBe('https://dd.example');
});

test('trigger should fall back to the result link and a fixed event when the title is disabled', async () => {
  configure({ disabletitle: true });
  await prowl.trigger({ ...container, result: { link: 'https://registry.example' } });
  const form = lastForm();
  expect(form.get('url')).toBe('https://registry.example');
  expect(form.get('event')).toBe('Update');
});

test('triggerBatch should post the batch title', async () => {
  configure();
  await prowl.triggerBatch([container, container]);
  expect(lastForm().get('event')).toBe('2 updates available');
});

test('triggerBatch should use a fixed event when the title is disabled', async () => {
  configure({ disabletitle: true });
  await prowl.triggerBatch([container]);
  expect(lastForm().get('event')).toBe('Batch Updates');
});

test('trigger should propagate http errors', async () => {
  configure();
  vi.mocked(axios.post).mockRejectedValue(new Error('boom'));
  await expect(prowl.trigger(container)).rejects.toThrow('boom');
});
