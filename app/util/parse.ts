export function toPositiveInteger(rawValue: unknown, fallbackValue: number): number {
  const normalizedValue = String(rawValue ?? '').trim();
  if (!/^\d+$/.test(normalizedValue)) {
    return fallbackValue;
  }
  const parsedValue = Number.parseInt(normalizedValue, 10);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    return fallbackValue;
  }
  return parsedValue;
}
