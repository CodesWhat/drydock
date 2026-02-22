<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { type FontId, fontOptions, useFont } from '../composables/useFont';
import { useIcons } from '../composables/useIcons';
import { type IconLibrary, iconMap, libraryLabels } from '../icons';
import { clearIconCache, getSettings, updateSettings } from '../services/settings';
import { getServer } from '../services/server';
import { themeFamilies } from '../theme/palettes';
import { useTheme } from '../theme/useTheme';

const { themeFamily, themeVariant, isDark, setThemeFamily, transitionTheme } = useTheme();

const { iconLibrary, setIconLibrary, iconScale, setIconScale } = useIcons();
const { activeFont, setFont, fontLoading, isFontLoaded } = useFont();

const activeSettingsTab = ref<'general' | 'appearance'>('general');

const settingsTabs = [
  { id: 'general' as const, label: 'General', icon: 'settings' },
  { id: 'appearance' as const, label: 'Appearance', icon: 'config' },
];

const loading = ref(true);
const serverFields = ref<Array<{ label: string; value: string }>>([]);

// Settings state
const internetlessMode = ref(false);
const settingsLoading = ref(false);

onMounted(async () => {
  try {
    const [serverData, appData, settings] = await Promise.all([
      getServer().catch(() => null),
      fetch('/api/app')
        .then((r) => r.json())
        .catch(() => null),
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
  } catch {
    serverFields.value = [{ label: 'Error', value: 'Failed to load server info' }];
  } finally {
    loading.value = false;
  }
});

async function toggleInternetlessMode() {
  settingsLoading.value = true;
  try {
    const updated = await updateSettings({ internetlessMode: !internetlessMode.value });
    internetlessMode.value = updated.internetlessMode;
  } finally {
    settingsLoading.value = false;
  }
}

const cacheClearing = ref(false);
const cacheCleared = ref<number | null>(null);

async function handleClearIconCache() {
  cacheClearing.value = true;
  cacheCleared.value = null;
  try {
    const result = await clearIconCache();
    cacheCleared.value = result.cleared;
  } finally {
    cacheClearing.value = false;
  }
}

</script>

<template>
  <div class="flex-1 min-h-0 overflow-y-auto">
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
              <button
                class="relative w-10 h-5 dd-rounded-lg transition-colors"
                :class="settingsLoading ? 'opacity-50 pointer-events-none' : ''"
                :style="{
                  backgroundColor: internetlessMode ? 'var(--dd-primary)' : 'var(--dd-border-strong)',
                }"
                @click="toggleInternetlessMode">
                <span class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform"
                      :class="internetlessMode ? 'translate-x-5' : 'translate-x-0'" />
              </button>
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
                  Container icons are cached to disk on first fetch
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
  </div>
</template>
