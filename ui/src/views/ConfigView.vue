<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { type FontId, fontOptions, useFont } from '../composables/useFont';
import { useIcons } from '../composables/useIcons';
import { LOG_AUTO_FETCH_INTERVALS, useAutoFetchLogs, useLogViewport } from '../composables/useLogViewerBehavior';
import { type IconLibrary, iconMap, libraryLabels } from '../icons';
import { getAppInfos } from '../services/app';
import { getUser } from '../services/auth';
import { getLog, getLogEntries } from '../services/log';
import { clearIconCache, getSettings, updateSettings } from '../services/settings';
import { getServer } from '../services/server';
import { themeFamilies } from '../theme/palettes';
import { useTheme } from '../theme/useTheme';

const route = useRoute();
const { themeFamily, themeVariant, isDark, setThemeFamily, transitionTheme } = useTheme();

const { iconLibrary, setIconLibrary, iconScale, setIconScale } = useIcons();
const { activeFont, setFont, fontLoading, isFontLoaded } = useFont();

const { logContainer, scrollBlocked, scrollToBottom, handleLogScroll, resumeAutoScroll } = useLogViewport();
const { autoFetchInterval } = useAutoFetchLogs({ fetchFn: refreshAppLogs, scrollToBottom, scrollBlocked });

type SettingsTab = 'general' | 'appearance' | 'logs' | 'profile';

const VALID_TABS = new Set<SettingsTab>(['general', 'appearance', 'logs', 'profile']);

function tabFromQuery(): SettingsTab {
  const raw = route.query.tab;
  const val = Array.isArray(raw) ? raw[0] : raw;
  return typeof val === 'string' && VALID_TABS.has(val as SettingsTab) ? (val as SettingsTab) : 'general';
}

const activeSettingsTab = ref<SettingsTab>(tabFromQuery());

watch(() => route.query.tab, () => {
  activeSettingsTab.value = tabFromQuery();
});

const settingsTabs = [
  { id: 'general' as const, label: 'General', icon: 'settings' },
  { id: 'appearance' as const, label: 'Appearance', icon: 'config' },
  { id: 'logs' as const, label: 'Logs', icon: 'logs' },
  { id: 'profile' as const, label: 'Profile', icon: 'user' },
];

const loading = ref(true);
const serverFields = ref<Array<{ label: string; value: string }>>([]);
const serverError = ref('');

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

// App logs state
interface AppLogEntry {
  timestamp?: string | number;
  level?: string;
  component?: string;
  msg?: string;
  message?: string;
}

const appLogLevel = ref('unknown');
const appLogEntries = ref<AppLogEntry[]>([]);
const appLogsLoading = ref(false);
const appLogsError = ref('');
const appLogLevelFilter = ref('all');
const appLogTail = ref(100);
const appLogComponent = ref('');
const appLogsLastFetched = ref('');

function formatLogTimestamp(timestamp: string | number | undefined): string {
  if (timestamp === undefined || timestamp === null) {
    return 'unknown';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return String(timestamp);
  }
  return date.toLocaleString();
}

function formatLastFetched(iso: string): string {
  if (!iso) {
    return 'never';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'never';
  }
  return date.toLocaleTimeString();
}

function logMessage(entry: AppLogEntry): string {
  return entry.msg || entry.message || '';
}

function getLevelColor(level: string | undefined): string {
  const value = (level || '').toLowerCase();
  if (value === 'error') return 'var(--dd-danger)';
  if (value === 'warn' || value === 'warning') return 'var(--dd-warning)';
  if (value === 'info') return 'var(--dd-info)';
  if (value === 'debug') return 'var(--dd-text-secondary)';
  return 'var(--dd-text-secondary)';
}

async function refreshAppLogs() {
  appLogsLoading.value = true;
  appLogsError.value = '';
  try {
    const [logInfo, entries] = await Promise.all([
      getLog().catch(() => ({ level: 'unknown' })),
      getLogEntries({
        level: appLogLevelFilter.value,
        component: appLogComponent.value.trim() || undefined,
        tail: appLogTail.value,
      }),
    ]);
    appLogLevel.value = logInfo?.level ?? 'unknown';
    appLogEntries.value = Array.isArray(entries) ? entries : [];
    appLogsLastFetched.value = new Date().toISOString();
    if (!scrollBlocked.value) {
      void nextTick(() => scrollToBottom());
    }
  } catch (e: any) {
    appLogsError.value = e?.message || 'Failed to load application logs';
    appLogEntries.value = [];
  } finally {
    appLogsLoading.value = false;
  }
}

function resetLogFilters() {
  appLogLevelFilter.value = 'all';
  appLogTail.value = 100;
  appLogComponent.value = '';
  void refreshAppLogs();
}

watch(
  () => activeSettingsTab.value,
  (tab, oldTab) => {
    if (tab === 'logs' && appLogEntries.value.length === 0 && !appLogsLoading.value) {
      void refreshAppLogs();
    }
    if (oldTab === 'logs') {
      autoFetchInterval.value = 0;
    }
  },
);

async function loadGeneralSettingsData() {
  loading.value = true;
  serverError.value = '';
  settingsError.value = '';
  try {
    const [serverData, appData, settings] = await Promise.all([
      getServer().catch(() => null),
      getAppInfos().catch(() => null),
      getSettings().catch(() => null),
    ]);
    const config = serverData?.configuration ?? {};
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
    ];
    serverFields.value = fields;
    if (settings) {
      internetlessMode.value = settings.internetlessMode;
    }
  } catch (e: any) {
    serverError.value = e?.message || 'Failed to load server info';
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
  } catch (e: any) {
    profileError.value = e?.message || 'Failed to load profile data';
  } finally {
    profileLoading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadGeneralSettingsData(), loadProfileData()]);

  if (activeSettingsTab.value === 'logs') {
    void refreshAppLogs();
  }
});

async function toggleInternetlessMode() {
  settingsError.value = '';
  settingsLoading.value = true;
  try {
    const updated = await updateSettings({ internetlessMode: !internetlessMode.value });
    internetlessMode.value = updated.internetlessMode;
  } catch (e: any) {
    settingsError.value = e?.message || 'Failed to update network settings';
  } finally {
    settingsLoading.value = false;
  }
}

const cacheClearing = ref(false);
const cacheCleared = ref<number | null>(null);

async function handleClearIconCache() {
  settingsError.value = '';
  cacheClearing.value = true;
  cacheCleared.value = null;
  try {
    const result = await clearIconCache();
    cacheCleared.value = result.cleared;
  } catch (e: any) {
    settingsError.value = e?.message || 'Failed to clear icon cache';
  } finally {
    cacheClearing.value = false;
  }
}
</script>

<template>
  <DataViewLayout>
      <!-- Tabs -->
      <div class="flex gap-1 mb-6"
           :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
        <button v-for="tab in settingsTabs" :key="tab.id"
                class="px-4 py-2.5 text-[12px] font-semibold transition-colors relative"
                :class="activeSettingsTab === tab.id
                  ? 'text-drydock-secondary'
                  : 'dd-text-muted hover:dd-text'"
                @click="activeSettingsTab = tab.id">
          <AppIcon :name="tab.icon" :size="12" class="mr-1.5" />
          {{ tab.label }}
          <div v-if="activeSettingsTab === tab.id"
               class="absolute bottom-0 left-0 right-0 h-[2px] bg-drydock-secondary rounded-t-full" />
        </button>
      </div>

      <!-- GENERAL TAB -->
      <div v-if="activeSettingsTab === 'general'" class="space-y-6">
        <div v-if="serverError"
             class="px-3 py-2 text-[11px] dd-rounded"
             :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
          {{ serverError }}
        </div>

        <div v-if="settingsError"
             class="px-3 py-2 text-[11px] dd-rounded"
             :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
          {{ settingsError }}
        </div>

        <!-- Application Info -->
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="px-5 py-3.5 flex items-center gap-2"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <AppIcon name="settings" :size="14" class="text-drydock-secondary" />
            <h2 class="text-sm font-semibold dd-text">Application</h2>
          </div>
          <div class="p-5 space-y-4">
            <div v-if="loading" class="text-[12px] dd-text-muted text-center py-4">Loading...</div>
            <template v-else>
              <div v-for="field in serverFields" :key="field.label"
                   class="flex items-center justify-between py-2"
                   :style="{ borderBottom: '1px solid var(--dd-border)' }">
                <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">{{ field.label }}</span>
                <span class="text-[12px] font-medium font-mono dd-text">{{ field.value }}</span>
              </div>
            </template>
          </div>
        </div>

        <!-- Internetless Mode -->
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="px-5 py-3.5 flex items-center gap-2"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <AppIcon name="globe" :size="14" class="text-drydock-secondary" />
            <h2 class="text-sm font-semibold dd-text">Network</h2>
          </div>
          <div class="p-5">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-[12px] font-semibold dd-text">Internetless Mode</div>
                <div class="text-[10px] dd-text-muted mt-0.5">
                  Block all outbound requests (container icons, external fetches)
                </div>
              </div>
              <ToggleSwitch
                :model-value="internetlessMode"
                :disabled="settingsLoading"
                @update:model-value="toggleInternetlessMode"
              />
            </div>
          </div>
        </div>
        <!-- Icon Cache -->
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="px-5 py-3.5 flex items-center gap-2"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <AppIcon name="containers" :size="14" class="text-drydock-secondary" />
            <h2 class="text-sm font-semibold dd-text">Container Icon Cache</h2>
          </div>
          <div class="p-5">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-[12px] font-semibold dd-text">Cached Icons</div>
                <div class="text-[10px] dd-text-muted mt-0.5">
                  Common icons are bundled; other icons are cached to disk on first fetch
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span v-if="cacheCleared !== null" class="text-[10px] dd-text-success">
                  {{ cacheCleared }} cleared
                </span>
                <button
                  class="px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors"
                  :class="cacheClearing ? 'opacity-50 pointer-events-none' : ''"
                  :style="{
                    backgroundColor: 'var(--dd-danger-muted)',
                    color: 'var(--dd-danger)',
                    border: '1px solid var(--dd-danger)',
                  }"
                  @click="handleClearIconCache">
                  <AppIcon name="trash" :size="10" class="mr-1" />
                  Clear Cache
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- APPEARANCE TAB -->
      <div v-if="activeSettingsTab === 'appearance'" class="space-y-6">

        <!-- Color Theme -->
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="flex items-center gap-2 px-5 py-3"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <AppIcon name="settings" :size="14" class="text-drydock-secondary" />
            <h2 class="text-sm font-semibold dd-text">Color Theme</h2>
          </div>
          <div class="p-4">
            <div class="grid grid-cols-2 gap-3">
              <button v-for="fam in themeFamilies" :key="fam.id"
                      class="dd-rounded p-3 text-left transition-all border"
                      :class="themeFamily === fam.id ? 'ring-2 ring-drydock-secondary' : ''"
                      :style="{
                        backgroundColor: themeFamily === fam.id
                          ? 'var(--dd-primary-muted)'
                          : 'var(--dd-bg-inset)',
                        border: themeFamily === fam.id
                          ? '1px solid var(--dd-primary)'
                          : '1px solid var(--dd-border-strong)',
                      }"
                      @click="transitionTheme(() => setThemeFamily(fam.id), $event)">
                <div class="flex items-center gap-2 mb-1.5">
                  <span class="w-4 h-4 rounded-full border-2"
                        :style="{ backgroundColor: isDark ? fam.swatchDark : fam.swatchLight, borderColor: fam.accent }" />
                  <span class="text-[12px] font-semibold"
                        :class="themeFamily === fam.id ? 'text-drydock-secondary' : 'dd-text'">
                    {{ fam.label }}
                  </span>
                </div>
                <div class="text-[10px] dd-text-muted">
                  {{ fam.description }}
                </div>
              </button>
            </div>
          </div>
        </div>

        <!-- Theme Variant -->
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="px-5 py-3.5 flex items-center gap-2"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <AppIcon :name="themeVariant === 'system' ? 'monitor' : isDark ? 'moon' : 'sun'" :size="14" class="text-drydock-secondary" />
            <h2 class="text-sm font-semibold dd-text">Theme</h2>
          </div>
          <div class="p-5 flex items-center gap-4">
            <ThemeToggle size="md" />
            <span class="text-[12px] font-semibold dd-text-secondary capitalize">{{ themeVariant }}</span>
          </div>
        </div>

        <!-- Font Family -->
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="px-5 py-3.5 flex items-center gap-2"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <AppIcon name="terminal" :size="14" class="text-drydock-secondary" />
            <h2 class="text-sm font-semibold dd-text">Font Family</h2>
          </div>
          <div class="p-5">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button v-for="f in fontOptions" :key="f.id"
                      class="flex items-center gap-3 px-4 py-3 dd-rounded text-left transition-colors"
                      :class="[
                        activeFont === f.id ? 'ring-2 ring-drydock-secondary' : '',
                        fontLoading ? 'pointer-events-none' : '',
                      ]"
                      :style="{
                        backgroundColor: activeFont === f.id
                          ? 'var(--dd-primary-muted)'
                          : 'var(--dd-bg-inset)',
                        border: activeFont === f.id
                          ? '1.5px solid var(--dd-primary)'
                          : '1px solid var(--dd-border-strong)',
                      }"
                      @click="setFont(f.id as FontId)">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="text-[13px] font-semibold truncate"
                         :style="isFontLoaded(f.id) ? { fontFamily: f.family } : {}"
                         :class="activeFont === f.id ? 'text-drydock-secondary' : 'dd-text'">
                      {{ f.label }}
                    </span>
                    <span v-if="f.bundled" class="text-[8px] font-bold uppercase tracking-wider dd-text-muted px-1 py-0.5 dd-rounded-sm"
                          :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
                      default
                    </span>
                  </div>
                  <div class="text-[10px] mt-0.5 truncate dd-text-muted"
                       :style="isFontLoaded(f.id) ? { fontFamily: f.family } : {}">
                    The quick brown fox jumps over the lazy dog
                  </div>
                </div>
                <AppIcon v-if="activeFont === f.id" name="check" :size="14" class="text-drydock-secondary shrink-0" />
              </button>
            </div>
          </div>
        </div>

        <!-- Icon Library -->
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="px-5 py-3.5 flex items-center gap-2"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <AppIcon name="dashboard" :size="14" class="text-drydock-secondary" />
            <h2 class="text-sm font-semibold dd-text">Icon Library</h2>
          </div>
          <div class="p-5">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              <button v-for="(label, lib) in libraryLabels" :key="lib"
                      class="flex items-center gap-3 px-4 py-3 dd-rounded text-left transition-colors"
                      :class="iconLibrary === lib ? 'ring-2 ring-drydock-secondary' : ''"
                      :style="{
                        backgroundColor: iconLibrary === lib
                          ? 'var(--dd-primary-muted)'
                          : 'var(--dd-bg-inset)',
                        border: iconLibrary === lib
                          ? '1.5px solid var(--dd-primary)'
                          : '1px solid var(--dd-border-strong)',
                      }"
                      @click="setIconLibrary(lib as IconLibrary)">
                <div class="w-8 h-8 dd-rounded flex items-center justify-center"
                     :style="{
                       backgroundColor: iconLibrary === lib ? 'var(--dd-primary-muted)' : 'var(--dd-bg-elevated)',
                     }">
                  <iconify-icon :icon="iconMap['dashboard']?.[lib as IconLibrary]" width="18" height="18"
                                :class="iconLibrary === lib ? 'text-drydock-secondary' : 'dd-text-secondary'" />
                </div>
                <div class="min-w-0">
                  <div class="text-[12px] font-semibold" :class="iconLibrary === lib ? 'text-drydock-secondary' : 'dd-text'">
                    {{ label }}
                  </div>
                  <div class="text-[10px] dd-text-muted">
                    {{ lib }}
                  </div>
                </div>
                <div v-if="iconLibrary === lib" class="ml-auto shrink-0">
                  <AppIcon name="check" :size="14" class="text-drydock-secondary" />
                </div>
              </button>
            </div>
          </div>
        </div>

        <!-- Icon Size -->
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="px-5 py-3.5 flex items-center gap-2"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <AppIcon name="containers" :size="14" class="text-drydock-secondary" />
            <h2 class="text-sm font-semibold dd-text">Icon Size</h2>
          </div>
          <div class="p-5">
            <div class="flex items-center gap-4">
              <AppIcon name="dashboard" :size="10" class="dd-text-muted" />
              <input type="range" min="0.8" max="1.5" step="0.05"
                     :value="iconScale"
                     @input="setIconScale(parseFloat(($event.target as HTMLInputElement).value))"
                     class="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                     :style="{ background: 'var(--dd-border-strong)', accentColor: 'var(--dd-primary)' }" />
              <AppIcon name="dashboard" :size="20" class="dd-text-muted" />
            </div>
            <div class="text-center mt-2 text-[11px] dd-text-muted">
              {{ Math.round(iconScale * 100) }}%
            </div>
          </div>
        </div>

      </div><!-- end appearance tab -->

      <!-- LOGS TAB -->
      <div v-if="activeSettingsTab === 'logs'" class="space-y-6">
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="px-5 py-3.5 flex items-center justify-between gap-3"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="logs" :size="14" class="text-drydock-secondary" />
              <h2 class="text-sm font-semibold dd-text">Application Logs</h2>
            </div>
            <div class="text-[10px] dd-text-muted">
              Server Level: <span class="font-semibold dd-text capitalize">{{ appLogLevel }}</span>
            </div>
          </div>

          <div class="p-5 space-y-4">
            <div class="flex flex-wrap items-center gap-2">
              <select v-model="appLogLevelFilter"
                      class="px-2 py-1.5 dd-rounded text-[11px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
                <option value="all">All Levels</option>
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>

              <select v-model.number="appLogTail"
                      class="px-2 py-1.5 dd-rounded text-[11px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
                <option :value="50">Tail 50</option>
                <option :value="100">Tail 100</option>
                <option :value="500">Tail 500</option>
                <option :value="1000">Tail 1000</option>
              </select>

              <select v-model.number="autoFetchInterval"
                      class="px-2 py-1.5 dd-rounded text-[11px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
                <option v-for="opt in LOG_AUTO_FETCH_INTERVALS" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>

              <input v-model="appLogComponent"
                     type="text"
                     placeholder="Filter by component..."
                     class="flex-1 min-w-[180px] max-w-[280px] px-2.5 py-1.5 dd-rounded text-[11px] font-medium border outline-none dd-bg dd-text dd-placeholder dd-border-strong"
                     @keyup.enter="refreshAppLogs" />

              <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-bg-elevated dd-text hover:opacity-90"
                      :class="appLogsLoading ? 'opacity-50 pointer-events-none' : ''"
                      @click="refreshAppLogs">
                Apply
              </button>
              <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text"
                      :class="appLogsLoading ? 'opacity-50 pointer-events-none' : ''"
                      @click="resetLogFilters">
                Reset
              </button>
              <button class="p-1.5 dd-rounded transition-colors dd-text-muted hover:dd-text"
                      :class="appLogsLoading ? 'opacity-50 pointer-events-none' : ''"
                      title="Refresh"
                      @click="refreshAppLogs">
                <AppIcon name="refresh" :size="12" />
              </button>
            </div>

            <div class="text-[10px] dd-text-muted">
              Last fetched: {{ formatLastFetched(appLogsLastFetched) }}
            </div>

            <div v-if="appLogsLoading" class="text-[12px] dd-text-muted text-center py-6">
              Loading logs...
            </div>
            <div v-else-if="appLogsError"
                 class="text-[11px] px-3 py-2 dd-rounded"
                 :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
              {{ appLogsError }}
            </div>
            <div v-else ref="logContainer"
                 class="dd-rounded overflow-auto max-h-[420px] font-mono text-[11px]"
                 :style="{
                   backgroundColor: 'var(--dd-bg-inset)',
                   border: '1px solid var(--dd-border-strong)',
                 }"
                 @scroll="handleLogScroll">
              <div v-if="appLogEntries.length === 0"
                   class="px-3 py-4 dd-text-muted text-center">
                No log entries found for current filters.
              </div>
              <div v-else>
                <div v-for="(entry, index) in appLogEntries" :key="index"
                     class="px-3 py-2 flex gap-3 items-start"
                     :style="{ borderBottom: index < appLogEntries.length - 1 ? '1px solid var(--dd-border)' : 'none' }">
                  <span class="shrink-0 tabular-nums dd-text-muted">{{ formatLogTimestamp(entry.timestamp) }}</span>
                  <span class="shrink-0 uppercase font-semibold"
                        :style="{ color: getLevelColor(entry.level) }">
                    {{ entry.level || 'info' }}
                  </span>
                  <span class="shrink-0 dd-text-secondary">{{ entry.component || '-' }}</span>
                  <span class="dd-text break-all">{{ logMessage(entry) }}</span>
                </div>
              </div>
            </div>
            <div v-if="scrollBlocked && autoFetchInterval > 0"
                 class="flex items-center justify-between px-3 py-2 text-[10px]"
                 :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-warning-muted)' }">
              <span class="font-semibold" :style="{ color: 'var(--dd-warning)' }">Auto-scroll paused</span>
              <button class="px-2 py-0.5 dd-rounded text-[10px] font-semibold transition-colors"
                      :style="{ backgroundColor: 'var(--dd-warning)', color: 'var(--dd-bg)' }"
                      @click="resumeAutoScroll">
                Resume
              </button>
            </div>
          </div>
        </div>
      </div><!-- end logs tab -->

      <!-- PROFILE TAB -->
      <div v-if="activeSettingsTab === 'profile'" class="space-y-6">
        <!-- Profile Card -->
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="px-5 py-5 flex items-center justify-between gap-4"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-4 min-w-0">
              <div class="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold text-white shrink-0"
                   style="background: linear-gradient(135deg, var(--dd-primary), var(--dd-success));">
                {{ profileInitials }}
              </div>
              <div class="min-w-0">
                <div class="text-sm font-bold dd-text truncate">{{ profileDisplayName }}</div>
                <div class="text-[11px] dd-text-muted truncate">{{ profileData.email || profileData.username || '—' }}</div>
                <span v-if="profileData.role" class="badge text-[9px] font-semibold mt-1 inline-flex"
                      :style="{ backgroundColor: 'var(--dd-primary-muted)', color: 'var(--dd-primary)' }">
                  {{ profileData.role }}
                </span>
              </div>
            </div>
            <button
              data-testid="profile-refresh"
              class="px-2.5 py-1 dd-rounded text-[10px] font-semibold transition-colors dd-bg-elevated dd-text hover:opacity-90 disabled:opacity-50"
              :disabled="profileLoading"
              @click="loadProfileData">
              Refresh
            </button>
          </div>
          <div class="p-5 space-y-4">
            <div v-if="profileLoading" class="text-[12px] dd-text-muted text-center py-4">Loading...</div>
            <div v-else-if="profileError"
                 class="text-[11px] px-3 py-2 dd-rounded"
                 :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
              {{ profileError }}
            </div>
            <template v-else>
              <div class="flex items-center justify-between py-2"
                   :style="{ borderBottom: '1px solid var(--dd-border)' }">
                <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Username</span>
                <span class="text-[12px] font-medium font-mono dd-text">{{ profileData.username || '—' }}</span>
              </div>
              <div class="flex items-center justify-between py-2"
                   :style="{ borderBottom: '1px solid var(--dd-border)' }">
                <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Email</span>
                <span class="text-[12px] font-medium font-mono dd-text">{{ profileData.email || '—' }}</span>
              </div>
              <div class="flex items-center justify-between py-2"
                   :style="{ borderBottom: '1px solid var(--dd-border)' }">
                <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Role</span>
                <span class="text-[12px] font-medium font-mono dd-text">{{ profileData.role || '—' }}</span>
              </div>
              <div class="flex items-center justify-between py-2"
                   :style="{ borderBottom: '1px solid var(--dd-border)' }">
                <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Provider</span>
                <span class="text-[12px] font-medium font-mono dd-text">{{ profileData.provider || '—' }}</span>
              </div>
              <div class="flex items-center justify-between py-2"
                   :style="{ borderBottom: '1px solid var(--dd-border)' }">
                <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Last Login</span>
                <span class="text-[12px] font-medium font-mono dd-text">{{ profileData.lastLogin || '—' }}</span>
              </div>
              <div class="flex items-center justify-between py-2">
                <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Active Sessions</span>
                <span class="text-[12px] font-medium font-mono dd-text">{{ profileData.sessions }}</span>
              </div>
            </template>
          </div>
        </div>
      </div><!-- end profile tab -->
  </DataViewLayout>
</template>
