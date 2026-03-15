import {
  getUsageThreshold,
  getUsageThresholdColor,
  getUsageThresholdMutedColor,
} from '@/utils/stats-thresholds';

describe('stats-thresholds', () => {
  it('maps values below 60 to healthy', () => {
    expect(getUsageThreshold(0)).toBe('healthy');
    expect(getUsageThreshold(59.99)).toBe('healthy');
  });

  it('maps values in [60, 85] to warning', () => {
    expect(getUsageThreshold(60)).toBe('warning');
    expect(getUsageThreshold(85)).toBe('warning');
  });

  it('maps values above 85 to critical', () => {
    expect(getUsageThreshold(85.01)).toBe('critical');
    expect(getUsageThreshold(160)).toBe('critical');
  });

  it('treats non-finite values as healthy', () => {
    expect(getUsageThreshold(Number.NaN)).toBe('healthy');
    expect(getUsageThreshold(Number.POSITIVE_INFINITY)).toBe('healthy');
  });

  it('returns the expected semantic colors', () => {
    expect(getUsageThresholdColor(40)).toBe('var(--dd-success)');
    expect(getUsageThresholdColor(60)).toBe('var(--dd-warning)');
    expect(getUsageThresholdColor(86)).toBe('var(--dd-danger)');

    expect(getUsageThresholdMutedColor(40)).toBe('var(--dd-success-muted)');
    expect(getUsageThresholdMutedColor(60)).toBe('var(--dd-warning-muted)');
    expect(getUsageThresholdMutedColor(86)).toBe('var(--dd-danger-muted)');
  });
});
