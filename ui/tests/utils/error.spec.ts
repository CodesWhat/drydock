import { ApiError, errorMessage } from '@/utils/error';

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
});
