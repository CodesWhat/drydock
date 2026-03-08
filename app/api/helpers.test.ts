const { mockLogInfo, mockLogWarn, mockLogDebug, mockLogError } = vi.hoisted(() => ({
  mockLogInfo: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogDebug: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({
      info: mockLogInfo,
      warn: mockLogWarn,
      debug: mockLogDebug,
      error: mockLogError,
    }),
  },
}));

import { sanitizeApiError } from './helpers.js';

describe('sanitizeApiError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns generic invalid request message for Joi validation errors', () => {
    const error = {
      isJoi: true,
      message: '"enabled" must be a boolean',
      details: [{ message: '"enabled" must be a boolean' }],
    };

    expect(sanitizeApiError(error)).toBe('Invalid request parameters');
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('"enabled" must be a boolean'),
    );
  });

  test('returns generic internal server message for unexpected errors', () => {
    expect(sanitizeApiError(new Error('database offline'))).toBe('Internal server error');
    expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('database offline'));
  });

  test('returns generic internal server message for non-Error values', () => {
    expect(sanitizeApiError('boom')).toBe('Internal server error');
    expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});
