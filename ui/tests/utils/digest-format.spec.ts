import { formatShortDigest } from '@/utils/digest-format';

describe('formatShortDigest', () => {
  it('truncates a sha256: digest to first 12 hex chars with ellipsis', () => {
    const full = 'sha256:bcf6335aabbb1234567890abcdef1234567890abcdef1234567890abcdef12';
    expect(formatShortDigest(full)).toBe('sha256:bcf6335aabbb…');
  });

  it('truncates a digest without sha256: prefix to first 12 hex chars', () => {
    const hex = 'bcf6335aabbb1234567890abcdef1234567890abcdef1234567890abcdef12';
    expect(formatShortDigest(hex)).toBe('bcf6335aabbb…');
  });

  it('returns the input unchanged when hex part is exactly 12 chars', () => {
    expect(formatShortDigest('sha256:bcf6335aabbb')).toBe('sha256:bcf6335aabbb');
  });

  it('returns the input unchanged when hex part is shorter than 12 chars', () => {
    expect(formatShortDigest('sha256:short')).toBe('sha256:short');
  });

  it('returns the input unchanged when no prefix and shorter than 12 chars', () => {
    expect(formatShortDigest('abc123')).toBe('abc123');
  });

  it('handles a digest with exactly 12 hex chars (no prefix)', () => {
    expect(formatShortDigest('bcf6335aabbb')).toBe('bcf6335aabbb');
  });

  it('handles a 64-char hex (full sha256 without prefix)', () => {
    const hex = 'bcf6335aabbb1234567890abcdef1234567890abcdef1234567890abcdef1234';
    expect(formatShortDigest(hex)).toBe('bcf6335aabbb…');
  });
});
