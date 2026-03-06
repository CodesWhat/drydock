import { type Ref, ref, watch } from 'vue';

export function useStorageRef<T>(
  key: string,
  defaultValue: T,
  validator?: (v: unknown) => v is T,
): Ref<T> {
  let initial = defaultValue;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as unknown;
      if (validator ? validator(parsed) : typeof parsed === typeof defaultValue) {
        initial = parsed as T;
      }
    }
  } catch {
    // Corrupt or unreadable — use default.
  }

  const state = ref(initial) as Ref<T>;

  watch(state, (v) => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // Storage full or unavailable — silently ignore.
    }
  });

  return state;
}
