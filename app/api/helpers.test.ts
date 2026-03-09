import { sanitizeLogParam } from '../log/sanitize.js';
import { createContainerFixture, createMockResponse } from '../test/helpers.js';

const {
  mockLogInfo,
  mockLogWarn,
  mockLogDebug,
  mockLogError,
  mockRecordAuditEvent,
  mockSendErrorResponse,
} = vi.hoisted(() => ({
  mockLogInfo: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogDebug: vi.fn(),
  mockLogError: vi.fn(),
  mockRecordAuditEvent: vi.fn(),
  mockSendErrorResponse: vi.fn(),
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

vi.mock('./audit-events.js', () => ({
  recordAuditEvent: mockRecordAuditEvent,
}));

vi.mock('./error-response.js', () => ({
  sendErrorResponse: mockSendErrorResponse,
}));

import { handleContainerActionError, sanitizeApiError } from './helpers.js';

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

  test('treats Joi-like payloads with invalid details shape as internal errors', () => {
    const error = {
      isJoi: true,
      message: '"name" is required',
      details: 'invalid-details-shape',
    };

    expect(sanitizeApiError(error)).toBe('Internal server error');
    expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('"name" is required'));
  });

  test('falls back to Joi message when detail messages are empty or non-string', () => {
    const error = {
      isJoi: true,
      message: '"name" is required',
      details: [{ message: 42 }, { message: '   ' }],
    };

    expect(sanitizeApiError(error)).toBe('Invalid request parameters');
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('"name" is required'));
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

describe('handleContainerActionError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sanitizes warning log data, records error audit, and returns 500 response', () => {
    const res = createMockResponse();
    const warn = vi.fn();
    const container = createContainerFixture({
      id: 'container-1',
      name: 'nginx',
      image: { name: 'library/nginx' },
    }) as any;
    const id = 'api-id-\n01';
    const error = new Error('docker stop failed\nreason: timeout');

    const returnedMessage = handleContainerActionError({
      error,
      action: 'container-stop',
      actionLabel: 'stopping',
      id,
      container,
      log: { warn } as any,
      res: res as any,
    });

    expect(returnedMessage).toBe(error.message);
    expect(warn).toHaveBeenCalledWith(
      `Error stopping container ${sanitizeLogParam(id)} (${sanitizeLogParam(error.message)})`,
    );
    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'container-stop',
      container,
      status: 'error',
      details: error.message,
    });
    expect(mockSendErrorResponse).toHaveBeenCalledWith(res, 500, 'Error stopping container');
  });

  test('stringifies non-Error failures for audit details and return value', () => {
    const res = createMockResponse();
    const warn = vi.fn();
    const container = createContainerFixture({
      id: 'container-2',
      name: 'redis',
      image: { name: 'library/redis' },
    }) as any;

    const returnedMessage = handleContainerActionError({
      error: 503,
      action: 'container-start',
      actionLabel: 'starting',
      id: 'redis-1',
      container,
      log: { warn } as any,
      res: res as any,
    });

    expect(returnedMessage).toBe('503');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'container-start',
      container,
      status: 'error',
      details: '503',
    });
    expect(mockSendErrorResponse).toHaveBeenCalledWith(res, 500, 'Error starting container');
  });
});
