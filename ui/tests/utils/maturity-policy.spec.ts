import {
  DEFAULT_MATURITY_MIN_AGE_DAYS,
  daysToMs,
  MS_PER_DAY,
  maturityMinAgeDaysToMilliseconds,
  normalizeMaturityMode,
  parseMaturityMinAgeDays,
  resolveMaturityClock,
  resolveMaturityMinAgeDays,
} from '@/utils/maturity-policy';

describe('maturity-policy utils', () => {
  it('normalizes supported maturity modes', () => {
    expect(normalizeMaturityMode('all')).toBe('all');
    expect(normalizeMaturityMode('  MATURE  ')).toBe('mature');
    expect(normalizeMaturityMode('unsupported')).toBeUndefined();
    expect(normalizeMaturityMode(42)).toBeUndefined();
  });

  it('parses valid maturity min-age values', () => {
    expect(parseMaturityMinAgeDays(1)).toBe(1);
    expect(parseMaturityMinAgeDays('365')).toBe(365);
  });

  it('rejects invalid maturity min-age values', () => {
    expect(parseMaturityMinAgeDays(0)).toBeUndefined();
    expect(parseMaturityMinAgeDays(366)).toBeUndefined();
    expect(parseMaturityMinAgeDays(7.5)).toBeUndefined();
    expect(parseMaturityMinAgeDays('not-a-number')).toBeUndefined();
  });

  it('resolves configured maturity min-age when valid', () => {
    expect(resolveMaturityMinAgeDays(10, 20)).toBe(10);
  });

  it('falls back to provided fallback when configured value is invalid', () => {
    expect(resolveMaturityMinAgeDays('invalid', 14)).toBe(14);
  });

  it('falls back to default when provided fallback is invalid', () => {
    expect(resolveMaturityMinAgeDays(undefined, 0)).toBe(DEFAULT_MATURITY_MIN_AGE_DAYS);
  });

  it('converts days to milliseconds consistently', () => {
    expect(daysToMs(2)).toBe(2 * MS_PER_DAY);
    expect(maturityMinAgeDaysToMilliseconds(3)).toBe(3 * MS_PER_DAY);
  });
});

describe('resolveMaturityClock', () => {
  const NOW = new Date('2026-04-23T12:00:00.000Z').getTime();

  it('returns startMs=undefined and source=undefined when nothing resolves', () => {
    expect(resolveMaturityClock({})).toEqual({ startMs: undefined, source: undefined });
    expect(resolveMaturityClock({ result: {} })).toEqual({
      startMs: undefined,
      source: undefined,
    });
  });

  it('prefers a trusted publishedAt over a later detectedAt', () => {
    const publishedAt = new Date(NOW - daysToMs(10)).toISOString();
    const detectedAt = new Date(NOW - daysToMs(5)).toISOString();
    expect(
      resolveMaturityClock(
        { updateDetectedAt: detectedAt, result: { publishedAt, publishedAtTrusted: true } },
        NOW,
      ),
    ).toEqual({ startMs: Date.parse(publishedAt), source: 'publishedAt' });
  });

  it('lets detectedAt win the tie-break when earlier than a trusted publishedAt', () => {
    const publishedAt = new Date(NOW - daysToMs(3)).toISOString();
    const detectedAt = new Date(NOW - daysToMs(5)).toISOString();
    expect(
      resolveMaturityClock(
        { updateDetectedAt: detectedAt, result: { publishedAt, publishedAtTrusted: true } },
        NOW,
      ),
    ).toEqual({ startMs: Date.parse(detectedAt), source: 'detectedAt' });
  });

  it('ignores an untrusted publishedAt in favor of detectedAt', () => {
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

  it('treats a trusted-but-absent publishedAt as unresolved', () => {
    expect(resolveMaturityClock({ result: { publishedAtTrusted: true } }, NOW)).toEqual({
      startMs: undefined,
      source: undefined,
    });
  });

  it('falls back to detectedAt when a trusted publishedAt fails to parse', () => {
    const detectedAt = new Date(NOW - daysToMs(5)).toISOString();
    expect(
      resolveMaturityClock(
        {
          updateDetectedAt: detectedAt,
          result: { publishedAt: 'not-a-date', publishedAtTrusted: true },
        },
        NOW,
      ),
    ).toEqual({ startMs: Date.parse(detectedAt), source: 'detectedAt' });
  });

  it('rejects a future publishedAt even when trusted, falling back to detectedAt', () => {
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

  it('resolves to nothing when a future publishedAt has no detectedAt to fall back to', () => {
    const futurePublishedAt = new Date(NOW + daysToMs(1)).toISOString();
    expect(
      resolveMaturityClock(
        { result: { publishedAt: futurePublishedAt, publishedAtTrusted: true } },
        NOW,
      ),
    ).toEqual({ startMs: undefined, source: undefined });
  });

  it('resolves a trusted publishedAt alone when detectedAt is missing', () => {
    const publishedAt = new Date(NOW - daysToMs(10)).toISOString();
    expect(
      resolveMaturityClock({ result: { publishedAt, publishedAtTrusted: true } }, NOW),
    ).toEqual({ startMs: Date.parse(publishedAt), source: 'publishedAt' });
  });

  it('defaults nowMs to Date.now() when omitted', () => {
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
});
