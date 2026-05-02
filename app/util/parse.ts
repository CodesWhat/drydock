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

export function parseEnvNonNegativeInteger(
  rawValue: string | undefined,
  envName: string,
): number | undefined {
  if (rawValue === undefined || rawValue.trim() === '') {
    return undefined;
  }

  const normalizedValue = rawValue.trim();
  if (!/^\d+$/.test(normalizedValue)) {
    throw new Error(`${envName} must be a non-negative integer (got "${rawValue}")`);
  }

  const parsedValue = Number.parseInt(normalizedValue, 10);
  if (!Number.isSafeInteger(parsedValue)) {
    throw new Error(`${envName} must be a non-negative integer (got "${rawValue}")`);
  }

  return parsedValue;
}
