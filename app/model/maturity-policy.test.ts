import { describe, expect, test } from 'vitest';
import {
  DEFAULT_MATURITY_MIN_AGE_DAYS,
  daysToMs,
  getMaturityStartMs,
  MATURITY_MIN_AGE_DAYS_MAX,
  MATURITY_MIN_AGE_DAYS_MIN,
  MS_PER_DAY,
  maturityMinAgeDaysToMilliseconds,
  normalizeMaturityMode,
  parseMaturityMinAgeDays,
  resolveMaturityClock,
  resolveMaturityMinAgeDays,
} from './maturity-policy.js';

describe('model/maturity-policy', () => {
  test('exports canonical maturity bounds and defaults', () => {
    expect(DEFAULT_MATURITY_MIN_AGE_DAYS).toBe(7);
    expect(MATURITY_MIN_AGE_DAYS_MIN).toBe(1);
    expect(MATURITY_MIN_AGE_DAYS_MAX).toBe(365);
  });

  test('exports day-millisecond helpers', () => {
    expect(MS_PER_DAY).toBe(86_400_000);
    expect(daysToMs(1)).toBe(86_400_000);
    expect(daysToMs(7)).toBe(604_800_000);
    expect(maturityMinAgeDaysToMilliseconds(7)).toBe(604_800_000);
  });

  test.each([
    [1, 1],
    [7, 7],
    [365, 365],
    ['21', 21],
    [0, undefined],
    [366, undefined],
    [3.5, undefined],
    [Number.NaN, undefined],
    [Number.POSITIVE_INFINITY, undefined],
    [undefined, undefined],
  ])('parses maturity min age days (%s)', (value, expected) => {
    expect(parseMaturityMinAgeDays(value)).toBe(expected);
  });

  test('resolves invalid values to a valid fallback default', () => {
    expect(resolveMaturityMinAgeDays(undefined)).toBe(DEFAULT_MATURITY_MIN_AGE_DAYS);
    expect(resolveMaturityMinAgeDays(366)).toBe(DEFAULT_MATURITY_MIN_AGE_DAYS);
    expect(resolveMaturityMinAgeDays(0, 21)).toBe(21);
    expect(resolveMaturityMinAgeDays(0, 999)).toBe(DEFAULT_MATURITY_MIN_AGE_DAYS);
  });

  test.each([
    ['all', 'all'],
    ['mature', 'mature'],
    ['  ALL ', 'all'],
    [' Mature ', 'mature'],
    ['fresh', undefined],
    [undefined, undefined],
  ])('normalizes maturity modes (%s)', (value, expected) => {
    expect(normalizeMaturityMode(value)).toBe(expected);
  });
});

describe('getMaturityStartMs', () => {
  const NOW = new Date('2026-04-23T12:00:00.000Z').getTime();

  test('returns undefined when both updateDetectedAt and publishedAt are missing', () => {
    expect(getMaturityStartMs({})).toBeUndefined();
    expect(getMaturityStartMs({ result: {} })).toBeUndefined();
  });

  test('returns detectedAt when publishedAtTrusted is false or absent', () => {
    const detectedAt = new Date(NOW - daysToMs(5)).toISOString();
    expect(getMaturityStartMs({ updateDetectedAt: detectedAt })).toBe(Date.parse(detectedAt));

    expect(
      getMaturityStartMs({
        updateDetectedAt: detectedAt,
        result: {
          publishedAt: new Date(NOW - daysToMs(10)).toISOString(),
          publishedAtTrusted: false,
        },
      }),
    ).toBe(Date.parse(detectedAt));

    expect(
      getMaturityStartMs({
        updateDetectedAt: detectedAt,
        result: { publishedAt: new Date(NOW - daysToMs(10)).toISOString() },
      }),
    ).toBe(Date.parse(detectedAt));
  });

  test('returns publishedAt when trusted and earlier than detectedAt', () => {
    const publishedAt = new Date(NOW - daysToMs(10)).toISOString();
    const detectedAt = new Date(NOW - daysToMs(5)).toISOString();
    const result = getMaturityStartMs({
      updateDetectedAt: detectedAt,
      result: { publishedAt, publishedAtTrusted: true },
    });
    expect(result).toBe(Date.parse(publishedAt));
  });

  test('returns detectedAt when trusted publishedAt is later than detectedAt', () => {
    const publishedAt = new Date(NOW - daysToMs(3)).toISOString();
    const detectedAt = new Date(NOW - daysToMs(5)).toISOString();
    const result = getMaturityStartMs({
      updateDetectedAt: detectedAt,
      result: { publishedAt, publishedAtTrusted: true },
    });
    expect(result).toBe(Date.parse(detectedAt));
  });

  test('clamps future publishedAt and falls back to detectedAt', () => {
    const futurePublishedAt = new Date(NOW + daysToMs(1)).toISOString();
    const detectedAt = new Date(NOW - daysToMs(5)).toISOString();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const result = getMaturityStartMs({
        updateDetectedAt: detectedAt,
        result: { publishedAt: futurePublishedAt, publishedAtTrusted: true },
      });
      expect(result).toBe(Date.parse(detectedAt));
    } finally {
      vi.useRealTimers();
    }
  });

  test('returns trusted publishedAt when detectedAt is missing', () => {
    const publishedAt = new Date(NOW - daysToMs(10)).toISOString();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const result = getMaturityStartMs({
        result: { publishedAt, publishedAtTrusted: true },
      });
      expect(result).toBe(Date.parse(publishedAt));
    } finally {
      vi.useRealTimers();
    }
  });

  test('falls back to detectedAt when publishedAtTrusted is true but publishedAt is absent', () => {
    const detectedAt = new Date(NOW - daysToMs(5)).toISOString();
    const result = getMaturityStartMs({
      updateDetectedAt: detectedAt,
      result: { publishedAtTrusted: true }, // no publishedAt → || '' → NaN → falls back
    });
    expect(result).toBe(Date.parse(detectedAt));
  });

  test('returns undefined when only trusted publishedAt is future and detectedAt is missing', () => {
    const futurePublishedAt = new Date(NOW + daysToMs(1)).toISOString();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const result = getMaturityStartMs({
        result: { publishedAt: futurePublishedAt, publishedAtTrusted: true },
      });
      expect(result).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('injectable nowMs governs future-date guard without fake timers', () => {
    const pastNow = new Date('2026-01-01T00:00:00.000Z').getTime();
    // publishedAt is in the future relative to pastNow → rejected → falls back to detectedAt
    const futurePublishedAt = new Date('2026-06-01T00:00:00.000Z').toISOString();
    const detectedAt = new Date('2025-12-01T00:00:00.000Z').toISOString();
    expect(
      getMaturityStartMs(
        {
          updateDetectedAt: detectedAt,
          result: { publishedAt: futurePublishedAt, publishedAtTrusted: true },
        },
        pastNow,
      ),
    ).toBe(Date.parse(detectedAt));

    // Default-arg path: with real Date.now() a past publishedAt is accepted
    const pastPublishedAt = new Date(Date.now() - daysToMs(5)).toISOString();
    expect(
      getMaturityStartMs({ result: { publishedAt: pastPublishedAt, publishedAtTrusted: true } }),
    ).toBe(Date.parse(pastPublishedAt));
  });
});

describe('resolveMaturityClock', () => {
  const NOW = new Date('2026-04-23T12:00:00.000Z').getTime();

  test('returns startMs=undefined and source=undefined when nothing resolves', () => {
    expect(resolveMaturityClock({})).toEqual({ startMs: undefined, source: undefined });
    expect(resolveMaturityClock({ result: {} })).toEqual({
      startMs: undefined,
      source: undefined,
    });
  });

  test('trusted publishedAt wins over a later detectedAt', () => {
    const publishedAt = new Date(NOW - daysToMs(10)).toISOString();
    const detectedAt = new Date(NOW - daysToMs(5)).toISOString();
    expect(
      resolveMaturityClock(
        { updateDetectedAt: detectedAt, result: { publishedAt, publishedAtTrusted: true } },
        NOW,
      ),
    ).toEqual({ startMs: Date.parse(publishedAt), source: 'publishedAt' });
  });

  test('detectedAt wins the tie-break when it is earlier than trusted publishedAt', () => {
    const publishedAt = new Date(NOW - daysToMs(3)).toISOString();
    const detectedAt = new Date(NOW - daysToMs(5)).toISOString();
    expect(
      resolveMaturityClock(
        { updateDetectedAt: detectedAt, result: { publishedAt, publishedAtTrusted: true } },
        NOW,
      ),
    ).toEqual({ startMs: Date.parse(detectedAt), source: 'detectedAt' });
  });

  test('untrusted publishedAt is ignored in favor of detectedAt', () => {
    const publishedAt = new Date(NOW - daysToMs(10)).toISOString();
    const detectedAt = new Date(NOW - daysToMs(5)).toISOString();
    expect(
      resolveMaturityClock(
        { updateDetectedAt: detectedAt, result: { publishedAt, publishedAtTrusted: false } },
        NOW,
      ),
    ).toEqual({ startMs: Date.parse(detectedAt), source: 'detectedAt' });
    expect(
      resolveMaturityClock({ updateDetectedAt: detectedAt, result: { publishedAt } }, NOW),
    ).toEqual({ startMs: Date.parse(detectedAt), source: 'detectedAt' });
  });

  test('future publishedAt is rejected even when trusted, falling back to detectedAt', () => {
    const futurePublishedAt = new Date(NOW + daysToMs(1)).toISOString();
    const detectedAt = new Date(NOW - daysToMs(5)).toISOString();
    expect(
      resolveMaturityClock(
        {
          updateDetectedAt: detectedAt,
          result: { publishedAt: futurePublishedAt, publishedAtTrusted: true },
        },
        NOW,
      ),
    ).toEqual({ startMs: Date.parse(detectedAt), source: 'detectedAt' });
  });

  test('future publishedAt with no detectedAt resolves to nothing', () => {
    const futurePublishedAt = new Date(NOW + daysToMs(1)).toISOString();
    expect(
      resolveMaturityClock(
        { result: { publishedAt: futurePublishedAt, publishedAtTrusted: true } },
        NOW,
      ),
    ).toEqual({ startMs: undefined, source: undefined });
  });

  test('trusted publishedAt alone resolves when detectedAt is missing', () => {
    const publishedAt = new Date(NOW - daysToMs(10)).toISOString();
    expect(
      resolveMaturityClock({ result: { publishedAt, publishedAtTrusted: true } }, NOW),
    ).toEqual({ startMs: Date.parse(publishedAt), source: 'publishedAt' });
  });

  test('defaults nowMs to Date.now() when omitted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const detectedAt = new Date(NOW - daysToMs(5)).toISOString();
      expect(resolveMaturityClock({ updateDetectedAt: detectedAt })).toEqual({
        startMs: Date.parse(detectedAt),
        source: 'detectedAt',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test('getMaturityStartMs is a thin wrapper returning resolveMaturityClock().startMs', () => {
    const scenarios: Array<{
      updateDetectedAt?: string;
      result?: { publishedAt?: string; publishedAtTrusted?: boolean };
    }> = [
      {},
      { updateDetectedAt: new Date(NOW - daysToMs(5)).toISOString() },
      {
        updateDetectedAt: new Date(NOW - daysToMs(5)).toISOString(),
        result: {
          publishedAt: new Date(NOW - daysToMs(10)).toISOString(),
          publishedAtTrusted: true,
        },
      },
      {
        updateDetectedAt: new Date(NOW - daysToMs(5)).toISOString(),
        result: {
          publishedAt: new Date(NOW - daysToMs(3)).toISOString(),
          publishedAtTrusted: true,
        },
      },
    ];
    for (const scenario of scenarios) {
      expect(getMaturityStartMs(scenario, NOW)).toBe(resolveMaturityClock(scenario, NOW).startMs);
    }
  });
});
