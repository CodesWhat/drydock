import axios from 'axios';
import joi from 'joi';
import Whatsapp from './Whatsapp.js';

vi.mock('axios');

const whatsapp = new Whatsapp();
const container = {
  name: 'container1',
  updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
};
const required = { phonenumberid: '123', token: 'secret', recipient: '15550001111' };

function configure(overrides = {}) {
  whatsapp.configuration = whatsapp.validateConfiguration({ ...required, ...overrides });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(axios.post).mockResolvedValue({ data: { messages: [{ id: 'wamid' }] } });
});

test('validateConfiguration should apply defaults', () => {
  expect(whatsapp.validateConfiguration(required)).toMatchObject({
    ...required,
    url: 'https://graph.facebook.com/v19.0',
    disabletitle: false,
  });
});

test('validateConfiguration should strip a trailing slash from the url', () => {
  expect(whatsapp.validateConfiguration({ ...required, url: 'https://g.example/v1/' }).url).toBe(
    'https://g.example/v1',
  );
});

test.each([
  {},
  { phonenumberid: '1', token: 't' },
  { ...required, url: 'ftp://x' },
])('validateConfiguration should reject %j', (configuration) => {
  expect(() => whatsapp.validateConfiguration(configuration)).toThrowError(joi.ValidationError);
});

test('maskConfiguration should mask the identifiers and credential', () => {
  configure();
  expect(whatsapp.maskConfiguration()).toMatchObject({
    phonenumberid: '[REDACTED]',
    token: '[REDACTED]',
    recipient: '[REDACTED]',
  });
});

test('trigger should post a bold title and body to the Cloud API', async () => {
  configure();
  await expect(whatsapp.trigger(container)).resolves.toEqual({ messages: [{ id: 'wamid' }] });
  expect(axios.post).toHaveBeenCalledWith(
    'https://graph.facebook.com/v19.0/123/messages',
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '15550001111',
      type: 'text',
      text: {
        preview_url: true,
        body: '*New tag found for container container1*\n\nContainer container1 running with tag 1.0.0 can be updated to tag 2.0.0',
      },
    },
    {
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      timeout: 30000,
    },
  );
});

test('trigger should send only the body when the title is disabled', async () => {
  configure({ disabletitle: true });
  await whatsapp.trigger(container);
  const payload = vi.mocked(axios.post).mock.calls[0][1] as { text: { body: string } };
  expect(payload.text.body).toBe(
    'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
  );
});

test('triggerBatch should send the batch title and body', async () => {
  configure();
  await whatsapp.triggerBatch([container, container]);
  const payload = vi.mocked(axios.post).mock.calls[0][1] as { text: { body: string } };
  expect(payload.text.body.startsWith('*2 updates available*\n\n')).toBe(true);
});

test('triggerBatch should omit the title when disabled', async () => {
  configure({ disabletitle: true });
  await whatsapp.triggerBatch([container]);
  const payload = vi.mocked(axios.post).mock.calls[0][1] as { text: { body: string } };
  expect(payload.text.body.startsWith('*')).toBe(false);
});

test('trigger should propagate http errors', async () => {
  configure();
  vi.mocked(axios.post).mockRejectedValue(new Error('boom'));
  await expect(whatsapp.trigger(container)).rejects.toThrow('boom');
});
