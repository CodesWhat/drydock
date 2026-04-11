import { describe, expect, test, vi } from 'vitest';
import { SELF_UPDATE_FINALIZE_SECRET_HEADER } from '../../../api/internal-self-update.js';

const mockHttpRequest = vi.hoisted(() => vi.fn());
const mockHttpsRequest = vi.hoisted(() => vi.fn());

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
});
