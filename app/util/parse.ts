export function toPositiveInteger(rawValue: unknown, fallbackValue: number): number {
  const parsedValue = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallbackValue;
  }
  return parsedValue;
}
