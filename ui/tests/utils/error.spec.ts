import {
  ApiError,
  errorMessage,
  errorMessageEquals,
  isNoUpdateAvailableError,
} from '@/utils/error';

describe('error utils', () => {
  it('constructs ApiError with message, status, and name', () => {
    const error = new ApiError('Forbidden', 403);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.message).toBe('Forbidden');
    expect(error.status).toBe(403);
  });

  it('extracts messages from known error shapes with fallback for unknown', () => {
    expect(errorMessage(new Error('disk full'))).toBe('disk full');
    expect(errorMessage('plain failure')).toBe('plain failure');
    expect(errorMessage({ code: 'E_UNKNOWN' }, 'Default message')).toBe('Default message');
  });

  it('matches exact error messages after normalization', () => {
    expect(
      errorMessageEquals(
        new Error('No update available for this container'),
        'No update available for this container',
      ),
    ).toBe(true);
    expect(
      errorMessageEquals(
        new Error('  No update available for this container  '),
        'No update available for this container',
      ),
    ).toBe(true);
    expect(
      errorMessageEquals(
        new Error('Proxy error: No update available for this container'),
        'No update available for this container',
      ),
    ).toBe(false);
  });

  it('identifies the no-update error without treating nullish or opaque values as stale', () => {
    expect(isNoUpdateAvailableError(new Error('No update available for this container'))).toBe(
      true,
    );
    expect(isNoUpdateAvailableError('No update available for this container')).toBe(true);
    expect(isNoUpdateAvailableError(null)).toBe(false);
    expect(isNoUpdateAvailableError(undefined)).toBe(false);
    expect(isNoUpdateAvailableError({ code: 'E_UNKNOWN' })).toBe(false);
  });
});
