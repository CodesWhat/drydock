<script setup lang="ts">
import { ref } from 'vue';
import { useConfirmDialog } from '../composables/useConfirmDialog';
import { type FontId, fontOptions, useFont } from '../composables/useFont';
import { useIcons } from '../composables/useIcons';
import { type IconLibrary, iconMap, libraryLabels } from '../icons';
import { themeFamilies } from '../theme/palettes';
import { useTheme } from '../theme/useTheme';

const { themeFamily, themeVariant, isDark, setThemeFamily, transitionTheme } = useTheme();
const { iconLibrary, setIconLibrary, iconScale, setIconScale } = useIcons();
const { activeFont, setFont, fontLoading, isFontLoaded } = useFont();
const confirm = useConfirmDialog();

type PlaygroundTab = 'customize' | 'components' | 'tokens';

const activeTab = ref<PlaygroundTab>('customize');

const tabs = [
  { id: 'customize' as const, label: 'Customize', icon: 'config' },
  { id: 'components' as const, label: 'Components', icon: 'containers' },
  { id: 'tokens' as const, label: 'Tokens', icon: 'dashboard' },
];

// --- Spinner ---
const spinSpeed = ref<'dd-spin-fast' | 'dd-spin' | 'dd-spin-slow'>('dd-spin');
const speedOptions = [
  { cls: 'dd-spin-fast', label: 'Fast' },
  { cls: 'dd-spin', label: 'Normal' },
  { cls: 'dd-spin-slow', label: 'Slow' },
] as const;

const spinnerCandidates = [
  { icon: 'ph:spinner-duotone', label: 'Spinner' },
  { icon: 'ph:spinner-gap-duotone', label: 'Spinner Gap' },
  { icon: 'ph:spinner-ball-duotone', label: 'Spinner Ball' },
  { icon: 'ph:circle-notch-duotone', label: 'Circle Notch' },
  { icon: 'ph:circle-dashed-duotone', label: 'Circle Dashed' },
  { icon: 'ph:arrow-clockwise-duotone', label: 'Arrow CW' },
  { icon: 'ph:arrows-clockwise-duotone', label: 'Arrows CW' },
  { icon: 'ph:gear-duotone', label: 'Gear' },
  { icon: 'ph:gear-fine-duotone', label: 'Gear Fine' },
  { icon: 'ph:gear-six-duotone', label: 'Gear Six' },
  { icon: 'ph:fan-duotone', label: 'Fan' },
  { icon: 'ph:hourglass-duotone', label: 'Hourglass' },
];
const selectedSpinner = ref(spinnerCandidates[0].icon);
const demoToggle = ref(true);

// --- Border Radius ---
const radiusPresets = [
  { id: 'none', label: 'None', sm: 0, md: 0, lg: 0 },
  { id: 'sharp', label: 'Sharp', sm: 2, md: 3, lg: 4 },
  { id: 'modern', label: 'Modern', sm: 4, md: 8, lg: 12 },
  { id: 'soft', label: 'Soft', sm: 6, md: 12, lg: 16 },
  { id: 'round', label: 'Round', sm: 8, md: 16, lg: 24 },
];

function loadRadius() {
  try {
    return localStorage.getItem('drydock-radius-v1') || 'sharp';
  } catch {
    return 'sharp';
  }
}
const activeRadius = ref(loadRadius());
function setRadius(id: string) {
  activeRadius.value = id;
  const p = radiusPresets.find((r) => r.id === id) ?? radiusPresets[1];
  const el = document.documentElement;
  el.style.setProperty('--dd-radius', `${p.md}px`);
  el.style.setProperty('--dd-radius-sm', `${p.sm}px`);
  el.style.setProperty('--dd-radius-lg', `${p.lg}px`);
  try {
    localStorage.setItem('drydock-radius-v1', id);
  } catch {
    /* ignored */
  }
}
setRadius(activeRadius.value);

// --- Confirm Dialog demos ---
const lastConfirmResult = ref('');

function demoConfirmStop() {
  confirm.require({
    header: 'Stop Container',
    message: 'Stop nginx-proxy?',
    rejectLabel: 'Cancel',
    acceptLabel: 'Stop',
    severity: 'danger',
    accept: () => {
      lastConfirmResult.value = 'Stopped nginx-proxy';
    },
    reject: () => {
      lastConfirmResult.value = 'Cancelled stop';
    },
  });
}

function demoConfirmRestart() {
  confirm.require({
    header: 'Restart Container',
    message: 'Restart postgres-db?',
    rejectLabel: 'Cancel',
    acceptLabel: 'Restart',
    severity: 'warn',
    accept: () => {
      lastConfirmResult.value = 'Restarted postgres-db';
    },
    reject: () => {
      lastConfirmResult.value = 'Cancelled restart';
    },
  });
}

function demoConfirmIgnore() {
  confirm.require({
    header: 'Ignore Container',
    message: 'Ignore redis-cache? It will no longer be monitored for updates.',
    rejectLabel: 'Cancel',
    acceptLabel: 'Ignore',
    severity: 'danger',
    accept: () => {
      lastConfirmResult.value = 'Ignored redis-cache';
    },
    reject: () => {
      lastConfirmResult.value = 'Cancelled ignore';
    },
  });
}

// --- Playground data ---
const playgroundLogs = [
  '[info]  nginx/1.25.3 started',
  '[info]  listening on 0.0.0.0:80',
  '[info]  listening on 0.0.0.0:443',
  '[info]  upstream server 10.0.1.5:3000 connected',
  '[info]  GET /api/health 200 1ms',
  '[info]  GET /api/containers 200 23ms',
  '[warn]  upstream slow response: 510ms',
  '[info]  GET /api/health 200 1ms',
  '[error] connection refused: 10.0.1.8:5432',
  '[info]  TLS handshake completed',
  '[info]  GET /api/containers 200 18ms',
  '[warn]  rate limit reached for 192.168.1.50',
];

const playgroundContainers = [
  {
    name: 'nginx-proxy',
    image: 'nginx',
    tag: '1.25.3',
    newTag: '1.25.4',
    status: 'running',
    registry: 'dockerhub',
  },
  {
    name: 'postgres-db',
    image: 'postgres',
    tag: '16.1',
    newTag: '16.2',
    status: 'running',
    registry: 'dockerhub',
  },
  {
    name: 'redis-cache',
    image: 'redis',
    tag: '7.2.3',
    newTag: null,
    status: 'running',
    registry: 'dockerhub',
  },
  {
    name: 'drydock',
    image: 'ghcr.io/drydock/drydock',
    tag: 'v1.3.0',
    newTag: 'v1.4.0',
    status: 'stopped',
    registry: 'ghcr',
  },
];

const playgroundTableRows = [
  {
    name: 'traefik',
    image: 'traefik',
    oldVer: '2.10.7',
    newVer: '3.0.1',
    status: 'updated',
    time: '12m ago',
    running: true,
  },
  {
    name: 'postgres-db',
    image: 'postgres',
    oldVer: '15.4',
    newVer: '16.1',
    status: 'pending',
    time: '34m ago',
    running: true,
  },
  {
    name: 'redis-cache',
    image: 'redis',
    oldVer: '7.0.12',
    newVer: '7.2.4',
    status: 'updated',
    time: '1h ago',
    running: true,
  },
  {
    name: 'nginx-proxy',
    image: 'nginx',
    oldVer: '1.24.0',
    newVer: '1.25.3',
    status: 'failed',
    time: '2h ago',
    running: false,
  },
  {
    name: 'grafana',
    image: 'grafana/grafana',
    oldVer: '10.1.5',
    newVer: '10.2.3',
    status: 'updated',
    time: '3h ago',
    running: true,
  },
];

const tableSortKey = ref('name');
const tableSortAsc = ref(true);
const tableColumns = [
  { key: 'name', label: 'Container', sortable: true },
  { key: 'image', label: 'Image', sortable: true },
  { key: 'version', label: 'Version', sortable: false },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'time', label: 'Time', align: 'text-right', sortable: false },
];

const colorTokens = [
  { name: 'primary', var: '--dd-primary' },
  { name: 'primary-muted', var: '--dd-primary-muted' },
  { name: 'success', var: '--dd-success' },
  { name: 'success-muted', var: '--dd-success-muted' },
  { name: 'danger', var: '--dd-danger' },
  { name: 'danger-muted', var: '--dd-danger-muted' },
  { name: 'warning', var: '--dd-warning' },
  { name: 'warning-muted', var: '--dd-warning-muted' },
  { name: 'info', var: '--dd-info' },
  { name: 'info-muted', var: '--dd-info-muted' },
  { name: 'bg', var: '--dd-bg' },
  { name: 'bg-card', var: '--dd-bg-card' },
  { name: 'bg-inset', var: '--dd-bg-inset' },
  { name: 'bg-elevated', var: '--dd-bg-elevated' },
  { name: 'bg-code', var: '--dd-bg-code' },
  { name: 'border', var: '--dd-border' },
  { name: 'border-strong', var: '--dd-border-strong' },
  { name: 'text', var: '--dd-text' },
  { name: 'text-secondary', var: '--dd-text-secondary' },
  { name: 'text-muted', var: '--dd-text-muted' },
];
</script>

<template>
  <DataViewLayout>
    <!-- Tabs -->
    <div class="flex gap-1 mb-6"
         :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
      <button v-for="tab in tabs" :key="tab.id"
              class="px-4 py-2.5 text-[12px] font-semibold transition-colors relative"
              :class="activeTab === tab.id
                ? 'text-drydock-secondary'
                : 'dd-text-muted hover:dd-text'"
              @click="activeTab = tab.id">
        <AppIcon :name="tab.icon" :size="12" class="mr-1.5" />
        {{ tab.label }}
        <div v-if="activeTab === tab.id"
             class="absolute bottom-0 left-0 right-0 h-[2px] bg-drydock-secondary rounded-t-full" />
      </button>
    </div>

    <!-- ==================== CUSTOMIZE TAB ==================== -->
    <div v-if="activeTab === 'customize'" class="space-y-6">

      <!-- Color Theme -->
      <div class="dd-rounded overflow-hidden"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <div class="flex items-center gap-2 px-5 py-3"
             :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
          <AppIcon name="settings" :size="14" class="text-drydock-secondary" />
          <h2 class="text-sm font-semibold dd-text">Color Theme</h2>
        </div>
        <div class="p-4">
          <div class="grid grid-cols-2 gap-3">
            <button v-for="fam in themeFamilies" :key="fam.id"
                    class="dd-rounded p-3 text-left transition-[color,background-color,border-color,opacity,transform,box-shadow] border"
                    :class="themeFamily === fam.id ? 'ring-2 ring-drydock-secondary' : ''"
                    :style="{
                      backgroundColor: themeFamily === fam.id ? 'var(--dd-primary-muted)' : 'var(--dd-bg-inset)',
                      border: themeFamily === fam.id ? '1px solid var(--dd-primary)' : '1px solid var(--dd-border-strong)',
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
              <div class="text-[10px] dd-text-muted">{{ fam.description }}</div>
            </button>
          </div>
        </div>
      </div>

      <!-- Theme Variant -->
      <div class="dd-rounded overflow-hidden"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <div class="px-5 py-3.5 flex items-center gap-2"
             :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
          <AppIcon :name="themeVariant === 'system' ? 'monitor' : isDark ? 'moon' : 'sun'" :size="14" class="text-drydock-secondary" />
          <h2 class="text-sm font-semibold dd-text">Theme Variant</h2>
        </div>
        <div class="p-5 flex items-center gap-4">
          <ThemeToggle size="md" />
          <span class="text-[12px] font-semibold dd-text-secondary capitalize">{{ themeVariant }}</span>
        </div>
      </div>

      <!-- Font Family -->
      <div class="dd-rounded overflow-hidden"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
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
                      backgroundColor: activeFont === f.id ? 'var(--dd-primary-muted)' : 'var(--dd-bg-inset)',
                      border: activeFont === f.id ? '1.5px solid var(--dd-primary)' : '1px solid var(--dd-border-strong)',
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
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
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
                      backgroundColor: iconLibrary === lib ? 'var(--dd-primary-muted)' : 'var(--dd-bg-inset)',
                      border: iconLibrary === lib ? '1.5px solid var(--dd-primary)' : '1px solid var(--dd-border-strong)',
                    }"
                    @click="setIconLibrary(lib as IconLibrary)">
              <div class="w-8 h-8 dd-rounded flex items-center justify-center"
                   :style="{ backgroundColor: iconLibrary === lib ? 'var(--dd-primary-muted)' : 'var(--dd-bg-elevated)' }">
                <iconify-icon :icon="iconMap['dashboard']?.[lib as IconLibrary]" width="18" height="18"
                              :class="iconLibrary === lib ? 'text-drydock-secondary' : 'dd-text-secondary'" />
              </div>
              <div class="min-w-0">
                <div class="text-[12px] font-semibold" :class="iconLibrary === lib ? 'text-drydock-secondary' : 'dd-text'">
                  {{ label }}
                </div>
                <div class="text-[10px] dd-text-muted">{{ lib }}</div>
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
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
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
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <div class="px-5 py-3.5 flex items-center gap-2"
             :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
          <AppIcon name="settings" :size="14" class="text-drydock-secondary" />
          <h2 class="text-sm font-semibold dd-text">Border Radius</h2>
        </div>
        <div class="p-5">
          <div class="grid grid-cols-5 gap-2">
            <button v-for="p in radiusPresets" :key="p.id"
                    class="flex flex-col items-center gap-2 px-3 py-3 dd-rounded transition-colors"
                    :class="activeRadius === p.id ? 'ring-2 ring-drydock-secondary' : ''"
                    :style="{
                      backgroundColor: activeRadius === p.id ? 'var(--dd-primary-muted)' : 'var(--dd-bg-inset)',
                      border: activeRadius === p.id ? '1.5px solid var(--dd-primary)' : '1px solid var(--dd-border-strong)',
                    }"
                    @click="setRadius(p.id)">
              <div class="w-10 h-7 border-2 transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                   :class="activeRadius === p.id ? 'border-drydock-secondary/60' : 'dd-border-strong'"
                   :style="{ borderRadius: p.md + 'px', backgroundColor: activeRadius === p.id ? 'var(--dd-primary-muted)' : 'transparent' }" />
              <div class="text-[11px] font-semibold"
                   :class="activeRadius === p.id ? 'text-drydock-secondary' : 'dd-text'">{{ p.label }}</div>
            </button>
          </div>
        </div>
      </div>

      <!-- Brand Spinner -->
      <div class="dd-rounded overflow-hidden"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <div class="px-5 py-3.5 flex items-center gap-2"
             :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
          <iconify-icon icon="ph:spinner-duotone" width="14" class="text-drydock-secondary dd-spin" />
          <h2 class="text-sm font-semibold dd-text">Brand Spinner</h2>
          <div class="flex items-center gap-1 ml-auto">
            <button v-for="sp in speedOptions" :key="sp.cls"
                    class="px-2.5 py-1 dd-rounded text-[10px] font-semibold transition-colors"
                    :class="spinSpeed === sp.cls ? 'text-drydock-secondary' : 'dd-text-muted hover:dd-text'"
                    :style="spinSpeed === sp.cls ? { backgroundColor: 'var(--dd-primary-muted)', border: '1px solid var(--dd-primary)' } : { border: '1px solid var(--dd-border-strong)' }"
                    @click="spinSpeed = sp.cls">
              {{ sp.label }}
            </button>
          </div>
        </div>
        <div class="p-5">
          <div class="flex flex-wrap gap-2">
            <button v-for="s in spinnerCandidates" :key="s.icon"
                    class="flex items-center gap-2 px-3 py-2 dd-rounded transition-colors"
                    :class="selectedSpinner === s.icon ? 'ring-2 ring-drydock-secondary' : ''"
                    :style="{
                      backgroundColor: selectedSpinner === s.icon ? 'var(--dd-primary-muted)' : 'var(--dd-bg-inset)',
                      border: selectedSpinner === s.icon ? '1px solid var(--dd-primary)' : '1px solid var(--dd-border-strong)',
                    }"
                    @click="selectedSpinner = s.icon">
              <iconify-icon :icon="s.icon" width="20"
                            :class="[spinSpeed, selectedSpinner === s.icon ? 'text-drydock-secondary' : 'dd-text-secondary']" />
              <span class="text-[10px] font-semibold"
                    :class="selectedSpinner === s.icon ? 'text-drydock-secondary' : 'dd-text-muted'">{{ s.label }}</span>
            </button>
          </div>
        </div>
      </div>
    </div><!-- end customize tab -->

    <!-- ==================== COMPONENTS TAB ==================== -->
    <div v-if="activeTab === 'components'" class="space-y-6">

      <!-- Buttons -->
      <div class="dd-rounded overflow-hidden"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <div class="px-5 py-3.5 flex items-center gap-2"
             :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
          <AppIcon name="containers" :size="14" class="text-drydock-secondary" />
          <h2 class="text-sm font-semibold dd-text">Buttons</h2>
        </div>
        <div class="p-5 space-y-4">
          <div class="flex flex-wrap gap-2">
            <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold text-white"
                    :style="{ backgroundColor: 'var(--dd-primary)' }">Primary</button>
            <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold dd-text"
                    :style="{ backgroundColor: 'var(--dd-bg-inset)', border: '1px solid var(--dd-border-strong)' }">Secondary</button>
            <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold"
                    :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }">Danger</button>
            <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold"
                    :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)', border: '1px solid var(--dd-success)' }">Success</button>
            <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold"
                    :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)', border: '1px solid var(--dd-warning)' }">Warning</button>
            <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold dd-text-muted" disabled
                    :style="{ backgroundColor: 'var(--dd-bg-inset)', border: '1px solid var(--dd-border)', opacity: 0.5 }">Disabled</button>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="px-4 py-2 dd-rounded text-[12px] font-bold text-white"
                    :style="{ backgroundColor: 'var(--dd-primary)' }">
              <AppIcon name="play" :size="12" class="mr-1.5" />Start
            </button>
            <button class="px-4 py-2 dd-rounded text-[12px] font-bold"
                    :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
              <AppIcon name="stop" :size="12" class="mr-1.5" />Stop
            </button>
            <button class="px-4 py-2 dd-rounded text-[12px] font-bold"
                    :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
              <AppIcon name="pause" :size="12" class="mr-1.5" />Pause
            </button>
          </div>
        </div>
      </div>

      <!-- Badges & Status -->
      <div class="dd-rounded overflow-hidden"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <div class="px-5 py-3.5 flex items-center gap-2"
             :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
          <AppIcon name="security" :size="14" class="text-drydock-secondary" />
          <h2 class="text-sm font-semibold dd-text">Badges & Status</h2>
        </div>
        <div class="p-5 space-y-4">
          <div class="flex flex-wrap gap-2 items-center">
            <span class="badge text-[10px]" :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }">running</span>
            <span class="badge text-[10px]" :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">stopped</span>
            <span class="badge text-[10px]" :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">paused</span>
            <span class="badge text-[10px]" :style="{ backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' }">updating</span>
            <span class="badge text-[10px]" :style="{ backgroundColor: 'var(--dd-bg-elevated)', color: 'var(--dd-text-muted)' }">unknown</span>
          </div>
          <div class="flex flex-wrap gap-3 items-center">
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full" style="background: var(--dd-success);" />
              <span class="text-[11px] dd-text-secondary">Connected</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full" style="background: var(--dd-danger);" />
              <span class="text-[11px] dd-text-secondary">Disconnected</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full animate-pulse" style="background: var(--dd-warning);" />
              <span class="text-[11px] dd-text-secondary">Syncing</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Inputs -->
      <div class="dd-rounded overflow-hidden"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <div class="px-5 py-3.5 flex items-center gap-2"
             :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
          <AppIcon name="terminal" :size="14" class="text-drydock-secondary" />
          <h2 class="text-sm font-semibold dd-text">Inputs</h2>
        </div>
        <div class="p-5 space-y-4">
          <div class="space-y-1.5">
            <label class="block text-[10px] font-semibold uppercase tracking-wider dd-text-muted">Text Input</label>
            <input type="text" placeholder="Enter something..." class="w-full px-3 py-2 text-[12px] dd-rounded dd-text dd-placeholder"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)', border: '1px solid var(--dd-border-strong)' }" />
          </div>
          <div class="space-y-1.5">
            <label class="block text-[10px] font-semibold uppercase tracking-wider dd-text-muted">Select</label>
            <select class="dd-select w-full px-3 py-2 text-[12px] dd-rounded dd-text"
                    :style="{ backgroundColor: 'var(--dd-bg-inset)', border: '1px solid var(--dd-border-strong)' }">
              <option>Option A</option>
              <option>Option B</option>
              <option>Option C</option>
            </select>
          </div>
          <div class="flex items-center gap-3">
            <label class="text-[11px] font-semibold dd-text">Toggle example</label>
            <ToggleSwitch v-model="demoToggle" />
          </div>
        </div>
      </div>

      <!-- Cards -->
      <div class="dd-rounded overflow-hidden"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <div class="px-5 py-3.5 flex items-center gap-2"
             :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
          <AppIcon name="dashboard" :size="14" class="text-drydock-secondary" />
          <h2 class="text-sm font-semibold dd-text">Cards</h2>
        </div>
        <div class="p-5">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="dd-rounded p-4 stat-card"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)', border: '1px solid var(--dd-border-strong)', borderLeftColor: 'var(--dd-success)' }">
              <div class="text-[10px] font-semibold uppercase tracking-wider dd-text-muted mb-1">Running</div>
              <div class="text-xl font-bold dd-text">12</div>
            </div>
            <div class="dd-rounded p-4 stat-card"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)', border: '1px solid var(--dd-border-strong)', borderLeftColor: 'var(--dd-danger)' }">
              <div class="text-[10px] font-semibold uppercase tracking-wider dd-text-muted mb-1">Stopped</div>
              <div class="text-xl font-bold dd-text">3</div>
            </div>
            <div class="dd-rounded p-4 stat-card"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)', border: '1px solid var(--dd-border-strong)', borderLeftColor: 'var(--dd-warning)' }">
              <div class="text-[10px] font-semibold uppercase tracking-wider dd-text-muted mb-1">Updates</div>
              <div class="text-xl font-bold dd-text">5</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Container Cards -->
      <DataCardGrid
        :items="playgroundContainers"
        item-key="name"
        min-width="280px">
        <template #card="{ item: c }">
          <!-- Card header -->
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="flex items-center gap-2.5 min-w-0">
              <AppIcon name="containers" :size="24" class="dd-text-secondary shrink-0" />
              <div class="min-w-0">
                <div class="text-[15px] font-semibold truncate dd-text">{{ c.name }}</div>
                <div class="text-[11px] truncate mt-0.5 dd-text-muted">{{ c.image }}:{{ c.tag }}</div>
              </div>
            </div>
            <span class="badge text-[9px] uppercase tracking-wide font-bold shrink-0 ml-2"
                  :style="{ backgroundColor: 'var(--dd-primary-muted)', color: 'var(--dd-primary)' }">
              {{ c.registry }}
            </span>
          </div>
          <!-- Card body -->
          <div class="px-4 py-3 min-w-0">
            <div class="flex items-center gap-2 flex-wrap min-w-0">
              <span class="text-[11px] dd-text-muted shrink-0">Current</span>
              <span class="text-[12px] font-bold dd-text truncate max-w-[120px]">{{ c.tag }}</span>
              <template v-if="c.newTag">
                <span class="text-[11px] ml-1 dd-text-muted shrink-0">Latest</span>
                <span class="px-1.5 py-0.5 dd-rounded-sm text-[11px] font-bold"
                      :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
                  {{ c.newTag }}
                </span>
              </template>
              <template v-else>
                <AppIcon name="check" :size="14" class="ml-1" style="color: var(--dd-success);" />
              </template>
            </div>
          </div>
          <!-- Card footer -->
          <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <span class="badge text-[9px] font-bold"
                  :style="{
                    backgroundColor: c.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                    color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                  }">
              {{ c.status }}
            </span>
            <div class="flex items-center gap-1.5">
              <button v-if="c.status === 'running'"
                      class="w-7 h-7 dd-rounded-sm flex items-center justify-center transition-colors dd-text-muted hover:dd-text-danger hover:dd-bg-elevated"
                      v-tooltip.top="{ value: 'Stop', showDelay: 400 }">
                <AppIcon name="stop" :size="14" />
              </button>
              <button v-else
                      class="w-7 h-7 dd-rounded-sm flex items-center justify-center transition-colors dd-text-muted hover:dd-text-success hover:dd-bg-elevated"
                      v-tooltip.top="{ value: 'Start', showDelay: 400 }">
                <AppIcon name="play" :size="14" />
              </button>
              <button class="w-7 h-7 dd-rounded-sm flex items-center justify-center transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                      v-tooltip.top="{ value: 'Restart', showDelay: 400 }">
                <AppIcon name="restart" :size="14" />
              </button>
              <button v-if="c.newTag"
                      class="w-7 h-7 dd-rounded-sm flex items-center justify-center transition-colors dd-text-muted hover:dd-text-success hover:dd-bg-elevated"
                      v-tooltip.top="{ value: 'Update', showDelay: 400 }">
                <AppIcon name="cloud-download" :size="14" />
              </button>
            </div>
          </div>
        </template>
      </DataCardGrid>

      <!-- Data Table -->
      <DataTable
        :columns="tableColumns"
        :rows="playgroundTableRows"
        row-key="name"
        :sort-key="tableSortKey"
        :sort-asc="tableSortAsc"
        @update:sort-key="tableSortKey = $event"
        @update:sort-asc="tableSortAsc = $event">
        <template #cell-name="{ row }">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full shrink-0"
                  :style="{ backgroundColor: row.running ? 'var(--dd-success)' : 'var(--dd-text-muted)' }" />
            <span class="font-medium dd-text">{{ row.name }}</span>
          </div>
        </template>
        <template #cell-image="{ row }">
          <span class="dd-text-secondary">{{ row.image }}</span>
        </template>
        <template #cell-version="{ row }">
          <div class="flex items-center gap-1.5">
            <span class="text-[11px] dd-text-secondary">{{ row.oldVer }}</span>
            <AppIcon name="arrow-right" :size="8" class="dd-text-muted shrink-0" />
            <span class="text-[11px] font-semibold" style="color: var(--dd-primary);">{{ row.newVer }}</span>
          </div>
        </template>
        <template #cell-status="{ row }">
          <span class="badge text-[10px]"
                :style="{
                  backgroundColor: row.status === 'updated' ? 'var(--dd-success-muted)' : row.status === 'pending' ? 'var(--dd-warning-muted)' : 'var(--dd-danger-muted)',
                  color: row.status === 'updated' ? 'var(--dd-success)' : row.status === 'pending' ? 'var(--dd-warning)' : 'var(--dd-danger)',
                }">
            {{ row.status }}
          </span>
        </template>
        <template #cell-time="{ row }">
          <span class="dd-text-muted">{{ row.time }}</span>
        </template>
      </DataTable>

      <!-- Tooltips & Confirm Dialogs -->
      <ConfirmDialog />
      <div class="dd-rounded overflow-hidden"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <div class="px-5 py-3.5 flex items-center gap-2"
             :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
          <AppIcon name="security" :size="14" class="text-drydock-secondary" />
          <h2 class="text-sm font-semibold dd-text">Tooltips & Confirm Dialogs</h2>
        </div>
        <div class="p-5 space-y-5">
          <div>
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Tooltips (hover)</div>
            <div class="flex flex-wrap gap-2">
              <button v-tooltip.top="{ value: 'Stop container', showDelay: 400 }"
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-colors dd-text-danger hover:dd-bg-elevated"
                      :style="{ border: '1px solid var(--dd-border-strong)' }">
                <AppIcon name="stop" :size="14" />
              </button>
              <button v-tooltip.top="{ value: 'Start container', showDelay: 400 }"
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-colors dd-text-success hover:dd-bg-elevated"
                      :style="{ border: '1px solid var(--dd-border-strong)' }">
                <AppIcon name="play" :size="14" />
              </button>
              <button v-tooltip.top="{ value: 'Restart container', showDelay: 400 }"
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                      :style="{ border: '1px solid var(--dd-border-strong)' }">
                <AppIcon name="restart" :size="14" />
              </button>
              <button v-tooltip.top="{ value: 'Update container', showDelay: 400 }"
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-colors hover:dd-bg-elevated"
                      :style="{ color: 'var(--dd-primary)', border: '1px solid var(--dd-border-strong)' }">
                <AppIcon name="cloud-download" :size="14" />
              </button>
              <button v-tooltip.top="{ value: 'Blocked by Bouncer', showDelay: 400 }"
                      class="w-8 h-8 dd-rounded flex items-center justify-center cursor-not-allowed dd-text-muted opacity-50"
                      :style="{ border: '1px solid var(--dd-border-strong)' }">
                <AppIcon name="lock" :size="13" />
              </button>
              <button v-tooltip.top="{ value: 'More actions', showDelay: 400 }"
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                      :style="{ border: '1px solid var(--dd-border-strong)' }">
                <AppIcon name="more" :size="13" />
              </button>
            </div>
          </div>
          <div>
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Confirm Dialogs (click)</div>
            <div class="flex flex-wrap gap-2">
              <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold"
                      :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }"
                      @click="demoConfirmStop">
                <AppIcon name="stop" :size="10" class="mr-1" />Stop
              </button>
              <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold dd-text-muted hover:dd-text"
                      :style="{ border: '1px solid var(--dd-border-strong)' }"
                      @click="demoConfirmRestart">
                <AppIcon name="restart" :size="10" class="mr-1" />Restart
              </button>
              <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold"
                      :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }"
                      @click="demoConfirmIgnore">
                <AppIcon name="eye-slash" :size="11" class="mr-1" />Ignore
              </button>
            </div>
            <div v-if="lastConfirmResult" class="mt-2 text-[11px] font-mono dd-text-secondary px-2.5 py-1.5 dd-rounded"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              Result: {{ lastConfirmResult }}
            </div>
          </div>
        </div>
      </div>
    </div><!-- end components tab -->

    <!-- ==================== TOKENS TAB ==================== -->
    <div v-if="activeTab === 'tokens'" class="space-y-6">

      <!-- Color Tokens -->
      <div class="dd-rounded overflow-hidden"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <div class="px-5 py-3.5 flex items-center gap-2"
             :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
          <AppIcon name="config" :size="14" class="text-drydock-secondary" />
          <h2 class="text-sm font-semibold dd-text">Color Tokens</h2>
        </div>
        <div class="p-5">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div v-for="token in colorTokens" :key="token.var"
                 class="flex items-center gap-2 p-2 dd-rounded"
                 :style="{ border: '1px solid var(--dd-border)' }">
              <div class="w-5 h-5 dd-rounded-sm shrink-0"
                   :style="{ backgroundColor: `var(${token.var})`, border: '1px solid var(--dd-border-strong)' }" />
              <span class="text-[10px] font-mono dd-text-muted truncate">{{ token.name }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Typography -->
      <div class="dd-rounded overflow-hidden"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <div class="px-5 py-3.5 flex items-center gap-2"
             :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
          <AppIcon name="terminal" :size="14" class="text-drydock-secondary" />
          <h2 class="text-sm font-semibold dd-text">Typography</h2>
        </div>
        <div class="p-5 space-y-3">
          <div class="text-lg font-bold dd-text">Heading Large</div>
          <div class="text-sm font-semibold dd-text">Heading Small</div>
          <div class="text-[12px] dd-text-secondary">Body text — The quick brown fox jumps over the lazy dog</div>
          <div class="text-[11px] dd-text-muted">Muted caption text</div>
          <div class="text-[11px] font-mono dd-text" :style="{ backgroundColor: 'var(--dd-bg-inset)', padding: '8px 12px', borderRadius: 'var(--dd-radius)' }">
            <span class="dd-text-muted">$</span> docker compose up -d
          </div>
        </div>
      </div>

      <!-- Terminal / Log View -->
      <div class="dd-rounded overflow-hidden"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <div class="px-5 py-3.5 flex items-center gap-2"
             :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
          <AppIcon name="terminal" :size="14" class="text-drydock-secondary" />
          <h2 class="text-sm font-semibold dd-text">Terminal / Log View</h2>
        </div>
        <div class="p-5">
          <div class="dd-rounded-lg p-3 font-mono text-[10px] leading-relaxed overflow-x-auto"
               :style="{ backgroundColor: 'var(--dd-bg-code)' }">
            <div v-for="(line, i) in playgroundLogs" :key="i" class="flex">
              <span class="w-6 shrink-0 text-right mr-3 select-none dd-text-muted">{{ i + 1 }}</span>
              <span :class="line.startsWith('[warn]') ? 'dd-text-warning'
                : line.startsWith('[error]') ? 'dd-text-danger'
                : 'dd-text-success'">{{ line }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Status Bar -->
      <div class="dd-rounded overflow-hidden"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <div class="px-5 py-3.5 flex items-center gap-2"
             :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
          <AppIcon name="dashboard" :size="14" class="text-drydock-secondary" />
          <h2 class="text-sm font-semibold dd-text">Status Bar</h2>
        </div>
        <div class="p-5 space-y-3">
          <div class="flex dd-rounded-lg overflow-hidden h-8">
            <div class="flex items-center justify-center text-[10px] font-bold text-white transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                 style="width: 80%; background: var(--dd-success);">38</div>
            <div class="flex items-center justify-center text-[10px] font-bold text-white transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                 style="width: 13%; background: var(--dd-warning);">6</div>
            <div class="flex items-center justify-center text-[10px] font-bold text-white transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                 style="width: 7%; background: var(--dd-danger);">3</div>
          </div>
          <div class="flex items-center gap-5 text-[10px]">
            <div class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full dd-bg-success" />
              <span class="dd-text-secondary">Running (38)</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full dd-bg-warning" />
              <span class="dd-text-secondary">Stopped (6)</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full dd-bg-danger" />
              <span class="dd-text-secondary">Errored (3)</span>
            </div>
          </div>
        </div>
      </div>
    </div><!-- end tokens tab -->
  </DataViewLayout>
</template>
