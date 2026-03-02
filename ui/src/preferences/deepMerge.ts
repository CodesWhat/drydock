export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  for (const key of Object.keys(target)) {
    if (!(key in source)) continue;

    const typedKey = key as keyof T;
    const tv = target[typedKey];
    const sv = source[key];

    if (
      tv !== null &&
      sv !== null &&
      typeof tv === 'object' &&
      typeof sv === 'object' &&
      !Array.isArray(tv) &&
      !Array.isArray(sv)
    ) {
      deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else if (sv !== undefined) {
      target[typedKey] = sv as T[keyof T];
    }
  }

  return target;
}
