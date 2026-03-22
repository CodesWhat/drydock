export function getFirstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        return item.trim();
      }
    }
    return undefined;
  }
  return typeof value === 'string' ? value.trim() : undefined;
}

export function getFirstNonEmptyQueryValue(value: unknown): string | undefined {
  const queryValue = getFirstQueryValue(value);
  if (!queryValue || queryValue.length === 0) {
    return undefined;
  }
  return queryValue;
}
