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
    // 10 seconds in the future — should produce ~10_000ms delay, not the backoff (100ms)
    const future = new Date(Date.now() + 10_000).toUTCString();
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': future }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'done' });

    const mockLogger = { debug: vi.fn() };

    const promise = withRetry(request, {
      backoffBaseMs: 100,
      backoffMaxMs: 60_000,
      logger: mockLogger,
      requestLabel: 'test-url',
    });
    await vi.runAllTimersAsync();
    await promise;

    // The delay should be derived from the HTTP-date header (~10_000ms),
    // NOT from exponential backoff (100ms). Assert delay is well above backoff.
    const call = mockLogger.debug.mock.calls[0][0] as string;
    const match = call.match(/(\d+)ms/);
    expect(match).not.toBeNull();
    const delayMs = Number.parseInt(match![1], 10);
    // Must be at least 5 seconds (parsed from header), never just 100ms backoff
    expect(delayMs).toBeGreaterThan(5_000);
    expect(delayMs).toBeLessThanOrEqual(60_000);
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

  test('Retry-After with comma/space that is not a valid date falls back to exponential backoff', async () => {
    // The string ", garbage" passes the /[, ]/ regex check but Date.parse returns NaN,
    // so parseRetryAfterMs returns undefined and the caller falls back to backoff delay.
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': ', garbage' }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const promise = withRetry(request, {
      backoffBaseMs: 100,
      logger: mockLogger,
      requestLabel: 'test',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toBe('ok');
    // Falls back to exponential backoff: 100 * 2^0 = 100ms
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('100ms'));
  });

  // ── isAxiosError guard: non-Axios errors are rethrown immediately ──────────

  test('non-Axios error with no response property is thrown immediately without retry', async () => {
    // Kills: LogicalOperator && -> || mutant and ConditionalExpression true on isAxiosError
    const nonAxiosErr = new Error('network failure');
    // Explicitly has NO .response property
    const request = vi.fn().mockRejectedValueOnce(nonAxiosErr);

    await expect(withRetry(request)).rejects.toBe(nonAxiosErr);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('error with null response is treated as non-Axios and thrown immediately', async () => {
    // Kills: ConditionalExpression true guards inside isAxiosError (lines 35,37,38)
    const errWithNullResponse = new Error('null response') as Error & { response: null };
    errWithNullResponse.response = null;
    const request = vi.fn().mockRejectedValueOnce(errWithNullResponse);

    await expect(withRetry(request)).rejects.toBe(errWithNullResponse);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('error with non-object response property is treated as non-Axios and thrown immediately', async () => {
    // Kills: typeof response === 'object' checks (lines 37-38)
    const errWithStringResponse = new Error('string response') as Error & { response: string };
    (errWithStringResponse as any).response = 'not-an-object';
    const request = vi.fn().mockRejectedValueOnce(errWithStringResponse);

    await expect(withRetry(request)).rejects.toBe(errWithStringResponse);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('null error is thrown immediately without retry (not an object)', async () => {
    // Kills: typeof err === 'object' && err !== null short-circuit mutations
    const request = vi.fn().mockRejectedValueOnce(null);

    await expect(withRetry(request)).rejects.toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  // ── parseRetryAfterMs: exact values tested ─────────────────────────────────

  test('Retry-After integer header "30" gives exactly 30000ms delay', async () => {
    // Kills: BlockStatement {} mutant at line 56:29 (the parseInt+*1000 path)
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': '30' }))
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
    // 30 seconds = 30_000ms; capped at 60_000
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('30000ms'));
  });

  test('Retry-After with leading/trailing whitespace is trimmed before parsing', async () => {
    // Kills: [MethodExpression] headerValue (trim() removed) at line 47
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': '  10  ' }))
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
    // "  10  ".trim() = "10" → 10s = 10000ms
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('10000ms'));
  });

  test('Retry-After HTTP-date: returned delay is parsed - Date.now(), not parsed + Date.now()', async () => {
    // Kills: ArithmeticOperator parsed + Date.now() mutant at line 59:26
    // A date 20 seconds in the future should give ~20_000ms delay, not 2*timestamp + 20_000ms
    // With fake timers, Date.now() returns a fixed fake time T.
    // correct: parsed(T+20000) - T = 20000
    // mutant:  parsed(T+20000) + T = 2T + 20000 → capped at backoffMaxMs = 60_000
    // So correct gives 20_000ms, mutant gives 60_000ms. We assert delay < 60_000.
    const future = new Date(Date.now() + 20_000).toUTCString();
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': future }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const promise = withRetry(request, {
      backoffBaseMs: 100,
      backoffMaxMs: 60_000,
      logger: mockLogger,
      requestLabel: 'test',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toBe('ok');
    // With correct code: delay = 20_000ms (strictly less than backoffMaxMs = 60_000)
    // With mutant (+): delay = 2*fakeTime + 20_000 → capped to 60_000ms
    const call = mockLogger.debug.mock.calls[0][0] as string;
    const match = call.match(/(\d+)ms/);
    expect(match).not.toBeNull();
    const delayMs = Number.parseInt(match![1], 10);
    expect(delayMs).toBeGreaterThanOrEqual(15_000); // must be close to 20_000
    expect(delayMs).toBeLessThan(60_000); // must NOT be capped at backoffMaxMs
  });

  // ── requestLabel default value ─────────────────────────────────────────────

  test('log message uses "Retrying request" when requestLabel is empty (default)', async () => {
    // Kills: StringLiteral "" mutants at lines 80:20 and 115:65
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const promise = withRetry(request, {
      backoffBaseMs: 10,
      logger: mockLogger,
      // No requestLabel — uses the default ''
    });
    await vi.runAllTimersAsync();
    await promise;

    // When requestLabel is '' the label should be 'Retrying request' not 'Retrying '
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Retrying request'));
  });

  test('log message uses "Retrying <label>" when requestLabel is provided', async () => {
    // Counter-test: with a label, the message starts with "Retrying <label>"
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const promise = withRetry(request, {
      backoffBaseMs: 10,
      logger: mockLogger,
      requestLabel: 'my-registry GET /v2/img/tags/list',
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Retrying my-registry GET /v2/img/tags/list'),
    );
    // Must NOT contain the fallback "Retrying request" substring
    expect(mockLogger.debug).not.toHaveBeenCalledWith(expect.stringContaining('Retrying request'));
  });

  // ── attempt >= maxRetries exhaustion ──────────────────────────────────────

  test('exhausts exactly maxRetries=1 (throws after 2 calls total)', async () => {
    // Kills: EqualityOperator attempt > maxRetries mutant at line 104:11
    // With maxRetries=1, attempt 0 retries, attempt 1 should throw (not retry again)
    const request = vi.fn().mockRejectedValue(makeAxiosError(429, { 'retry-after': '0' }));

    const promise = withRetry(request, { maxRetries: 1, backoffBaseMs: 10 });
    const expectation = expect(promise).rejects.toThrow('status code 429');
    await vi.runAllTimersAsync();
    await expectation;

    // 1 initial + 1 retry = 2 total (not 3)
    expect(request).toHaveBeenCalledTimes(2);
  });

  test('attempt === maxRetries throws immediately without sleeping', async () => {
    // When attempt equals maxRetries exactly, we should throw — not sleep again
    const mockLogger = { debug: vi.fn() };
    const request = vi.fn().mockRejectedValue(makeAxiosError(429));

    const promise = withRetry(request, { maxRetries: 2, backoffBaseMs: 10, logger: mockLogger });
    const expectation = expect(promise).rejects.toThrow('status code 429');
    await vi.runAllTimersAsync();
    await expectation;

    // 1 initial + 2 retries = 3 total; only 2 debug logs (not 3)
    expect(request).toHaveBeenCalledTimes(3);
    expect(mockLogger.debug).toHaveBeenCalledTimes(2);
  });

  // ── optional chaining on headers ──────────────────────────────────────────

  test('missing headers on err.response does not crash (optional chaining on headers)', async () => {
    // Kills: [OptionalChaining] err.response.headers mutant at line 110:32
    // Craft an error where response has no headers property
    const errNoHeaders = new Error('Request failed with status code 429') as Error & {
      response: { status: number };
    };
    errNoHeaders.response = { status: 429 };

    const request = vi
      .fn()
      .mockRejectedValueOnce(errNoHeaders)
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const mockLogger = { debug: vi.fn() };
    const promise = withRetry(request, {
      backoffBaseMs: 100,
      logger: mockLogger,
      requestLabel: 'test',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    // Should not throw — missing headers falls back to backoff
    expect(result.data).toBe('ok');
    // Backoff was used: 100 * 2^0 = 100ms
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('100ms'));
  });

  // ── retryPredicate option ─────────────────────────────────────────────────

  test('retryPredicate: retries a status not in retryableStatuses when predicate returns true', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(403, { 'retry-after': '0' }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const mockLogger = { debug: vi.fn() };
    const predicate = vi.fn().mockReturnValue(true);

    const promise = withRetry(request, {
      retryableStatuses: [429, 503],
      retryPredicate: predicate,
      backoffBaseMs: 10,
      logger: mockLogger,
      requestLabel: 'test',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toBe('ok');
    expect(request).toHaveBeenCalledTimes(2);
    expect(predicate).toHaveBeenCalled();
  });

  test('retryPredicate: does NOT retry when predicate returns false for non-retryable status', async () => {
    const request = vi.fn().mockRejectedValueOnce(makeAxiosError(403, {}));
    const predicate = vi.fn().mockReturnValue(false);

    await expect(
      withRetry(request, {
        retryableStatuses: [429, 503],
        retryPredicate: predicate,
        backoffBaseMs: 10,
      }),
    ).rejects.toThrow('status code 403');

    expect(request).toHaveBeenCalledTimes(1);
    expect(predicate).toHaveBeenCalled();
  });

  test('retryPredicate is not called when status is already in retryableStatuses', async () => {
    // 429 is in retryableStatuses — predicate should not be needed (status check short-circuits)
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const predicate = vi.fn().mockReturnValue(false);

    const promise = withRetry(request, {
      retryableStatuses: [429, 503],
      retryPredicate: predicate,
      backoffBaseMs: 10,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toBe('ok');
    // Predicate was not called because retryableStatuses already matched
    expect(predicate).not.toHaveBeenCalled();
  });

  test('retryPredicate omitted: behavior is unchanged for existing callers', async () => {
    // Without retryPredicate, a 403 should still throw immediately
    const request = vi.fn().mockRejectedValueOnce(makeAxiosError(403));

    await expect(withRetry(request, { retryableStatuses: [429, 503] })).rejects.toThrow(
      'status code 403',
    );

    expect(request).toHaveBeenCalledTimes(1);
  });

  // ── retryDelayMs option ───────────────────────────────────────────────────

  test('retryDelayMs: overrides the delay when it returns a value', async () => {
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(403, { 'retry-after': '0' }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const promise = withRetry(request, {
      retryableStatuses: [429, 503],
      retryPredicate: () => true,
      retryDelayMs: () => 5000,
      backoffBaseMs: 100,
      logger: mockLogger,
      requestLabel: 'test',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toBe('ok');
    // Custom delay 5000ms was used (not backoff 100ms, not retry-after 0ms)
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('5000ms'));
  });

  test('retryDelayMs: falls back to Retry-After header when it returns undefined', async () => {
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': '7' }))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const promise = withRetry(request, {
      retryableStatuses: [429, 503],
      retryDelayMs: () => undefined,
      backoffBaseMs: 100,
      logger: mockLogger,
      requestLabel: 'test',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toBe('ok');
    // retryDelayMs returned undefined → falls through to retry-after header: 7s = 7000ms
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('7000ms'));
  });

  test('retryDelayMs: falls back to exponential backoff when it returns undefined and no header', async () => {
    const mockLogger = { debug: vi.fn() };
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' });

    const promise = withRetry(request, {
      retryableStatuses: [429, 503],
      retryDelayMs: () => undefined,
      backoffBaseMs: 200,
      logger: mockLogger,
      requestLabel: 'test',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toBe('ok');
    // No override, no header → exponential backoff: 200 * 2^0 = 200ms
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('200ms'));
  });
});
