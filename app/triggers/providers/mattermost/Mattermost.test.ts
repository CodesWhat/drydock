import joi from 'joi';
import Mattermost from './Mattermost.js';

vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const mattermost = new Mattermost();

beforeEach(() => {
  vi.clearAllMocks();
  mattermost.postMessage = Mattermost.prototype.postMessage;
});

const configurationValid = {
  url: 'https://mattermost.example.com/hooks/abcdefghijklmnopqrstuvwxyz',
  channel: 'drydock',
  username: 'drydock-bot',
  iconemoji: ':whale:',
  iconurl: 'https://example.com/whale.png',
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
  const validatedConfiguration = mattermost.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should apply default username when missing', async () => {
  const validatedConfiguration = mattermost.validateConfiguration({
    url: configurationValid.url,
  });
  expect(validatedConfiguration.username).toEqual('drydock');
});

test('validateConfiguration should throw error when invalid', async () => {
  expect(() => {
    mattermost.validateConfiguration({});
  }).toThrowError(joi.ValidationError);
});

test('maskConfiguration should mask sensitive data', async () => {
  mattermost.configuration = {
    url: configurationValid.url,
    channel: 'drydock',
  };
  const masked = mattermost.maskConfiguration();
  expect(masked.channel).toEqual('drydock');
  expect(masked.url).not.toEqual(configurationValid.url);
  expect(masked.url.startsWith('h')).toBe(true);
  expect(masked.url.endsWith('z')).toBe(true);
});

test('buildMessageBody should include optional fields when configured', async () => {
  mattermost.configuration = configurationValid;
  expect(mattermost.buildMessageBody('Test message')).toEqual({
    text: 'Test message',
    channel: 'drydock',
    username: 'drydock-bot',
    icon_emoji: ':whale:',
    icon_url: 'https://example.com/whale.png',
  });
});

test('buildMessageBody should omit optional fields when not configured', async () => {
  mattermost.configuration = {
    url: configurationValid.url,
  };
  expect(mattermost.buildMessageBody('Test message')).toEqual({
    text: 'Test message',
  });
});

test('trigger should send markdown formatted message', async () => {
  mattermost.configuration = configurationValid;
  mattermost.postMessage = vi.fn();
  await mattermost.trigger({});
  expect(mattermost.postMessage).toHaveBeenCalledWith('**Test Title**\n\nTest Body');
});

test('trigger should send body only when disabletitle is true', async () => {
  mattermost.configuration = {
    ...configurationValid,
    disabletitle: true,
  };
  mattermost.postMessage = vi.fn();
  await mattermost.trigger({});
  expect(mattermost.postMessage).toHaveBeenCalledWith('Test Body');
});

test('triggerBatch should send markdown formatted batch message', async () => {
  mattermost.configuration = configurationValid;
  mattermost.postMessage = vi.fn();
  const containers = [
    {
      name: 'container1',
      updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
    },
    {
      name: 'container2',
      updateKind: { kind: 'tag', localValue: '1.1.0', remoteValue: '2.1.0' },
    },
  ];
  await mattermost.triggerBatch(containers);
  expect(mattermost.postMessage).toHaveBeenCalledWith(
    '**Batch Title**\n\n- Test Body\n\n- Test Body\n',
  );
});

test('triggerBatch should send batch body only when disabletitle is true', async () => {
  mattermost.configuration = {
    ...configurationValid,
    disabletitle: true,
  };
  mattermost.postMessage = vi.fn();
  await mattermost.triggerBatch([{ name: 'container1' }]);
  expect(mattermost.postMessage).toHaveBeenCalledWith('- Test Body\n');
});

test('postMessage should call Mattermost webhook endpoint', async () => {
  const { default: axios } = await import('axios');
  mattermost.configuration = configurationValid;
  await mattermost.postMessage('Message to Mattermost');
  expect(axios.post).toHaveBeenCalledWith(
    'https://mattermost.example.com/hooks/abcdefghijklmnopqrstuvwxyz',
    {
      text: 'Message to Mattermost',
      channel: 'drydock',
      username: 'drydock-bot',
      icon_emoji: ':whale:',
      icon_url: 'https://example.com/whale.png',
    },
    {
      headers: {
        'content-type': 'application/json',
      },
    },
  );
});
