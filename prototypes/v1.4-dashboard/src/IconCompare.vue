<template>
  <div class="min-h-screen p-8" :style="{ backgroundColor: '#0f172a', color: '#e2e8f0' }">
    <h1 class="text-2xl font-bold mb-2">Drydock Icon Comparison</h1>
    <p class="text-sm text-slate-400 mb-6">34 icons used in the dashboard — compared across icon libraries</p>

    <!-- Library selector -->
    <div class="flex flex-wrap gap-2 mb-8 sticky top-0 z-10 py-3" style="background: #0f172a">
      <button v-for="lib in libraries" :key="lib.prefix"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors"
              :class="visibleLibs.has(lib.prefix)
                ? 'bg-drydock-secondary text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'"
              @click="toggleLib(lib.prefix)">
        {{ lib.name }}
      </button>
    </div>

    <!-- Icon grid -->
    <div class="overflow-x-auto">
      <table class="w-full border-collapse">
        <thead>
          <tr>
            <th class="text-left text-[10px] uppercase tracking-wider text-slate-500 pb-3 pr-6 sticky left-0 bg-[#0f172a] min-w-[160px]">
              Usage
            </th>
            <th v-for="lib in visibleLibraries" :key="lib.prefix"
                class="text-center text-[10px] uppercase tracking-wider text-slate-500 pb-3 px-4 min-w-[80px]">
              {{ lib.name }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="icon in icons" :key="icon.name"
              class="border-t border-slate-800 hover:bg-slate-800/50 transition-colors">
            <td class="py-3 pr-6 sticky left-0 bg-[#0f172a]">
              <div class="text-[11px] font-semibold text-slate-300">{{ icon.label }}</div>
              <div class="text-[9px] text-slate-600 font-mono">{{ icon.context }}</div>
            </td>
            <td v-for="lib in visibleLibraries" :key="lib.prefix"
                class="py-3 px-4 text-center">
              <div class="flex flex-col items-center gap-1">
                <iconify-icon
                  v-if="icon.map[lib.prefix]"
                  :icon="icon.map[lib.prefix]"
                  width="22" height="22"
                  class="text-slate-200" />
                <span v-else class="text-slate-700 text-[10px]">—</span>
                <span class="text-[8px] text-slate-600 font-mono max-w-[100px] truncate">
                  {{ icon.map[lib.prefix]?.split(':')[1] || '' }}
                </span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const libraries = [
  { prefix: 'fa6-solid', name: 'FA Solid' },
  { prefix: 'ph', name: 'Phosphor' },
  { prefix: 'ph-duotone', name: 'Phosphor Duo' },
  { prefix: 'lucide', name: 'Lucide' },
  { prefix: 'tabler', name: 'Tabler' },
  { prefix: 'heroicons', name: 'Heroicons' },
  { prefix: 'iconoir', name: 'Iconoir' },
  { prefix: 'streamline', name: 'Streamline' },
];

const visibleLibs = ref(new Set(['fa6-solid', 'ph', 'ph-duotone', 'lucide', 'tabler']));

const toggleLib = (prefix: string) => {
  if (visibleLibs.value.has(prefix)) {
    visibleLibs.value.delete(prefix);
  } else {
    visibleLibs.value.add(prefix);
  }
  visibleLibs.value = new Set(visibleLibs.value);
};

const visibleLibraries = computed(() =>
  libraries.filter(l => visibleLibs.value.has(l.prefix))
);

const icons = [
  // Sidebar Navigation
  { label: 'Dashboard', context: 'sidebar nav', map: {
    'fa6-solid': 'fa6-solid:layer-group',
    'ph': 'ph:squares-four', 'ph-duotone': 'ph:squares-four-duotone',
    'lucide': 'lucide:layout-dashboard', 'tabler': 'tabler:layout-dashboard',
    'heroicons': 'heroicons:squares-2x2', 'iconoir': 'iconoir:dashboard',
    'streamline': 'streamline:dashboard-square',
  }},
  { label: 'Containers', context: 'sidebar nav', map: {
    'fa6-solid': 'fa6-solid:cube',
    'ph': 'ph:cube', 'ph-duotone': 'ph:cube-duotone',
    'lucide': 'lucide:box', 'tabler': 'tabler:box',
    'heroicons': 'heroicons:cube', 'iconoir': 'iconoir:box-3d-center',
    'streamline': 'streamline:box',
  }},
  { label: 'Updates', context: 'sidebar nav + stats', map: {
    'fa6-solid': 'fa6-solid:download',
    'ph': 'ph:download-simple', 'ph-duotone': 'ph:download-simple-duotone',
    'lucide': 'lucide:download', 'tabler': 'tabler:download',
    'heroicons': 'heroicons:arrow-down-tray', 'iconoir': 'iconoir:download',
    'streamline': 'streamline:download-circle',
  }},
  { label: 'Security', context: 'sidebar + detail + stats', map: {
    'fa6-solid': 'fa6-solid:shield-halved',
    'ph': 'ph:shield-check', 'ph-duotone': 'ph:shield-check-duotone',
    'lucide': 'lucide:shield-check', 'tabler': 'tabler:shield-check',
    'heroicons': 'heroicons:shield-check', 'iconoir': 'iconoir:shield-check',
    'streamline': 'streamline:shield-check',
  }},
  { label: 'Logs', context: 'sidebar nav + detail tab', map: {
    'fa6-solid': 'fa6-solid:scroll',
    'ph': 'ph:scroll', 'ph-duotone': 'ph:scroll-duotone',
    'lucide': 'lucide:scroll-text', 'tabler': 'tabler:file-text',
    'heroicons': 'heroicons:document-text', 'iconoir': 'iconoir:page',
    'streamline': 'streamline:file-text',
  }},
  { label: 'Registries', context: 'sidebar nav', map: {
    'fa6-solid': 'fa6-solid:database',
    'ph': 'ph:database', 'ph-duotone': 'ph:database-duotone',
    'lucide': 'lucide:database', 'tabler': 'tabler:database',
    'heroicons': 'heroicons:circle-stack', 'iconoir': 'iconoir:database',
    'streamline': 'streamline:database',
  }},
  { label: 'Agents', context: 'sidebar nav', map: {
    'fa6-solid': 'fa6-solid:satellite-dish',
    'ph': 'ph:broadcast', 'ph-duotone': 'ph:broadcast-duotone',
    'lucide': 'lucide:radio-tower', 'tabler': 'tabler:antenna',
    'heroicons': 'heroicons:signal', 'iconoir': 'iconoir:antenna-signal',
    'streamline': 'streamline:satellite-dish',
  }},
  { label: 'Triggers', context: 'sidebar + detail tab', map: {
    'fa6-solid': 'fa6-solid:bolt',
    'ph': 'ph:lightning', 'ph-duotone': 'ph:lightning-duotone',
    'lucide': 'lucide:zap', 'tabler': 'tabler:bolt',
    'heroicons': 'heroicons:bolt', 'iconoir': 'iconoir:flash',
    'streamline': 'streamline:lightning-bolt',
  }},
  { label: 'Watchers', context: 'sidebar nav', map: {
    'fa6-solid': 'fa6-solid:eye',
    'ph': 'ph:eye', 'ph-duotone': 'ph:eye-duotone',
    'lucide': 'lucide:eye', 'tabler': 'tabler:eye',
    'heroicons': 'heroicons:eye', 'iconoir': 'iconoir:eye-empty',
    'streamline': 'streamline:visible',
  }},
  { label: 'Settings', context: 'sidebar + user menu', map: {
    'fa6-solid': 'fa6-solid:gear',
    'ph': 'ph:gear-six', 'ph-duotone': 'ph:gear-six-duotone',
    'lucide': 'lucide:settings', 'tabler': 'tabler:settings',
    'heroicons': 'heroicons:cog-6-tooth', 'iconoir': 'iconoir:settings',
    'streamline': 'streamline:cog',
  }},
  { label: 'Auth / Lock', context: 'sidebar nav', map: {
    'fa6-solid': 'fa6-solid:lock',
    'ph': 'ph:lock', 'ph-duotone': 'ph:lock-duotone',
    'lucide': 'lucide:lock', 'tabler': 'tabler:lock',
    'heroicons': 'heroicons:lock-closed', 'iconoir': 'iconoir:lock',
    'streamline': 'streamline:lock-1',
  }},
  { label: 'Notifications', context: 'sidebar + header', map: {
    'fa6-solid': 'fa6-solid:bell',
    'ph': 'ph:bell', 'ph-duotone': 'ph:bell-duotone',
    'lucide': 'lucide:bell', 'tabler': 'tabler:bell',
    'heroicons': 'heroicons:bell', 'iconoir': 'iconoir:bell',
    'streamline': 'streamline:alarm-bell',
  }},

  // Theme toggles
  { label: 'Dark Mode', context: 'theme toggle', map: {
    'fa6-solid': 'fa6-solid:moon',
    'ph': 'ph:moon', 'ph-duotone': 'ph:moon-duotone',
    'lucide': 'lucide:moon', 'tabler': 'tabler:moon',
    'heroicons': 'heroicons:moon', 'iconoir': 'iconoir:half-moon',
    'streamline': 'streamline:moon-1',
  }},
  { label: 'Light Mode', context: 'theme toggle', map: {
    'fa6-solid': 'fa6-solid:sun',
    'ph': 'ph:sun', 'ph-duotone': 'ph:sun-duotone',
    'lucide': 'lucide:sun', 'tabler': 'tabler:sun',
    'heroicons': 'heroicons:sun', 'iconoir': 'iconoir:sun-light',
    'streamline': 'streamline:sun-1',
  }},

  // Stats / Trends
  { label: 'Uptime', context: 'stats card', map: {
    'fa6-solid': 'fa6-solid:heart-pulse',
    'ph': 'ph:heartbeat', 'ph-duotone': 'ph:heartbeat-duotone',
    'lucide': 'lucide:heart-pulse', 'tabler': 'tabler:heartbeat',
    'heroicons': 'heroicons:heart', 'iconoir': 'iconoir:heart',
    'streamline': 'streamline:heart-rate-pulse',
  }},
  { label: 'Trend Up', context: 'stats trend', map: {
    'fa6-solid': 'fa6-solid:arrow-up',
    'ph': 'ph:arrow-up', 'ph-duotone': 'ph:arrow-up-duotone',
    'lucide': 'lucide:trending-up', 'tabler': 'tabler:trending-up',
    'heroicons': 'heroicons:arrow-trending-up', 'iconoir': 'iconoir:arrow-up',
    'streamline': 'streamline:arrow-up',
  }},
  { label: 'Trend Down', context: 'stats trend', map: {
    'fa6-solid': 'fa6-solid:arrow-down',
    'ph': 'ph:arrow-down', 'ph-duotone': 'ph:arrow-down-duotone',
    'lucide': 'lucide:trending-down', 'tabler': 'tabler:trending-down',
    'heroicons': 'heroicons:arrow-trending-down', 'iconoir': 'iconoir:arrow-down',
    'streamline': 'streamline:arrow-down',
  }},
  { label: 'Neutral', context: 'stats trend', map: {
    'fa6-solid': 'fa6-solid:minus',
    'ph': 'ph:minus', 'ph-duotone': 'ph:minus-duotone',
    'lucide': 'lucide:minus', 'tabler': 'tabler:minus',
    'heroicons': 'heroicons:minus', 'iconoir': 'iconoir:minus',
    'streamline': 'streamline:subtract-1',
  }},

  // Container actions
  { label: 'Recent Updates', context: 'section header', map: {
    'fa6-solid': 'fa6-solid:rotate',
    'ph': 'ph:arrows-clockwise', 'ph-duotone': 'ph:arrows-clockwise-duotone',
    'lucide': 'lucide:refresh-cw', 'tabler': 'tabler:refresh',
    'heroicons': 'heroicons:arrow-path', 'iconoir': 'iconoir:refresh-double',
    'streamline': 'streamline:synchronize-arrows-1',
  }},
  { label: 'Version Arrow', context: 'tag comparison', map: {
    'fa6-solid': 'fa6-solid:arrow-right',
    'ph': 'ph:arrow-right', 'ph-duotone': 'ph:arrow-right-duotone',
    'lucide': 'lucide:arrow-right', 'tabler': 'tabler:arrow-right',
    'heroicons': 'heroicons:arrow-right', 'iconoir': 'iconoir:arrow-right',
    'streamline': 'streamline:arrow-right',
  }},
  { label: 'Updated / Check', context: 'status badge', map: {
    'fa6-solid': 'fa6-solid:check',
    'ph': 'ph:check', 'ph-duotone': 'ph:check-duotone',
    'lucide': 'lucide:check', 'tabler': 'tabler:check',
    'heroicons': 'heroicons:check', 'iconoir': 'iconoir:check',
    'streamline': 'streamline:check-1',
  }},
  { label: 'Pending', context: 'status badge', map: {
    'fa6-solid': 'fa6-solid:clock',
    'ph': 'ph:clock', 'ph-duotone': 'ph:clock-duotone',
    'lucide': 'lucide:clock', 'tabler': 'tabler:clock',
    'heroicons': 'heroicons:clock', 'iconoir': 'iconoir:clock',
    'streamline': 'streamline:time-clock-circle',
  }},
  { label: 'Close / Failed', context: 'close btn + status', map: {
    'fa6-solid': 'fa6-solid:xmark',
    'ph': 'ph:x', 'ph-duotone': 'ph:x-duotone',
    'lucide': 'lucide:x', 'tabler': 'tabler:x',
    'heroicons': 'heroicons:x-mark', 'iconoir': 'iconoir:xmark',
    'streamline': 'streamline:delete-1',
  }},
  { label: 'Up to Date', context: 'container card', map: {
    'fa6-solid': 'fa6-solid:circle-check',
    'ph': 'ph:check-circle', 'ph-duotone': 'ph:check-circle-duotone',
    'lucide': 'lucide:check-circle', 'tabler': 'tabler:circle-check',
    'heroicons': 'heroicons:check-circle', 'iconoir': 'iconoir:check-circle',
    'streamline': 'streamline:check-circle-1',
  }},
  { label: 'Stop', context: 'container action', map: {
    'fa6-solid': 'fa6-solid:stop',
    'ph': 'ph:stop', 'ph-duotone': 'ph:stop-duotone',
    'lucide': 'lucide:square', 'tabler': 'tabler:player-stop',
    'heroicons': 'heroicons:stop', 'iconoir': 'iconoir:media-stop',
    'streamline': 'streamline:button-stop',
  }},
  { label: 'Start / Play', context: 'container action', map: {
    'fa6-solid': 'fa6-solid:play',
    'ph': 'ph:play', 'ph-duotone': 'ph:play-duotone',
    'lucide': 'lucide:play', 'tabler': 'tabler:player-play',
    'heroicons': 'heroicons:play', 'iconoir': 'iconoir:media-play',
    'streamline': 'streamline:button-play',
  }},
  { label: 'Restart', context: 'container action', map: {
    'fa6-solid': 'fa6-solid:rotate-right',
    'ph': 'ph:arrow-clockwise', 'ph-duotone': 'ph:arrow-clockwise-duotone',
    'lucide': 'lucide:rotate-cw', 'tabler': 'tabler:rotate-clockwise',
    'heroicons': 'heroicons:arrow-path', 'iconoir': 'iconoir:redo',
    'streamline': 'streamline:redo',
  }},
  { label: 'Update / Pull', context: 'container action', map: {
    'fa6-solid': 'fa6-solid:cloud-arrow-down',
    'ph': 'ph:cloud-arrow-down', 'ph-duotone': 'ph:cloud-arrow-down-duotone',
    'lucide': 'lucide:cloud-download', 'tabler': 'tabler:cloud-download',
    'heroicons': 'heroicons:cloud-arrow-down', 'iconoir': 'iconoir:cloud-download',
    'streamline': 'streamline:cloud-download',
  }},
  { label: 'Filter', context: 'empty state', map: {
    'fa6-solid': 'fa6-solid:filter',
    'ph': 'ph:funnel', 'ph-duotone': 'ph:funnel-duotone',
    'lucide': 'lucide:filter', 'tabler': 'tabler:filter',
    'heroicons': 'heroicons:funnel', 'iconoir': 'iconoir:filter',
    'streamline': 'streamline:filter-1',
  }},

  // Detail panel
  { label: 'Ports / Network', context: 'detail overview', map: {
    'fa6-solid': 'fa6-solid:network-wired',
    'ph': 'ph:plugs-connected', 'ph-duotone': 'ph:plugs-connected-duotone',
    'lucide': 'lucide:network', 'tabler': 'tabler:network',
    'heroicons': 'heroicons:server-stack', 'iconoir': 'iconoir:network-right',
    'streamline': 'streamline:hierarchy-3',
  }},
  { label: 'Volumes / Disk', context: 'detail overview', map: {
    'fa6-solid': 'fa6-solid:hard-drive',
    'ph': 'ph:hard-drives', 'ph-duotone': 'ph:hard-drives-duotone',
    'lucide': 'lucide:hard-drive', 'tabler': 'tabler:device-floppy',
    'heroicons': 'heroicons:server', 'iconoir': 'iconoir:hard-drive',
    'streamline': 'streamline:hard-drive',
  }},
  { label: 'Webhook / Globe', context: 'trigger type', map: {
    'fa6-solid': 'fa6-solid:globe',
    'ph': 'ph:globe', 'ph-duotone': 'ph:globe-duotone',
    'lucide': 'lucide:globe', 'tabler': 'tabler:world',
    'heroicons': 'heroicons:globe-alt', 'iconoir': 'iconoir:globe',
    'streamline': 'streamline:earth',
  }},
  { label: 'Terminal / Search', context: 'search modal', map: {
    'fa6-solid': 'fa6-solid:terminal',
    'ph': 'ph:terminal', 'ph-duotone': 'ph:terminal-duotone',
    'lucide': 'lucide:terminal', 'tabler': 'tabler:terminal',
    'heroicons': 'heroicons:command-line', 'iconoir': 'iconoir:terminal',
    'streamline': 'streamline:programming-browser',
  }},

  // User menu
  { label: 'User / Profile', context: 'user menu', map: {
    'fa6-solid': 'fa6-solid:user',
    'ph': 'ph:user', 'ph-duotone': 'ph:user-duotone',
    'lucide': 'lucide:user', 'tabler': 'tabler:user',
    'heroicons': 'heroicons:user', 'iconoir': 'iconoir:user',
    'streamline': 'streamline:single-neutral',
  }},
  { label: 'Sign Out', context: 'user menu', map: {
    'fa6-solid': 'fa6-solid:arrow-right-from-bracket',
    'ph': 'ph:sign-out', 'ph-duotone': 'ph:sign-out-duotone',
    'lucide': 'lucide:log-out', 'tabler': 'tabler:logout',
    'heroicons': 'heroicons:arrow-right-on-rectangle', 'iconoir': 'iconoir:log-out',
    'streamline': 'streamline:logout-1',
  }},
  { label: 'Info / Overview', context: 'detail tab', map: {
    'fa6-solid': 'fa6-solid:circle-info',
    'ph': 'ph:info', 'ph-duotone': 'ph:info-duotone',
    'lucide': 'lucide:info', 'tabler': 'tabler:info-circle',
    'heroicons': 'heroicons:information-circle', 'iconoir': 'iconoir:info-circle',
    'streamline': 'streamline:information-circle',
  }},
];
</script>
