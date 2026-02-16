import joi from 'joi';
import Googlechat from './Googlechat.js';

vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const googlechat = new Googlechat();

beforeEach(() => {
  vi.clearAllMocks();
  googlechat.postMessage = Googlechat.prototype.postMessage;
});

const configurationValid = {
  url: 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=key123&token=token123',
  threadkey: 'drydock-thread',
  messagereplyoption: 'REPLY_MESSAGE_OR_FAIL',
  threshold: 'all',
  mode: 'simple',
  once: true,
  auto: true,
  order: 100,
  simpletitle: 'Test Title',
  simplebody: 'Test Body',
  batchtitle: 'Batch Title',
  resolvenotifications: false,
  disabletitle: false,
};

test('validateConfiguration should return validated configuration when valid', async () => {
  const validatedConfiguration = googlechat.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when invalid', async () => {
  expect(() => {
    googlechat.validateConfiguration({});
  }).toThrowError(joi.ValidationError);
});

test('maskConfiguration should mask sensitive data', async () => {
  googlechat.configuration = configurationValid;
  const masked = googlechat.maskConfiguration();
  expect(masked.url).not.toEqual(configurationValid.url);
  expect(masked.url.startsWith('h')).toBe(true);
  expect(masked.url.endsWith('3')).toBe(true);
});

test('buildMessageBody should include thread key when configured', async () => {
  googlechat.configuration = configurationValid;
  expect(googlechat.buildMessageBody('Test message')).toEqual({
    text: 'Test message',
    thread: {
      threadKey: 'drydock-thread',
    },
  });
});

test('buildMessageBody should omit thread when not configured', async () => {
  googlechat.configuration = {
    url: configurationValid.url,
  };
  expect(googlechat.buildMessageBody('Test message')).toEqual({
    text: 'Test message',
  });
});

test('buildWebhookUrl should keep base URL when message reply option is missing', async () => {
  googlechat.configuration = {
    url: configurationValid.url,
  };
  expect(googlechat.buildWebhookUrl()).toEqual(configurationValid.url);
});

test('buildWebhookUrl should append message reply option when configured', async () => {
  googlechat.configuration = configurationValid;
  expect(googlechat.buildWebhookUrl()).toEqual(
    'https://chat.googleapis.com/v1/spaces/AAA/messages?key=key123&token=token123&messageReplyOption=REPLY_MESSAGE_OR_FAIL',
  );
});

test('trigger should send title and body when disabletitle is false', async () => {
  googlechat.configuration = configurationValid;
  googlechat.postMessage = vi.fn();
  await googlechat.trigger({});
  expect(googlechat.postMessage).toHaveBeenCalledWith('Test Title\n\nTest Body');
});

test('trigger should send body only when disabletitle is true', async () => {
  googlechat.configuration = {
    ...configurationValid,
    disabletitle: true,
  };
  googlechat.postMessage = vi.fn();
  await googlechat.trigger({});
  expect(googlechat.postMessage).toHaveBeenCalledWith('Test Body');
});

test('triggerBatch should send formatted batch message', async () => {
  googlechat.configuration = configurationValid;
  googlechat.postMessage = vi.fn();
  await googlechat.triggerBatch([{ name: 'container1' }, { name: 'container2' }]);
  expect(googlechat.postMessage).toHaveBeenCalledWith('Batch Title\n\n- Test Body\n\n- Test Body\n');
});

test('postMessage should call Google Chat webhook endpoint', async () => {
  const { default: axios } = await import('axios');
  googlechat.configuration = configurationValid;
  await googlechat.postMessage('Message to Google Chat');
  expect(axios.post).toHaveBeenCalledWith(
    'https://chat.googleapis.com/v1/spaces/AAA/messages?key=key123&token=token123&messageReplyOption=REPLY_MESSAGE_OR_FAIL',
    {
      text: 'Message to Google Chat',
      thread: {
        threadKey: 'drydock-thread',
      },
    },
    {
      headers: {
        'content-type': 'application/json',
      },
    },
  );
});
