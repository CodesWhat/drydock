import joi from 'joi';
import Teams from './Teams.js';

vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const teams = new Teams();

beforeEach(() => {
  vi.clearAllMocks();
  teams.postMessage = Teams.prototype.postMessage;
});

const configurationValid = {
  url: 'https://prod-00.westus.logic.azure.com/workflows/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/triggers/manual/paths/invoke',
  cardversion: '1.4',
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
  const validatedConfiguration = teams.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should apply default cardversion when missing', async () => {
  const validatedConfiguration = teams.validateConfiguration({
    url: configurationValid.url,
  });
  expect(validatedConfiguration.cardversion).toEqual('1.4');
});

test('validateConfiguration should throw error when invalid', async () => {
  expect(() => {
    teams.validateConfiguration({});
  }).toThrowError(joi.ValidationError);
});

test('maskConfiguration should mask sensitive data', async () => {
  teams.configuration = {
    ...configurationValid,
  };
  const masked = teams.maskConfiguration();
  expect(masked.url).not.toEqual(configurationValid.url);
  expect(masked.url.startsWith('h')).toBe(true);
  expect(masked.url.endsWith('e')).toBe(true);
});

test('buildMessageBody should build adaptive card payload', async () => {
  teams.configuration = configurationValid;
  expect(teams.buildMessageBody('Test message')).toEqual({
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          type: 'AdaptiveCard',
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: 'Test message',
              wrap: true,
            },
          ],
        },
      },
    ],
  });
});

test('trigger should send title and body when disabletitle is false', async () => {
  teams.configuration = configurationValid;
  teams.postMessage = vi.fn();
  await teams.trigger({});
  expect(teams.postMessage).toHaveBeenCalledWith('Test Title\n\nTest Body');
});

test('trigger should send body only when disabletitle is true', async () => {
  teams.configuration = {
    ...configurationValid,
    disabletitle: true,
  };
  teams.postMessage = vi.fn();
  await teams.trigger({});
  expect(teams.postMessage).toHaveBeenCalledWith('Test Body');
});

test('triggerBatch should send formatted batch message', async () => {
  teams.configuration = configurationValid;
  teams.postMessage = vi.fn();
  await teams.triggerBatch([{ name: 'container1' }, { name: 'container2' }]);
  expect(teams.postMessage).toHaveBeenCalledWith('Batch Title\n\n- Test Body\n\n- Test Body\n');
});

test('postMessage should call Teams webhook endpoint', async () => {
  const { default: axios } = await import('axios');
  teams.configuration = configurationValid;
  await teams.postMessage('Message to Teams');
  expect(axios.post).toHaveBeenCalledWith(
    configurationValid.url,
    {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.4',
            body: [
              {
                type: 'TextBlock',
                text: 'Message to Teams',
                wrap: true,
              },
            ],
          },
        },
      ],
    },
    {
      headers: {
        'content-type': 'application/json',
      },
      timeout: 30000,
    },
  );
});
