import { buildSparklinePoints } from '@/utils/stats-sparkline';

describe('stats-sparkline', () => {
  it('returns an empty string for empty values', () => {
    expect(buildSparklinePoints([], 120, 32)).toBe('');
  });

  it('builds normalized points for ascending values', () => {
    expect(buildSparklinePoints([0, 50, 100], 100, 20)).toBe('0,20 50,10 100,0');
  });

  it('builds a centerline for flat values', () => {
    expect(buildSparklinePoints([5, 5, 5], 60, 12)).toBe('0,6 30,6 60,6');
  });

  it('builds a single centered point for one flat value', () => {
    expect(buildSparklinePoints([5], 60, 12)).toBe('0,6');
  });

  it('coerces invalid values to zero before plotting', () => {
    expect(buildSparklinePoints([1, Number.NaN, Number.POSITIVE_INFINITY], 100, 20)).toBe(
      '0,0 50,20 100,20',
    );
  });
});
