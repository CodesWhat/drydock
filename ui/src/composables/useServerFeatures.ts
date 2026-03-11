import { computed, readonly, ref } from 'vue';
import { getServer } from '../services/server';
import { errorMessage } from '../utils/error';

type ServerFeatureFlags = Record<string, boolean>;

// Module-level singleton state shared by every composable consumer.
const featureFlags = ref<ServerFeatureFlags>({});
const loaded = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
let loadPromise: Promise<void> | null = null;

function normalizeFeatureFlags(rawValue: unknown): ServerFeatureFlags {
  if (!rawValue || typeof rawValue !== 'object') {
    return {};
  }

  const normalized: ServerFeatureFlags = {};
  for (const [key, value] of Object.entries(rawValue as Record<string, unknown>)) {
    normalized[key.toLowerCase()] = value === true;
  }
  return normalized;
}

function isFeatureEnabled(name: string): boolean {
  return featureFlags.value[name.toLowerCase()] === true;
}

async function loadServerFeatures(): Promise<void> {
  if (loaded.value) {
    return;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loading.value = true;
  error.value = null;

  loadPromise = (async () => {
    try {
      const serverData = await getServer();
      featureFlags.value = normalizeFeatureFlags(serverData?.configuration?.feature);
      loaded.value = true;
    } catch (e: unknown) {
      featureFlags.value = {};
      error.value = errorMessage(e, 'Failed to load server feature configuration');
    } finally {
      loading.value = false;
      loadPromise = null;
    }
  })();

  return loadPromise;
}

const containerActionsEnabled = computed(() => isFeatureEnabled('containeractions'));
const deleteEnabled = computed(() => isFeatureEnabled('delete'));
const containerActionsDisabledReason = computed(() =>
  containerActionsEnabled.value ? '' : 'Container actions disabled by server configuration',
);

interface UseServerFeaturesOptions {
  autoLoad?: boolean;
}

export function useServerFeatures(options: UseServerFeaturesOptions = {}) {
  if (options.autoLoad !== false && !loaded.value && !loadPromise) {
    void loadServerFeatures();
  }

  return {
    featureFlags: readonly(featureFlags),
    containerActionsEnabled,
    containerActionsDisabledReason,
    deleteEnabled,
    loaded: readonly(loaded),
    loading: readonly(loading),
    error: readonly(error),
    loadServerFeatures,
    isFeatureEnabled,
  };
}

export { loadServerFeatures };
