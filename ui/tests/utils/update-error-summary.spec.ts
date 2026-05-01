import { resolveUpdateFailureReason, summariseUpdateError } from '@/utils/update-error-summary';

describe('summariseUpdateError', () => {
  it('returns undefined for empty / non-string input', () => {
    expect(summariseUpdateError(undefined)).toBeUndefined();
    expect(summariseUpdateError('')).toBeUndefined();
    expect(summariseUpdateError(null as unknown as string)).toBeUndefined();
    expect(summariseUpdateError(42 as unknown as string)).toBeUndefined();
  });

  it('classifies Docker Hub rate limit (HTTP 500 + "rate limit")', () => {
    expect(
      summariseUpdateError(
        '(HTTP code 500) server error - error from registry: You have reached your unauthenticated pull rate limit. https://www.docker.com/increase-rate-limit',
      ),
    ).toBe('Registry rate limit hit');
  });

  it('classifies registry "toomanyrequests" status', () => {
    expect(summariseUpdateError('toomanyrequests: rate exceeded')).toBe('Registry rate limit hit');
  });

  it('classifies HTTP 403 / denied / forbidden', () => {
    expect(summariseUpdateError('(HTTP code 403) unexpected - error from registry: denied')).toBe(
      'Registry access denied',
    );
    expect(summariseUpdateError('Forbidden')).toBe('Registry access denied');
  });

  it('classifies image-not-found cases', () => {
    expect(
      summariseUpdateError('(HTTP code 404) no such container - No such image: busybox:1.37.0'),
    ).toBe('Image not found');
    expect(summariseUpdateError('manifest unknown')).toBe('Image not found');
  });

  it('classifies HTTP 401 / unauthorized', () => {
    expect(summariseUpdateError('(HTTP code 401) unexpected - error: unauthorized')).toBe(
      'Registry authentication failed',
    );
    expect(summariseUpdateError('invalid_token')).toBe('Registry authentication failed');
    expect(summariseUpdateError('authentication required')).toBe('Registry authentication failed');
  });

  it('classifies network / connectivity errors', () => {
    expect(summariseUpdateError('connect ECONNREFUSED 1.2.3.4:443')).toBe('Registry unreachable');
    expect(summariseUpdateError('getaddrinfo ENOTFOUND registry.example.com')).toBe(
      'Registry unreachable',
    );
    expect(summariseUpdateError('connect ETIMEDOUT')).toBe('Registry unreachable');
    expect(summariseUpdateError('socket hang up')).toBe('Registry unreachable');
    expect(summariseUpdateError('read ECONNRESET')).toBe('Registry unreachable');
  });

  it('classifies operator cancellation', () => {
    expect(summariseUpdateError('Cancelled by operator')).toBe('Cancelled');
  });

  it('classifies security gate blocks', () => {
    expect(
      summariseUpdateError('Security scan blocked update (3 vulnerabilities matched ...)'),
    ).toBe('Blocked by security scan');
    expect(summariseUpdateError('cosign signature verification failed')).toBe(
      'Signature verification failed',
    );
  });

  it('returns undefined for unrecognised errors', () => {
    expect(summariseUpdateError('something weird happened')).toBeUndefined();
    expect(summariseUpdateError('disk full')).toBeUndefined();
  });
});

describe('resolveUpdateFailureReason', () => {
  it('prefers the friendly summarised label when the raw error matches a pattern', () => {
    expect(
      resolveUpdateFailureReason({
        lastError: '(HTTP code 401) unauthorized',
        rollbackReason: 'health_gate_failed',
      }),
    ).toBe('Registry authentication failed');
  });

  it('falls back to humanised rollbackReason when the summariser does not match', () => {
    expect(
      resolveUpdateFailureReason({
        lastError: 'container exited with code 137',
        rollbackReason: 'health_gate_failed',
      }),
    ).toBe('health gate failed');
    expect(
      resolveUpdateFailureReason({
        lastError: undefined,
        rollbackReason: 'start_new_failed',
      }),
    ).toBe('start new failed');
  });

  it('falls back to the raw lastError when nothing else is available and the message is short', () => {
    expect(resolveUpdateFailureReason({ lastError: 'disk full' })).toBe('disk full');
  });

  it('does not surface excessively long raw lastError strings', () => {
    const longError = 'x'.repeat(121);
    expect(resolveUpdateFailureReason({ lastError: longError })).toBeUndefined();
  });

  it('returns undefined when no signal is provided', () => {
    expect(resolveUpdateFailureReason({})).toBeUndefined();
    expect(resolveUpdateFailureReason({ lastError: '', rollbackReason: '   ' })).toBeUndefined();
  });

  it('treats whitespace-only rollbackReason as missing', () => {
    expect(resolveUpdateFailureReason({ lastError: 'disk full', rollbackReason: '   ' })).toBe(
      'disk full',
    );
  });
});
