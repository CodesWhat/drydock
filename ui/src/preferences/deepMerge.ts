function isMergeableObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  for (const key of Object.keys(target)) {
    if (!(key in source)) continue;

    const typedKey = key as keyof T;
    const tv = target[typedKey];
    const sv = source[key];

    if (isMergeableObject(tv) && isMergeableObject(sv)) {
      deepMerge(tv, sv);
    } else if (sv !== undefined) {
      target[typedKey] = sv as T[keyof T];
    }
  }

  return target;
}
