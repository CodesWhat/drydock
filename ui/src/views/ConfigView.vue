<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { disableIconifyApi } from '../boot/icons';
import { type FontId, fontOptions, useFont } from '../composables/useFont';
import { useIcons } from '../composables/useIcons';
import AppTabBar from '../components/AppTabBar.vue';
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

const { t } = useI18n();
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

const settingsTabs = computed(() => [
  { id: 'general' as const, label: t('configView.tabs.general'), icon: 'settings' },
  { id: 'appearance' as const, label: t('configView.tabs.appearance'), icon: 'config' },
  { id: 'profile' as const, label: t('configView.tabs.profile'), icon: 'user' },
]);
const availableThemeFamilies = themeFamilies;

const loading = ref(true);
const serverFields = ref<Array<{ label: string; value: string }>>([]);
const storeFields = ref<Array<{ label: string; value: string }>>([]);
const serverError = ref('');
const webhookEnabled = ref(false);
const webhookEndpoints = computed(() => [
  {
    endpoint: 'POST /api/webhook/watch',
    description: t('configView.general.webhookApi.endpoints.watchAll'),
  },
  {
    endpoint: 'POST /api/webhook/watch/:name',
    description: t('configView.general.webhookApi.endpoints.watchOne'),
  },
  {
    endpoint: 'POST /api/webhook/update/:name',
    description: t('configView.general.webhookApi.endpoints.updateOne'),
  },
]);
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
    const storeConfig = storeData?.configuration ?? {};
    webhookEnabled.value = Boolean(config.webhook?.enabled);
    const enabled = t('configView.general.fields.enabled');
    const disabled = t('configView.general.fields.disabled');
    const yes = t('configView.general.fields.yes');
    const no = t('configView.general.fields.no');
    const fields = [
      {
        label: t('configView.general.fields.version'),
        value: appData?.version ?? t('common.unknown'),
      },
      { label: t('configView.general.fields.serverPort'), value: String(config.port ?? 3000) },
      {
        label: t('configView.general.fields.containerActions'),
        value: config.feature?.containeractions ? enabled : disabled,
      },
      {
        label: t('configView.general.fields.webhook'),
        value: config.webhook?.enabled ? enabled : disabled,
      },
      {
        label: t('configView.general.fields.deleteEnabled'),
        value: config.feature?.delete ? yes : no,
      },
      {
        label: t('configView.general.fields.trustProxy'),
        value: config.trustproxy ? enabled : disabled,
      },
      {
        label: t('configView.general.fields.metricsAuth'),
        value: config.metrics?.auth !== false ? enabled : disabled,
      },
    ];
    const storeConfigFields = [
      {
        label: t('configView.general.fields.storePath'),
        value: String(storeConfig.path ?? t('common.unknown')),
      },
      {
        label: t('configView.general.fields.storeFile'),
        value: String(storeConfig.file ?? t('common.unknown')),
      },
    ];
    serverFields.value = fields;
    storeFields.value = storeConfigFields;
    if (settings) {
      internetlessMode.value = settings.internetlessMode;
    }
  } catch (e: unknown) {
    serverError.value = errorMessage(e, t('configView.general.errors.loadServerInfo'));
    webhookEnabled.value = false;
    serverFields.value = [
      {
        label: t('configView.general.errors.errorLabel'),
        value: t('configView.general.errors.loadServerInfo'),
      },
    ];
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
    profileError.value = errorMessage(e, t('configView.general.errors.loadProfileData'));
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
    settingsError.value = errorMessage(e, t('configView.general.errors.updateNetworkSettings'));
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
    settingsError.value = errorMessage(e, t('configView.general.errors.clearIconCache'));
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
    debugDumpError.value = errorMessage(e, t('configView.general.errors.downloadDebugDump'));
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
    <AppTabBar
      :tabs="settingsTabs"
      :model-value="activeSettingsTab"
      class="mb-6"
      @update:model-value="router.replace({ query: { tab: $event } })"
    />

    <ConfigGeneralTab
      v-if="activeSettingsTab === 'general'"
      :loading="loading"
      :server-error="serverError"
      :settings-error="settingsError"
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
