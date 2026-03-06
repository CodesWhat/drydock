export function normalizeSeverity(value: unknown): string {
  if (typeof value !== 'string') {
    return 'UNKNOWN';
  }
  const normalized = value.toUpperCase();
  if (
    normalized === 'CRITICAL' ||
    normalized === 'HIGH' ||
    normalized === 'MEDIUM' ||
    normalized === 'LOW'
  ) {
    return normalized;
  }
  return 'UNKNOWN';
}
