<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { useTheme } from './theme/useTheme';
import { themeFamilies } from './theme/palettes';

const { isDark, themeFamily, themeVariant, setThemeFamily, setThemeVariant, toggleVariant } = useTheme();

const tokens = ref({
  sm: getComputedStyle(document.documentElement).getPropertyValue('--dd-radius-sm').trim() || '2',
  md: getComputedStyle(document.documentElement).getPropertyValue('--dd-radius').trim() || '3',
  lg: getComputedStyle(document.documentElement).getPropertyValue('--dd-radius-lg').trim() || '4',
});

function applyTokens() {
  document.documentElement.style.setProperty('--dd-radius-sm', tokens.value.sm.includes('px') ? tokens.value.sm : tokens.value.sm + 'px');
  document.documentElement.style.setProperty('--dd-radius', tokens.value.md.includes('px') ? tokens.value.md : tokens.value.md + 'px');
  document.documentElement.style.setProperty('--dd-radius-lg', tokens.value.lg.includes('px') ? tokens.value.lg : tokens.value.lg + 'px');
}

const presets = [
  { name: 'Sharp', sm: '2', md: '3', lg: '4' },
  { name: 'Modern', sm: '4', md: '6', lg: '8' },
  { name: 'Soft', sm: '6', md: '10', lg: '14' },
  { name: 'Pill', sm: '8', md: '16', lg: '24' },
  { name: 'Round', sm: '12', md: '20', lg: '9999' },
];

function applyPreset(p: typeof presets[number]) {
  tokens.value = { sm: p.sm, md: p.md, lg: p.lg };
  applyTokens();
}

applyTokens();

// Interactive state
const toggleA = ref(true);
const toggleB = ref(false);
const activeNav = ref('dashboard');
const activeTab = ref('overview');
const detailOpen = ref(true);
const accordionOpen = reactive<Record<string, boolean>>({ registry: true, trigger: false });
const searchOpen = ref(false);
const logPaused = ref(false);
const selectedContainer = ref('traefik');

// Mock log lines
const logLines = [
  { time: '14:23:01', level: 'info', component: 'watcher.docker.local', msg: 'Cron started (0 * * * *)' },
  { time: '14:23:02', level: 'info', component: 'watcher.docker.local', msg: 'Found 8 containers to watch' },
  { time: '14:23:03', level: 'warn', component: 'registry.ghcr', msg: 'Rate limit approaching (42/60 remaining)' },
  { time: '14:23:04', level: 'error', component: 'trigger.smtp.email', msg: 'Connection refused: ECONNREFUSED 127.0.0.1:587' },
  { time: '14:23:05', level: 'debug', component: 'api', msg: 'GET /api/containers 200 12ms' },
  { time: '14:23:06', level: 'info', component: 'watcher.docker.local', msg: 'Cron finished (8 watched, 0 errors, 5 updates)' },
];

const logLevelColor = (level: string) => {
  switch (level) {
    case 'error': return 'dd-text-danger';
    case 'warn': return 'dd-text-warning';
    case 'debug': return 'dd-text-muted';
    default: return 'dd-text-success';
  }
};
</script>

<template>
  <div class="min-h-screen p-8 transition-colors dd-text"
       :style="{ background: 'var(--dd-bg)', fontFamily: 'IBM Plex Mono, monospace' }">

    <div class="max-w-7xl mx-auto">

      <!-- ─── HEADER ─────────────────────────────────────── -->
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-2xl font-bold mb-1">Drydock Style Guide</h1>
          <p class="text-sm dd-text-secondary">
            Complete component reference with live
            <code class="dd-rounded-sm px-1.5 py-0.5 text-[10px] dd-bg-card text-drydock-secondary">--dd-radius</code> controls
          </p>
        </div>
        <button class="dd-rounded px-3 py-1.5 text-xs font-medium transition-colors border dd-bg-card dd-text dd-border hover:dd-bg-elevated"
                @click="toggleVariant()">
          {{ themeVariant === 'dark' ? 'Light Mode' : themeVariant === 'light' ? 'System' : 'Dark Mode' }}
        </button>
      </div>

      <!-- ─── RADIUS CONTROLS (sticky) ───────────────────── -->
      <div class="sticky top-0 z-50 dd-rounded p-4 mb-8 border backdrop-blur-sm dd-bg-elevated dd-border">
        <div class="flex items-center gap-3 mb-3 flex-wrap">
          <span class="text-[10px] font-semibold uppercase tracking-wider dd-text-secondary">Presets</span>
          <button v-for="p in presets" :key="p.name"
                  class="dd-rounded-sm px-3 py-1 text-[10px] font-medium transition-colors border dd-bg-card dd-text dd-border-strong hover:dd-border-primary"
                  @click="applyPreset(p)">
            {{ p.name }}
          </button>
        </div>
        <div class="grid grid-cols-3 gap-6">
          <div v-for="(label, key) in { sm: '--dd-radius-sm', md: '--dd-radius', lg: '--dd-radius-lg' }" :key="key">
            <label class="block text-[9px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">{{ label }}</label>
            <div class="flex items-center gap-2">
              <input type="range" min="0" max="32" step="1"
                     v-model="tokens[key]" @input="applyTokens()"
                     class="flex-1" style="accent-color: var(--dd-primary);">
              <span class="text-xs font-bold w-10 text-right tabular-nums"
                    :class="isDark ? 'text-drydock-secondary' : 'text-drydock-primary'">{{ tokens[key] }}px</span>
            </div>
          </div>
        </div>
        <!-- Theme family -->
        <div class="flex items-center gap-3 flex-wrap">
          <span class="text-[10px] font-semibold uppercase tracking-wider dd-text-secondary">Theme</span>
          <button v-for="fam in themeFamilies" :key="fam.id"
                  class="dd-rounded-sm px-3 py-1 text-[10px] font-medium transition-colors border flex items-center gap-1.5"
                  :class="themeFamily === fam.id
                    ? (isDark ? 'bg-drydock-secondary/15 text-drydock-secondary border-drydock-secondary/40' : 'bg-drydock-secondary/10 text-drydock-secondary border-drydock-secondary/30')
                    : 'dd-bg-card dd-text dd-border-strong hover:dd-border-primary'"
                  @click="setThemeFamily(fam.id)">
            <span class="w-2.5 h-2.5 rounded-full border"
                  :style="{ backgroundColor: isDark ? fam.swatchDark : fam.swatchLight, borderColor: fam.accent }" />
            {{ fam.label }}
          </button>
          <span class="text-[10px] font-semibold uppercase tracking-wider ml-4 dd-text-secondary">Mode</span>
          <button v-for="mode in ['dark', 'light', 'system']" :key="mode"
                  class="dd-rounded-sm px-2.5 py-1 text-[10px] font-medium transition-colors border capitalize"
                  :class="themeVariant === mode
                    ? (isDark ? 'bg-drydock-secondary/15 text-drydock-secondary border-drydock-secondary/40' : 'bg-drydock-secondary/10 text-drydock-secondary border-drydock-secondary/30')
                    : 'dd-bg-card dd-text dd-border-strong hover:dd-border-primary'"
                  @click="setThemeVariant(mode as any)">
            {{ mode }}
          </button>
        </div>
      </div>

      <!-- ─── GRID ───────────────────────────────────────── -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <!-- ═══════════════ 1. STATUS DOTS ═══════════════ -->
        <section class="dd-rounded p-5 border dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Status Indicators</h2>
          <div class="flex flex-wrap items-center gap-4">
            <div class="flex items-center gap-2">
              <div class="w-2.5 h-2.5 rounded-full dd-bg-success" />
              <span class="text-xs dd-text">Running</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-2.5 h-2.5 rounded-full dd-bg-danger" />
              <span class="text-xs dd-text">Stopped</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-2.5 h-2.5 rounded-full dd-bg-warning" />
              <span class="text-xs dd-text">Restarting</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-2.5 h-2.5 rounded-full dd-bg-elevated" />
              <span class="text-xs dd-text">Disconnected</span>
            </div>
          </div>
          <div class="flex items-center gap-4 mt-4">
            <span class="text-[10px] uppercase tracking-wider dd-text-muted">Notification badge</span>
            <div class="relative">
              <div class="dd-rounded w-8 h-8 flex items-center justify-center dd-bg-card dd-text-secondary">
                <iconify-icon icon="ph-duotone:bell" width="16" />
              </div>
              <span class="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-bold text-white"
                    style="background: var(--dd-danger); animation: pulse-badge 2s ease-in-out infinite;">3</span>
            </div>
            <div class="relative">
              <div class="dd-rounded w-8 h-8 flex items-center justify-center dd-bg-card dd-text-secondary">
                <iconify-icon icon="ph-duotone:bell" width="16" />
              </div>
              <span class="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-bold text-white"
                    style="background: var(--dd-warning);">12</span>
            </div>
          </div>
          <div class="flex items-center gap-4 mt-4">
            <span class="text-[10px] uppercase tracking-wider dd-text-muted">Trend indicators</span>
            <span class="flex items-center gap-1 text-xs dd-text-success">
              <iconify-icon icon="ph-duotone:trend-up" width="14" /> +12%
            </span>
            <span class="flex items-center gap-1 text-xs dd-text-danger">
              <iconify-icon icon="ph-duotone:trend-down" width="14" /> -3%
            </span>
            <span class="flex items-center gap-1 text-xs dd-text-muted">
              <iconify-icon icon="ph-duotone:minus" width="14" /> 0%
            </span>
          </div>
        </section>

        <!-- ═══════════════ 2. BADGES & CHIPS ═══════════════ -->
        <section class="dd-rounded p-5 border dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Badges & Chips
            <span class="text-[10px] font-normal ml-2 opacity-60">--dd-radius-sm</span>
          </h2>
          <div class="space-y-3">
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Status</span>
              <div class="flex flex-wrap items-center gap-2">
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-success-muted dd-text-success">Running</span>
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-danger-muted dd-text-danger">Stopped</span>
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-warning-muted dd-text-warning">Restarting</span>
              </div>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Registry</span>
              <div class="flex flex-wrap items-center gap-2">
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-info-muted dd-text-info">DOCKERHUB</span>
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-alt-muted dd-text-alt">GHCR</span>
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-warning-muted dd-text-warning">QUAY</span>
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-danger-muted dd-text-danger">ECR</span>
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-primary-muted dd-text-primary">GCR</span>
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-caution-muted dd-text-caution">GITLAB</span>
              </div>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Severity</span>
              <div class="flex flex-wrap items-center gap-2">
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-bold leading-none text-white" style="background: var(--dd-danger);">CRITICAL</span>
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-bold leading-none text-white" style="background: var(--dd-warning);">HIGH</span>
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-bold leading-none text-white" style="background: var(--dd-primary);">MEDIUM</span>
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-bold leading-none dd-bg-elevated dd-text">LOW</span>
              </div>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Update kind / Version</span>
              <div class="flex flex-wrap items-center gap-2">
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-danger-muted dd-text-danger border dd-border-danger">major</span>
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-warning-muted dd-text-warning border dd-border-warning">minor</span>
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-card dd-text-secondary border dd-border">patch</span>
                <span class="dd-rounded-sm inline-flex items-center px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-success-muted dd-text-success border dd-border-success">3.0.1</span>
              </div>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Bouncer</span>
              <div class="flex flex-wrap items-center gap-2">
                <span class="dd-rounded-sm inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-success-muted dd-text-success">
                  <iconify-icon icon="ph-duotone:check-circle" width="12" /> safe</span>
                <span class="dd-rounded-sm inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-danger-muted dd-text-danger">
                  <iconify-icon icon="ph-duotone:x-circle" width="12" /> blocked</span>
                <span class="dd-rounded-sm inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold leading-none dd-bg-warning-muted dd-text-warning">
                  <iconify-icon icon="ph-duotone:warning" width="12" /> unsafe</span>
              </div>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Labels / Tags</span>
              <div class="flex flex-wrap items-center gap-2">
                <span class="dd-rounded-sm inline-flex items-center px-2 py-0.5 text-[10px] leading-none dd-bg-card dd-text-secondary">dd.rollback.auto=true</span>
                <span class="dd-rounded-sm inline-flex items-center px-2 py-0.5 text-[10px] leading-none dd-bg-card dd-text-secondary">dd.rollback.window=120000</span>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 3. BUTTONS ═══════════════ -->
        <section class="dd-rounded p-5 border dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Buttons
            <span class="text-[10px] font-normal ml-2 opacity-60">--dd-radius</span>
          </h2>
          <div class="space-y-4">
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Primary / Variants</span>
              <div class="flex flex-wrap items-center gap-2">
                <button class="dd-rounded px-4 py-2 text-xs font-semibold text-white bg-drydock-secondary hover:opacity-90 transition-opacity">Primary</button>
                <button class="dd-rounded px-4 py-2 text-xs font-semibold transition-colors border dd-text dd-border-strong dd-bg-card hover:dd-bg-elevated">Secondary</button>
                <button class="dd-rounded px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity" style="background: var(--dd-danger);">Danger</button>
                <button class="dd-rounded px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity" style="background: var(--dd-success);">Success</button>
                <button class="dd-rounded px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
                        style="background: linear-gradient(135deg, var(--dd-primary), color-mix(in srgb, var(--dd-primary) 70%, var(--dd-info)));">Gradient</button>
              </div>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Small / Tiny</span>
              <div class="flex flex-wrap items-center gap-2">
                <button class="dd-rounded px-3 py-1.5 text-[11px] font-medium transition-colors border dd-text-secondary dd-border hover:dd-bg-elevated"> Small</button>
                <button class="dd-rounded-sm px-2.5 py-1 text-[10px] font-medium transition-colors dd-text-secondary dd-bg-card hover:dd-bg-elevated"> Tiny</button>
                <button class="dd-rounded px-3 py-1.5 text-[11px] font-medium transition-colors border opacity-40 cursor-not-allowed dd-text-muted dd-border dd-bg-card"> Disabled</button>
              </div>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Icon buttons</span>
              <div class="flex items-center gap-2">
                <button class="dd-rounded w-8 h-8 flex items-center justify-center transition-colors dd-bg-card dd-text-secondary hover:dd-bg-elevated"> 
                  <iconify-icon icon="ph-duotone:moon" width="16" /></button>
                <button class="dd-rounded w-8 h-8 flex items-center justify-center transition-colors dd-bg-card dd-text-secondary hover:dd-bg-elevated"> 
                  <iconify-icon icon="ph-duotone:bell" width="16" /></button>
                <button class="dd-rounded w-8 h-8 flex items-center justify-center transition-colors dd-bg-card dd-text-secondary hover:dd-bg-elevated"> 
                  <iconify-icon icon="ph-duotone:gear-six" width="16" /></button>
              </div>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Action buttons (colored)</span>
              <div class="flex items-center gap-2">
                <button class="dd-rounded-sm w-7 h-7 flex items-center justify-center dd-text-danger transition-colors opacity-70 hover:opacity-100 hover:dd-bg-elevated">
                  <iconify-icon icon="ph-duotone:stop" width="14" /></button>
                <button class="dd-rounded-sm w-7 h-7 flex items-center justify-center dd-text-success transition-colors opacity-70 hover:opacity-100 hover:dd-bg-elevated">
                  <iconify-icon icon="ph-duotone:play" width="14" /></button>
                <button class="dd-rounded-sm w-7 h-7 flex items-center justify-center transition-colors dd-text-muted hover:dd-bg-elevated">
                  <iconify-icon icon="ph-duotone:arrow-clockwise" width="14" /></button>
                <button class="dd-rounded-sm w-7 h-7 flex items-center justify-center dd-text-warning transition-colors opacity-70 hover:opacity-100 hover:dd-bg-elevated">
                  <iconify-icon icon="ph-duotone:cloud-arrow-down" width="14" /></button>
                <button class="dd-rounded-sm w-7 h-7 flex items-center justify-center transition-colors dd-text-muted hover:dd-bg-elevated"> 
                  <iconify-icon icon="ph-duotone:dots-three" width="14" /></button>
              </div>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Panel size selector</span>
              <div class="flex items-center gap-1">
                <button v-for="s in ['S', 'M', 'L']" :key="s"
                        class="dd-rounded-sm w-6 h-6 flex items-center justify-center text-[11px] font-medium transition-colors"
                        :class="s === 'M'
                          ? 'bg-drydock-secondary/20 text-drydock-secondary'
                          : 'dd-text-muted hover:dd-bg-elevated'">{{ s }}</button>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 4. INPUTS, SELECTS, TOGGLES ═══════════════ -->
        <section class="dd-rounded p-5 border dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Inputs, Selects & Controls</h2>
          <div class="space-y-4">
            <div class="flex flex-wrap gap-3">
              <input type="text" placeholder="Search containers..."
                     class="dd-rounded px-3 py-2 text-xs border outline-none transition-colors w-48 dd-bg-card dd-border dd-text focus:border-drydock-secondary"> 
              <select class="dd-rounded px-3 py-2 text-xs border outline-none transition-colors dd-bg-card dd-border dd-text"> 
                <option>STATUS</option><option>Running</option><option>Stopped</option>
              </select>
              <select class="dd-rounded px-3 py-2 text-xs border outline-none transition-colors dd-bg-card dd-border dd-text"> 
                <option>REGISTRY</option><option>Docker Hub</option><option>GHCR</option>
              </select>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Toggle switches</span>
              <div class="flex items-center gap-6">
                <label class="flex items-center gap-2 cursor-pointer" @click="toggleA = !toggleA">
                  <div class="relative w-8 h-4 rounded-full transition-colors"
                       :class="toggleA ? 'dd-bg-success' : 'dd-bg-elevated'">
                    <div class="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform"
                         :style="{ transform: toggleA ? 'translateX(17px)' : 'translateX(2px)' }" />
                  </div>
                  <span class="text-xs dd-text">Auto-scroll</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer" @click="toggleB = !toggleB">
                  <div class="relative w-8 h-4 rounded-full transition-colors"
                       :class="toggleB ? 'dd-bg-success' : 'dd-bg-elevated'">
                    <div class="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform"
                         :style="{ transform: toggleB ? 'translateX(17px)' : 'translateX(2px)' }" />
                  </div>
                  <span class="text-xs dd-text">Enabled</span>
                </label>
              </div>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Checkbox</span>
              <div class="flex items-center gap-4">
                <label class="flex items-center gap-2 cursor-pointer">
                  <div class="w-3.5 h-3.5 dd-rounded-sm border flex items-center justify-center"
                       :class="isDark ? 'border-drydock-secondary bg-drydock-secondary/20' : 'border-drydock-secondary bg-drydock-secondary/10'">
                    <iconify-icon icon="ph:check-bold" width="10" class="text-drydock-secondary" />
                  </div>
                  <span class="text-xs dd-text">Updates only</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                  <div class="w-3.5 h-3.5 dd-rounded-sm border dd-border-strong"
                        />
                  <span class="text-xs dd-text">Unchecked</span>
                </label>
              </div>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Keyboard shortcuts</span>
              <div class="flex items-center gap-3">
                <kbd class="dd-rounded-sm px-1.5 py-0.5 text-[10px] font-medium border dd-bg-card dd-text-secondary dd-border-strong">⌘K</kbd>
                <kbd class="dd-rounded-sm px-1.5 py-0.5 text-[10px] font-medium border dd-bg-card dd-text-secondary dd-border-strong">ESC</kbd>
                <kbd class="dd-rounded-sm px-1.5 py-0.5 text-[10px] font-medium border dd-bg-card dd-text-secondary dd-border-strong">Enter</kbd>
              </div>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Range slider</span>
              <div class="flex items-center gap-3 w-64">
                <iconify-icon icon="ph-duotone:text-aa" width="12" class="dd-text-muted" />
                <input type="range" min="0.8" max="1.5" step="0.05" value="1.15"
                       class="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                       :style="{ background: 'var(--dd-border-strong)', accentColor: 'var(--dd-primary)' }">
                <iconify-icon icon="ph-duotone:text-aa" width="18" class="dd-text-muted" />
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 5. NAV, TABS, BREADCRUMBS ═══════════════ -->
        <section class="dd-rounded p-5 border dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Navigation, Tabs & Breadcrumbs</h2>
          <div class="grid grid-cols-2 gap-6">
            <!-- Sidebar nav -->
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Sidebar nav</span>
              <div class="flex flex-col gap-0.5">
                <div v-for="item in [
                  { id: 'dashboard', label: 'Dashboard', icon: 'ph-duotone:house' },
                  { id: 'containers', label: 'Containers', icon: 'ph-duotone:cube', badge: 8 },
                  { id: 'updates', label: 'Updates', icon: 'ph-duotone:cloud-arrow-down', badge: 5, badgeColor: 'var(--dd-warning)' },
                  { id: 'security', label: 'Security', icon: 'ph-duotone:shield-warning', badge: 2, badgeColor: 'var(--dd-danger)' },
                  { id: 'logs', label: 'Logs', icon: 'ph-duotone:terminal' },
                ]" :key="item.id"
                     class="dd-rounded flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors relative"
                     :class="activeNav === item.id
                       ? (isDark ? 'bg-drydock-secondary/10 text-drydock-secondary' : 'bg-drydock-secondary/10 text-drydock-primary')
                       : 'dd-text-muted hover:dd-bg-elevated'"
                     :style="activeNav === item.id ? 'border-left: 3px solid var(--dd-primary)' : 'border-left: 3px solid transparent'"
                     @click="activeNav = item.id">
                  <iconify-icon :icon="item.icon" width="16" />
                  <span class="text-xs font-medium flex-1">{{ item.label }}</span>
                  <span v-if="item.badge"
                        class="dd-rounded-sm min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[9px] font-bold text-white"
                        :style="{ background: item.badgeColor || 'var(--dd-neutral)' }">{{ item.badge }}</span>
                </div>
              </div>
            </div>
            <!-- Tabs + Breadcrumb -->
            <div class="space-y-4">
              <div>
                <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Segmented tabs</span>
                <div class="flex gap-0.5 p-1 dd-rounded dd-bg-card">
                  <button v-for="t in ['All', 'Major', 'Minor', 'Patch']" :key="t"
                          class="dd-rounded px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors"
                          :class="t === 'All' ? 'dd-bg-elevated dd-text' : 'dd-text-muted'">{{ t }}</button>
                </div>
              </div>
              <div>
                <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Underline tabs</span>
                <div class="flex gap-4 border-b dd-border">
                  <button v-for="t in ['Overview', 'Logs', 'Security', 'Triggers']" :key="t"
                          class="pb-2 text-[11px] font-semibold uppercase tracking-wide transition-colors relative"
                          :class="activeTab === t.toLowerCase()
                            ? 'text-drydock-secondary'
                            : 'dd-text-muted'"
                          @click="activeTab = t.toLowerCase()">
                    {{ t }}
                    <div v-if="activeTab === t.toLowerCase()" class="absolute bottom-0 left-0 right-0 h-0.5 bg-drydock-secondary rounded-t-full" />
                  </button>
                </div>
              </div>
              <div>
                <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Breadcrumb</span>
                <div class="flex items-center gap-1.5 text-xs">
                  <iconify-icon icon="ph-duotone:house" width="14" class="text-drydock-secondary" />
                  <span class="dd-text-muted">/</span>
                  <span class="dd-text-secondary">Configuration</span>
                  <span class="dd-text-muted">/</span>
                  <span class="dd-text">Triggers</span>
                </div>
              </div>
              <div>
                <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Search bar</span>
                <button class="dd-rounded flex items-center gap-2 px-3 py-1.5 text-xs w-full transition-colors border dd-bg-card dd-border dd-text-muted"> 
                  <iconify-icon icon="ph-duotone:magnifying-glass" width="14" />
                  <span class="flex-1 text-left">Search containers, images, settings...</span>
                  <kbd class="dd-rounded-sm px-1.5 py-0.5 text-[10px] font-medium dd-bg-elevated dd-text-secondary">⌘K</kbd>
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 6. STAT CARDS ═══════════════ -->
        <section class="dd-rounded p-5 border lg:col-span-2 dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Stat Cards
            <span class="text-[10px] font-normal ml-2 opacity-60">--dd-radius + border-left-4</span>
          </h2>
          <div class="grid grid-cols-4 gap-4">
            <div v-for="stat in [
              { label: 'Containers', value: '10', trend: '+2', trendUp: true, color: 'var(--dd-primary)', icon: 'ph-duotone:cube' },
              { label: 'Updates', value: '5', trend: '-1', trendUp: false, color: 'var(--dd-success)', icon: 'ph-duotone:cloud-arrow-down' },
              { label: 'Security Issues', value: '2', trend: '+1', trendUp: true, color: 'var(--dd-danger)', icon: 'ph-duotone:shield-warning' },
              { label: 'Uptime', value: '99.9%', trend: '0%', trendUp: null, color: 'var(--dd-warning)', icon: 'ph-duotone:clock' },
            ]" :key="stat.label"
                 class="dd-rounded p-4 border-l-4 dd-bg-elevated"
                 :style="{ borderLeftColor: stat.color }">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[10px] uppercase tracking-wider dd-text-muted">{{ stat.label }}</span>
                <div class="dd-rounded w-8 h-8 flex items-center justify-center" :style="{ background: `color-mix(in srgb, ${stat.color} 15%, transparent)`, color: stat.color }">
                  <iconify-icon :icon="stat.icon" width="16" />
                </div>
              </div>
              <div class="text-2xl font-bold dd-text">{{ stat.value }}</div>
              <div class="flex items-center gap-1 mt-1 text-[10px]"
                   :class="stat.trendUp === true ? 'dd-text-success' : stat.trendUp === false ? 'dd-text-danger' : 'dd-text-muted'">
                <iconify-icon v-if="stat.trendUp === true" icon="ph-duotone:trend-up" width="12" />
                <iconify-icon v-else-if="stat.trendUp === false" icon="ph-duotone:trend-down" width="12" />
                <iconify-icon v-else icon="ph-duotone:minus" width="12" />
                {{ stat.trend }}
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 7. CONTAINER CARDS ═══════════════ -->
        <section class="dd-rounded p-5 border lg:col-span-2 dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Container Cards</h2>
          <div class="grid grid-cols-3 gap-4">
            <div v-for="c in [
              { name: 'traefik', image: 'traefik:2.10.7', current: '2.10.7', latest: '3.0.1', status: 'running', registry: 'DOCKERHUB', kind: 'major', selected: true },
              { name: 'postgres-db', image: 'postgres:15.4', current: '15.4', latest: '16.1', status: 'running', registry: 'DOCKERHUB', kind: 'major', selected: false },
              { name: 'redis-cache', image: 'redis:7.2.4', current: '7.2.4', latest: '7.2.4', status: 'stopped', registry: 'GHCR', kind: null, selected: false },
            ]" :key="c.name"
                 class="dd-rounded p-4 cursor-pointer transition-all border"
                 :class="[
                   'dd-bg-card',
                   c.selected ? 'ring-2 ring-drydock-secondary border-transparent' : 'dd-border hover:dd-border-primary',
                 ]">
              <div class="flex items-center justify-between mb-1">
                <div class="flex items-center gap-2">
                  <div class="w-2.5 h-2.5 rounded-full" :class="c.status === 'running' ? 'dd-bg-success' : 'dd-bg-danger'" />
                  <span class="text-sm font-bold dd-text">{{ c.name }}</span>
                </div>
                <span class="dd-rounded-sm inline-flex items-center px-2 py-0.5 text-[10px] font-semibold leading-none dd-bg-info-muted dd-text-info">{{ c.registry }}</span>
              </div>
              <div class="text-[11px] mb-3 dd-text-muted">{{ c.image }}</div>
              <!-- Version comparison -->
              <div class="flex items-center gap-2 mb-3">
                <span class="text-xs dd-text-secondary">Current</span>
                <span class="text-sm font-bold dd-text">{{ c.current }}</span>
                <template v-if="c.kind">
                  <iconify-icon icon="ph:arrow-right" width="12" class="dd-text-muted" />
                  <span class="dd-rounded-sm inline-flex items-center px-2 py-0.5 text-[11px] font-bold leading-none dd-bg-success-muted dd-text-success">{{ c.latest }}</span>
                  <span class="dd-rounded-sm inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold leading-none"
                        :class="c.kind === 'major' ? 'dd-bg-danger-muted dd-text-danger' : 'dd-bg-warning-muted dd-text-warning'">{{ c.kind }}</span>
                </template>
                <template v-else>
                  <iconify-icon icon="ph-duotone:check-circle" width="14" class="dd-text-success" />
                  <span class="text-xs dd-text-success font-medium">Up to date</span>
                </template>
              </div>
              <div class="flex items-center justify-between pt-2 border-t dd-border">
                <span class="text-xs font-semibold" :class="c.status === 'running' ? 'dd-text-success' : 'dd-text-danger'">{{ c.status === 'running' ? 'Running' : 'Stopped' }}</span>
                <div class="flex gap-1.5">
                  <button class="dd-rounded-sm w-6 h-6 flex items-center justify-center dd-text-danger transition-colors opacity-60 hover:opacity-100 hover:dd-bg-elevated">
                    <iconify-icon icon="ph-duotone:stop" width="13" /></button>
                  <button class="dd-rounded-sm w-6 h-6 flex items-center justify-center transition-colors dd-text-muted hover:dd-bg-elevated">
                    <iconify-icon icon="ph-duotone:arrow-clockwise" width="13" /></button>
                  <button v-if="c.kind" class="dd-rounded-sm w-6 h-6 flex items-center justify-center dd-text-warning transition-colors opacity-60 hover:opacity-100 hover:dd-bg-elevated">
                    <iconify-icon icon="ph-duotone:cloud-arrow-down" width="13" /></button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 8. FILTER BAR ═══════════════ -->
        <section class="dd-rounded p-5 border lg:col-span-2 dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Filter Bar</h2>
          <div class="dd-rounded px-3 py-2 flex items-center gap-3 flex-wrap dd-bg"> 
            <select class="dd-rounded px-2.5 py-1.5 text-[11px] border outline-none dd-bg-card dd-border dd-text">
              <option>STATUS</option></select>
            <select class="dd-rounded px-2.5 py-1.5 text-[11px] border outline-none dd-bg-card dd-border dd-text">
              <option>BOUNCER</option></select>
            <select class="dd-rounded px-2.5 py-1.5 text-[11px] border outline-none dd-bg-card dd-border dd-text">
              <option>REGISTRY</option></select>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <div class="w-3.5 h-3.5 dd-rounded-sm border flex items-center justify-center dd-border-strong"
                    />
              <span class="text-[11px] uppercase font-semibold tracking-wide dd-text-secondary">UPDATES</span>
            </label>
            <span class="ml-auto text-[10px] dd-text-muted">Showing 8 of 10</span>
          </div>
        </section>

        <!-- ═══════════════ 9. TABLE (with sorting + complex cells) ═══════════════ -->
        <section class="dd-rounded p-5 border lg:col-span-2 dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Tables</h2>
          <div class="dd-rounded overflow-hidden border dd-border">
            <table class="w-full text-xs">
              <thead>
                <tr class="dd-bg">
                  <th class="text-left px-4 py-2.5 font-semibold dd-text-secondary">Container</th>
                  <th class="text-left px-4 py-2.5 font-semibold dd-text-secondary">Image</th>
                  <th class="text-left px-4 py-2.5 font-semibold dd-text-secondary">Status</th>
                  <th class="text-left px-4 py-2.5 font-semibold cursor-pointer group dd-text-secondary">
                    Update
                    <iconify-icon icon="ph:caret-up-down" width="10" class="ml-0.5 opacity-50 group-hover:opacity-100" />
                  </th>
                  <th class="text-left px-4 py-2.5 font-semibold cursor-pointer group dd-text-secondary">
                    Severity
                    <iconify-icon icon="ph:caret-down" width="10" class="ml-0.5 text-drydock-secondary" />
                  </th>
                  <th class="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in [
                  { name: 'traefik', image: 'traefik:2.10.7', status: 'Running', update: '3.0.1', kind: 'major', severity: 'CRITICAL' },
                  { name: 'postgres-db', image: 'postgres:15.4', status: 'Running', update: '16.1', kind: 'major', severity: 'HIGH' },
                  { name: 'redis-cache', image: 'redis:7.2.4', status: 'Stopped', update: null, kind: null, severity: 'LOW' },
                  { name: 'grafana', image: 'grafana/grafana:11.4.0', status: 'Running', update: '11.5.2', kind: 'minor', severity: null },
                ]" :key="row.name"
                    class="border-t transition-colors dd-border hover:dd-bg-elevated"> 
                  <td class="px-4 py-2.5 font-medium dd-text">
                    <div class="flex items-center gap-2">
                      <div class="w-2 h-2 rounded-full" :class="row.status === 'Running' ? 'dd-bg-success' : 'dd-bg-danger'" />
                      {{ row.name }}
                    </div>
                  </td>
                  <td class="px-4 py-2.5 dd-text-secondary">{{ row.image }}</td>
                  <td class="px-4 py-2.5">
                    <span class="dd-rounded-sm inline-flex items-center px-2 py-0.5 text-[10px] font-semibold leading-none"
                          :class="row.status === 'Running' ? 'dd-bg-success-muted dd-text-success' : 'dd-bg-danger-muted dd-text-danger'">{{ row.status }}</span>
                  </td>
                  <td class="px-4 py-2.5">
                    <div v-if="row.update" class="flex items-center gap-1.5">
                      <span class="dd-rounded-sm inline-flex items-center px-2 py-0.5 text-[10px] font-semibold leading-none dd-bg-success-muted dd-text-success border dd-border-success">{{ row.update }}</span>
                      <span class="dd-rounded-sm inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold leading-none"
                            :class="row.kind === 'major' ? 'dd-bg-danger-muted dd-text-danger' : 'dd-bg-warning-muted dd-text-warning'">{{ row.kind }}</span>
                    </div>
                    <span v-else class="text-[10px] dd-text-muted">—</span>
                  </td>
                  <td class="px-4 py-2.5">
                    <span v-if="row.severity" class="dd-rounded-sm inline-flex items-center px-2 py-0.5 text-[10px] font-bold leading-none text-white"
                          :style="{ background: row.severity === 'CRITICAL' ? 'var(--dd-danger)' : row.severity === 'HIGH' ? 'var(--dd-warning)' : row.severity === 'MEDIUM' ? 'var(--dd-primary)' : 'var(--dd-neutral)' }">{{ row.severity }}</span>
                    <span v-else class="text-[10px] dd-text-muted">—</span>
                  </td>
                  <td class="px-4 py-2.5">
                    <button class="dd-rounded-sm w-6 h-6 flex items-center justify-center transition-colors dd-text-muted hover:dd-bg-elevated"> 
                      <iconify-icon icon="ph-duotone:dots-three" width="14" /></button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ═══════════════ 10. ACCORDION / COLLAPSIBLE CARDS ═══════════════ -->
        <section class="dd-rounded p-5 border dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Collapsible Cards</h2>
          <div class="space-y-2">
            <div v-for="item in [
              { key: 'registry', icon: 'ph-duotone:package', name: 'Docker Hub', type: 'hub', status: 'connected', fields: { URL: 'https://registry-1.docker.io/v2', Auth: 'Token', Images: '24' } },
              { key: 'trigger', icon: 'ph-duotone:bell-ringing', name: 'Discord Alerts', type: 'discord', status: 'active', fields: { Webhook: 'https://discord.com/api/webhooks/...', Events: 'update-available', Format: 'embed' } },
            ]" :key="item.key"
                 class="dd-rounded border overflow-hidden transition-all dd-border dd-bg-elevated"> 
              <!-- Header -->
              <div class="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:dd-bg-elevated"
                   
                   @click="accordionOpen[item.key] = !accordionOpen[item.key]">
                <div class="w-2 h-2 rounded-full dd-bg-success" />
                <iconify-icon :icon="item.icon" width="16" class="dd-text-secondary" />
                <span class="text-xs font-bold flex-1 dd-text">{{ item.name }}</span>
                <span class="dd-rounded-sm inline-flex items-center px-2 py-0.5 text-[10px] font-semibold leading-none dd-bg-card dd-text-secondary">{{ item.type }}</span>
                <iconify-icon :icon="accordionOpen[item.key] ? 'ph:caret-up' : 'ph:caret-down'" width="14"
                              class="dd-text-muted" />
              </div>
              <!-- Content -->
              <div v-if="accordionOpen[item.key]" class="px-4 pb-3 border-t dd-border">
                <div class="grid grid-cols-2 gap-3 pt-3">
                  <div v-for="(val, label) in item.fields" :key="label">
                    <div class="text-[9px] uppercase tracking-wider mb-0.5 dd-text-muted">{{ label }}</div>
                    <div class="text-[11px] truncate dd-text">{{ val }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 11. DETAIL PANEL ═══════════════ -->
        <section class="dd-rounded p-5 border dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Detail Panel
            <span class="text-[10px] font-normal ml-2 opacity-60">--dd-radius-lg</span>
          </h2>
          <div class="dd-rounded-lg border overflow-hidden dd-bg-elevated dd-border"> 
            <!-- Toolbar -->
            <div class="flex items-center justify-between px-4 py-2.5 border-b dd-border">
              <div class="flex items-center gap-2">
                <div class="w-2.5 h-2.5 rounded-full dd-bg-success" />
                <span class="text-sm font-bold dd-text">traefik</span>
                <span class="dd-rounded-sm inline-flex items-center px-2 py-0.5 text-[9px] font-semibold leading-none dd-bg-danger-muted dd-text-danger">major</span>
              </div>
              <div class="flex items-center gap-2">
                <div class="flex items-center gap-0.5">
                  <button v-for="s in ['S', 'M', 'L']" :key="s"
                          class="dd-rounded-sm w-5 h-5 flex items-center justify-center text-[10px] font-medium transition-colors"
                          :class="s === 'M' ? 'bg-drydock-secondary/20 text-drydock-secondary' : 'dd-text-muted'">{{ s }}</button>
                </div>
                <button class="dd-rounded-sm w-5 h-5 flex items-center justify-center dd-text-muted"> 
                  <iconify-icon icon="ph:x" width="12" /></button>
              </div>
            </div>
            <!-- Tabs -->
            <div class="flex gap-4 px-4 pt-2 border-b dd-border">
              <button v-for="t in ['Overview', 'Logs', 'Security', 'Triggers']" :key="t"
                      class="pb-2 text-[10px] font-semibold uppercase tracking-wide relative"
                      :class="t === 'Overview' ? 'text-drydock-secondary' : 'dd-text-muted'">
                {{ t }}
                <div v-if="t === 'Overview'" class="absolute bottom-0 left-0 right-0 h-0.5 bg-drydock-secondary rounded-t-full" />
              </button>
            </div>
            <!-- Content: Key-Value grid -->
            <div class="p-4 space-y-3">
              <div class="grid grid-cols-2 gap-3">
                <div v-for="kv in [
                  { label: 'Ports', value: '80:80, 443:443, 8080:8080', icon: 'ph-duotone:plug' },
                  { label: 'Volumes', value: '/var/run/docker.sock', icon: 'ph-duotone:hard-drives' },
                  { label: 'Network', value: 'web-proxy', icon: 'ph-duotone:globe' },
                  { label: 'Restart', value: 'unless-stopped', icon: 'ph-duotone:arrow-clockwise' },
                ]" :key="kv.label"
                     class="dd-rounded p-2.5 dd-bg-card">
                  <div class="flex items-center gap-1.5 mb-1">
                    <iconify-icon :icon="kv.icon" width="11" class="dd-text-muted" />
                    <span class="text-[9px] uppercase tracking-wider dd-text-muted">{{ kv.label }}</span>
                  </div>
                  <div class="text-[11px] dd-text">{{ kv.value }}</div>
                </div>
              </div>
              <div>
                <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Labels</span>
                <div class="flex flex-wrap gap-1.5">
                  <span v-for="l in ['dd.rollback.auto=true', 'dd.rollback.window=120000', 'dd.rollback.interval=5000']" :key="l"
                        class="dd-rounded-sm inline-flex items-center px-2 py-0.5 text-[10px] leading-none dd-bg-card dd-text-secondary">{{ l }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 12. LOG VIEWER ═══════════════ -->
        <section class="dd-rounded p-5 border lg:col-span-2 dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Log Viewer</h2>
          <div class="dd-rounded overflow-hidden border dd-border">
            <!-- Toolbar -->
            <div class="flex items-center gap-3 px-3 py-2 dd-bg">
              <select class="dd-rounded-sm px-2 py-1 text-[10px] border outline-none dd-bg-card dd-border dd-text">
                <option>All Sources</option><option>watcher</option><option>trigger</option><option>api</option>
              </select>
              <select class="dd-rounded-sm px-2 py-1 text-[10px] border outline-none dd-bg-card dd-border dd-text">
                <option>All Levels</option><option>error</option><option>warn</option><option>info</option><option>debug</option>
              </select>
              <div class="flex-1" />
              <label class="flex items-center gap-1.5 cursor-pointer" @click="toggleA = !toggleA">
                <div class="relative w-7 h-3.5 rounded-full transition-colors" :class="toggleA ? 'dd-bg-success' : 'dd-bg-elevated'">
                  <div class="absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform" :style="{ transform: toggleA ? 'translateX(14px)' : 'translateX(2px)' }" />
                </div>
                <span class="text-[10px] dd-text-muted">Auto-scroll</span>
              </label>
              <button class="dd-rounded-sm px-2 py-1 text-[10px] font-medium transition-colors"
                      :class="logPaused
                        ? 'dd-bg-warning-muted dd-text-warning'
                        : 'dd-text-muted hover:dd-bg-elevated'"
                      @click="logPaused = !logPaused">
                <iconify-icon :icon="logPaused ? 'ph-duotone:play' : 'ph-duotone:pause'" width="11" />
              </button>
              <button class="dd-rounded-sm px-2 py-1 text-[10px] font-medium transition-colors dd-text-muted hover:dd-bg-elevated"> 
                <iconify-icon icon="ph-duotone:trash" width="11" />
              </button>
            </div>
            <!-- Log lines -->
            <div class="px-3 py-2 space-y-0.5 font-mono text-[11px] dd-bg-code">
              <div v-for="(line, i) in logLines" :key="i" class="flex gap-3 py-0.5">
                <span class="dd-text-muted">{{ line.time }}</span>
                <span class="w-12 text-right font-semibold uppercase" :class="logLevelColor(line.level)">{{ line.level }}</span>
                <span class="dd-text-muted">[{{ line.component }}]</span>
                <span class="dd-text">{{ line.msg }}</span>
              </div>
            </div>
            <!-- Status bar -->
            <div class="flex items-center justify-between px-3 py-1.5 text-[10px] dd-bg dd-border"> 
              <span class="dd-text-muted">{{ logLines.length }} entries</span>
              <div class="flex items-center gap-1.5">
                <div class="w-1.5 h-1.5 rounded-full" :class="logPaused ? 'dd-bg-warning' : 'dd-bg-success'" />
                <span :class="logPaused ? 'dd-text-warning' : 'dd-text-success'">{{ logPaused ? 'Paused' : 'Connected' }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 13. DONUT CHART ═══════════════ -->
        <section class="dd-rounded p-5 border dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Donut Chart</h2>
          <div class="flex items-center gap-6">
            <svg viewBox="0 0 120 120" class="w-28 h-28">
              <circle cx="60" cy="60" r="50" fill="none" style="stroke: var(--dd-border);" stroke-width="12" />
              <circle cx="60" cy="60" r="50" fill="none" style="stroke: var(--dd-success);" stroke-width="12"
                      stroke-dasharray="235.6 78.5" stroke-dashoffset="0"
                      transform="rotate(-90 60 60)" stroke-linecap="round" />
              <circle cx="60" cy="60" r="50" fill="none" style="stroke: var(--dd-danger);" stroke-width="12"
                      stroke-dasharray="31.4 282.7" stroke-dashoffset="-235.6"
                      transform="rotate(-90 60 60)" stroke-linecap="round" />
              <text x="60" y="55" text-anchor="middle" class="text-lg font-bold" fill="var(--dd-text)" font-size="20">8</text>
              <text x="60" y="72" text-anchor="middle" fill="var(--dd-text-muted)" font-size="10">scanned</text>
            </svg>
            <div class="space-y-2 text-xs">
              <div class="flex items-center gap-2"><div class="w-2.5 h-2.5 rounded-full dd-bg-success" /> <span class="dd-text">Safe (6)</span></div>
              <div class="flex items-center gap-2"><div class="w-2.5 h-2.5 rounded-full dd-bg-danger" /> <span class="dd-text">Vulnerable (2)</span></div>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 14. EMPTY STATES ═══════════════ -->
        <section class="dd-rounded p-5 border dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Empty States</h2>
          <div class="dd-rounded flex flex-col items-center justify-center py-10 dd-bg-elevated"> 
            <iconify-icon icon="ph-duotone:magnifying-glass" width="32" class="dd-text-muted" />
            <p class="mt-3 text-sm font-medium dd-text-secondary">No containers match your filters</p>
            <p class="text-[11px] mt-1 dd-text-muted">Try adjusting your search or filter criteria</p>
            <button class="dd-rounded mt-4 px-3 py-1.5 text-[11px] font-medium text-drydock-secondary border border-drydock-secondary/30 hover:bg-drydock-secondary/10 transition-colors">
              Clear Filters
            </button>
          </div>
        </section>

        <!-- ═══════════════ 15. USER MENU & AVATAR ═══════════════ -->
        <section class="dd-rounded p-5 border dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">User Menu & Avatar</h2>
          <div class="flex items-center gap-6">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                   style="background: linear-gradient(135deg, var(--dd-primary), var(--dd-success));">A</div>
              <span class="text-xs font-medium dd-text">admin</span>
              <iconify-icon icon="ph:caret-down" width="10" class="dd-text-muted" />
            </div>
            <div class="dd-rounded border py-1 w-40 dd-bg-elevated dd-border"> 
              <button class="w-full text-left px-3 py-1.5 text-xs transition-colors dd-text hover:dd-bg-elevated"> Profile</button>
              <button class="w-full text-left px-3 py-1.5 text-xs transition-colors dd-text hover:dd-bg-elevated"> Settings</button>
              <div class="my-1 border-t dd-border" />
              <button class="w-full text-left px-3 py-1.5 text-xs dd-text-danger transition-colors hover:dd-bg-elevated"> Sign Out</button>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 16. SEARCH MODAL ═══════════════ -->
        <section class="dd-rounded p-5 border dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Search Modal
            <span class="text-[10px] font-normal ml-2 opacity-60">--dd-radius-lg</span>
          </h2>
          <div class="dd-rounded-lg border overflow-hidden dd-bg-elevated dd-border"
               
               style="box-shadow: 0 25px 50px -12px rgba(0,0,0,0.3);">
            <div class="flex items-center gap-3 px-4 py-3 border-b dd-border">
              <iconify-icon icon="ph-duotone:magnifying-glass" width="16" class="dd-text-muted" />
              <input type="text" placeholder="Search containers, images, settings..."
                     class="flex-1 bg-transparent text-sm outline-none dd-text"> 
              <kbd class="dd-rounded-sm px-1.5 py-0.5 text-[10px] font-medium dd-bg-card dd-text-muted border dd-border">ESC</kbd>
            </div>
            <div class="px-4 py-6 text-center">
              <span class="text-xs dd-text-muted">Start typing to search...</span>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 17. NOTIFICATION CARDS ═══════════════ -->
        <section class="dd-rounded p-5 border lg:col-span-2 dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Notification / Trigger Cards (with toggles)</h2>
          <div class="space-y-2">
            <div v-for="n in [
              { name: 'Update Available', desc: 'When a container has a new version', enabled: true, triggers: ['slack-ops', 'discord-dev', 'email-admin'] },
              { name: 'Security Alert', desc: 'When a vulnerability is detected', enabled: true, triggers: ['email-admin', 'discord-dev'] },
              { name: 'Container Stopped', desc: 'When a running container stops unexpectedly', enabled: false, triggers: ['slack-ops'] },
            ]" :key="n.name"
                 class="dd-rounded p-4 border flex items-start gap-4 dd-bg-elevated dd-border"> 
              <div class="relative w-8 h-4 rounded-full transition-colors cursor-pointer mt-0.5 shrink-0"
                   :class="n.enabled ? 'dd-bg-success' : 'dd-bg-elevated'">
                <div class="absolute top-0.5 w-3 h-3 rounded-full shadow transition-transform"
                     :style="{ backgroundColor: 'var(--dd-text)', transform: n.enabled ? 'translateX(17px)' : 'translateX(2px)' }" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-bold dd-text">{{ n.name }}</div>
                <div class="text-[11px] mt-0.5 dd-text-muted">{{ n.desc }}</div>
                <div class="flex flex-wrap gap-1.5 mt-2">
                  <span v-for="t in n.triggers" :key="t"
                        class="dd-rounded-sm inline-flex items-center px-2 py-0.5 text-[9px] font-medium leading-none dd-bg-card dd-text-secondary">{{ t }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 18. FORMS / CONFIG EDITING ═══════════════ -->
        <section class="dd-rounded p-5 border lg:col-span-2 dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Forms / Config Editing</h2>
          <div class="grid grid-cols-2 gap-6">
            <!-- Left: Stacked form -->
            <div class="space-y-4">
              <span class="text-[9px] uppercase tracking-wider block dd-text-muted">Stacked form (add trigger)</span>
              <div class="dd-rounded border p-4 space-y-3 dd-bg-elevated dd-border"> 
                <div>
                  <label class="block text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-secondary">Name</label>
                  <input type="text" value="slack-ops" class="dd-rounded w-full px-3 py-2 text-xs border outline-none transition-colors dd-bg-card dd-border dd-text focus:border-drydock-secondary"> 
                </div>
                <div>
                  <label class="block text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-secondary">Type</label>
                  <select class="dd-rounded w-full px-3 py-2 text-xs border outline-none transition-colors dd-bg-card dd-border dd-text"> 
                    <option>Slack</option><option>Discord</option><option>SMTP</option><option>HTTP</option><option>Telegram</option><option>MQTT</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-secondary">Webhook URL</label>
                  <input type="text" value="https://hooks.slack.com/services/T0..." class="dd-rounded w-full px-3 py-2 text-xs border outline-none transition-colors dd-bg-card dd-border dd-text focus:border-drydock-secondary"> 
                </div>
                <div>
                  <label class="block text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-secondary">Events</label>
                  <div class="flex flex-wrap gap-2">
                    <label v-for="ev in ['update-available', 'container-started', 'container-stopped', 'security-alert']" :key="ev"
                           class="flex items-center gap-1.5 cursor-pointer">
                      <div class="w-3.5 h-3.5 dd-rounded-sm border flex items-center justify-center transition-colors"
                           :class="['update-available', 'security-alert'].includes(ev)
                             ? (isDark ? 'border-drydock-secondary bg-drydock-secondary/20' : 'border-drydock-secondary bg-drydock-secondary/10')
                             : 'dd-border-strong'">
                        <iconify-icon v-if="['update-available', 'security-alert'].includes(ev)" icon="ph:check-bold" width="9" class="text-drydock-secondary" />
                      </div>
                      <span class="text-[10px] dd-text">{{ ev }}</span>
                    </label>
                  </div>
                </div>
                <div class="flex items-center gap-2 pt-2">
                  <button class="dd-rounded px-4 py-2 text-xs font-semibold text-white bg-drydock-secondary hover:opacity-90 transition-opacity">Save</button>
                  <button class="dd-rounded px-4 py-2 text-xs font-semibold transition-colors border dd-text-secondary dd-border hover:dd-bg-elevated"> Cancel</button>
                  <button class="dd-rounded px-4 py-2 text-xs font-semibold dd-text-danger transition-colors ml-auto hover:dd-bg-elevated"> Delete</button>
                </div>
              </div>
            </div>
            <!-- Right: Inline / compact form -->
            <div class="space-y-4">
              <span class="text-[9px] uppercase tracking-wider block dd-text-muted">Inline form (edit watcher)</span>
              <div class="dd-rounded border p-4 space-y-3 dd-bg-elevated dd-border"> 
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-secondary">Socket</label>
                    <input type="text" value="/var/run/docker.sock" class="dd-rounded w-full px-3 py-2 text-xs border outline-none transition-colors dd-bg-card dd-border dd-text"> 
                  </div>
                  <div>
                    <label class="block text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-secondary">Cron</label>
                    <input type="text" value="0 * * * *" class="dd-rounded w-full px-3 py-2 text-xs font-mono border outline-none transition-colors dd-bg-card dd-border dd-text"> 
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-secondary">Watch by Default</label>
                    <div class="flex items-center gap-2 mt-1">
                      <div class="relative w-8 h-4 rounded-full transition-colors cursor-pointer dd-bg-success">
                        <div class="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow" style="transform: translateX(17px)" />
                      </div>
                      <span class="text-[10px] dd-text-secondary">Enabled</span>
                    </div>
                  </div>
                  <div>
                    <label class="block text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-secondary">Watch Events</label>
                    <div class="flex items-center gap-2 mt-1">
                      <div class="relative w-8 h-4 rounded-full transition-colors cursor-pointer dd-bg-elevated">
                        <div class="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow" style="transform: translateX(2px)" />
                      </div>
                      <span class="text-[10px] dd-text-secondary">Disabled</span>
                    </div>
                  </div>
                </div>
                <div>
                  <label class="block text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-secondary">
                    Description <span class="text-[9px] font-normal opacity-50">(optional)</span>
                  </label>
                  <textarea rows="2" placeholder="Notes about this watcher..."
                            class="dd-rounded w-full px-3 py-2 text-xs border outline-none transition-colors resize-none dd-bg-card dd-border dd-text focus:border-drydock-secondary"> </textarea>
                </div>
              </div>
              <!-- Validation states -->
              <span class="text-[9px] uppercase tracking-wider block dd-text-muted">Validation states</span>
              <div class="space-y-2">
                <div>
                  <input type="text" value="not-a-valid-cron" class="dd-rounded w-full px-3 py-2 text-xs border outline-none dd-border-danger dd-bg-card dd-text">
                  <p class="text-[10px] dd-text-danger mt-1 flex items-center gap-1">
                    <iconify-icon icon="ph-duotone:warning" width="11" /> Invalid cron expression
                  </p>
                </div>
                <div>
                  <input type="text" value="https://hooks.slack.com/services/T0..." class="dd-rounded w-full px-3 py-2 text-xs border outline-none dd-border-success dd-bg-card dd-text">
                  <p class="text-[10px] dd-text-success mt-1 flex items-center gap-1">
                    <iconify-icon icon="ph-duotone:check-circle" width="11" /> Connection verified
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 19. SHELL / TERMINAL ═══════════════ -->
        <section class="dd-rounded p-5 border lg:col-span-2 dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Shell / Terminal</h2>
          <div class="dd-rounded overflow-hidden border dd-border">
            <!-- Title bar -->
            <div class="flex items-center gap-2 px-3 py-2 border-b dd-bg-code dd-border">
              <div class="flex gap-1.5">
                <div class="w-2.5 h-2.5 rounded-full dd-bg-danger opacity-80" />
                <div class="w-2.5 h-2.5 rounded-full dd-bg-warning opacity-80" />
                <div class="w-2.5 h-2.5 rounded-full dd-bg-success opacity-80" />
              </div>
              <span class="flex-1 text-center text-[10px] font-medium dd-text-muted">traefik -- /bin/sh</span>
              <div class="flex items-center gap-1.5">
                <button class="dd-rounded-sm w-5 h-5 flex items-center justify-center transition-colors dd-text-muted hover:dd-bg-elevated"> 
                  <iconify-icon icon="ph:copy" width="11" /></button>
                <button class="dd-rounded-sm w-5 h-5 flex items-center justify-center transition-colors dd-text-muted hover:dd-bg-elevated"> 
                  <iconify-icon icon="ph:arrows-out" width="11" /></button>
              </div>
            </div>
            <!-- Terminal output -->
            <div class="px-3 py-3 font-mono text-[11px] leading-relaxed min-h-[160px] dd-bg-code"
                 
                 style="color: var(--dd-text);">
              <div><span style="color: var(--dd-success);">root@traefik</span><span style="color: var(--dd-text-muted);">:</span><span style="color: var(--dd-primary);">/</span><span style="color: var(--dd-text-muted);">$</span> ls -la /etc/traefik/</div>
              <div style="color: var(--dd-text-secondary);">total 28</div>
              <div style="color: var(--dd-text-secondary);">drwxr-xr-x  2 root root 4096 Feb 18 14:23 <span style="color: var(--dd-primary);">.</span></div>
              <div style="color: var(--dd-text-secondary);">drwxr-xr-x 15 root root 4096 Feb 18 14:23 <span style="color: var(--dd-primary);">..</span></div>
              <div style="color: var(--dd-text-secondary);">-rw-r--r--  1 root root 1247 Feb 18 14:23 traefik.yml</div>
              <div style="color: var(--dd-text-secondary);">-rw-r--r--  1 root root  892 Feb 18 14:23 dynamic.yml</div>
              <div class="mt-1"><span style="color: var(--dd-success);">root@traefik</span><span style="color: var(--dd-text-muted);">:</span><span style="color: var(--dd-primary);">/</span><span style="color: var(--dd-text-muted);">$</span> cat /etc/traefik/traefik.yml</div>
              <div style="color: var(--dd-text-secondary);">entryPoints:</div>
              <div style="color: var(--dd-text-secondary);">  web:</div>
              <div style="color: var(--dd-text-secondary);">    address: <span style="color: var(--dd-success);">":80"</span></div>
              <div style="color: var(--dd-text-secondary);">  websecure:</div>
              <div style="color: var(--dd-text-secondary);">    address: <span style="color: var(--dd-success);">":443"</span></div>
              <div class="mt-1"><span style="color: var(--dd-success);">root@traefik</span><span style="color: var(--dd-text-muted);">:</span><span style="color: var(--dd-primary);">/</span><span style="color: var(--dd-text-muted);">$</span> <span class="animate-pulse">_</span></div>
            </div>
            <!-- Input bar -->
            <div class="flex items-center gap-2 px-3 py-2 border-t dd-bg-code dd-border"> 
              <span class="text-[10px] font-mono" style="color: var(--dd-success);">$</span>
              <input type="text" placeholder="Type command..."
                     class="flex-1 bg-transparent text-[11px] font-mono outline-none dd-text"> 
              <kbd class="dd-rounded-sm px-1.5 py-0.5 text-[9px] font-medium dd-bg-card dd-text-muted border dd-border">Enter</kbd>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 20. YAML / CODE EDITOR ═══════════════ -->
        <section class="dd-rounded p-5 border lg:col-span-2 dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Code / Config Editor</h2>
          <div class="grid grid-cols-2 gap-6">
            <!-- Read-only config view -->
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Read-only config view</span>
              <div class="dd-rounded overflow-hidden border dd-border">
                <div class="flex items-center justify-between px-3 py-1.5 border-b dd-bg dd-border"> 
                  <span class="text-[10px] font-medium dd-text-secondary">docker-compose.yml</span>
                  <button class="dd-rounded-sm px-2 py-0.5 text-[10px] font-medium transition-colors dd-text-muted hover:dd-bg-elevated"> 
                    <iconify-icon icon="ph:copy" width="11" /> Copy
                  </button>
                </div>
                <div class="px-3 py-2 font-mono text-[11px] leading-relaxed dd-bg-code">
                  <div><span class="dd-text-muted">1</span>  <span style="color: var(--dd-primary);">version</span><span class="dd-text-secondary">:</span> <span style="color: var(--dd-success);">"3.8"</span></div>
                  <div><span class="dd-text-muted">2</span>  <span style="color: var(--dd-primary);">services</span><span class="dd-text-secondary">:</span></div>
                  <div><span class="dd-text-muted">3</span>    <span style="color: var(--dd-primary);">drydock</span><span class="dd-text-secondary">:</span></div>
                  <div><span class="dd-text-muted">4</span>      <span style="color: var(--dd-primary);">image</span><span class="dd-text-secondary">:</span> <span style="color: var(--dd-success);">ghcr.io/codeswhat/drydock:latest</span></div>
                  <div><span class="dd-text-muted">5</span>      <span style="color: var(--dd-primary);">ports</span><span class="dd-text-secondary">:</span></div>
                  <div><span class="dd-text-muted">6</span>        <span class="dd-text-secondary">-</span> <span style="color: var(--dd-success);">"3000:3000"</span></div>
                  <div><span class="dd-text-muted">7</span>      <span style="color: var(--dd-primary);">volumes</span><span class="dd-text-secondary">:</span></div>
                  <div><span class="dd-text-muted">8</span>        <span class="dd-text-secondary">-</span> <span style="color: var(--dd-success);">/var/run/docker.sock:/var/run/docker.sock</span></div>
                </div>
              </div>
            </div>
            <!-- Editable textarea -->
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Editable config (JSON)</span>
              <div class="dd-rounded overflow-hidden border dd-border">
                <div class="flex items-center justify-between px-3 py-1.5 border-b dd-bg dd-border"> 
                  <span class="text-[10px] font-medium dd-text-secondary">trigger.json</span>
                  <div class="flex items-center gap-1.5">
                    <span class="dd-rounded-sm inline-flex items-center px-1.5 py-0.5 text-[9px] font-medium leading-none dd-bg-warning-muted dd-text-warning">modified</span>
                    <button class="dd-rounded px-2 py-0.5 text-[10px] font-semibold text-white bg-drydock-secondary hover:opacity-90 transition-opacity">Save</button>
                  </div>
                </div>
                <textarea rows="8" spellcheck="false"
                          class="w-full px-3 py-2 font-mono text-[11px] leading-relaxed outline-none resize-none border-none dd-bg-code dd-text"
                          
                          :value="'{\n  &quot;type&quot;: &quot;slack&quot;,\n  &quot;name&quot;: &quot;slack-ops&quot;,\n  &quot;configuration&quot;: {\n    &quot;url&quot;: &quot;https://hooks.slack.com/services/T0...&quot;,\n    &quot;channel&quot;: &quot;#ops-alerts&quot;,\n    &quot;botname&quot;: &quot;drydock&quot;\n  }\n}'"></textarea>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 21. TOASTS / ALERTS ═══════════════ -->
        <section class="dd-rounded p-5 border lg:col-span-2 dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Toasts / Alerts / Banners</h2>
          <div class="space-y-3">
            <div v-for="alert in [
              { type: 'success', icon: 'ph-duotone:check-circle', title: 'Container updated', msg: 'traefik updated from 2.10.7 to 3.0.1', color: 'var(--dd-success)', bg: 'dd-bg-success-muted', border: 'dd-border-success' },
              { type: 'error', icon: 'ph-duotone:x-circle', title: 'Update failed', msg: 'Connection refused: ECONNREFUSED 127.0.0.1:2375', color: 'var(--dd-danger)', bg: 'dd-bg-danger-muted', border: 'dd-border-danger' },
              { type: 'warning', icon: 'ph-duotone:warning', title: 'Rate limit approaching', msg: 'Docker Hub: 42 of 100 pulls remaining (resets in 4h)', color: 'var(--dd-warning)', bg: 'dd-bg-warning-muted', border: 'dd-border-warning' },
              { type: 'info', icon: 'ph-duotone:info', title: 'Scan complete', msg: '8 containers scanned, 2 vulnerabilities found', color: 'var(--dd-primary)', bg: 'dd-bg-primary-muted', border: 'dd-border-primary' },
            ]" :key="alert.type"
                 class="dd-rounded flex items-start gap-3 px-4 py-3 border"
                 :class="[alert.bg, alert.border]">
              <iconify-icon :icon="alert.icon" width="18" :style="{ color: alert.color }" class="mt-0.5 shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="text-xs font-bold" :style="{ color: alert.color }">{{ alert.title }}</div>
                <div class="text-[11px] mt-0.5 dd-text-secondary">{{ alert.msg }}</div>
              </div>
              <button class="dd-rounded-sm w-5 h-5 flex items-center justify-center shrink-0 transition-colors dd-text-muted"> 
                <iconify-icon icon="ph:x" width="12" />
              </button>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 22. CONFIRMATION DIALOG ═══════════════ -->
        <section class="dd-rounded p-5 border dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Confirmation Dialog
            <span class="text-[10px] font-normal ml-2 opacity-60">--dd-radius-lg</span>
          </h2>
          <div class="dd-rounded-lg border p-5 max-w-sm dd-bg-elevated dd-border"
               
               style="box-shadow: 0 25px 50px -12px rgba(0,0,0,0.3);">
            <div class="flex items-center gap-3 mb-3">
              <div class="dd-rounded w-9 h-9 flex items-center justify-center dd-bg-danger-muted">
                <iconify-icon icon="ph-duotone:warning" width="20" class="dd-text-danger" />
              </div>
              <div>
                <div class="text-sm font-bold dd-text">Delete Trigger?</div>
                <div class="text-[11px] dd-text-secondary">This action cannot be undone.</div>
              </div>
            </div>
            <p class="text-xs mb-4 dd-text-secondary">
              Are you sure you want to delete <span class="font-semibold dd-text">slack-ops</span>? All associated notification rules will be removed.
            </p>
            <div class="flex items-center gap-2 justify-end">
              <button class="dd-rounded px-4 py-2 text-xs font-semibold transition-colors border dd-text-secondary dd-border hover:dd-bg-elevated"> Cancel</button>
              <button class="dd-rounded px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity" style="background: var(--dd-danger);">Delete</button>
            </div>
          </div>
        </section>

        <!-- ═══════════════ 23. LOADING / SKELETON ═══════════════ -->
        <section class="dd-rounded p-5 border dd-bg-elevated dd-border">
          <h2 class="text-xs font-semibold uppercase tracking-wider mb-4 dd-text-secondary">Loading / Skeleton States</h2>
          <div class="space-y-4">
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Skeleton card</span>
              <div class="dd-rounded p-4 border animate-pulse dd-bg-card dd-border">
                <div class="flex items-center gap-2 mb-3">
                  <div class="w-2.5 h-2.5 rounded-full" style="background: var(--dd-border-strong)" />
                  <div class="h-3.5 w-24 dd-rounded-sm" style="background: var(--dd-border)" />
                  <div class="ml-auto h-3.5 w-16 dd-rounded-sm" style="background: var(--dd-border)" />
                </div>
                <div class="h-3 w-32 dd-rounded-sm mb-3" style="background: var(--dd-border)" />
                <div class="flex items-center gap-2 mb-3">
                  <div class="h-3 w-16 dd-rounded-sm" style="background: var(--dd-border)" />
                  <div class="h-4 w-12 dd-rounded-sm" style="background: var(--dd-border-strong)" />
                  <div class="h-3 w-10 dd-rounded-sm" style="background: var(--dd-border)" />
                  <div class="h-4 w-12 dd-rounded-sm" style="background: var(--dd-border-strong)" />
                </div>
                <div class="border-t pt-2 flex items-center justify-between dd-border">
                  <div class="h-3 w-14 dd-rounded-sm" style="background: var(--dd-border)" />
                  <div class="flex gap-1.5">
                    <div class="w-6 h-6 dd-rounded-sm" style="background: var(--dd-border)" />
                    <div class="w-6 h-6 dd-rounded-sm" style="background: var(--dd-border)" />
                  </div>
                </div>
              </div>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider block mb-1.5 dd-text-muted">Spinner</span>
              <div class="flex items-center gap-4">
                <div class="w-5 h-5 rounded-full border-2 border-drydock-secondary border-t-transparent animate-spin" />
                <span class="text-xs dd-text-secondary">Loading containers...</span>
              </div>
            </div>
          </div>
        </section>

      </div>

      <!-- ─── TOKEN REFERENCE ────────────────────────────── -->
      <div class="mt-8 dd-rounded p-5 border dd-bg-elevated dd-border">
        <h2 class="text-xs font-semibold uppercase tracking-wider mb-3 dd-text-secondary">Token Reference</h2>
        <div class="grid grid-cols-3 gap-4 text-xs">
          <div v-for="(info, key) in {
            sm: { token: '--dd-radius-sm', cls: 'dd-rounded-sm', used: 'Badges, chips, version tags, severity labels, kbd, label chips, small action buttons, checkboxes' },
            md: { token: '--dd-radius', cls: 'dd-rounded', used: 'Cards, buttons, inputs, selects, nav items, tabs, stat cards, table wrappers, filter bars, accordion headers, key-value cells' },
            lg: { token: '--dd-radius-lg', cls: 'dd-rounded-lg', used: 'Modals, detail panels, search overlay' },
          }" :key="key">
            <div class="p-3 dd-rounded dd-bg-card">
              <code class="font-bold text-drydock-secondary">{{ info.token }}</code>
              <div class="mt-1 dd-text-secondary">
                Class: <code class="dd-rounded-sm px-1 py-0.5 dd-bg-elevated dd-text">.{{ info.cls }}</code>
              </div>
              <div class="mt-1 dd-text-muted">{{ info.used }}</div>
              <div class="mt-2 w-16 h-10 border-2"
                   :class="isDark ? 'border-drydock-secondary/50 bg-drydock-secondary/10' : 'border-drydock-primary/30 bg-drydock-primary/5'"
                   :style="{ borderRadius: key === 'sm' ? 'var(--dd-radius-sm)' : key === 'md' ? 'var(--dd-radius)' : 'var(--dd-radius-lg)' }" />
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
