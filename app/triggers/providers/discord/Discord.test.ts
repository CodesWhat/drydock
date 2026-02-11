// @ts-nocheck
import Discord from './Discord.js';

// Mock axios
vi.mock('axios', () => ({ default: vi.fn().mockResolvedValue({ data: {} }) }));

describe('Discord Trigger', () => {
  let discord;

  beforeEach(async () => {
    discord = new Discord();
    vi.clearAllMocks();
  });

  test('should create instance', async () => {
    expect(discord).toBeDefined();
    expect(discord).toBeInstanceOf(Discord);
  });

  test('should have correct configuration schema', async () => {
    const schema = discord.getConfigurationSchema();
    expect(schema).toBeDefined();
  });

  test('should validate configuration with webhook URL', async () => {
    const config = {
      url: 'https://discord.com/api/webhooks/123/abc',
    };

    expect(() => discord.validateConfiguration(config)).not.toThrow();
  });

  test('should throw error when webhook URL is missing', async () => {
    const config = {};

    expect(() => discord.validateConfiguration(config)).toThrow();
  });

  test('should mask configuration URL', async () => {
    discord.configuration = {
      url: 'https://discord.com/api/webhooks/123/secret', // NOSONAR - test fixture, not a real credential
    };
    const masked = discord.maskConfiguration();
    expect(masked.url).toBe('h*****************************************t');
  });

  test('should trigger with container', async () => {
    discord.configuration = {
      url: 'https://discord.com/api/webhooks/123/abc',
    };
    discord.renderSimpleTitle = vi.fn().mockReturnValue('Title');
    discord.renderSimpleBody = vi.fn().mockReturnValue('Body');
    const container = { name: 'test' };

    await discord.trigger(container);
    expect(discord.renderSimpleTitle).toHaveBeenCalledWith(container);
    expect(discord.renderSimpleBody).toHaveBeenCalledWith(container);
  });

  test('should trigger batch with containers', async () => {
    discord.configuration = {
      url: 'https://discord.com/api/webhooks/123/abc',
    };
    discord.renderBatchTitle = vi.fn().mockReturnValue('Batch Title');
    discord.renderBatchBody = vi.fn().mockReturnValue('Batch Body');
    const containers = [{ name: 'test1' }, { name: 'test2' }];

    await discord.triggerBatch(containers);
    expect(discord.renderBatchTitle).toHaveBeenCalledWith(containers);
    expect(discord.renderBatchBody).toHaveBeenCalledWith(containers);
  });

  test('should send message with custom configuration', async () => {
    const { default: axios } = await import('axios');
    discord.configuration = {
      url: 'https://discord.com/api/webhooks/123/abc',
      botusername: 'CustomBot',
      cardcolor: 16711680,
      cardlabel: 'Updates',
    };

    await discord.sendMessage('Test Title', 'Test Body');
    expect(axios).toHaveBeenCalledWith({
      method: 'POST',
      uri: 'https://discord.com/api/webhooks/123/abc',
      body: {
        username: 'CustomBot',
        embeds: [
          {
            title: 'Test Title',
            color: 16711680,
            fields: [
              {
                name: 'Updates',
                value: 'Test Body',
              },
            ],
          },
        ],
      },
    });
  });
});
