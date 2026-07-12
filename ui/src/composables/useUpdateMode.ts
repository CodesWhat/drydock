import { readonly, ref } from 'vue';
import { getSettings, type UpdateMode, updateSettings } from '../services/settings';
import { errorMessage } from '../utils/error';

const updateMode = ref<UpdateMode>('manual');
const loaded = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
let loadPromise: Promise<void> | null = null;

async function loadUpdateMode(): Promise<void> {
  if (loaded.value) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const settings = await getSettings();
      updateMode.value = settings.updateMode;
      loaded.value = true;
      error.value = null;
    } catch (caught: unknown) {
      error.value = errorMessage(caught);
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

async function setUpdateMode(mode: UpdateMode): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  error.value = null;
  try {
    const settings = await updateSettings({ updateMode: mode });
    updateMode.value = settings.updateMode;
    loaded.value = true;
  } catch (caught: unknown) {
    error.value = errorMessage(caught);
    throw caught;
  } finally {
    saving.value = false;
  }
}

export function useUpdateMode(options: { autoLoad?: boolean } = {}) {
  if (options.autoLoad !== false) {
    void loadUpdateMode();
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
