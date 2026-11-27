import axios from 'axios';
import { rejectOnceWithHttpStatus } from '../../../test/notification-provider-mocks.js';
import Uptimekuma from './Uptimekuma.js';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const uptimekuma = new Uptimekuma();

const container = {
  name: 'container1',
  updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
};

const pushUrl = 'https://kuma.example.com/api/push/abc123';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(axios.get).mockResolvedValue({ data: { ok: true } });
  uptimekuma.configuration = uptimekuma.validateConfiguration({ url: pushUrl });
});

test('validateConfiguration should apply defaults', () => {
  expect(uptimekuma.configuration).toMatchObject({
    url: pushUrl,
    status: 'up',
    disabletitle: false,
  });
});

test('validateConfiguration should reject a missing url', () => {
  expect(() => uptimekuma.validateConfiguration({ status: 'up' })).toThrow();
});

test('validateConfiguration should reject a non-http url', () => {
  expect(() => uptimekuma.validateConfiguration({ url: 'git://kuma' })).toThrow();
});

test('validateConfiguration should reject an unknown status', () => {
  expect(() => uptimekuma.validateConfiguration({ url: pushUrl, status: 'paused' })).toThrow();
});

test('maskConfiguration should mask the push url', () => {
  expect(uptimekuma.maskConfiguration()).toMatchObject({ url: '[REDACTED]', status: 'up' });
});

test('trigger should call the push url with title and body', async () => {
  const result = await uptimekuma.trigger(container as never);
  expect(result).toEqual({ ok: true });
  expect(axios.get).toHaveBeenCalledWith(pushUrl, {
    params: {
      status: 'up',
      msg: 'New tag found for container container1: Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
    },
    timeout: expect.any(Number),
  });
});

test('trigger should send only the body when disabletitle is set', async () => {
  uptimekuma.configuration.disabletitle = true;
  await uptimekuma.trigger(container as never);
  const options = vi.mocked(axios.get).mock.calls[0][1] as any;
  expect(options.params.msg).toBe(
    'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
  );
});

test('trigger should prefer the configured message and status', async () => {
  uptimekuma.configuration.msg = 'Updates pending';
  uptimekuma.configuration.status = 'down';
  await uptimekuma.trigger(container as never);
  const options = vi.mocked(axios.get).mock.calls[0][1] as any;
  expect(options.params).toEqual({ status: 'down', msg: 'Updates pending' });
});

test('trigger should cap the message at 200 characters', async () => {
  uptimekuma.configuration.msg = 'x'.repeat(250);
  await uptimekuma.trigger(container as never);
  const options = vi.mocked(axios.get).mock.calls[0][1] as any;
  expect(options.params.msg).toHaveLength(200);
});

test('triggerBatch should call the push url with the batch message', async () => {
  await uptimekuma.triggerBatch([container, { ...container, name: 'container2' }] as never);
  const options = vi.mocked(axios.get).mock.calls[0][1] as any;
  expect(options.params.msg).toContain('2 updates available: ');
});

test('triggerBatch should prefer the configured message', async () => {
  uptimekuma.configuration.msg = 'Updates pending';
  await uptimekuma.triggerBatch([container] as never);
  const options = vi.mocked(axios.get).mock.calls[0][1] as any;
  expect(options.params.msg).toBe('Updates pending');
});

test('trigger should reject when Uptime Kuma returns an error', async () => {
  rejectOnceWithHttpStatus(vi.mocked(axios.get) as never, 'Kuma failed', 404);
  await expect(uptimekuma.trigger(container as never)).rejects.toThrow('Kuma failed');
});
