import axios from 'axios';
import joi from 'joi';
import Bark from './Bark.js';

vi.mock('axios');

const bark = new Bark();
const container = {
  name: 'container1',
  updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
};

function configure(overrides = {}) {
  bark.configuration = bark.validateConfiguration({ devicekey: 'key123', ...overrides });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(axios.post).mockResolvedValue({ data: { code: 200 } });
});

test('validateConfiguration should apply defaults', () => {
  expect(bark.validateConfiguration({ devicekey: ' key123 ' })).toMatchObject({
    url: 'https://api.day.app',
    devicekey: 'key123',
    barkgroup: 'drydock',
    disabletitle: false,
  });
});

test('validateConfiguration should strip a trailing slash from the url', () => {
  expect(bark.validateConfiguration({ devicekey: 'k', url: 'https://bark.example/' }).url).toBe(
    'https://bark.example',
  );
});

test.each([
  {},
  { devicekey: 'k', url: 'ftp://x' },
  { devicekey: 'k', badge: -1 },
  { devicekey: 'k', icon: 'nope' },
])('validateConfiguration should reject %j', (configuration) => {
  expect(() => bark.validateConfiguration(configuration)).toThrowError(joi.ValidationError);
});

test('maskConfiguration should mask the device key', () => {
  configure();
  expect(bark.maskConfiguration()).toMatchObject({ devicekey: '[REDACTED]', barkgroup: 'drydock' });
});

test('trigger should post a minimal payload', async () => {
  configure();
  await expect(bark.trigger(container)).resolves.toEqual({ code: 200 });
  expect(axios.post).toHaveBeenCalledWith(
    'https://api.day.app/push',
    {
      device_key: 'key123',
      body: 'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
      group: 'drydock',
      title: 'New tag found for container container1',
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 30000 },
  );
});

test('trigger should send every optional field and prefer urltoopen over the result link', async () => {
  configure({
    icon: 'https://x.io/i.png',
    sound: 'bell',
    badge: 0,
    urltoopen: 'https://dd.example',
  });
  await bark.trigger({ ...container, result: { link: 'https://registry.example' } });
  expect(vi.mocked(axios.post).mock.calls[0][1]).toMatchObject({
    icon: 'https://x.io/i.png',
    sound: 'bell',
    badge: 0,
    url: 'https://dd.example',
  });
});

test('trigger should fall back to the result link and drop the title when disabled', async () => {
  configure({ disabletitle: true });
  await bark.trigger({ ...container, result: { link: 'https://registry.example' } });
  const payload = vi.mocked(axios.post).mock.calls[0][1] as Record<string, unknown>;
  expect(payload.url).toBe('https://registry.example');
  expect(payload).not.toHaveProperty('title');
});

test('triggerBatch should post the batch title and body', async () => {
  configure();
  await bark.triggerBatch([container, container]);
  expect(vi.mocked(axios.post).mock.calls[0][1]).toMatchObject({
    title: '2 updates available',
  });
});

test('triggerBatch should omit the title when disabled', async () => {
  configure({ disabletitle: true });
  await bark.triggerBatch([container]);
  expect(vi.mocked(axios.post).mock.calls[0][1]).not.toHaveProperty('title');
});

test('trigger should propagate http errors', async () => {
  configure();
  vi.mocked(axios.post).mockRejectedValue(new Error('boom'));
  await expect(bark.trigger(container)).rejects.toThrow('boom');
});
