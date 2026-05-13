/**
 * Tests for http-retry.ts withRetry helper.
 * RED phase: all tests will fail until withRetry is implemented.
 */

import { withRetry } from './http-retry.js';

// Fake AxiosError shape thrown by axios on non-2xx responses
function makeAxiosError(status: number, headers: Record<string, string> = {}) {
  const err = new Error(`Request failed with status code ${status}`) as Error & {
    response: { status: number; headers: Record<string, string> };
  };
  err.response = { status, headers };
  return err;
}

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('resolves immediately on first-try success', async () => {
    const request = vi.fn().mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const result = await withRetry(request);

    expect(result).toEqual({ status: 200, headers: {}, data: 'ok' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('retries on 429 and succeeds on second attempt', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': '0' }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'retried' });

    const promise = withRetry(request, { backoffBaseMs: 10 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toBe('retried');
    expect(request).toHaveBeenCalledTimes(2);
  });

  test('retries on 503 and succeeds on second attempt', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(503, { 'retry-after': '0' }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'recovered' });

    const promise = withRetry(request, { backoffBaseMs: 10 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toBe('recovered');
    expect(request).toHaveBeenCalledTimes(2);
  });

  test('does NOT retry on 400 (bad request)', async () => {
    const request = vi.fn().mockRejectedValueOnce(makeAxiosError(400));

    await expect(withRetry(request)).rejects.toThrow('status code 400');
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('does NOT retry on 401 (unauthorized)', async () => {
    const request = vi.fn().mockRejectedValueOnce(makeAxiosError(401));

    await expect(withRetry(request)).rejects.toThrow('status code 401');
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('does NOT retry on 403 (forbidden)', async () => {
    const request = vi.fn().mockRejectedValueOnce(makeAxiosError(403));

    await expect(withRetry(request)).rejects.toThrow('status code 403');
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('does NOT retry on 500 (server error not in retryable list)', async () => {
    const request = vi.fn().mockRejectedValueOnce(makeAxiosError(500));

    await expect(withRetry(request)).rejects.toThrow('status code 500');
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('throws after exhausting maxRetries (default 3)', async () => {
    const request = vi.fn().mockRejectedValue(makeAxiosError(429, { 'retry-after': '0' }));

    // Set up the expectation before advancing timers to avoid unhandled rejection
    const promise = withRetry(request, { backoffBaseMs: 10 });
    const expectation = expect(promise).rejects.toThrow('status code 429');
    await vi.runAllTimersAsync();
    await expectation;
    // 1 initial + 3 retries = 4 total calls
    expect(request).toHaveBeenCalledTimes(4);
  });

  test('uses Retry-After seconds header for delay', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': '5' }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'done' });

    const mockLogger = { debug: vi.fn() };

    const promise = withRetry(request, {
      backoffBaseMs: 1000,
      logger: mockLogger,
      requestLabel: 'test-url',
    });
    await vi.runAllTimersAsync();
    await promise;

    // Logger should have been called with the delay info
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('5000ms'));
  });

  test('uses Retry-After HTTP-date header for delay', async () => {
    // 10 seconds in the future
    const future = new Date(Date.now() + 10_000).toUTCString();
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': future }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'done' });

    const mockLogger = { debug: vi.fn() };

    const promise = withRetry(request, {
      backoffBaseMs: 100,
      logger: mockLogger,
      requestLabel: 'test-url',
    });
    await vi.runAllTimersAsync();
    await promise;

    // Logger should have been called mentioning a delay > 0ms
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringMatching(/\d+ms/));
  });

  test('clamps negative Retry-After HTTP-date to 0', async () => {
    // Date in the past
    const past = new Date(Date.now() - 5000).toUTCString();
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': past }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'done' });

    const mockLogger = { debug: vi.fn() };

    const promise = withRetry(request, {
      backoffBaseMs: 100,
      logger: mockLogger,
      requestLabel: 'test-url',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    // Should succeed and not throw (0ms delay is valid)
    expect(result.data).toBe('done');
    // Logged delay should be 0ms (clamped)
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('0ms'));
  });

  test('uses exponential backoff when Retry-After header is absent', async () => {
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'done' });

    const promise = withRetry(request, {
      backoffBaseMs: 100,
      backoffMaxMs: 60_000,
      logger: mockLogger,
      requestLabel: 'test-url',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toBe('done');
    // Two debug calls: attempt 1 (100ms) and attempt 2 (200ms)
    expect(mockLogger.debug).toHaveBeenCalledTimes(2);
    expect(mockLogger.debug).toHaveBeenNthCalledWith(1, expect.stringContaining('100ms'));
    expect(mockLogger.debug).toHaveBeenNthCalledWith(2, expect.stringContaining('200ms'));
  });

  test('caps exponential backoff at backoffMaxMs', async () => {
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'done' });

    const promise = withRetry(request, {
      maxRetries: 4,
      backoffBaseMs: 1000,
      backoffMaxMs: 1500,
      logger: mockLogger,
      requestLabel: 'test-url',
    });
    await vi.runAllTimersAsync();
    await promise;

    // Third attempt should be capped at backoffMaxMs (1500), not 4000
    expect(mockLogger.debug).toHaveBeenNthCalledWith(3, expect.stringContaining('1500ms'));
  });

  test('logs attempt number and status in debug message', async () => {
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const promise = withRetry(request, {
      backoffBaseMs: 10,
      logger: mockLogger,
      requestLabel: 'ghcr.io GET /v2/myimage/tags/list',
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('attempt 1/3'));
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('HTTP 429'));
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('ghcr.io GET /v2/myimage/tags/list'),
    );
  });

  test('does not retry non-AxiosError (no response property)', async () => {
    const networkErr = new Error('ECONNREFUSED');
    const request = vi.fn().mockRejectedValueOnce(networkErr);

    await expect(withRetry(request)).rejects.toThrow('ECONNREFUSED');
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('malformed Retry-After "not-a-date" falls back to exponential backoff', async () => {
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': 'not-a-date' }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const promise = withRetry(request, {
      backoffBaseMs: 100,
      logger: mockLogger,
      requestLabel: 'test',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toBe('ok');
    // Should have logged 100ms (attempt 0 backoff = 100 * 2^0 = 100)
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('100ms'));
  });

  test('malformed Retry-After "abc" falls back to exponential backoff', async () => {
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': 'abc' }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const promise = withRetry(request, {
      backoffBaseMs: 200,
      logger: mockLogger,
      requestLabel: 'test',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toBe('ok');
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('200ms'));
  });

  test('decimal Retry-After "1.5" falls back to exponential backoff (not parsed as date)', async () => {
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': '1.5' }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const promise = withRetry(request, {
      backoffBaseMs: 100,
      logger: mockLogger,
      requestLabel: 'test',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toBe('ok');
    // Backoff 100ms, not 1500ms
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('100ms'));
  });

  test('huge Retry-After "86400" is capped at backoffMaxMs', async () => {
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': '86400' }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const promise = withRetry(request, {
      backoffBaseMs: 1000,
      backoffMaxMs: 60_000,
      logger: mockLogger,
      requestLabel: 'test',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toBe('ok');
    // 86400 seconds = 86_400_000ms, capped to 60_000ms
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('60000ms'));
  });

  test('returns full envelope with status and headers on success', async () => {
    const request = vi.fn().mockResolvedValueOnce({
      status: 200,
      headers: { 'x-ratelimit-remaining': '99' },
      data: { val: 1 },
    });

    const result = await withRetry(request);

    expect(result.status).toBe(200);
    expect(result.headers['x-ratelimit-remaining']).toBe('99');
    expect(result.data).toEqual({ val: 1 });
  });

  test('throws lastError when maxRetries is negative (loop body never executes)', async () => {
    const request = vi.fn().mockRejectedValue(new Error('should not be called'));

    // maxRetries=-1 means the loop condition (0 <= -1) is false immediately,
    // so lastError stays undefined and the post-loop throw executes.
    await expect(withRetry(request, { maxRetries: -1 })).rejects.toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });
});
