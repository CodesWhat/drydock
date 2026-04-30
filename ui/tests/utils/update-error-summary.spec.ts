import { summariseUpdateError } from '@/utils/update-error-summary';

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
