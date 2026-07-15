import { getCurrentScope, onScopeDispose, readonly, ref } from 'vue';
import { getSettings, type UpdateMode, updateSettings } from '../services/settings';
import { errorMessage } from '../utils/error';

const updateMode = ref<UpdateMode>('manual');
const loaded = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
let loadPromise: Promise<void> | null = null;
let savePromise: Promise<void> | null = null;
let revalidationConsumers = 0;
let canonicalRevision = 0;

export interface LoadUpdateModeOptions {
  force?: boolean;
}

async function loadUpdateMode(options: LoadUpdateModeOptions = {}): Promise<void> {
  if (loaded.value && !options.force) return;
  if (loadPromise) return loadPromise;
  const loadRevision = canonicalRevision;
  loadPromise = (async () => {
    try {
      const settings = await getSettings();
      if (loadRevision === canonicalRevision) {
        updateMode.value = settings.updateMode;
        loaded.value = true;
        error.value = null;
      }
    } catch (caught: unknown) {
      if (loadRevision === canonicalRevision) error.value = errorMessage(caught);
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

async function setUpdateMode(mode: UpdateMode): Promise<void> {
  if (savePromise) return savePromise;
  savePromise = (async () => {
    saving.value = true;
    error.value = null;
    try {
      const settings = await updateSettings({ updateMode: mode });
      canonicalRevision += 1;
      updateMode.value = settings.updateMode;
      loaded.value = true;
    } catch (caught: unknown) {
      error.value = errorMessage(caught);
      throw caught;
    } finally {
      saving.value = false;
      savePromise = null;
    }
  })();
  return savePromise;
}

function revalidateUpdateMode(): void {
  void loadUpdateMode({ force: true });
}

function revalidateVisibleUpdateMode(): void {
  if (document.visibilityState === 'visible') revalidateUpdateMode();
}

export function startUpdateModeRevalidation(): () => void {
  revalidationConsumers += 1;
  if (revalidationConsumers === 1 && typeof window !== 'undefined') {
    window.addEventListener('focus', revalidateUpdateMode);
    document.addEventListener('visibilitychange', revalidateVisibleUpdateMode);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    revalidationConsumers -= 1;
    if (revalidationConsumers === 0 && typeof window !== 'undefined') {
      window.removeEventListener('focus', revalidateUpdateMode);
      document.removeEventListener('visibilitychange', revalidateVisibleUpdateMode);
    }
  };
}

export function useUpdateMode(options: { autoLoad?: boolean } = {}) {
  if (options.autoLoad !== false) {
    void loadUpdateMode();
  }
  if (getCurrentScope()) {
    const stopRevalidation = startUpdateModeRevalidation();
    onScopeDispose(stopRevalidation);
  }
  return {
    updateMode: readonly(updateMode),
    loaded: readonly(loaded),
    saving: readonly(saving),
    error: readonly(error),
    loadUpdateMode,
    setUpdateMode,
  };
}
