import axios from 'axios';
import { rejectOnceWithHttpStatus } from '../../../test/notification-provider-mocks.js';
import Pagerduty from './Pagerduty.js';

vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));

const pagerduty = new Pagerduty();

const container = {
  name: 'database',
  watcher: 'local',
  updateKind: { kind: 'tag', localValue: '14.1', remoteValue: '14.2' },
  result: { link: 'https://hub.docker.com/_/postgres' },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(axios.post).mockResolvedValue({ data: { status: 'success' } });
  pagerduty.configuration = pagerduty.validateConfiguration({
    routingkey: 'abcdef1234567890',
  });
});

test('validateConfiguration should apply defaults', () => {
  expect(pagerduty.validateConfiguration({ routingkey: ' key ' })).toMatchObject({
    routingkey: 'key',
    severity: 'info',
    source: 'drydock',
    disabletitle: false,
  });
});

test('validateConfiguration should reject a missing routing key', () => {
  expect(() => pagerduty.validateConfiguration({ severity: 'info' })).toThrow();
});

test('validateConfiguration should reject an unknown severity', () => {
  expect(() =>
    pagerduty.validateConfiguration({ routingkey: 'key', severity: 'urgent' }),
  ).toThrow();
});

test('maskConfiguration should mask the routing key', () => {
  expect(pagerduty.maskConfiguration()).toMatchObject({
    routingkey: '[REDACTED]',
    severity: 'info',
  });
});

test('trigger should post a trigger event with container details', async () => {
  const result = await pagerduty.trigger(container as never);
  expect(result).toEqual({ status: 'success' });
  expect(axios.post).toHaveBeenCalledWith(
    'https://events.pagerduty.com/v2/enqueue',
    {
      routing_key: 'abcdef1234567890',
      event_action: 'trigger',
      payload: {
        summary: 'New tag found for container database',
        source: 'drydock',
        severity: 'info',
        custom_details: {
          message: expect.stringContaining('database'),
          containerName: 'database',
          watcher: 'local',
          local: '14.1',
          remote: '14.2',
          link: 'https://hub.docker.com/_/postgres',
        },
      },
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: expect.any(Number) },
  );
});

test('trigger should omit optional container details when absent', async () => {
  await pagerduty.trigger({ name: 'bare' } as never);
  const payload = vi.mocked(axios.post).mock.calls[0][1] as any;
  expect(payload.payload.custom_details).toEqual({
    message: expect.any(String),
    containerName: 'bare',
    watcher: undefined,
  });
});

test('trigger should use a plain summary when disabletitle is set', async () => {
  pagerduty.configuration.disabletitle = true;
  await pagerduty.trigger(container as never);
  const payload = vi.mocked(axios.post).mock.calls[0][1] as any;
  expect(payload.payload.summary).toBe('Update available for database');
});

test('triggerBatch should post a summary without container details', async () => {
  await pagerduty.triggerBatch([container, { ...container, name: 'cache' }] as never);
  const payload = vi.mocked(axios.post).mock.calls[0][1] as any;
  expect(payload.payload.summary).toBe('2 updates available');
  expect(payload.payload.custom_details).toEqual({ message: expect.any(String) });
});

test('triggerBatch should use a plain summary when disabletitle is set', async () => {
  pagerduty.configuration.disabletitle = true;
  await pagerduty.triggerBatch([container] as never);
  const payload = vi.mocked(axios.post).mock.calls[0][1] as any;
  expect(payload.payload.summary).toBe('1 container updates available');
});

test('trigger should reject when PagerDuty returns an error', async () => {
  rejectOnceWithHttpStatus(vi.mocked(axios.post) as never, 'PagerDuty failed', 400);
  await expect(pagerduty.trigger(container as never)).rejects.toThrow('PagerDuty failed');
});
