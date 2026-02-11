// @ts-nocheck
import Rocketchat from './Rocketchat.js';

// Mock axios
vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

describe('Rocketchat Trigger', () => {
  let rocketchat;

  beforeEach(async () => {
    rocketchat = new Rocketchat();
    vi.clearAllMocks();
  });

  test('should create instance', async () => {
    expect(rocketchat).toBeDefined();
    expect(rocketchat).toBeInstanceOf(Rocketchat);
  });

  test('should have correct configuration schema', async () => {
    const schema = rocketchat.getConfigurationSchema();
    expect(schema).toBeDefined();
  });

  test('should validate configuration with required fields', async () => {
    const config = {
      url: 'https://open.rocket.chat',
      user: { id: 'jDdn8oh9BfJKnWdDY' },
      auth: { token: 'Rbqz90hnkRyVwRfcmE5PzkP5Pqwml_fo7ZUXzxv2_zx' }, // NOSONAR - test fixture, not a real credential
      channel: '#general',
    };

    expect(() => rocketchat.validateConfiguration(config)).not.toThrow();
  });

  test('should throw error when URL is missing', async () => {
    const config = {
      user: { id: 'test' },
      auth: { token: 'test' }, // NOSONAR - test fixture, not a real credential
      channel: '#general',
    };

    expect(() => rocketchat.validateConfiguration(config)).toThrow();
  });

  test('should throw error when user id is missing', async () => {
    const config = {
      url: 'https://open.rocket.chat',
      user: {},
      auth: { token: 'test' }, // NOSONAR - test fixture, not a real credential
      channel: '#general',
    };

    expect(() => rocketchat.validateConfiguration(config)).toThrow();
  });

  test('should throw error when auth token is missing', async () => {
    const config = {
      url: 'https://open.rocket.chat',
      user: { id: 'test' },
      auth: {},
      channel: '#general',
    };

    expect(() => rocketchat.validateConfiguration(config)).toThrow();
  });

  test('should throw error when channel is missing', async () => {
    const config = {
      url: 'https://open.rocket.chat',
      user: { id: 'test' },
      auth: { token: 'test' }, // NOSONAR - test fixture, not a real credential
    };

    expect(() => rocketchat.validateConfiguration(config)).toThrow();
  });

  test('should mask configuration sensitive data', async () => {
    rocketchat.configuration = {
      auth: { token: 'token' }, // NOSONAR - test fixture, not a real credential
      user: { id: 'some_user_id' },
      channel: '#general',
    };
    const masked = rocketchat.maskConfiguration();
    expect(masked.auth.token).toBe('t***n');
    expect(masked.user.id).toBe('s**********d');
    expect(masked.channel).toBe('#general');
  });

  test('should trigger with container', async () => {
    rocketchat.configuration = {
      url: 'https://open.rocket.chat',
      user: { id: 'jDdn8oh9BfJKnWdDY' },
      auth: { token: 'Rbqz90hnkRyVwRfcmE5PzkP5Pqwml_fo7ZUXzxv2_zx' }, // NOSONAR - test fixture, not a real credential
      channel: '#general',
    };
    rocketchat.renderSimpleTitle = vi.fn().mockReturnValue('Title');
    rocketchat.renderSimpleBody = vi.fn().mockReturnValue('Body');
    const container = { name: 'test' };

    await rocketchat.trigger(container);
    expect(rocketchat.renderSimpleTitle).toHaveBeenCalledWith(container);
    expect(rocketchat.renderSimpleBody).toHaveBeenCalledWith(container);
  });

  test('should trigger batch with containers', async () => {
    rocketchat.configuration = {
      url: 'https://open.rocket.chat',
      user: { id: 'jDdn8oh9BfJKnWdDY' },
      auth: { token: 'Rbqz90hnkRyVwRfcmE5PzkP5Pqwml_fo7ZUXzxv2_zx' }, // NOSONAR - test fixture, not a real credential
      channel: '#general',
    };
    rocketchat.renderBatchTitle = vi.fn().mockReturnValue('Batch Title');
    rocketchat.renderBatchBody = vi.fn().mockReturnValue('Batch Body');
    const containers = [{ name: 'test1' }, { name: 'test2' }];

    await rocketchat.triggerBatch(containers);
    expect(rocketchat.renderBatchTitle).toHaveBeenCalledWith(containers);
    expect(rocketchat.renderBatchBody).toHaveBeenCalledWith(containers);
  });

  test('should send message with correct data', async () => {
    const { default: axios } = await import('axios');
    rocketchat.configuration = {
      url: 'https://open.rocket.chat',
      user: { id: 'jDdn8oh9BfJKnWdDY' },
      auth: { token: 'Rbqz90hnkRyVwRfcmE5PzkP5Pqwml_fo7ZUXzxv2_zx' }, // NOSONAR - test fixture, not a real credential
      channel: '#general',
    };

    await rocketchat.postMessage('Test message');
    expect(axios.post).toHaveBeenCalledWith(
      'https://open.rocket.chat/api/v1/chat.postMessage',
      {
        channel: '#general',
        text: 'Test message',
      },
      {
        headers: {
          'X-Auth-Token': 'Rbqz90hnkRyVwRfcmE5PzkP5Pqwml_fo7ZUXzxv2_zx', // NOSONAR - test fixture, not a real credential
          'X-User-Id': 'jDdn8oh9BfJKnWdDY',
          'content-type': 'application/json',
          accept: 'application/json',
        },
      },
    );
  });

  test('buildMessageBody should include alias when configured', () => {
    rocketchat.configuration = {
      channel: '#general',
      alias: 'Drydock Bot',
    };
    const body = rocketchat.buildMessageBody('Test');
    expect(body).toEqual({
      channel: '#general',
      text: 'Test',
      alias: 'Drydock Bot',
    });
  });

  test('buildMessageBody should include avatar when configured', () => {
    rocketchat.configuration = {
      channel: '#general',
      avatar: 'https://example.com/avatar.png',
    };
    const body = rocketchat.buildMessageBody('Test');
    expect(body).toEqual({
      channel: '#general',
      text: 'Test',
      avatar: 'https://example.com/avatar.png',
    });
  });

  test('buildMessageBody should include emoji when configured', () => {
    rocketchat.configuration = {
      channel: '#general',
      emoji: ':whale:',
    };
    const body = rocketchat.buildMessageBody('Test');
    expect(body).toEqual({
      channel: '#general',
      text: 'Test',
      emoji: ':whale:',
    });
  });

  test('buildMessageBody should include parseUrls when parse.urls is set', () => {
    rocketchat.configuration = {
      channel: '#general',
      parse: { urls: true },
    };
    const body = rocketchat.buildMessageBody('Test');
    expect(body).toEqual({
      channel: '#general',
      text: 'Test',
      parseUrls: true,
    });
  });

  test('composeMessage should return only body when disabletitle is true', () => {
    rocketchat.configuration = { disabletitle: true };
    rocketchat.renderSimpleBody = vi.fn().mockReturnValue('Body only');
    rocketchat.renderSimpleTitle = vi.fn().mockReturnValue('Title');
    const result = rocketchat.composeMessage({ name: 'test' });
    expect(result).toBe('Body only');
    expect(rocketchat.renderSimpleTitle).not.toHaveBeenCalled();
  });

  test('composeBatchMessage should return only body when disabletitle is true', () => {
    rocketchat.configuration = { disabletitle: true };
    rocketchat.renderBatchBody = vi.fn().mockReturnValue('Batch body');
    rocketchat.renderBatchTitle = vi.fn().mockReturnValue('Batch title');
    const result = rocketchat.composeBatchMessage([{ name: 'c1' }]);
    expect(result).toBe('Batch body');
    expect(rocketchat.renderBatchTitle).not.toHaveBeenCalled();
  });
});
