import axios from 'axios';
import { rejectOnceWithHttpStatus } from '../../../test/notification-provider-mocks.js';
import Signal from './Signal.js';

vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));

const signal = new Signal();

const container = {
  name: 'container1',
  updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(axios.post).mockResolvedValue({ data: { timestamp: 123 } });
  signal.configuration = signal.validateConfiguration({
    url: 'http://signal-cli:8080/',
    number: '+1234567890',
    recipients: '+1987654321, +1122334455,',
  });
});

test('validateConfiguration should strip the trailing slash and apply defaults', () => {
  expect(signal.configuration).toMatchObject({
    url: 'http://signal-cli:8080',
    disabletitle: false,
  });
});

test.each([
  ['url', { number: '+1', recipients: '+2' }],
  ['number', { url: 'http://signal-cli:8080', recipients: '+2' }],
  ['recipients', { url: 'http://signal-cli:8080', number: '+1' }],
])('validateConfiguration should reject a missing %s', (_name, configuration) => {
  expect(() => signal.validateConfiguration(configuration)).toThrow();
});

test('validateConfiguration should reject a non-http url', () => {
  expect(() =>
    signal.validateConfiguration({ url: 'git://x', number: '+1', recipients: '+2' }),
  ).toThrow();
});

test('maskConfiguration should mask number, recipients and api key', () => {
  signal.configuration.apikey = 'secret';
  expect(signal.maskConfiguration()).toMatchObject({
    number: '[REDACTED]',
    recipients: '[REDACTED]',
    apikey: '[REDACTED]',
    url: 'http://signal-cli:8080',
  });
});

test('maskConfiguration should leave an unset api key out', () => {
  expect(signal.maskConfiguration().apikey).toBeUndefined();
});

test('trigger should post title and body to every recipient', async () => {
  const result = await signal.trigger(container as never);
  expect(result).toEqual({ timestamp: 123 });
  expect(axios.post).toHaveBeenCalledWith(
    'http://signal-cli:8080/v2/send',
    {
      message:
        'New tag found for container container1\n\nContainer container1 running with tag 1.0.0 can be updated to tag 2.0.0',
      number: '+1234567890',
      recipients: ['+1987654321', '+1122334455'],
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: expect.any(Number) },
  );
});

test('trigger should send a bearer header when an api key is set', async () => {
  signal.configuration.apikey = 'secret';
  await signal.trigger(container as never);
  const options = vi.mocked(axios.post).mock.calls[0][2] as any;
  expect(options.headers.Authorization).toBe('Bearer secret');
});

test('trigger should send only the body when disabletitle is set', async () => {
  signal.configuration.disabletitle = true;
  await signal.trigger(container as never);
  const payload = vi.mocked(axios.post).mock.calls[0][1] as any;
  expect(payload.message).toBe(
    'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
  );
});

test('triggerBatch should post a batch message', async () => {
  await signal.triggerBatch([container, { ...container, name: 'container2' }] as never);
  const payload = vi.mocked(axios.post).mock.calls[0][1] as any;
  expect(payload.message).toContain('2 updates available');
});

test('trigger should reject when signal-cli-rest-api returns an error', async () => {
  rejectOnceWithHttpStatus(vi.mocked(axios.post) as never, 'Signal failed', 400);
  await expect(signal.trigger(container as never)).rejects.toThrow('Signal failed');
});
