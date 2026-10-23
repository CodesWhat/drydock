import { computed, readonly, ref } from 'vue';
import { i18n } from '../boot/i18n';
import { getServer } from '../services/server';
import { errorMessage } from '../utils/error';
import { useConnectivity } from './useConnectivity';

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
      error.value = errorMessage(e, i18n.global.t('sharedComponents.serverFeatures.loadFailed'));
    } finally {
      loading.value = false;
      loadPromise = null;
    }
  })();

  return loadPromise;
}

// Mutating actions are also off while offline or while the server is
// unreachable: the views are showing last-known data and a write would fail.
const connectivity = useConnectivity();
const containerActionsEnabled = computed(
  () => isFeatureEnabled('containeractions') && !connectivity.isReadOnly.value,
);
const deleteEnabled = computed(() => isFeatureEnabled('delete') && !connectivity.isReadOnly.value);
const containerActionsDisabledReason = computed(() => {
  if (connectivity.isReadOnly.value) {
    return connectivity.readOnlyReason.value;
  }
  return containerActionsEnabled.value
    ? ''
    : i18n.global.t('sharedComponents.serverFeatures.actionsDisabledReason');
});

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
