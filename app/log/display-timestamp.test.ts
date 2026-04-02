import type { LogEntry } from './buffer.js';
import { formatLogDisplayTimestamp, toDisplayLogEntry } from './display-timestamp.js';

describe('display timestamp formatting', () => {
  test('formats numeric and ISO string timestamps consistently', () => {
    const timestamp = Date.parse('2026-04-01T12:34:56.789Z');

    expect(formatLogDisplayTimestamp(timestamp)).toBe(
      formatLogDisplayTimestamp('2026-04-01T12:34:56.789Z'),
    );
    expect(formatLogDisplayTimestamp(timestamp)).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]$/u);
  });

  test('returns a placeholder for invalid numeric, blank, and nullish timestamps', () => {
    expect(formatLogDisplayTimestamp(Number.POSITIVE_INFINITY)).toBe('-');
    expect(formatLogDisplayTimestamp(9e15)).toBe('-');
    expect(formatLogDisplayTimestamp('   ')).toBe('-');
    expect(formatLogDisplayTimestamp(undefined)).toBe('-');
    expect(formatLogDisplayTimestamp(null)).toBe('-');
  });

  test('returns trimmed non-date strings unchanged', () => {
    expect(formatLogDisplayTimestamp('  not-a-date  ')).toBe('not-a-date');
  });

  test('adds a formatted display timestamp to log entries', () => {
    const entry: LogEntry = {
      timestamp: Date.parse('2026-04-01T12:34:56.789Z'),
      level: 'info',
      component: 'test',
      msg: 'hello',
    };

    expect(toDisplayLogEntry(entry)).toEqual({
      ...entry,
      displayTimestamp: expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]$/u),
    });
  });
});
