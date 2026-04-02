import { formatLogTimestamp } from '@/utils/log-timestamp';

describe('formatLogTimestamp', () => {
  it('formats numeric and ISO string timestamps consistently', () => {
    const timestamp = Date.parse('2026-04-01T12:34:56.789Z');

    expect(formatLogTimestamp(timestamp)).toBe(formatLogTimestamp('2026-04-01T12:34:56.789Z'));
    expect(formatLogTimestamp(timestamp)).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]$/u);
  });

  it('returns a placeholder for invalid numeric, blank, and nullish timestamps', () => {
    expect(formatLogTimestamp(Number.POSITIVE_INFINITY)).toBe('-');
    expect(formatLogTimestamp(9e15)).toBe('-');
    expect(formatLogTimestamp('   ')).toBe('-');
    expect(formatLogTimestamp(undefined)).toBe('-');
    expect(formatLogTimestamp(null)).toBe('-');
  });

  it('returns trimmed non-date strings unchanged', () => {
    expect(formatLogTimestamp('  not-a-date  ')).toBe('not-a-date');
  });
});
