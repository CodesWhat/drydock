export type UsageThreshold = 'healthy' | 'warning' | 'critical';

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

export function getUsageThreshold(percent: number): UsageThreshold {
  if (!isFiniteNumber(percent)) {
    return 'healthy';
  }
  if (percent < 60) {
    return 'healthy';
  }
  if (percent <= 85) {
    return 'warning';
  }
  return 'critical';
}

export function getUsageThresholdColor(percent: number): string {
  const threshold = getUsageThreshold(percent);
  if (threshold === 'healthy') {
    return 'var(--dd-success)';
  }
  if (threshold === 'warning') {
    return 'var(--dd-warning)';
  }
  return 'var(--dd-danger)';
}

export function getUsageThresholdMutedColor(percent: number): string {
  const threshold = getUsageThreshold(percent);
  if (threshold === 'healthy') {
    return 'var(--dd-success-muted)';
  }
  if (threshold === 'warning') {
    return 'var(--dd-warning-muted)';
  }
  return 'var(--dd-danger-muted)';
}
