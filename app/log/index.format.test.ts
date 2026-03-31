import { Writable } from 'node:stream';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetLogFormat, mockPinoPretty, mockSetWarnLogger } = vi.hoisted(() => ({
  mockGetLogFormat: vi.fn(() => 'text'),
  mockPinoPretty: vi.fn(
    () =>
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
  ),
  mockSetWarnLogger: vi.fn(),
}));

vi.mock('../configuration', () => ({
  getLogLevel: vi.fn(() => 'info'),
  getLogFormat: mockGetLogFormat,
  getLogBufferEnabled: vi.fn(() => false),
}));

vi.mock('pino-pretty', () => ({
  default: mockPinoPretty,
}));

vi.mock('./warn.js', () => ({
  setWarnLogger: mockSetWarnLogger,
}));

describe('Logger format selection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetLogFormat.mockReturnValue('text');
    mockPinoPretty.mockImplementation(
      () =>
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
    );
  });

  test('should configure pino-pretty with explicit readable timestamp options in text mode', async () => {
    await import('./index.js');

    expect(mockPinoPretty).toHaveBeenCalledWith({
      colorize: false,
      sync: true,
      singleLine: true,
      translateTime: 'SYS:HH:MM:ss.l',
    });
  });

  test('should bypass pino-pretty when json logs are requested', async () => {
    mockGetLogFormat.mockReturnValue('json');

    await import('./index.js');

    expect(mockPinoPretty).not.toHaveBeenCalled();
  });
});
