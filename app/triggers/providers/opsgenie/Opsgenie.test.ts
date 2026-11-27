import axios from 'axios';
import { rejectOnceWithHttpStatus } from '../../../test/notification-provider-mocks.js';
import Opsgenie from './Opsgenie.js';

vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));

const opsgenie = new Opsgenie();

const container = {
  name: 'frontend',
  watcher: 'local',
  updateKind: { kind: 'tag', localValue: '1.0', remoteValue: '1.1' },
};

const headers = {
  Authorization: 'GenieKey eb48f654-key',
  'Content-Type': 'application/json',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(axios.post).mockResolvedValue({ data: { result: 'Request will be processed' } });
  opsgenie.configuration = opsgenie.validateConfiguration({ apikey: 'eb48f654-key' });
});

test('validateConfiguration should apply defaults', () => {
  expect(opsgenie.validateConfiguration({ apikey: 'key' })).toMatchObject({
    region: 'us',
    priority: 'P5',
    tags: 'drydock,docker',
    disabletitle: false,
  });
});

test('validateConfiguration should reject a missing api key', () => {
  expect(() => opsgenie.validateConfiguration({ region: 'us' })).toThrow();
});

test('validateConfiguration should reject an unknown region', () => {
  expect(() => opsgenie.validateConfiguration({ apikey: 'key', region: 'apac' })).toThrow();
});

test('validateConfiguration should reject an unknown priority', () => {
  expect(() => opsgenie.validateConfiguration({ apikey: 'key', priority: 'P9' })).toThrow();
});

test('maskConfiguration should mask the api key', () => {
  expect(opsgenie.maskConfiguration()).toMatchObject({ apikey: '[REDACTED]', region: 'us' });
});

test('trigger should create an alert on the US endpoint with container details', async () => {
  opsgenie.configuration.tags = 'docker, prod,, ';
  opsgenie.configuration.priority = 'P4';
  const result = await opsgenie.trigger(container as never);
  expect(result).toEqual({ result: 'Request will be processed' });
  expect(axios.post).toHaveBeenCalledWith(
    'https://api.opsgenie.com/v2/alerts',
    {
      message: 'New tag found for container frontend',
      description: expect.stringContaining('frontend'),
      priority: 'P4',
      source: 'drydock',
      tags: ['docker', 'prod'],
      details: {
        containerName: 'frontend',
        watcher: 'local',
        localTag: '1.0',
        remoteTag: '1.1',
      },
    },
    { headers, timeout: expect.any(Number) },
  );
});

test('trigger should send empty tags when the container has no update kind', async () => {
  await opsgenie.trigger({ name: 'bare' } as never);
  const payload = vi.mocked(axios.post).mock.calls[0][1] as any;
  expect(payload.details).toMatchObject({ localTag: '', remoteTag: '' });
});

test('trigger should use a fixed message when disabletitle is set', async () => {
  opsgenie.configuration.disabletitle = true;
  await opsgenie.trigger(container as never);
  const payload = vi.mocked(axios.post).mock.calls[0][1] as any;
  expect(payload.message).toBe('Container update');
});

test('triggerBatch should use the EU endpoint and omit container details', async () => {
  opsgenie.configuration.region = 'eu';
  await opsgenie.triggerBatch([container, { ...container, name: 'api' }] as never);
  expect(axios.post).toHaveBeenCalledWith(
    'https://api.eu.opsgenie.com/v2/alerts',
    {
      message: '2 updates available',
      description: expect.any(String),
      priority: 'P5',
      source: 'drydock',
      tags: ['drydock', 'docker'],
    },
    { headers, timeout: expect.any(Number) },
  );
});

test('triggerBatch should use a fixed message when disabletitle is set', async () => {
  opsgenie.configuration.disabletitle = true;
  await opsgenie.triggerBatch([container] as never);
  const payload = vi.mocked(axios.post).mock.calls[0][1] as any;
  expect(payload.message).toBe('Container updates available');
});

test('trigger should reject when Opsgenie returns an error', async () => {
  rejectOnceWithHttpStatus(vi.mocked(axios.post) as never, 'Opsgenie failed', 422);
  await expect(opsgenie.trigger(container as never)).rejects.toThrow('Opsgenie failed');
});
