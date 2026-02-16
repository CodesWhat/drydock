import joi from 'joi';
import Matrix from './Matrix.js';

vi.mock('axios', () => ({
  default: {
    put: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const matrix = new Matrix();

beforeEach(() => {
  vi.clearAllMocks();
  matrix.postMessage = Matrix.prototype.postMessage;
  matrix.generateTransactionId = Matrix.prototype.generateTransactionId;
});

const configurationValid = {
  url: 'https://matrix.example.com',
  roomid: '!room:example.com',
  accesstoken: 'matrix_token_abcdefghijklmnopqrstuvwxyz',
  msgtype: 'm.notice',
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
  const validatedConfiguration = matrix.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should normalize trailing slash in URL', async () => {
  const validatedConfiguration = matrix.validateConfiguration({
    ...configurationValid,
    url: 'https://matrix.example.com/',
  });
  expect(validatedConfiguration.url).toEqual('https://matrix.example.com');
});

test('validateConfiguration should apply default msgtype when missing', async () => {
  const validatedConfiguration = matrix.validateConfiguration({
    url: configurationValid.url,
    roomid: configurationValid.roomid,
    accesstoken: configurationValid.accesstoken,
  });
  expect(validatedConfiguration.msgtype).toEqual('m.notice');
});

test('validateConfiguration should throw error when invalid', async () => {
  expect(() => {
    matrix.validateConfiguration({});
  }).toThrowError(joi.ValidationError);
});

test('maskConfiguration should mask sensitive data', async () => {
  matrix.configuration = configurationValid;
  const masked = matrix.maskConfiguration();
  expect(masked.roomid).toEqual(configurationValid.roomid);
  expect(masked.accesstoken).not.toEqual(configurationValid.accesstoken);
  expect(masked.accesstoken.startsWith('m')).toBe(true);
  expect(masked.accesstoken.endsWith('z')).toBe(true);
});

test('buildMessageEndpoint should encode room id and transaction id', async () => {
  matrix.configuration = configurationValid;
  expect(matrix.buildMessageEndpoint('txn/123')).toEqual(
    'https://matrix.example.com/_matrix/client/v3/rooms/!room%3Aexample.com/send/m.room.message/txn%2F123',
  );
});

test('buildMessageBody should include message type and body', async () => {
  matrix.configuration = configurationValid;
  expect(matrix.buildMessageBody('Test message')).toEqual({
    msgtype: 'm.notice',
    body: 'Test message',
  });
});

test('generateTransactionId should include timestamp prefix', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
  expect(matrix.generateTransactionId()).toMatch(/^1700000000000-/);
  vi.restoreAllMocks();
});

test('trigger should send title and body when disabletitle is false', async () => {
  matrix.configuration = configurationValid;
  matrix.postMessage = vi.fn();
  await matrix.trigger({});
  expect(matrix.postMessage).toHaveBeenCalledWith('Test Title\n\nTest Body');
});

test('trigger should send body only when disabletitle is true', async () => {
  matrix.configuration = {
    ...configurationValid,
    disabletitle: true,
  };
  matrix.postMessage = vi.fn();
  await matrix.trigger({});
  expect(matrix.postMessage).toHaveBeenCalledWith('Test Body');
});

test('triggerBatch should send formatted batch message', async () => {
  matrix.configuration = configurationValid;
  matrix.postMessage = vi.fn();
  await matrix.triggerBatch([{ name: 'container1' }, { name: 'container2' }]);
  expect(matrix.postMessage).toHaveBeenCalledWith('Batch Title\n\n- Test Body\n\n- Test Body\n');
});

test('postMessage should call Matrix message endpoint', async () => {
  const { default: axios } = await import('axios');
  matrix.configuration = configurationValid;
  matrix.generateTransactionId = vi.fn().mockReturnValue('txn-123');
  await matrix.postMessage('Message to Matrix');
  expect(axios.put).toHaveBeenCalledWith(
    'https://matrix.example.com/_matrix/client/v3/rooms/!room%3Aexample.com/send/m.room.message/txn-123',
    {
      msgtype: 'm.notice',
      body: 'Message to Matrix',
    },
    {
      headers: {
        Authorization: 'Bearer matrix_token_abcdefghijklmnopqrstuvwxyz',
        'content-type': 'application/json',
      },
    },
  );
});
