import axios from 'axios';
import { rejectOnceWithHttpStatus } from '../../../test/notification-provider-mocks.js';
import Zulip from './Zulip.js';

vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));

const zulip = new Zulip();

const container = {
  name: 'container1',
  updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
};

const authorization = `Basic ${Buffer.from('bot@zulip.example.com:secret').toString('base64')}`;

function postedParams() {
  return new URLSearchParams(vi.mocked(axios.post).mock.calls[0][1] as string);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(axios.post).mockResolvedValue({ data: { result: 'success', id: 7 } });
  zulip.configuration = zulip.validateConfiguration({
    url: 'https://zulip.example.com/',
    botemail: 'bot@zulip.example.com',
    apikey: 'secret',
    to: 'general',
  });
});

test('validateConfiguration should apply defaults and strip the trailing slash', () => {
  expect(zulip.configuration).toMatchObject({
    url: 'https://zulip.example.com',
    type: 'stream',
    topic: 'Drydock Updates',
    disabletitle: false,
  });
});

test.each([
  ['url', { botemail: 'b', apikey: 'k', to: 't' }],
  ['botemail', { url: 'https://z.example.com', apikey: 'k', to: 't' }],
  ['apikey', { url: 'https://z.example.com', botemail: 'b', to: 't' }],
  ['to', { url: 'https://z.example.com', botemail: 'b', apikey: 'k' }],
])('validateConfiguration should reject a missing %s', (_name, configuration) => {
  expect(() => zulip.validateConfiguration(configuration)).toThrow();
});

test('validateConfiguration should reject an unknown message type', () => {
  expect(() =>
    zulip.validateConfiguration({
      url: 'https://z.example.com',
      botemail: 'b',
      apikey: 'k',
      to: 't',
      type: 'private',
    }),
  ).toThrow();
});

test('maskConfiguration should mask the api key', () => {
  expect(zulip.maskConfiguration()).toMatchObject({
    apikey: '[REDACTED]',
    botemail: 'bot@zulip.example.com',
  });
});

test('trigger should post a bold title and body to the stream topic', async () => {
  const result = await zulip.trigger(container as never);
  expect(result).toEqual({ result: 'success', id: 7 });
  expect(axios.post).toHaveBeenCalledWith(
    'https://zulip.example.com/api/v1/messages',
    expect.any(String),
    {
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: expect.any(Number),
    },
  );
  const params = postedParams();
  expect(params.get('type')).toBe('stream');
  expect(params.get('to')).toBe('general');
  expect(params.get('topic')).toBe('Drydock Updates');
  expect(params.get('content')).toBe(
    '**New tag found for container container1**\n\nContainer container1 running with tag 1.0.0 can be updated to tag 2.0.0',
  );
});

test('trigger should omit the topic for direct messages', async () => {
  zulip.configuration.type = 'direct';
  await zulip.trigger(container as never);
  const params = postedParams();
  expect(params.get('type')).toBe('direct');
  expect(params.has('topic')).toBe(false);
});

test('trigger should send only the body when disabletitle is set', async () => {
  zulip.configuration.disabletitle = true;
  await zulip.trigger(container as never);
  expect(postedParams().get('content')).toBe(
    'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
  );
});

test('triggerBatch should post a batch message', async () => {
  await zulip.triggerBatch([container, { ...container, name: 'container2' }] as never);
  expect(postedParams().get('content')).toContain('**2 updates available**');
});

test('trigger should reject when Zulip returns an error', async () => {
  rejectOnceWithHttpStatus(vi.mocked(axios.post) as never, 'Zulip failed', 400);
  await expect(zulip.trigger(container as never)).rejects.toThrow('Zulip failed');
});
