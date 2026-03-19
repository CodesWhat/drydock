<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { disableIconifyApi } from '../boot/icons';
import { type FontId, fontOptions, useFont } from '../composables/useFont';
import { useIcons } from '../composables/useIcons';
import ConfigAppearanceTab from '../components/config/ConfigAppearanceTab.vue';
import ConfigGeneralTab from '../components/config/ConfigGeneralTab.vue';
import ConfigProfileTab from '../components/config/ConfigProfileTab.vue';
import { type IconLibrary, iconMap, libraryLabels } from '../icons';
import { themeFamilies } from '../theme/palettes';
import { getAppInfos } from '../services/app';
import { getUser } from '../services/auth';
import { downloadDebugDump } from '../services/debug';
import { getServer } from '../services/server';
import { clearIconCache, getSettings, updateSettings } from '../services/settings';
import { getStore } from '../services/store';
import { applyFontSize } from '../preferences/font-size';
import { applyRadius, type RadiusPresetId, RADIUS_PRESET_VALUES } from '../preferences/radius';
import { preferences } from '../preferences/store';
import { usePreference } from '../preferences/usePreference';
import { useTheme } from '../theme/useTheme';
import { errorMessage } from '../utils/error';

const route = useRoute();
const router = useRouter();
const { themeFamily, themeVariant, isDark, setThemeFamily, transitionTheme } = useTheme();

// --- Border Radius ---
const radiusPresets = RADIUS_PRESET_VALUES;

const activeRadius = usePreference(
  () => preferences.appearance.radius,
  (v) => {
    preferences.appearance.radius = v;
  },
);

function setRadius(id: RadiusPresetId) {
  activeRadius.value = id;
  applyRadius(id);
}

const { iconLibrary, setIconLibrary, iconScale, setIconScale } = useIcons();
const { activeFont, setFont, fontLoading, isFontLoaded } = useFont();

// --- Font Size ---
const activeFontSize = usePreference(
  () => preferences.appearance.fontSize,
  (v) => {
    preferences.appearance.fontSize = v;
  },
);

function setFontSize(scale: number) {
  activeFontSize.value = scale;
  applyFontSize(scale);
}

type SettingsTab = 'general' | 'appearance' | 'profile';

const VALID_TABS = new Set<SettingsTab>(['general', 'appearance', 'profile']);

function tabFromQuery(): SettingsTab {
  const raw = route.query.tab;
  const val = Array.isArray(raw) ? raw[0] : raw;
  return typeof val === 'string' && VALID_TABS.has(val as SettingsTab)
    ? (val as SettingsTab)
    : 'general';
}

const activeSettingsTab = ref<SettingsTab>(tabFromQuery());

watch(
  () => route.query.tab,
  () => {
    activeSettingsTab.value = tabFromQuery();
  },
);

const settingsTabs = [
  { id: 'general' as const, label: 'General', icon: 'settings' },
  { id: 'appearance' as const, label: 'Appearance', icon: 'config' },
  { id: 'profile' as const, label: 'Profile', icon: 'user' },
];
const availableThemeFamilies = themeFamilies;

const loading = ref(true);
const serverFields = ref<Array<{ label: string; value: string }>>([]);
const storeFields = ref<Array<{ label: string; value: string }>>([]);
const serverError = ref('');
const webhookEnabled = ref(false);
const webhookEndpoints = [
  {
    endpoint: 'POST /api/webhook/watch',
    description: 'Trigger a full watch cycle on all watchers',
  },
  {
    endpoint: 'POST /api/webhook/watch/:name',
    description: 'Watch a specific container by name',
  },
  {
    endpoint: 'POST /api/webhook/update/:name',
    description: 'Trigger an update on a specific container',
  },
];
const webhookBaseUrl = computed(() => {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.location.origin;
});
const webhookExample = computed(
  () =>
    `curl -X POST ${webhookBaseUrl.value}/api/webhook/watch \\\n  -H "Authorization: Bearer YOUR_TOKEN"`,
);

// Settings state
const internetlessMode = ref(false);
const settingsLoading = ref(false);
const settingsError = ref('');

interface LegacyInputSourceSummary {
  total: number;
  keys: string[];
}

interface LegacyInputSummary {
  total: number;
  env: LegacyInputSourceSummary;
  label: LegacyInputSourceSummary;
}

const LEGACY_KEY_PREVIEW_LIMIT = 6;
const legacyInputSummary = ref<LegacyInputSummary | null>(null);
const hasLegacyCompatibilityInputs = computed(() => (legacyInputSummary.value?.total ?? 0) > 0);
const legacyEnvKeysPreview = computed(() =>
  summarizeLegacyKeys(legacyInputSummary.value?.env.keys ?? []),
);
const legacyLabelKeysPreview = computed(() =>
  summarizeLegacyKeys(legacyInputSummary.value?.label.keys ?? []),
);

function normalizeLegacyInputSourceSummary(rawValue: unknown): LegacyInputSourceSummary {
  const parsedTotal = Number((rawValue as { total?: unknown })?.total);
  const parsedKeys = Array.isArray((rawValue as { keys?: unknown })?.keys)
    ? (rawValue as { keys: unknown[] }).keys.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  const uniqueKeys = Array.from(new Set(parsedKeys)).sort((a, b) => a.localeCompare(b));
  const total =
    Number.isFinite(parsedTotal) && parsedTotal >= 0
      ? Math.max(Math.floor(parsedTotal), uniqueKeys.length)
      : uniqueKeys.length;
  return { total, keys: uniqueKeys };
}

function normalizeLegacyInputSummary(rawValue: unknown): LegacyInputSummary | null {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }
  const env = normalizeLegacyInputSourceSummary((rawValue as { env?: unknown }).env);
  const label = normalizeLegacyInputSourceSummary((rawValue as { label?: unknown }).label);
  const parsedTotal = Number((rawValue as { total?: unknown }).total);
  const totalFromKeys = env.total + label.total;
  const total =
    Number.isFinite(parsedTotal) && parsedTotal >= 0
      ? Math.max(Math.floor(parsedTotal), totalFromKeys)
      : totalFromKeys;

  if (total <= 0) {
    return null;
  }

  return { total, env, label };
}

function summarizeLegacyKeys(keys: string[]): string {
  if (keys.length === 0) {
    return '';
  }
  const previewKeys = keys.slice(0, LEGACY_KEY_PREVIEW_LIMIT);
  const hiddenCount = keys.length - previewKeys.length;
  return hiddenCount > 0
    ? `${previewKeys.join(', ')} (+${hiddenCount} more)`
    : previewKeys.join(', ');
}

// Profile state
interface ProfileData {
  username: string;
  displayName: string;
  email: string;
  role: string;
  provider: string;
  lastLogin: string;
  sessions: number;
}

function emptyProfileData(): ProfileData {
  return {
    username: '',
    displayName: '',
    email: '',
    role: '',
    provider: '',
    lastLogin: '',
    sessions: 0,
  };
}

const profileData = ref<ProfileData>(emptyProfileData());
const profileLoading = ref(true);
const profileError = ref('');
const profileDisplayName = computed(
  () => profileData.value.displayName || profileData.value.username || 'Unknown User',
);
const profileInitials = computed(() => profileDisplayName.value.slice(0, 2).toUpperCase());

function formatProfileLastLogin(rawValue: unknown): string {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return '';
  }
  const date = new Date(rawValue as string | number | Date);
  if (Number.isNaN(date.getTime())) {
    return String(rawValue);
  }
  return date.toLocaleString();
}

function normalizeSessionCount(rawValue: unknown): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

async function loadGeneralSettingsData() {
  loading.value = true;
  serverError.value = '';
  settingsError.value = '';
  try {
    const [serverData, appData, storeData, settings] = await Promise.all([
      getServer().catch(() => null),
      getAppInfos().catch(() => null),
      getStore().catch(() => null),
      getSettings().catch(() => null),
    ]);
    const config = serverData?.configuration ?? {};
    legacyInputSummary.value = normalizeLegacyInputSummary(serverData?.compatibility?.legacyInputs);
    const storeConfig = storeData?.configuration ?? {};
    webhookEnabled.value = Boolean(config.webhook?.enabled);
    const fields = [
      { label: 'Version', value: appData?.version ?? 'unknown' },
      { label: 'Server Port', value: String(config.port ?? 3000) },
      {
        label: 'Container Actions',
        value: config.feature?.containeractions ? 'Enabled' : 'Disabled',
      },
      { label: 'Webhook', value: config.webhook?.enabled ? 'Enabled' : 'Disabled' },
      { label: 'Delete Enabled', value: config.feature?.delete ? 'Yes' : 'No' },
      { label: 'Trust Proxy', value: config.trustproxy ? 'Enabled' : 'Disabled' },
      { label: 'Metrics Auth', value: config.metrics?.auth !== false ? 'Enabled' : 'Disabled' },
    ];
    const storeConfigFields = [
      { label: 'Store Path', value: String(storeConfig.path ?? 'unknown') },
      { label: 'Store File', value: String(storeConfig.file ?? 'unknown') },
    ];
    serverFields.value = fields;
    storeFields.value = storeConfigFields;
    if (settings) {
      internetlessMode.value = settings.internetlessMode;
    }
  } catch (e: unknown) {
    serverError.value = errorMessage(e, 'Failed to load server info');
    legacyInputSummary.value = null;
    webhookEnabled.value = false;
    serverFields.value = [{ label: 'Error', value: 'Failed to load server info' }];
  } finally {
    loading.value = false;
  }
}

async function loadProfileData() {
  profileLoading.value = true;
  profileError.value = '';
  profileData.value = emptyProfileData();
  try {
    const user = await getUser();
    if (user) {
      profileData.value = {
        username: user.username ?? '',
        displayName: user.displayName ?? '',
        email: user.email ?? '',
        role: user.role ?? '',
        provider: user.provider ?? user.authentication ?? '',
        lastLogin: formatProfileLastLogin(user.lastLogin),
        sessions: normalizeSessionCount(user.sessions),
      };
    }
  } catch (e: unknown) {
    profileError.value = errorMessage(e, 'Failed to load profile data');
  } finally {
    profileLoading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadGeneralSettingsData(), loadProfileData()]);
});

async function toggleInternetlessMode() {
  settingsError.value = '';
  settingsLoading.value = true;
  try {
    const updated = await updateSettings({ internetlessMode: !internetlessMode.value });
    internetlessMode.value = updated.internetlessMode;
    if (updated.internetlessMode) {
      disableIconifyApi();
    }
  } catch (e: unknown) {
    settingsError.value = errorMessage(e, 'Failed to update network settings');
  } finally {
    settingsLoading.value = false;
  }
}

const cacheClearing = ref(false);
const cacheCleared = ref<number | null>(null);
const debugDumpDownloading = ref(false);
const debugDumpError = ref('');

async function handleClearIconCache() {
  settingsError.value = '';
  cacheClearing.value = true;
  cacheCleared.value = null;
  try {
    const result = await clearIconCache();
    cacheCleared.value = result.cleared;
  } catch (e: unknown) {
    settingsError.value = errorMessage(e, 'Failed to clear icon cache');
  } finally {
    cacheClearing.value = false;
  }
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const createObjectUrl = globalThis.URL?.createObjectURL;
  if (typeof createObjectUrl !== 'function') {
    throw new Error('Browser does not support file downloads');
  }

  const objectUrl = createObjectUrl(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

async function handleDownloadDebugDump() {
  if (debugDumpDownloading.value) {
    return;
  }

  debugDumpDownloading.value = true;
  debugDumpError.value = '';

  try {
    const { blob, filename } = await downloadDebugDump();
    triggerBlobDownload(blob, filename);
  } catch (e: unknown) {
    debugDumpError.value = errorMessage(e, 'Unable to download debug dump');
  } finally {
    debugDumpDownloading.value = false;
  }
}

function handleSelectThemeFamily(familyId: string, event: Event) {
  transitionTheme(
    () => setThemeFamily(familyId as (typeof availableThemeFamilies)[number]['id']),
    event,
  );
}

function handleSelectFont(fontId: string) {
  setFont(fontId as FontId);
}

function handleSelectIconLibrary(library: string) {
  setIconLibrary(library as IconLibrary);
}
</script>

<template>
  <DataViewLayout>
    <div class="flex gap-1 mb-6" :style="{ borderBottom: '1px solid var(--dd-border)' }">
      <AppButton size="none" variant="plain" weight="none"
        v-for="tab in settingsTabs"
        :key="tab.id"
        class="px-4 py-2.5 text-xs font-semibold transition-colors relative"
        :class="activeSettingsTab === tab.id ? 'text-drydock-secondary' : 'dd-text-muted hover:dd-text'"
        @click="router.replace({ query: { tab: tab.id } })"
      >
        <AppIcon :name="tab.icon" :size="12" class="mr-1.5" />
        {{ tab.label }}
        <div
          v-if="activeSettingsTab === tab.id"
          class="absolute bottom-0 left-0 right-0 h-[2px] bg-drydock-secondary rounded-t-full"
        />
      </AppButton>
    </div>

    <ConfigGeneralTab
      v-if="activeSettingsTab === 'general'"
      :loading="loading"
      :server-error="serverError"
      :settings-error="settingsError"
      :has-legacy-compatibility-inputs="hasLegacyCompatibilityInputs"
      :legacy-input-summary="legacyInputSummary"
      :legacy-env-keys-preview="legacyEnvKeysPreview"
      :legacy-label-keys-preview="legacyLabelKeysPreview"
      :server-fields="serverFields"
      :store-fields="storeFields"
      :webhook-enabled="webhookEnabled"
      :webhook-endpoints="webhookEndpoints"
      :webhook-example="webhookExample"
      :internetless-mode="internetlessMode"
      :settings-loading="settingsLoading"
      :cache-clearing="cacheClearing"
      :cache-cleared="cacheCleared"
      :debug-dump-downloading="debugDumpDownloading"
      :debug-dump-error="debugDumpError"
      @toggle-internetless-mode="toggleInternetlessMode"
      @clear-icon-cache="handleClearIconCache"
      @download-debug-dump="handleDownloadDebugDump"
    />

    <ConfigAppearanceTab
      v-if="activeSettingsTab === 'appearance'"
      :theme-families="availableThemeFamilies"
      :theme-family="themeFamily"
      :is-dark="isDark"
      :active-font="activeFont"
      :font-loading="fontLoading"
      :font-options="fontOptions"
      :is-font-loaded="isFontLoaded"
      :icon-library="iconLibrary"
      :library-labels="libraryLabels"
      :icon-map="iconMap"
      :icon-scale="iconScale"
      :on-select-theme-family="handleSelectThemeFamily"
      :on-select-font="handleSelectFont"
      :on-select-icon-library="handleSelectIconLibrary"
      :on-change-icon-scale="setIconScale"
      :font-size="activeFontSize"
      :on-change-font-size="setFontSize"
      :active-radius="activeRadius"
      :radius-presets="radiusPresets"
      :on-select-radius="setRadius"
    />

    <ConfigProfileTab
      v-if="activeSettingsTab === 'profile'"
      :profile-initials="profileInitials"
      :profile-display-name="profileDisplayName"
      :profile-data="profileData"
      :profile-loading="profileLoading"
      :profile-error="profileError"
    />
  </DataViewLayout>
</template>
