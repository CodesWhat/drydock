export function getPathParamValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] || '';
  }
  return value || '';
}

export function parseIntegerQueryParam(rawValue: unknown, fallback: number): number {
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof value !== 'string') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseBooleanQueryParam(rawValue: unknown, fallback: boolean): boolean {
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof value !== 'string') {
    return fallback;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return fallback;
}
