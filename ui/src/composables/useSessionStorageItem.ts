interface SessionStorageItem<T> {
  read: () => T | null;
  write: (value: T) => void;
  remove: () => void;
}

export function useSessionStorageItem<T>(
  key: string,
  validator?: (value: unknown) => value is T,
): SessionStorageItem<T> {
  function read(): T | null {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (validator && !validator(parsed)) return null;
      return parsed as T;
    } catch {
      return null;
    }
  }

  function write(value: T): void {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable — silently ignore.
    }
  }

  function remove(): void {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Storage unavailable — silently ignore.
    }
  }

  return { read, write, remove };
}
