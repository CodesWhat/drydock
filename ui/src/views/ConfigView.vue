<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useIcons } from '../composables/useIcons';
import { getServer } from '../services/server';
import { useTheme } from '../theme/useTheme';

const { themeFamily, themeVariant, isDark, setThemeFamily, setThemeVariant, transitionTheme } =
  useTheme();

const { iconLibrary, setIconLibrary, iconScale, setIconScale } = useIcons();

const activeSettingsTab = ref<'general' | 'appearance'>('general');

const settingsTabs = [
  { id: 'general' as const, label: 'General', icon: 'settings' },
  { id: 'appearance' as const, label: 'Appearance', icon: 'config' },
];

const loading = ref(true);
const serverFields = ref<Array<{ label: string; value: string }>>([]);

onMounted(async () => {
  try {
    const [serverData, appData] = await Promise.all([
      getServer().catch(() => null),
      fetch('/api/app')
        .then((r) => r.json())
        .catch(() => null),
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
  } catch {
    serverFields.value = [{ label: 'Error', value: 'Failed to load server info' }];
  } finally {
    loading.value = false;
  }
});

const themeOptions = [
  { id: 'dark', label: 'Dark', icon: 'moon', iconClass: '' },
  { id: 'light', label: 'Light', icon: 'sun', iconClass: '' },
  { id: 'system', label: 'System', icon: '', iconClass: 'fa-solid fa-display' },
];

const fontOptions = [
  { id: 'mono', label: 'JetBrains Mono', family: '"JetBrains Mono", monospace' },
  { id: 'inter', label: 'Inter', family: '"Inter", sans-serif' },
  { id: 'system', label: 'System', family: 'system-ui, sans-serif' },
  { id: 'fira', label: 'Fira Code', family: '"Fira Code", monospace' },
];

const activeFont = ref('mono');
function setFont(id: string) {
  activeFont.value = id;
}

const radiusPresets = [
  { id: 'none', label: 'None', sm: 0, md: 0, lg: 0 },
  { id: 'sm', label: 'Small', sm: 2, md: 4, lg: 6 },
  { id: 'md', label: 'Medium', sm: 4, md: 8, lg: 12 },
  { id: 'lg', label: 'Large', sm: 6, md: 12, lg: 16 },
];

const activeRadius = ref('md');
function setRadius(id: string) {
  activeRadius.value = id;
}

const tableActionStyle = ref<'icons' | 'buttons'>('icons');
</script>

<template>
  <AppLayout>
    <div class="p-6">
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

        <!-- Theme -->
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="px-5 py-3.5 flex items-center gap-2"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <template v-if="themeVariant === 'system'"><i class="fa-solid fa-display text-[14px] text-drydock-secondary" /></template>
            <AppIcon v-else :name="isDark ? 'moon' : 'sun'" :size="14" class="text-drydock-secondary" />
            <h2 class="text-sm font-semibold dd-text">Theme</h2>
          </div>
          <div class="p-5">
            <div class="flex gap-2">
              <button v-for="opt in themeOptions" :key="opt.id"
                      class="flex items-center gap-2.5 px-4 py-3 dd-rounded transition-colors"
                      :class="themeVariant === opt.id ? 'ring-2 ring-drydock-secondary' : ''"
                      :style="{
                        backgroundColor: themeVariant === opt.id
                          ? 'var(--dd-primary-muted)'
                          : 'var(--dd-bg-inset)',
                        border: themeVariant === opt.id
                          ? '1.5px solid var(--dd-primary)'
                          : '1px solid var(--dd-border-strong)',
                      }"
                      @click="transitionTheme(() => setThemeVariant(opt.id as any), $event)">
                <i v-if="opt.iconClass" :class="[opt.iconClass, 'text-[16px]', themeVariant === opt.id ? 'text-drydock-secondary' : 'dd-text-muted']" />
                <AppIcon v-else :name="opt.icon" :size="16"
                         :class="themeVariant === opt.id ? 'text-drydock-secondary' : 'dd-text-muted'" />
                <span class="text-[12px] font-semibold"
                      :class="themeVariant === opt.id ? 'text-drydock-secondary' : 'dd-text-secondary'">
                  {{ opt.label }}
                </span>
              </button>
            </div>
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
                      :class="activeFont === f.id ? 'ring-2 ring-drydock-secondary' : ''"
                      :style="{
                        backgroundColor: activeFont === f.id
                          ? 'var(--dd-primary-muted)'
                          : 'var(--dd-bg-inset)',
                        border: activeFont === f.id
                          ? '1.5px solid var(--dd-primary)'
                          : '1px solid var(--dd-border-strong)',
                      }"
                      @click="setFont(f.id)">
                <div class="flex-1 min-w-0">
                  <div class="text-[13px] font-semibold truncate"
                       :style="{ fontFamily: f.family }"
                       :class="activeFont === f.id ? 'text-drydock-secondary' : 'dd-text'">
                    {{ f.label }}
                  </div>
                  <div class="text-[10px] mt-0.5 truncate dd-text-muted" :style="{ fontFamily: f.family }">
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

        <!-- Border Radius -->
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="px-5 py-3.5 flex items-center gap-2"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <AppIcon name="settings" :size="14" class="text-drydock-secondary" />
            <h2 class="text-sm font-semibold dd-text">Border Radius</h2>
          </div>
          <div class="p-5">
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button v-for="p in radiusPresets" :key="p.id"
                      class="flex flex-col items-center gap-2.5 px-4 py-3.5 dd-rounded transition-colors"
                      :class="activeRadius === p.id ? 'ring-2 ring-drydock-secondary' : ''"
                      :style="{
                        backgroundColor: activeRadius === p.id
                          ? 'var(--dd-primary-muted)'
                          : 'var(--dd-bg-inset)',
                        border: activeRadius === p.id
                          ? '1.5px solid var(--dd-primary)'
                          : '1px solid var(--dd-border-strong)',
                      }"
                      @click="setRadius(p.id)">
                <div class="w-12 h-8 border-2 transition-all"
                     :class="activeRadius === p.id ? 'border-drydock-secondary/60' : 'dd-border-strong'"
                     :style="{
                       borderRadius: p.md + 'px',
                       backgroundColor: activeRadius === p.id ? 'var(--dd-primary-muted)' : 'transparent',
                     }" />
                <div class="text-[12px] font-semibold"
                     :class="activeRadius === p.id ? 'text-drydock-secondary' : 'dd-text'">
                  {{ p.label }}
                </div>
                <div class="text-[10px] dd-text-muted">
                  {{ p.sm }}px / {{ p.md }}px / {{ p.lg }}px
                </div>
              </button>
            </div>
          </div>
        </div>

        <!-- Table Actions -->
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="px-5 py-3.5 flex items-center gap-2"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <AppIcon name="config" :size="14" class="text-drydock-secondary" />
            <h2 class="text-sm font-semibold dd-text">Table Actions</h2>
          </div>
          <div class="p-5">
            <div class="grid grid-cols-2 gap-2">
              <button v-for="opt in [{ id: 'icons', label: 'Icons', desc: 'Compact icon buttons' }, { id: 'buttons', label: 'Buttons', desc: 'Full split buttons' }]"
                      :key="opt.id"
                      class="flex flex-col items-center gap-1.5 px-4 py-3 dd-rounded transition-colors"
                      :class="tableActionStyle === opt.id ? 'ring-2 ring-drydock-secondary' : ''"
                      :style="{
                        backgroundColor: tableActionStyle === opt.id ? 'var(--dd-primary-muted)' : 'var(--dd-bg-inset)',
                        border: tableActionStyle === opt.id ? '1.5px solid var(--dd-primary)' : '1px solid var(--dd-border-strong)',
                      }"
                      @click="tableActionStyle = opt.id as 'icons' | 'buttons'">
                <div class="text-[12px] font-semibold"
                     :class="tableActionStyle === opt.id ? 'text-drydock-secondary' : 'dd-text'">
                  {{ opt.label }}
                </div>
                <div class="text-[10px] dd-text-muted">{{ opt.desc }}</div>
              </button>
            </div>
          </div>
        </div>

      </div><!-- end appearance tab -->
    </div>
  </AppLayout>
</template>
