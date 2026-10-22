import { useConnectivity } from '../composables/useConnectivity';
import { type LastKnownKey, readLastKnown, saveLastKnown } from '../utils/last-known';

/**
 * Run a safe GET loader and remember its result. The remembered copy is served
 * only when the request itself fails to reach the server (a network error), so
 * a reachable server always answers with live data. HTTP errors, aborts and
 * parse failures rethrow untouched.
 */
export async function withLastKnown<T>(key: LastKnownKey, load: () => Promise<T>): Promise<T> {
  try {
    const data = await load();
    saveLastKnown(key, data);
    return data;
  } catch (error: unknown) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    const cached = readLastKnown<T>(key);
    if (!cached) {
      throw error;
    }
    useConnectivity().noteLastKnownServed(cached.savedAt);
    return cached.data;
  }
}
