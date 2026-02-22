<script setup lang="ts">
import { useConfirmDialog } from '../composables/useConfirmDialog';
import { ref } from 'vue';

const confirm = useConfirmDialog();
const lastConfirmResult = ref('');

function demoConfirmStop() {
  confirm.require({
    header: 'Stop Container',
    message: 'Stop nginx-proxy?',
    rejectLabel: 'Cancel',
    acceptLabel: 'Stop',
    severity: 'danger',
    accept: () => { lastConfirmResult.value = 'Stopped nginx-proxy'; },
    reject: () => { lastConfirmResult.value = 'Cancelled stop'; },
  });
}

function demoConfirmRestart() {
  confirm.require({
    header: 'Restart Container',
    message: 'Restart postgres-db?',
    rejectLabel: 'Cancel',
    acceptLabel: 'Restart',
    severity: 'warn',
    accept: () => { lastConfirmResult.value = 'Restarted postgres-db'; },
    reject: () => { lastConfirmResult.value = 'Cancelled restart'; },
  });
}

function demoConfirmIgnore() {
  confirm.require({
    header: 'Ignore Container',
    message: 'Ignore redis-cache? It will no longer be monitored for updates.',
    rejectLabel: 'Cancel',
    acceptLabel: 'Ignore',
    severity: 'danger',
    accept: () => { lastConfirmResult.value = 'Ignored redis-cache'; },
    reject: () => { lastConfirmResult.value = 'Cancelled ignore'; },
  });
}

const spinSpeed = ref<'dd-spin-fast' | 'dd-spin' | 'dd-spin-slow'>('dd-spin');
const speedOptions = [
  { cls: 'dd-spin-fast', label: 'Fast (0.8s)' },
  { cls: 'dd-spin', label: 'Normal (1.5s)' },
  { cls: 'dd-spin-slow', label: 'Slow (2.5s)' },
] as const;

const spinnerCandidates = [
  { icon: 'ph:spinner-duotone', label: 'Spinner' },
  { icon: 'ph:spinner-gap-duotone', label: 'Spinner Gap' },
  { icon: 'ph:spinner-ball-duotone', label: 'Spinner Ball' },
  { icon: 'ph:circle-notch-duotone', label: 'Circle Notch' },
  { icon: 'ph:circle-dashed-duotone', label: 'Circle Dashed' },
  { icon: 'ph:arrow-clockwise-duotone', label: 'Arrow Clockwise' },
  { icon: 'ph:arrows-clockwise-duotone', label: 'Arrows Clockwise' },
  { icon: 'ph:gear-duotone', label: 'Gear' },
  { icon: 'ph:gear-fine-duotone', label: 'Gear Fine' },
  { icon: 'ph:gear-six-duotone', label: 'Gear Six' },
  { icon: 'ph:fan-duotone', label: 'Fan' },
  { icon: 'ph:hourglass-duotone', label: 'Hourglass' },
];

const radiusPresets = [
  { id: 'none', label: 'None', sm: 0, md: 0, lg: 0 },
  { id: 'sm', label: 'Small', sm: 2, md: 3, lg: 4 },
  { id: 'md', label: 'Medium', sm: 4, md: 8, lg: 12 },
  { id: 'lg', label: 'Large', sm: 6, md: 12, lg: 16 },
];

function loadRadius() {
  try { return localStorage.getItem('drydock-radius') || 'sm'; } catch { return 'sm'; }
}
const activeRadius = ref(loadRadius());
function setRadius(id: string) {
  activeRadius.value = id;
  const p = radiusPresets.find((r) => r.id === id) ?? radiusPresets[1];
  const el = document.documentElement;
  el.style.setProperty('--dd-radius', `${p.md}px`);
  el.style.setProperty('--dd-radius-sm', `${p.sm}px`);
  el.style.setProperty('--dd-radius-lg', `${p.lg}px`);
  try { localStorage.setItem('drydock-radius', id); } catch { /* ignored */ }
}
// Apply saved radius on load
setRadius(activeRadius.value);

const tableActionStyle = ref<'icons' | 'buttons'>('icons');

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
  { name: 'nginx-proxy', image: 'nginx', tag: '1.25.3', newTag: '1.25.4', status: 'running', registry: 'dockerhub' },
  { name: 'postgres-db', image: 'postgres', tag: '16.1', newTag: '16.2', status: 'running', registry: 'dockerhub' },
  { name: 'redis-cache', image: 'redis', tag: '7.2.3', newTag: null, status: 'running', registry: 'dockerhub' },
  { name: 'drydock', image: 'ghcr.io/drydock/drydock', tag: 'v1.3.0', newTag: 'v1.4.0', status: 'stopped', registry: 'ghcr' },
];

const playgroundTableRows = [
  { name: 'traefik', image: 'traefik', oldVer: '2.10.7', newVer: '3.0.1', status: 'updated', time: '12m ago', running: true },
  { name: 'postgres-db', image: 'postgres', oldVer: '15.4', newVer: '16.1', status: 'pending', time: '34m ago', running: true },
  { name: 'redis-cache', image: 'redis', oldVer: '7.0.12', newVer: '7.2.4', status: 'updated', time: '1h ago', running: true },
  { name: 'nginx-proxy', image: 'nginx', oldVer: '1.24.0', newVer: '1.25.3', status: 'failed', time: '2h ago', running: false },
  { name: 'grafana', image: 'grafana/grafana', oldVer: '10.1.5', newVer: '10.2.3', status: 'updated', time: '3h ago', running: true },
];
</script>

<template>
  <div class="flex-1 min-h-0 overflow-y-auto">
  <div class="space-y-6">

    <!-- Spinner Preview -->
    <div class="dd-rounded overflow-hidden"
         :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
      <div class="px-5 py-3.5 flex items-center gap-2"
           :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
        <iconify-icon icon="ph:spinner-duotone" width="14" class="text-drydock-secondary dd-spin" />
        <h2 class="text-sm font-semibold dd-text">Brand Spinner Candidates</h2>
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
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <div v-for="s in spinnerCandidates" :key="s.icon"
               class="flex flex-col items-center gap-3 px-4 py-5 dd-rounded transition-colors hover:dd-bg-elevated cursor-pointer"
               :style="{ backgroundColor: 'var(--dd-bg-inset)', border: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-6">
              <iconify-icon :icon="s.icon" width="20" class="dd-text-muted" :class="spinSpeed" />
              <iconify-icon :icon="s.icon" width="28" class="dd-text" :class="spinSpeed" />
              <iconify-icon :icon="s.icon" width="36" class="text-drydock-secondary" :class="spinSpeed" />
            </div>
            <div class="text-[11px] font-semibold dd-text">{{ s.label }}</div>
            <div class="text-[9px] font-mono dd-text-muted">{{ s.icon }}</div>
          </div>
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
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button v-for="p in radiusPresets" :key="p.id"
                  class="flex flex-col items-center gap-2.5 px-4 py-3.5 dd-rounded transition-colors"
                  :class="activeRadius === p.id ? 'ring-2 ring-drydock-secondary' : ''"
                  :style="{
                    backgroundColor: activeRadius === p.id ? 'var(--dd-primary-muted)' : 'var(--dd-bg-inset)',
                    border: activeRadius === p.id ? '1.5px solid var(--dd-primary)' : '1px solid var(--dd-border-strong)',
                  }"
                  @click="setRadius(p.id)">
            <div class="w-12 h-8 border-2 transition-all"
                 :class="activeRadius === p.id ? 'border-drydock-secondary/60' : 'dd-border-strong'"
                 :style="{ borderRadius: p.md + 'px', backgroundColor: activeRadius === p.id ? 'var(--dd-primary-muted)' : 'transparent' }" />
            <div class="text-[12px] font-semibold"
                 :class="activeRadius === p.id ? 'text-drydock-secondary' : 'dd-text'">{{ p.label }}</div>
            <div class="text-[10px] dd-text-muted">{{ p.sm }}px / {{ p.md }}px / {{ p.lg }}px</div>
          </button>
        </div>
      </div>
    </div>

    <!-- Table Actions -->
    <div class="dd-rounded overflow-hidden"
         :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
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
                 :class="tableActionStyle === opt.id ? 'text-drydock-secondary' : 'dd-text'">{{ opt.label }}</div>
            <div class="text-[10px] dd-text-muted">{{ opt.desc }}</div>
          </button>
        </div>
      </div>
    </div>

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
          <div class="relative w-10 h-5 dd-rounded-lg cursor-pointer"
               :style="{ backgroundColor: 'var(--dd-primary)' }">
            <span class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full translate-x-5 transition-transform" />
          </div>
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

    <!-- Container Card -->
    <div class="dd-rounded overflow-hidden"
         :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
      <div class="px-5 py-3.5 flex items-center gap-2"
           :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
        <AppIcon name="containers" :size="14" class="text-drydock-secondary" />
        <h2 class="text-sm font-semibold dd-text">Container Card</h2>
      </div>
      <div class="p-5">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div v-for="c in playgroundContainers" :key="c.name"
               class="dd-rounded container-card overflow-hidden cursor-pointer"
               :style="{ backgroundColor: 'var(--dd-bg-inset)', border: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-start justify-between p-3.5 pb-2">
              <div class="flex items-center gap-2 min-w-0">
                <span class="w-2 h-2 rounded-full shrink-0"
                      :style="{ backgroundColor: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
                <div class="min-w-0">
                  <div class="text-[12px] font-semibold truncate dd-text">{{ c.name }}</div>
                  <div class="text-[10px] truncate dd-text-muted">{{ c.image }}:{{ c.tag }}</div>
                </div>
              </div>
              <span class="shrink-0 badge text-[9px] uppercase tracking-wider"
                    :style="{ backgroundColor: 'var(--dd-primary-muted)', color: 'var(--dd-primary)' }">
                {{ c.registry }}
              </span>
            </div>
            <div class="px-3.5 pb-2">
              <div class="flex items-center gap-3 text-[10px]">
                <span class="dd-text-muted">Current</span>
                <span class="font-semibold dd-text">{{ c.tag }}</span>
                <template v-if="c.newTag">
                  <span class="dd-text-muted">&rarr;</span>
                  <span class="badge text-[9px]"
                        :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">{{ c.newTag }}</span>
                </template>
                <span v-else class="dd-text-success text-[10px]">
                  <AppIcon name="check" :size="10" class="mr-0.5" />up to date
                </span>
              </div>
            </div>
            <div class="flex items-center justify-between px-3.5 py-2"
                 :style="{ borderTop: '1px solid var(--dd-border)', backgroundColor: 'var(--dd-bg-card)' }">
              <span class="text-[10px] font-medium capitalize"
                    :class="c.status === 'running' ? 'dd-text-success' : 'dd-text-danger'">
                {{ c.status }}
              </span>
              <div class="flex items-center gap-1">
                <button v-if="c.status === 'running'" class="w-6 h-6 dd-rounded flex items-center justify-center dd-text-danger hover:dd-bg-elevated transition-colors">
                  <AppIcon name="stop" :size="10" />
                </button>
                <button v-if="c.status === 'running'" class="w-6 h-6 dd-rounded flex items-center justify-center dd-text-secondary hover:dd-bg-elevated transition-colors">
                  <AppIcon name="refresh" :size="10" />
                </button>
                <button v-if="c.status === 'stopped'" class="w-6 h-6 dd-rounded flex items-center justify-center dd-text-success hover:dd-bg-elevated transition-colors">
                  <AppIcon name="play" :size="10" />
                </button>
                <button v-if="c.newTag" class="w-6 h-6 dd-rounded flex items-center justify-center dd-text-warning hover:dd-bg-elevated transition-colors">
                  <AppIcon name="update" :size="10" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Data Table -->
    <div class="dd-rounded overflow-hidden"
         :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
      <div class="px-5 py-3.5 flex items-center gap-2"
           :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
        <AppIcon name="watchers" :size="14" class="text-drydock-secondary" />
        <h2 class="text-sm font-semibold dd-text">Data Table</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-[11px]">
          <thead>
            <tr :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Container</th>
              <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Image</th>
              <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Version</th>
              <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Status</th>
              <th class="text-right px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Time</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in playgroundTableRows" :key="row.name"
                class="transition-colors hover:dd-bg-elevated"
                :style="i < playgroundTableRows.length - 1 ? { borderBottom: '1px solid var(--dd-border)' } : {}">
              <td class="px-5 py-3 font-medium dd-text">
                <div class="flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full shrink-0"
                        :style="{ backgroundColor: row.running ? 'var(--dd-success)' : 'var(--dd-text-muted)' }" />
                  {{ row.name }}
                </div>
              </td>
              <td class="px-5 py-3 dd-text-secondary">{{ row.image }}</td>
              <td class="px-5 py-3">
                <div class="flex items-center gap-1.5">
                  <span class="px-1.5 py-0.5 dd-rounded-sm text-[10px] font-medium dd-bg-elevated dd-text-secondary">{{ row.oldVer }}</span>
                  <span class="text-[8px] dd-text-muted">&rarr;</span>
                  <span class="px-1.5 py-0.5 dd-rounded-sm text-[10px] font-medium"
                        :style="{ backgroundColor: 'var(--dd-primary-muted)', color: 'var(--dd-primary)' }">{{ row.newVer }}</span>
                </div>
              </td>
              <td class="px-5 py-3">
                <span class="badge text-[10px]"
                      :style="{
                        backgroundColor: row.status === 'updated' ? 'var(--dd-success-muted)' : row.status === 'pending' ? 'var(--dd-warning-muted)' : 'var(--dd-danger-muted)',
                        color: row.status === 'updated' ? 'var(--dd-success)' : row.status === 'pending' ? 'var(--dd-warning)' : 'var(--dd-danger)',
                      }">
                  {{ row.status }}
                </span>
              </td>
              <td class="px-5 py-3 text-right dd-text-muted">{{ row.time }}</td>
            </tr>
          </tbody>
        </table>
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
          <div class="flex items-center justify-center text-[10px] font-bold text-white transition-all"
               style="width: 80%; background: var(--dd-success);">38</div>
          <div class="flex items-center justify-center text-[10px] font-bold text-white transition-all"
               style="width: 13%; background: var(--dd-warning);">6</div>
          <div class="flex items-center justify-center text-[10px] font-bold text-white transition-all"
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
        <!-- Tooltip demos -->
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
        <!-- Confirm dialog demos -->
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
          <div v-for="token in [
            { name: 'primary', var: '--dd-primary' },
            { name: 'success', var: '--dd-success' },
            { name: 'danger', var: '--dd-danger' },
            { name: 'warning', var: '--dd-warning' },
            { name: 'info', var: '--dd-info' },
            { name: 'bg', var: '--dd-bg' },
            { name: 'bg-card', var: '--dd-bg-card' },
            { name: 'bg-inset', var: '--dd-bg-inset' },
            { name: 'bg-elevated', var: '--dd-bg-elevated' },
            { name: 'border', var: '--dd-border' },
            { name: 'border-strong', var: '--dd-border-strong' },
            { name: 'text', var: '--dd-text' },
          ]" :key="token.var"
               class="flex items-center gap-2 p-2 dd-rounded"
               :style="{ border: '1px solid var(--dd-border)' }">
            <div class="w-5 h-5 dd-rounded-sm shrink-0"
                 :style="{ backgroundColor: `var(${token.var})`, border: '1px solid var(--dd-border-strong)' }" />
            <span class="text-[10px] font-mono dd-text-muted truncate">{{ token.name }}</span>
          </div>
        </div>
      </div>
    </div>

  </div>
  </div>
</template>
