interface LoadRecentItemsOptions<T> {
  key: string;
  legacyKey?: string;
  maxItems: number;
  validate: (value: unknown) => value is T;
}

interface ReadResult<T> {
  found: boolean;
  items: T[];
}

function readRecentItems<T>(
  key: string,
  maxItems: number,
  validate: (value: unknown) => value is T,
): ReadResult<T> {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return { found: false, items: [] };
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { found: true, items: [] };
    }
    return {
      found: true,
      items: parsed.filter((item): item is T => validate(item)).slice(0, maxItems),
    };
  } catch {
    return { found: true, items: [] };
  }
}

export function saveRecentItems<T>(key: string, items: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Ignore storage errors.
  }
}

export function loadRecentItems<T>(options: LoadRecentItemsOptions<T>): T[] {
  const primary = readRecentItems(options.key, options.maxItems, options.validate);
  if (primary.found) {
    return primary.items;
  }

  if (!options.legacyKey) {
    return [];
  }

  const legacy = readRecentItems(options.legacyKey, options.maxItems, options.validate);
  if (!legacy.found) {
    return [];
  }

  if (legacy.items.length > 0) {
    saveRecentItems(options.key, legacy.items);
  }

  try {
    localStorage.removeItem(options.legacyKey);
  } catch {
    // Ignore storage errors.
  }

  return legacy.items;
}
