import { describe, expect, test, vi } from 'vitest';
import { SELF_UPDATE_FINALIZE_SECRET_HEADER } from '../../../api/internal-self-update.js';

const mockHttpRequest = vi.hoisted(() => vi.fn());
const mockHttpsRequest = vi.hoisted(() => vi.fn());
const mockSleep = vi.hoisted(() => vi.fn());

vi.mock('node:http', () => ({
  default: {
    request: mockHttpRequest,
  },
}));

vi.mock('node:https', () => ({
  default: {
    request: mockHttpsRequest,
  },
}));

vi.mock('../../../util/sleep.js', () => ({
  sleep: (...args: unknown[]) => mockSleep(...args),
}));

const REQUIRED_ENV_KEYS = [
  'DD_SELF_UPDATE_FINALIZE_URL',
  'DD_SELF_UPDATE_FINALIZE_SECRET',
  'DD_SELF_UPDATE_OPERATION_ID',
  'DD_SELF_UPDATE_STATUS',
  'DD_SELF_UPDATE_PHASE',
  'DD_SELF_UPDATE_LAST_ERROR',
  'DD_SELF_UPDATE_FINALIZE_TIMEOUT_MS',
  'DD_SELF_UPDATE_FINALIZE_RETRY_INTERVAL_MS',
] as const;

describe('self-update-finalize entrypoint', () => {
  test('sends the finalize secret header on callback requests', async () => {
    vi.resetModules();
    mockHttpRequest.mockReset();
    mockHttpsRequest.mockReset();

    const originalExitCode = process.exitCode;
    const savedEnv = new Map<string, string | undefined>();
    for (const key of REQUIRED_ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
    }

    process.env.DD_SELF_UPDATE_FINALIZE_URL =
      'http://127.0.0.1:3000/api/v1/internal/self-update/finalize';
    process.env.DD_SELF_UPDATE_FINALIZE_SECRET = 'self-update-finalize-secret';
    process.env.DD_SELF_UPDATE_OPERATION_ID = 'op-123';
    process.env.DD_SELF_UPDATE_STATUS = 'succeeded';
    process.env.DD_SELF_UPDATE_PHASE = 'succeeded';
    delete process.env.DD_SELF_UPDATE_LAST_ERROR;
    process.env.DD_SELF_UPDATE_FINALIZE_TIMEOUT_MS = '1000';
    process.env.DD_SELF_UPDATE_FINALIZE_RETRY_INTERVAL_MS = '1';

    let capturedRequestOptions: Record<string, unknown> | undefined;
    mockHttpRequest.mockImplementation((options, callback) => {
      capturedRequestOptions = options as Record<string, unknown>;
      const response = {
        statusCode: 202,
        resume: vi.fn(),
        once: vi.fn((event: string, handler: () => void) => {
          if (event === 'end') {
            queueMicrotask(() => handler());
          }
        }),
      };
      return {
        once: vi.fn(),
        write: vi.fn(),
        end: vi.fn(() => {
          callback(response);
        }),
      };
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;

    try {
      await import('./self-update-finalize-entrypoint.js?secret-header-test');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockHttpsRequest).not.toHaveBeenCalled();
      expect(mockHttpRequest).toHaveBeenCalledTimes(1);
      expect(
        (capturedRequestOptions?.headers as Record<string, string>)[
          SELF_UPDATE_FINALIZE_SECRET_HEADER
        ],
      ).toBe('self-update-finalize-secret');
      expect(errorSpy).not.toHaveBeenCalled();
      expect(process.exitCode).not.toBe(1);
    } finally {
      errorSpy.mockRestore();
      process.exitCode = originalExitCode;
      for (const [key, value] of savedEnv.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test('uses https for finalize URLs with an https scheme', async () => {
    vi.resetModules();
    mockHttpRequest.mockReset();
    mockHttpsRequest.mockReset();

    const originalExitCode = process.exitCode;
    const savedEnv = new Map<string, string | undefined>();
    for (const key of REQUIRED_ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
    }

    process.env.DD_SELF_UPDATE_FINALIZE_URL =
      'https://127.0.0.1:3443/api/v1/internal/self-update/finalize';
    process.env.DD_SELF_UPDATE_FINALIZE_SECRET = 'self-update-finalize-secret';
    process.env.DD_SELF_UPDATE_OPERATION_ID = 'op-123';
    process.env.DD_SELF_UPDATE_STATUS = 'succeeded';
    process.env.DD_SELF_UPDATE_PHASE = 'succeeded';
    delete process.env.DD_SELF_UPDATE_LAST_ERROR;
    process.env.DD_SELF_UPDATE_FINALIZE_TIMEOUT_MS = '1000';
    process.env.DD_SELF_UPDATE_FINALIZE_RETRY_INTERVAL_MS = '1';

    mockHttpsRequest.mockImplementation((options, callback) => {
      const response = {
        statusCode: 202,
        resume: vi.fn(),
        once: vi.fn((event: string, handler: () => void) => {
          if (event === 'end') {
            queueMicrotask(() => handler());
          }
        }),
      };
      return {
        once: vi.fn(),
        write: vi.fn(),
        end: vi.fn(() => {
          callback(response);
        }),
      };
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;

    try {
      await import('./self-update-finalize-entrypoint.js?https-test');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockHttpRequest).not.toHaveBeenCalled();
      expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(process.exitCode).not.toBe(1);
    } finally {
      errorSpy.mockRestore();
      process.exitCode = originalExitCode;
      for (const [key, value] of savedEnv.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test('reports callback failures when the finalize endpoint responds non-2xx', async () => {
    vi.resetModules();
    mockHttpRequest.mockReset();
    mockHttpsRequest.mockReset();
    mockSleep.mockReset();

    const originalExitCode = process.exitCode;
    const savedEnv = new Map<string, string | undefined>();
    for (const key of REQUIRED_ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
    }

    process.env.DD_SELF_UPDATE_FINALIZE_URL =
      'http://127.0.0.1:3000/api/v1/internal/self-update/finalize';
    process.env.DD_SELF_UPDATE_FINALIZE_SECRET = 'self-update-finalize-secret';
    process.env.DD_SELF_UPDATE_OPERATION_ID = 'op-123';
    process.env.DD_SELF_UPDATE_STATUS = 'succeeded';
    process.env.DD_SELF_UPDATE_PHASE = 'succeeded';
    delete process.env.DD_SELF_UPDATE_LAST_ERROR;
    process.env.DD_SELF_UPDATE_FINALIZE_TIMEOUT_MS = '150';
    process.env.DD_SELF_UPDATE_FINALIZE_RETRY_INTERVAL_MS = '1';

    mockSleep.mockResolvedValue(undefined);
    let now = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 100;
      return now;
    });

    mockHttpRequest.mockImplementation((options, callback) => {
      const response = {
        statusCode: undefined,
        resume: vi.fn(),
        once: vi.fn((event: string, handler: () => void) => {
          if (event === 'end') {
            queueMicrotask(() => handler());
          }
        }),
      };
      return {
        once: vi.fn(),
        write: vi.fn(),
        end: vi.fn(() => {
          callback(response);
        }),
      };
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;

    try {
      await import('./self-update-finalize-entrypoint.js?retry-failure-test');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockHttpRequest).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[self-update-finalize] callback failed: Finalize callback rejected with status 500',
        ),
      );
      expect(process.exitCode).toBe(1);
    } finally {
      nowSpy.mockRestore();
      errorSpy.mockRestore();
      process.exitCode = originalExitCode;
      for (const [key, value] of savedEnv.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test('reports missing required environment variables', async () => {
    vi.resetModules();
    mockHttpRequest.mockReset();
    mockHttpsRequest.mockReset();
    mockSleep.mockReset();

    const originalExitCode = process.exitCode;
    const savedEnv = new Map<string, string | undefined>();
    for (const key of REQUIRED_ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
    }

    process.env.DD_SELF_UPDATE_FINALIZE_URL =
      'http://127.0.0.1:3000/api/v1/internal/self-update/finalize';
    delete process.env.DD_SELF_UPDATE_FINALIZE_SECRET;
    process.env.DD_SELF_UPDATE_OPERATION_ID = 'op-123';
    process.env.DD_SELF_UPDATE_STATUS = 'succeeded';
    process.env.DD_SELF_UPDATE_PHASE = 'succeeded';
    delete process.env.DD_SELF_UPDATE_LAST_ERROR;
    process.env.DD_SELF_UPDATE_FINALIZE_TIMEOUT_MS = '1000';
    process.env.DD_SELF_UPDATE_FINALIZE_RETRY_INTERVAL_MS = '1';

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;

    try {
      await import('./self-update-finalize-entrypoint.js?missing-env-test');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockHttpRequest).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[self-update-finalize] callback failed: Missing required environment variable: DD_SELF_UPDATE_FINALIZE_SECRET',
        ),
      );
      expect(process.exitCode).toBe(1);
    } finally {
      errorSpy.mockRestore();
      process.exitCode = originalExitCode;
      for (const [key, value] of savedEnv.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test('includes lastError while omitting an empty phase in callback requests', async () => {
    vi.resetModules();
    mockHttpRequest.mockReset();
    mockHttpsRequest.mockReset();

    const originalExitCode = process.exitCode;
    const savedEnv = new Map<string, string | undefined>();
    for (const key of REQUIRED_ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
    }

    process.env.DD_SELF_UPDATE_FINALIZE_URL =
      'http://127.0.0.1:3000/api/v1/internal/self-update/finalize';
    process.env.DD_SELF_UPDATE_FINALIZE_SECRET = 'self-update-finalize-secret';
    process.env.DD_SELF_UPDATE_OPERATION_ID = 'op-123';
    process.env.DD_SELF_UPDATE_STATUS = 'failed';
    delete process.env.DD_SELF_UPDATE_PHASE;
    process.env.DD_SELF_UPDATE_LAST_ERROR = 'controller failure';
    process.env.DD_SELF_UPDATE_FINALIZE_TIMEOUT_MS = '1000';
    process.env.DD_SELF_UPDATE_FINALIZE_RETRY_INTERVAL_MS = '1';

    let capturedRequestOptions: Record<string, unknown> | undefined;
    let capturedRequestBody: string | undefined;
    mockHttpRequest.mockImplementation((options, callback) => {
      capturedRequestOptions = options as Record<string, unknown>;
      const response = {
        statusCode: 202,
        resume: vi.fn(),
        once: vi.fn((event: string, handler: () => void) => {
          if (event === 'end') {
            queueMicrotask(() => handler());
          }
        }),
      };
      return {
        once: vi.fn(),
        write: vi.fn((body: string) => {
          capturedRequestBody = body;
        }),
        end: vi.fn(() => {
          callback(response);
        }),
      };
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;

    try {
      await import('./self-update-finalize-entrypoint.js?last-error-test');
      await new Promise((resolve) => setImmediate(resolve));

      expect(
        (capturedRequestOptions?.headers as Record<string, string>)[
          SELF_UPDATE_FINALIZE_SECRET_HEADER
        ],
      ).toBe('self-update-finalize-secret');
      expect(capturedRequestOptions).toMatchObject({
        protocol: 'http:',
        hostname: '127.0.0.1',
        path: '/api/v1/internal/self-update/finalize',
      });
      expect(JSON.parse(capturedRequestBody || '')).toEqual({
        operationId: 'op-123',
        status: 'failed',
        lastError: 'controller failure',
      });
      expect(errorSpy).not.toHaveBeenCalled();
      expect(process.exitCode).not.toBe(1);
    } finally {
      errorSpy.mockRestore();
      process.exitCode = originalExitCode;
      for (const [key, value] of savedEnv.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test('throws a timeout when the finalize callback never gets a chance to succeed', async () => {
    vi.resetModules();
    mockHttpRequest.mockReset();
    mockHttpsRequest.mockReset();
    mockSleep.mockReset();

    const originalExitCode = process.exitCode;
    const savedEnv = new Map<string, string | undefined>();
    for (const key of REQUIRED_ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
    }

    process.env.DD_SELF_UPDATE_FINALIZE_URL =
      'http://127.0.0.1:3000/api/v1/internal/self-update/finalize';
    process.env.DD_SELF_UPDATE_FINALIZE_SECRET = 'self-update-finalize-secret';
    process.env.DD_SELF_UPDATE_OPERATION_ID = 'op-123';
    process.env.DD_SELF_UPDATE_STATUS = 'succeeded';
    process.env.DD_SELF_UPDATE_PHASE = 'succeeded';
    delete process.env.DD_SELF_UPDATE_LAST_ERROR;
    process.env.DD_SELF_UPDATE_FINALIZE_TIMEOUT_MS = '1000';
    process.env.DD_SELF_UPDATE_FINALIZE_RETRY_INTERVAL_MS = '1';

    mockSleep.mockResolvedValue(undefined);
    mockHttpRequest.mockImplementation((options, callback) => {
      const response = {
        statusCode: 202,
        resume: vi.fn(),
        once: vi.fn((event: string, handler: () => void) => {
          if (event === 'end') {
            queueMicrotask(() => handler());
          }
        }),
      };
      return {
        once: vi.fn(),
        write: vi.fn(),
        end: vi.fn(() => {
          callback(response);
        }),
      };
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;

    try {
      const module = await import('./self-update-finalize-entrypoint.js?timeout-direct-test');

      process.env.DD_SELF_UPDATE_FINALIZE_TIMEOUT_MS = '1';
      delete process.env.DD_SELF_UPDATE_PHASE;
      delete process.env.DD_SELF_UPDATE_LAST_ERROR;
      mockHttpRequest.mockReset();
      mockHttpsRequest.mockReset();
      let now = 0;
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
        now += 1000;
        return now;
      });

      await expect(module.runSelfUpdateFinalizeEntrypoint()).rejects.toThrow(
        'Timed out waiting for self-update finalize callback',
      );

      nowSpy.mockRestore();
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Missing required environment variable'),
      );
      expect(process.exitCode).not.toBe(1);
    } finally {
      errorSpy.mockRestore();
      process.exitCode = originalExitCode;
      for (const [key, value] of savedEnv.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
