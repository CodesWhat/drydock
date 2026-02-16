<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import Menu from 'primevue/menu';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import whaleLogo from '@/assets/whale-logo.png';
import AppIcon from './components/AppIcon.vue';
import { useIcons } from './composables/useIcons';
import { type IconLibrary, libraryLabels, iconMap } from './icons';

const { icon, iconLibrary, setIconLibrary, iconScale, setIconScale } = useIcons();

// ── Theme ──────────────────────────────────────────────
const isDark = ref(true);
function toggleTheme() {
  isDark.value = !isDark.value;
  document.documentElement.classList.toggle('dark', isDark.value);
  document.documentElement.classList.toggle('light', !isDark.value);
}

// ── Sidebar ────────────────────────────────────────────
const sidebarCollapsed = ref(false);
const isMobileMenuOpen = ref(false);
const isMobile = ref(globalThis.innerWidth < 768);

function handleResize() {
  isMobile.value = globalThis.innerWidth < 768;
  if (!isMobile.value) isMobileMenuOpen.value = false;
}

// ── Navigation ─────────────────────────────────────────
const activeRoute = ref('/home');
const isCollapsed = computed(() => sidebarCollapsed.value && !isMobile.value);

interface NavItem {
  label: string;
  icon: string;
  route: string;
  badge?: string;
  badgeColor?: string;
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', icon: 'dashboard', route: '/home' },
      { label: 'Containers', icon: 'containers', route: '/containers', badge: '47', badgeColor: 'blue' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Updates', icon: 'updates', route: '/updates', badge: '12', badgeColor: 'amber' },
      { label: 'Security', icon: 'security', route: '/security', badge: '3', badgeColor: 'red' },
      { label: 'Logs', icon: 'logs', route: '/logs' },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { label: 'Registries', icon: 'registries', route: '/registries' },
      { label: 'Agents', icon: 'agents', route: '/agents' },
      { label: 'Triggers', icon: 'triggers', route: '/triggers' },
      { label: 'Watchers', icon: 'watchers', route: '/watchers' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'Server', icon: 'settings', route: '/server' },
      { label: 'Auth', icon: 'auth', route: '/auth' },
      { label: 'Notifications', icon: 'notifications', route: '/notifications' },
    ],
  },
];

const currentPageLabel = computed(() => {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.route === activeRoute.value) return item.label;
    }
  }
  return 'Dashboard';
});

const currentPageIcon = computed(() => {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.route === activeRoute.value) return item.icon;
    }
  }
  return 'dashboard';
});

function navigateTo(route: string) {
  activeRoute.value = route;
  if (isMobile.value) isMobileMenuOpen.value = false;
  detailPanelOpen.value = false;
}

// ── User menu (PrimeVue Menu) ──────────────────────────
const userMenu = ref<InstanceType<typeof Menu> | null>(null);
const userMenuItems = [
  {
    label: 'admin',
    items: [
      { label: 'Profile', icon: 'fa-regular fa-user' },
      { label: 'Settings', icon: 'fa-solid fa-cog' },
      { separator: true },
      { label: 'Sign out', icon: 'fa-solid fa-arrow-right-from-bracket', class: 'text-red-400' },
    ],
  },
];
function toggleUserMenu(event: Event) {
  userMenu.value?.toggle(event);
}

// ── Search (PrimeVue Dialog) ───────────────────────────
const showSearch = ref(false);
const searchQuery = ref('');
const searchInput = ref<HTMLInputElement | null>(null);

function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    showSearch.value = !showSearch.value;
  }
  if (e.key === 'Escape') {
    showSearch.value = false;
  }
}

watch(showSearch, async (val) => {
  if (val) {
    searchQuery.value = '';
    await nextTick();
    searchInput.value?.focus();
  }
});

// ── Stats ──────────────────────────────────────────────
const stats = [
  { label: 'Containers', value: '47', icon: 'containers', color: '#0096C7', trend: '+3' },
  { label: 'Updates Available', value: '12', icon: 'updates', color: '#FF9800', trend: '+5' },
  { label: 'Security Issues', value: '3', icon: 'security', color: '#E53935', trend: '-2' },
  { label: 'Uptime', value: '99.8%', icon: 'uptime', color: '#06D6A0', trend: '+0.1%' },
];

// ── Recent Updates ─────────────────────────────────────
const recentUpdates = [
  { name: 'traefik', image: 'traefik', oldVer: '2.10.7', newVer: '3.0.1', status: 'updated', time: '12m ago', running: true },
  { name: 'postgres-db', image: 'postgres', oldVer: '15.4', newVer: '16.1', status: 'pending', time: '34m ago', running: true },
  { name: 'redis-cache', image: 'redis', oldVer: '7.0.12', newVer: '7.2.4', status: 'updated', time: '1h ago', running: true },
  { name: 'nginx-proxy', image: 'nginx', oldVer: '1.24.0', newVer: '1.25.3', status: 'failed', time: '2h ago', running: false },
  { name: 'grafana', image: 'grafana/grafana', oldVer: '10.1.5', newVer: '10.2.3', status: 'updated', time: '3h ago', running: true },
];

// ── Vulnerabilities ────────────────────────────────────
const vulnerabilities = [
  { id: 'CVE-2024-21626', severity: 'CRITICAL', package: 'runc 1.1.11', image: 'nginx-proxy' },
  { id: 'CVE-2024-0727', severity: 'CRITICAL', package: 'openssl 3.1.4', image: 'traefik' },
  { id: 'CVE-2023-50164', severity: 'HIGH', package: 'curl 8.4.0', image: 'postgres-db' },
];

// ── Containers Page ───────────────────────────────────
interface ContainerDetails {
  ports: string[];
  volumes: string[];
  env: { key: string; value: string }[];
  labels: string[];
}
interface Container {
  name: string;
  image: string;
  currentTag: string;
  newTag: string | null;
  status: 'running' | 'stopped';
  registry: 'dockerhub' | 'ghcr' | 'custom';
  updateKind: 'major' | 'minor' | 'patch' | 'digest' | null;
  bouncer: 'safe' | 'unsafe' | 'blocked';
  details: ContainerDetails;
}

const containers = ref<Container[]>([
  {
    name: 'traefik',
    image: 'traefik',
    currentTag: '2.10.7',
    newTag: '3.0.1',
    status: 'running',
    registry: 'dockerhub',
    updateKind: 'major',
    bouncer: 'blocked',
    details: {
      ports: ['80:80', '443:443', '8080:8080'],
      volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro', './traefik.yml:/traefik.yml'],
      env: [{ key: 'TRAEFIK_LOG_LEVEL', value: 'INFO' }],
      labels: ['reverse-proxy', 'load-balancer', 'production'],
    },
  },
  {
    name: 'postgres-db',
    image: 'postgres',
    currentTag: '15.4',
    newTag: '16.1',
    status: 'running',
    registry: 'dockerhub',
    updateKind: 'major',
    bouncer: 'blocked',
    details: {
      ports: ['5432:5432'],
      volumes: ['pg_data:/var/lib/postgresql/data'],
      env: [{ key: 'POSTGRES_DB', value: 'drydock' }, { key: 'POSTGRES_USER', value: 'admin' }],
      labels: ['database', 'production'],
    },
  },
  {
    name: 'redis-cache',
    image: 'redis',
    currentTag: '7.0.12',
    newTag: '7.2.4',
    status: 'running',
    registry: 'dockerhub',
    updateKind: 'minor',
    bouncer: 'safe',
    details: {
      ports: ['6379:6379'],
      volumes: ['redis_data:/data'],
      env: [{ key: 'REDIS_MAXMEMORY', value: '256mb' }],
      labels: ['cache', 'production'],
    },
  },
  {
    name: 'nginx-proxy',
    image: 'nginx',
    currentTag: '1.24.0',
    newTag: '1.25.3',
    status: 'stopped',
    registry: 'dockerhub',
    updateKind: 'minor',
    bouncer: 'unsafe',
    details: {
      ports: ['8081:80'],
      volumes: ['./nginx.conf:/etc/nginx/nginx.conf:ro'],
      env: [],
      labels: ['proxy', 'staging'],
    },
  },
  {
    name: 'grafana',
    image: 'grafana/grafana',
    currentTag: '10.1.5',
    newTag: '10.2.3',
    status: 'running',
    registry: 'dockerhub',
    updateKind: 'minor',
    bouncer: 'safe',
    details: {
      ports: ['3000:3000'],
      volumes: ['grafana_data:/var/lib/grafana'],
      env: [{ key: 'GF_SECURITY_ADMIN_USER', value: 'admin' }],
      labels: ['monitoring', 'observability'],
    },
  },
  {
    name: 'prometheus',
    image: 'prom/prometheus',
    currentTag: '2.48.1',
    newTag: null,
    status: 'running',
    registry: 'dockerhub',
    updateKind: null,
    bouncer: 'safe',
    details: {
      ports: ['9090:9090'],
      volumes: ['./prometheus.yml:/etc/prometheus/prometheus.yml', 'prom_data:/prometheus'],
      env: [],
      labels: ['monitoring', 'metrics', 'production'],
    },
  },
  {
    name: 'drydock-api',
    image: 'ghcr.io/drydock/api',
    currentTag: '1.3.1',
    newTag: '1.3.2',
    status: 'running',
    registry: 'ghcr',
    updateKind: 'patch',
    bouncer: 'safe',
    details: {
      ports: ['3001:3001'],
      volumes: ['./config:/app/config:ro'],
      env: [{ key: 'NODE_ENV', value: 'production' }, { key: 'LOG_LEVEL', value: 'info' }],
      labels: ['api', 'drydock', 'production'],
    },
  },
  {
    name: 'drydock-ui',
    image: 'ghcr.io/drydock/ui',
    currentTag: '1.3.1',
    newTag: null,
    status: 'running',
    registry: 'ghcr',
    updateKind: null,
    bouncer: 'safe',
    details: {
      ports: ['8080:80'],
      volumes: [],
      env: [{ key: 'API_URL', value: 'http://drydock-api:3001' }],
      labels: ['frontend', 'drydock', 'production'],
    },
  },
  {
    name: 'registry-mirror',
    image: 'registry.internal/mirror',
    currentTag: '2.8.3',
    newTag: '2.8.4',
    status: 'stopped',
    registry: 'custom',
    updateKind: 'patch',
    bouncer: 'unsafe',
    details: {
      ports: ['5000:5000'],
      volumes: ['registry_data:/var/lib/registry'],
      env: [{ key: 'REGISTRY_STORAGE_DELETE_ENABLED', value: 'true' }],
      labels: ['registry', 'internal'],
    },
  },
  {
    name: 'watchtower',
    image: 'containrrr/watchtower',
    currentTag: '1.7.1',
    newTag: null,
    status: 'running',
    registry: 'dockerhub',
    updateKind: null,
    bouncer: 'safe',
    details: {
      ports: [],
      volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
      env: [{ key: 'WATCHTOWER_POLL_INTERVAL', value: '3600' }, { key: 'WATCHTOWER_CLEANUP', value: 'true' }],
      labels: ['automation', 'updates'],
    },
  },
]);

// Container filters
const filterSearch = ref('');
const filterStatus = ref('all');
const filterRegistry = ref('all');
const filterUpdate = ref('all');
const filterBouncer = ref('all');

const filteredContainers = computed(() => {
  return containers.value.filter((c) => {
    if (filterSearch.value) {
      const q = filterSearch.value.toLowerCase();
      if (!c.name.toLowerCase().includes(q) && !c.image.toLowerCase().includes(q)) return false;
    }
    if (filterStatus.value !== 'all' && c.status !== filterStatus.value) return false;
    if (filterRegistry.value !== 'all' && c.registry !== filterRegistry.value) return false;
    if (filterUpdate.value === 'available' && !c.newTag) return false;
    if (filterUpdate.value === 'uptodate' && c.newTag) return false;
    if (filterBouncer.value !== 'all' && c.bouncer !== filterBouncer.value) return false;
    return true;
  });
});

// Container detail panel
const selectedContainer = ref<Container | null>(null);
const detailPanelOpen = ref(false);
const activeDetailTab = ref('overview');
const panelSize = ref<'sm' | 'md' | 'lg'>('sm');

// Panel widths: S=30%, M=45%, L=75% — cards always stay on the left
const panelFlex = computed(() =>
  panelSize.value === 'sm' ? '0 0 30%'
  : panelSize.value === 'md' ? '0 0 45%'
  : '0 0 70%'
);

// Panel size is set directly via S/M/L buttons in the toolbar

const detailTabs = [
  { id: 'overview', label: 'Overview', icon: 'info' },
  { id: 'logs', label: 'Logs', icon: 'logs' },
  { id: 'security', label: 'Security', icon: 'security' },
  { id: 'triggers', label: 'Triggers', icon: 'triggers' },
];

function selectContainer(c: Container) {
  selectedContainer.value = c;
  activeDetailTab.value = 'overview';
  detailPanelOpen.value = true;
}

function closePanel() {
  detailPanelOpen.value = false;
  panelSize.value = 'sm';
}

function clearFilters() {
  filterSearch.value = '';
  filterStatus.value = 'all';
  filterRegistry.value = 'all';
  filterUpdate.value = 'all';
  filterBouncer.value = 'all';
}

function registryLabel(reg: string) {
  return reg === 'dockerhub' ? 'Dockerhub' : reg === 'ghcr' ? 'GHCR' : 'Custom';
}
function registryColorBg(reg: string, dark: boolean) {
  if (reg === 'dockerhub') return dark ? 'rgba(59,130,246,0.15)' : '#eff6ff';
  if (reg === 'ghcr') return dark ? 'rgba(168,85,247,0.15)' : '#faf5ff';
  return dark ? '#334155' : '#f3f4f6';
}
function registryColorText(reg: string, dark: boolean) {
  if (reg === 'dockerhub') return dark ? '#60a5fa' : '#1d4ed8';
  if (reg === 'ghcr') return dark ? '#c084fc' : '#7e22ce';
  return dark ? '#94a3b8' : '#4b5563';
}
function updateKindColor(kind: string | null) {
  if (kind === 'major') return { bg: 'rgba(229,57,53,0.15)', text: '#E53935' };
  if (kind === 'minor') return { bg: 'rgba(255,152,0,0.15)', text: '#FF9800' };
  if (kind === 'patch') return { bg: 'rgba(0,150,199,0.15)', text: '#0096C7' };
  if (kind === 'digest') return { bg: 'rgba(100,116,139,0.15)', text: '#64748b' };
  return { bg: 'transparent', text: 'transparent' };
}

const mockLogLines = [
  { time: '14:23:01', level: 'info', msg: 'Server started on port 3001' },
  { time: '14:23:02', level: 'info', msg: 'Connected to database' },
  { time: '14:23:05', level: 'debug', msg: 'Health check passed' },
  { time: '14:24:12', level: 'warn', msg: 'Slow query detected (1.2s)' },
  { time: '14:25:00', level: 'info', msg: 'Scheduled task: image scan started' },
  { time: '14:25:33', level: 'info', msg: 'Image scan completed: 0 vulnerabilities' },
  { time: '14:26:01', level: 'error', msg: 'Failed to connect to upstream registry (timeout)' },
  { time: '14:26:15', level: 'info', msg: 'Retrying upstream connection...' },
  { time: '14:26:16', level: 'info', msg: 'Upstream connection restored' },
  { time: '14:27:00', level: 'debug', msg: 'Health check passed' },
];

const mockTriggers = [
  { name: 'Auto-update on patch', type: 'webhook', active: true },
  { name: 'Slack notification', type: 'notification', active: true },
  { name: 'Restart on failure', type: 'policy', active: false },
  { name: 'Security scan on pull', type: 'webhook', active: true },
];

// ── Settings Page ─────────────────────────────────────
const activeSettingsTab = ref('general');
const settingsTabs = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'moon' },
];

const serverFields = [
  { label: 'Server Name', value: 'drydock-prod' },
  { label: 'Version', value: 'v1.3.1' },
  { label: 'Host', value: '0.0.0.0:3001' },
  { label: 'Uptime', value: '14d 7h 23m' },
  { label: 'Docker Engine', value: '24.0.7' },
  { label: 'Containers', value: '47 (8 running)' },
];

const themeOptions = [
  { id: 'dark', label: 'Dark', icon: 'moon' },
  { id: 'light', label: 'Light', icon: 'sun' },
];

type FontId = 'ibm-plex-mono' | 'jetbrains-mono' | 'source-code-pro' | 'commit-mono' | 'inconsolata' | 'comic-mono';
const fontOptions: { id: FontId; label: string; family: string }[] = [
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', family: '"IBM Plex Mono", monospace' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono', family: '"JetBrains Mono", monospace' },
  { id: 'source-code-pro', label: 'Source Code Pro', family: '"Source Code Pro", monospace' },
  { id: 'commit-mono', label: 'Commit Mono', family: '"Commit Mono", monospace' },
  { id: 'inconsolata', label: 'Inconsolata', family: '"Inconsolata", monospace' },
  { id: 'comic-mono', label: 'Comic Mono', family: '"Comic Mono", monospace' },
];

const FONT_STORAGE_KEY = 'drydock-font-family';
function loadFont(): FontId {
  try {
    const stored = localStorage.getItem(FONT_STORAGE_KEY);
    if (stored && fontOptions.some(f => f.id === stored)) return stored as FontId;
  } catch { /* ignored */ }
  return 'ibm-plex-mono';
}
const activeFont = ref<FontId>(loadFont());

function setFont(id: FontId) {
  activeFont.value = id;
  const opt = fontOptions.find(f => f.id === id);
  if (opt) {
    document.documentElement.style.setProperty('--font-mono', opt.family);
    document.body.style.fontFamily = opt.family;
  }
  try { localStorage.setItem(FONT_STORAGE_KEY, id); } catch { /* ignored */ }
}
// Apply persisted font on load
{ const opt = fontOptions.find(f => f.id === activeFont.value); if (opt) { document.documentElement.style.setProperty('--font-mono', opt.family); document.body.style.fontFamily = opt.family; } }

// ── Lifecycle ──────────────────────────────────────────
onMounted(() => {
  globalThis.addEventListener('resize', handleResize);
  globalThis.addEventListener('keydown', handleKeydown);
});
onUnmounted(() => {
  globalThis.removeEventListener('resize', handleResize);
  globalThis.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div :class="[isDark ? 'dark' : 'light']"
       class="h-screen flex overflow-hidden font-mono"
       :style="{ background: isDark ? '#0f172a' : '#f8fafc' }">

    <!-- Mobile overlay -->
    <div v-if="isMobileMenuOpen && isMobile"
         class="sidebar-overlay fixed inset-0 bg-black/60 z-40"
         @click="isMobileMenuOpen = false" />

    <!-- ═══════════════════════════════════════════════ -->
    <!-- SIDEBAR                                        -->
    <!-- ═══════════════════════════════════════════════ -->
    <aside
      :class="[
        'sidebar-transition flex flex-col z-50 h-full',
        isMobile ? 'fixed top-0 left-0' : 'relative',
        isMobile && !isMobileMenuOpen ? '-translate-x-full' : 'translate-x-0',
        isCollapsed ? 'sidebar-collapsed' : '',
      ]"
      :style="{
        width: (isCollapsed) ? '56px' : '240px',
        minWidth: (isCollapsed) ? '56px' : '240px',
        backgroundColor: isDark ? '#0c1222' : '#ffffff',
        borderRight: isDark ? '1px solid #1e293b' : '1px solid #e2e8f0',
        overflowX: 'hidden',
      }">

      <!-- Logo -->
      <div class="flex items-center h-12 shrink-0 overflow-hidden"
           :class="isCollapsed ? 'justify-center px-1' : 'px-3'"
           :style="{ borderBottom: isDark ? '1px solid #1e293b' : '1px solid #e2e8f0' }">
        <div class="flex items-center gap-2 overflow-hidden shrink-0">
          <img :src="whaleLogo" alt="Drydock"
               class="h-5 w-auto shrink-0 transition-transform duration-300"
               :class="isDark ? 'invert' : ''"
               :style="isCollapsed ? { transform: 'scaleX(-1)' } : {}" />
          <span class="sidebar-label font-bold text-sm tracking-widest"
                :class="isDark ? 'text-slate-100' : 'text-slate-800'"
                style="letter-spacing:0.15em;">DRYDOCK</span>
        </div>
      </div>

      <!-- Nav groups -->
      <nav class="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-4">
        <div v-for="group in navGroups" :key="group.label">
          <!-- Group label (expanded) -->
          <div v-if="!isCollapsed"
               class="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider"
               :class="isDark ? 'text-slate-500' : 'text-slate-400'">
            {{ group.label }}
          </div>
          <!-- Collapsed divider dot (centered between groups) -->
          <div v-else class="flex justify-center py-1 w-9 mx-auto">
            <div class="w-1 h-1 rounded-full" :class="isDark ? 'bg-slate-700' : 'bg-slate-300'" />
          </div>

          <!-- Nav items -->
          <div v-for="item in group.items" :key="item.route"
               class="nav-item-wrapper relative"
               @click="navigateTo(item.route)">
            <div
              class="nav-item flex items-center rounded-lg cursor-pointer relative"
              :class="[
                activeRoute === item.route
                  ? (isDark ? 'bg-drydock-secondary/15 text-drydock-secondary' : 'bg-drydock-secondary/10 text-drydock-secondary')
                  : (isDark ? 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'),
                isCollapsed ? 'justify-center w-9 h-9 mx-auto' : 'gap-3',
              ]"
              :style="isCollapsed ? {} : { padding: '8px 12px' }">
              <!-- Active indicator bar -->
              <div v-if="activeRoute === item.route"
                   class="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-drydock-secondary"
                   style="height: 20px;" />

              <AppIcon :name="item.icon" :size="14" class="shrink-0" style="width:18px; text-align:center;" />
              <span class="sidebar-label text-[13px] font-medium">{{ item.label }}</span>

              <!-- Badge -->
              <span v-if="item.badge && !isCollapsed"
                    class="sidebar-label ml-auto badge text-[10px]"
                    :style="{
                      backgroundColor: item.badgeColor === 'red'
                        ? (isDark ? 'rgba(229,57,53,0.2)' : 'rgba(229,57,53,0.12)')
                        : (isDark ? 'rgba(255,152,0,0.2)' : 'rgba(255,152,0,0.12)'),
                      color: item.badgeColor === 'red' ? '#E53935' : '#FF9800',
                    }">
                {{ item.badge }}
              </span>
            </div>
            <!-- Tooltip for collapsed state -->
            <div class="nav-tooltip text-xs font-medium"
                 :style="{
                   backgroundColor: '#1e293b',
                   color: '#e2e8f0',
                   boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                 }">
              {{ item.label }}
            </div>
          </div>
        </div>
      </nav>

      <!-- Sidebar footer -->
      <div class="shrink-0 px-3 py-3 space-y-2"
           :style="{ borderTop: isDark ? '1px solid #1e293b' : '1px solid #e2e8f0' }">
        <div class="flex items-center justify-between"
             :style="(isCollapsed) ? { justifyContent: 'center' } : {}">
          <span class="text-[10px] font-medium px-1.5 py-0.5 rounded"
                :class="isDark ? 'bg-slate-800 text-slate-500' : 'bg-slate-100 text-slate-400'">
            {{ (isCollapsed) ? 'v1.3' : 'v1.3.1' }}
          </span>
          <a v-if="!(isCollapsed)"
             href="#" class="text-[10px] font-medium px-1.5 py-0.5 rounded no-underline hover:underline"
             :class="isDark ? 'bg-slate-800 text-slate-500 hover:text-slate-300' : 'bg-slate-100 text-slate-400 hover:text-slate-600'">
            Docs
          </a>
        </div>
        <button v-if="!isMobile"
                class="w-full flex items-center gap-2 rounded-lg text-xs font-medium transition-colors"
                :class="isDark
                  ? 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'"
                :style="{
                  padding: sidebarCollapsed ? '6px 0' : '6px 8px',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                }"
                @click="sidebarCollapsed = !sidebarCollapsed">
          <i :class="sidebarCollapsed ? 'pi pi-angle-double-right' : 'pi pi-angle-double-left'" class="text-sm" />
          <span class="sidebar-label">Collapse</span>
        </button>
      </div>
    </aside>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- MAIN AREA                                      -->
    <!-- ═══════════════════════════════════════════════ -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">

      <!-- TOP BAR -->
      <header class="h-12 grid items-center px-4 shrink-0"
              style="grid-template-columns: 1fr auto 1fr;"
              :style="{
                backgroundColor: isDark ? '#0f172a' : '#ffffff',
                borderBottom: isDark ? '1px solid #1e293b' : '1px solid #e2e8f0',
              }">
        <!-- Left: hamburger + breadcrumb -->
        <div class="flex items-center gap-3">
          <button v-if="isMobile"
                  class="flex flex-col items-center justify-center w-8 h-8 gap-1 rounded-md transition-colors"
                  :class="isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'"
                  @click="isMobileMenuOpen = !isMobileMenuOpen">
            <span class="hamburger-line block w-4 h-[2px] rounded-full" :class="isDark ? 'bg-slate-400' : 'bg-slate-500'" />
            <span class="hamburger-line block w-4 h-[2px] rounded-full" :class="isDark ? 'bg-slate-400' : 'bg-slate-500'" />
            <span class="hamburger-line block w-4 h-[2px] rounded-full" :class="isDark ? 'bg-slate-400' : 'bg-slate-500'" />
          </button>

          <nav class="flex items-center gap-1.5 text-[13px]">
            <AppIcon :name="currentPageIcon" :size="14" :class="isDark ? 'text-slate-500' : 'text-slate-400'" class="leading-none" />
            <i class="pi pi-angle-right text-[11px] leading-none" :class="isDark ? 'text-slate-600' : 'text-slate-300'" />
            <span class="font-medium leading-none" :class="isDark ? 'text-slate-300' : 'text-slate-600'">
              {{ currentPageLabel }}
            </span>
          </nav>
        </div>

        <!-- Center: search trigger -->
        <button class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-colors min-w-[220px]"
                :class="isDark
                  ? 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-300'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-600'"
                :style="{ border: isDark ? '1px solid #1e293b' : '1px solid #e2e8f0' }"
                @click="showSearch = true">
          <i class="pi pi-search text-[11px]" />
          <span class="hidden sm:inline">Search</span>
          <kbd class="hidden sm:inline-flex items-center gap-0.5 ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium"
               :class="isDark ? 'bg-slate-700 text-slate-500' : 'bg-slate-200 text-slate-400'">
            <span class="text-[9px]">&#8984;</span>K
          </kbd>
        </button>

        <!-- Right: theme, notifications, avatar -->
        <div class="flex items-center gap-2 justify-end">
          <!-- Theme toggle -->
          <button class="flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
                  :class="isDark
                    ? 'text-slate-400 hover:bg-slate-800 hover:text-amber-400'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-amber-500'"
                  @click="toggleTheme">
            <AppIcon :name="isDark ? 'moon' : 'sun'" :size="14" />
          </button>

          <!-- Notifications -->
          <button class="relative flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
                  :class="isDark
                    ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'">
            <AppIcon name="notifications" :size="14" />
            <span class="badge-pulse absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-bold text-white"
                  style="background:#E53935;">3</span>
          </button>

          <!-- User avatar + PrimeVue Menu -->
          <div class="relative">
            <button class="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors"
                    :class="isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'"
                    @click="toggleUserMenu">
              <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                   style="background: linear-gradient(135deg, #0096C7, #06D6A0);">
                SB
              </div>
              <i class="pi pi-angle-down text-[10px]" :class="isDark ? 'text-slate-500' : 'text-slate-400'" />
            </button>
            <Menu ref="userMenu" :model="userMenuItems" :popup="true" />
          </div>
        </div>
      </header>

      <!-- MAIN CONTENT -->
      <main class="flex-1 p-4 sm:p-6"
            :class="activeRoute === '/containers' && detailPanelOpen ? 'overflow-hidden' : 'overflow-y-auto'"
            :style="{ backgroundColor: isDark ? '#151d2e' : '#f1f5f9' }">

        <!-- ═══════════════════════════════════════════════ -->
        <!-- HOME PAGE                                      -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/home'">
          <!-- ═══ STAT CARDS ═══ -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div v-for="stat in stats" :key="stat.label"
                 class="stat-card rounded-xl p-4"
                 :style="{
                   borderLeftColor: stat.color,
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                   borderLeftWidth: '4px',
                 }">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[11px] font-medium uppercase tracking-wider"
                      :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                  {{ stat.label }}
                </span>
                <div class="w-8 h-8 rounded-lg flex items-center justify-center"
                     :style="{ backgroundColor: stat.color + '18', color: stat.color }">
                  <AppIcon :name="stat.icon" :size="14" />
                </div>
              </div>
              <div class="text-2xl font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">
                {{ stat.value }}
              </div>
              <div class="text-[11px] mt-1 flex items-center gap-1"
                   :style="{ color: stat.trend.startsWith('+') ? '#06D6A0' : stat.trend.startsWith('-') ? '#E53935' : '#64748b' }">
                <AppIcon :name="stat.trend.startsWith('+') ? 'trend-up' : stat.trend.startsWith('-') ? 'trend-down' : 'neutral'" :size="9" />
                {{ stat.trend }} from last week
              </div>
            </div>
          </div>

          <!-- ═══ TWO-COLUMN LAYOUT ═══ -->
          <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">

            <!-- Recent Updates (2/3) -->
            <div class="xl:col-span-2 rounded-xl overflow-hidden"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <div class="flex items-center justify-between px-5 py-3.5"
                   :style="{ borderBottom: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                <div class="flex items-center gap-2">
                  <AppIcon name="recent-updates" :size="14" class="text-drydock-secondary" />
                  <h2 class="text-sm font-semibold" :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                    Recent Updates
                  </h2>
                </div>
                <button class="text-[11px] font-medium text-drydock-secondary hover:underline">View all</button>
              </div>

              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead>
                    <tr :style="{ backgroundColor: isDark ? '#0f172a40' : '#f8fafc' }">
                      <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                          :class="isDark ? 'text-slate-500' : 'text-slate-400'">Container</th>
                      <th class="text-center px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                          :class="isDark ? 'text-slate-500' : 'text-slate-400'">Image</th>
                      <th class="text-center px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                          :class="isDark ? 'text-slate-500' : 'text-slate-400'">Version</th>
                      <th class="text-center px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                          :class="isDark ? 'text-slate-500' : 'text-slate-400'">Status</th>
                      <th class="text-right px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                          :class="isDark ? 'text-slate-500' : 'text-slate-400'">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, i) in recentUpdates" :key="i"
                        class="transition-colors"
                        :class="isDark ? 'hover:bg-slate-700/30' : 'hover:bg-slate-50'"
                        :style="{ borderBottom: i < recentUpdates.length - 1 ? (isDark ? '1px solid #334155' : '1px solid #f1f5f9') : 'none' }">
                      <td class="px-5 py-3 font-medium" :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                        <div class="flex items-center gap-2">
                          <div class="w-2 h-2 rounded-full shrink-0"
                               :style="{ backgroundColor: row.running ? '#06D6A0' : '#64748b' }" />
                          {{ row.name }}
                        </div>
                      </td>
                      <td class="px-5 py-3 text-center" :class="isDark ? 'text-slate-400' : 'text-slate-500'">
                        {{ row.image }}
                      </td>
                      <td class="px-5 py-3">
                        <div class="grid items-center gap-1.5" style="grid-template-columns: 1fr auto 1fr;">
                          <span class="px-1.5 py-0.5 rounded text-[10px] font-medium text-right justify-self-end"
                                :class="isDark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-500'">
                            {{ row.oldVer }}
                          </span>
                          <AppIcon name="arrow-right" :size="8" class="justify-self-center"
                             :class="isDark ? 'text-slate-600' : 'text-slate-300'" />
                          <span class="px-1.5 py-0.5 rounded text-[10px] font-medium justify-self-start"
                                style="background: rgba(0,150,199,0.15); color: #0096C7;">
                            {{ row.newVer }}
                          </span>
                        </div>
                      </td>
                      <td class="px-5 py-3 text-center">
                        <span class="badge"
                              :style="{
                                backgroundColor: row.status === 'updated'
                                  ? (isDark ? 'rgba(6,214,160,0.15)' : 'rgba(6,214,160,0.1)')
                                  : row.status === 'pending'
                                    ? (isDark ? 'rgba(255,152,0,0.15)' : 'rgba(255,152,0,0.1)')
                                    : (isDark ? 'rgba(229,57,53,0.15)' : 'rgba(229,57,53,0.1)'),
                                color: row.status === 'updated' ? '#06D6A0' : row.status === 'pending' ? '#FF9800' : '#E53935',
                              }">
                          <AppIcon :name="row.status === 'updated' ? 'check' : row.status === 'pending' ? 'pending' : 'xmark'"
                             :size="8" class="mr-1" />
                          {{ row.status }}
                        </span>
                      </td>
                      <td class="px-5 py-3 text-right" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                        {{ row.time }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Security Overview (1/3) -->
            <div class="rounded-xl overflow-hidden"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <div class="flex items-center justify-between px-5 py-3.5"
                   :style="{ borderBottom: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                <div class="flex items-center gap-2">
                  <AppIcon name="security" :size="14" class="text-drydock-accent" />
                  <h2 class="text-sm font-semibold" :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                    Security Overview
                  </h2>
                </div>
              </div>

              <div class="p-5">
                <!-- Donut chart -->
                <div class="flex items-center justify-center mb-5">
                  <div class="relative" style="width: 140px; height: 140px;">
                    <svg viewBox="0 0 120 120" class="w-full h-full" style="transform: rotate(-90deg);">
                      <circle cx="60" cy="60" r="48" fill="none"
                              :stroke="isDark ? '#334155' : '#e2e8f0'" stroke-width="14" />
                      <circle cx="60" cy="60" r="48" fill="none" stroke="#06D6A0" stroke-width="14"
                              stroke-linecap="round" class="donut-ring"
                              :stroke-dasharray="(44/47 * 301.6) + ' ' + 301.6" />
                      <circle cx="60" cy="60" r="48" fill="none" stroke="#E53935" stroke-width="14"
                              stroke-linecap="round" class="donut-ring"
                              :stroke-dasharray="(3/47 * 301.6) + ' ' + 301.6"
                              :stroke-dashoffset="-(44/47 * 301.6)" />
                    </svg>
                    <div class="absolute inset-0 flex flex-col items-center justify-center">
                      <span class="text-xl font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">47</span>
                      <span class="text-[10px]" :class="isDark ? 'text-slate-500' : 'text-slate-400'">images</span>
                    </div>
                  </div>
                </div>

                <!-- Legend -->
                <div class="flex justify-center gap-5 mb-5">
                  <div class="flex items-center gap-1.5">
                    <div class="w-2.5 h-2.5 rounded-full" style="background:#06D6A0;" />
                    <span class="text-[11px]" :class="isDark ? 'text-slate-400' : 'text-slate-500'">44 Clean</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <div class="w-2.5 h-2.5 rounded-full" style="background:#E53935;" />
                    <span class="text-[11px]" :class="isDark ? 'text-slate-400' : 'text-slate-500'">3 Critical</span>
                  </div>
                </div>

                <div class="mb-4" :style="{ borderTop: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }" />

                <!-- Top vulnerabilities -->
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-3"
                     :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                  Top Vulnerabilities
                </div>
                <div class="space-y-2.5">
                  <div v-for="vuln in vulnerabilities" :key="vuln.id"
                       class="flex items-start gap-3 p-2.5 rounded-lg"
                       :style="{ backgroundColor: isDark ? '#0f172a80' : '#f8fafc' }">
                    <div class="shrink-0 mt-0.5">
                      <span class="badge text-[9px]"
                            :style="{
                              backgroundColor: vuln.severity === 'CRITICAL'
                                ? (isDark ? 'rgba(229,57,53,0.2)' : 'rgba(229,57,53,0.12)')
                                : (isDark ? 'rgba(255,152,0,0.2)' : 'rgba(255,152,0,0.12)'),
                              color: vuln.severity === 'CRITICAL' ? '#E53935' : '#FF9800',
                            }">
                        {{ vuln.severity }}
                      </span>
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="text-[11px] font-semibold truncate"
                           :class="isDark ? 'text-slate-300' : 'text-slate-600'">
                        {{ vuln.id }}
                      </div>
                      <div class="text-[10px] mt-0.5 truncate"
                           :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                        {{ vuln.package }} &middot; {{ vuln.image }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════ -->
        <!-- CONTAINERS PAGE                                -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/containers'" class="flex flex-col" style="height: calc(100vh - 80px);">

          <!-- ═══ CONTENT + DETAIL PANEL FLEX WRAPPER ═══ -->
          <div class="flex gap-4 min-w-0 flex-1 min-h-0 pb-4">

          <!-- Left: filters + cards (scrolls independently) -->
          <div class="flex-1 min-w-0 overflow-y-auto p-0.5 -m-0.5 pr-4 pb-4"
               style="-webkit-mask-image: linear-gradient(to bottom, black calc(100% - 48px), transparent 100%); mask-image: linear-gradient(to bottom, black calc(100% - 48px), transparent 100%)">

          <!-- ═══ FILTER BAR ═══ -->
          <div class="sticky top-0 z-10 mb-5">
            <div class="px-3 py-2 rounded-xl relative z-[1]"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
            <div class="flex flex-wrap items-center gap-2.5">
              <!-- Status filter -->
              <select v-model="filterStatus"
                      class="px-2 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide outline-none cursor-pointer"
                      :class="isDark
                        ? 'bg-slate-800 text-slate-300 border border-slate-700'
                        : 'bg-slate-50 text-slate-600 border border-slate-200'">
                <option value="all">Status</option>
                <option value="running">Running</option>
                <option value="stopped">Stopped</option>
              </select>

              <!-- Bouncer filter -->
              <select v-model="filterBouncer"
                      class="px-2 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide outline-none cursor-pointer"
                      :class="isDark
                        ? 'bg-slate-800 text-slate-300 border border-slate-700'
                        : 'bg-slate-50 text-slate-600 border border-slate-200'">
                <option value="all">🥊 Bouncer</option>
                <option value="safe">Safe</option>
                <option value="unsafe">Unsafe</option>
                <option value="blocked">Blocked</option>
              </select>

              <!-- Registry filter -->
              <select v-model="filterRegistry"
                      class="px-2 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide outline-none cursor-pointer"
                      :class="isDark
                        ? 'bg-slate-800 text-slate-300 border border-slate-700'
                        : 'bg-slate-50 text-slate-600 border border-slate-200'">
                <option value="all">Registry</option>
                <option value="dockerhub">Docker Hub</option>
                <option value="ghcr">GHCR</option>
                <option value="custom">Custom</option>
              </select>

              <!-- Updates checkbox -->
              <label class="flex items-center gap-1.5 cursor-pointer select-none"
                     @click.prevent="filterUpdate = filterUpdate === 'available' ? 'all' : 'available'">
                <div class="w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors"
                     :class="filterUpdate === 'available'
                       ? 'bg-drydock-secondary border-drydock-secondary'
                       : isDark ? 'border-slate-600 bg-slate-800' : 'border-slate-300 bg-slate-50'">
                  <AppIcon v-if="filterUpdate === 'available'" name="check" :size="8" class="text-white" />
                </div>
                <span class="text-[11px] font-semibold uppercase tracking-wide"
                      :class="isDark ? 'text-slate-400' : 'text-slate-500'">Updates</span>
              </label>

              <!-- Result count -->
              <span class="text-[10px] font-semibold tabular-nums shrink-0 px-2 py-1 rounded-lg ml-auto"
                    :class="isDark ? 'text-slate-500 bg-slate-800/50' : 'text-slate-400 bg-slate-100'">
                {{ filteredContainers.length }}/{{ containers.length }}
              </span>
            </div>
            </div>
            <!-- Background shield: solid behind filter bar, fades out below -->
            <div class="absolute -inset-x-4 -top-4 z-0 pointer-events-none"
                 :style="{
                   bottom: '-24px',
                   background: isDark
                     ? 'linear-gradient(to bottom, #151d2e 0%, #151d2e calc(100% - 24px), #151d2e00 100%)'
                     : 'linear-gradient(to bottom, #f1f5f9 0%, #f1f5f9 calc(100% - 24px), #f1f5f900 100%)',
                 }" />
          </div>

          <!-- ═══ CONTAINER CARD GRID ═══ -->
          <div v-if="filteredContainers.length > 0"
               class="grid gap-4"
               style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
            <div v-for="c in filteredContainers" :key="c.name"
                 class="container-card rounded-xl cursor-pointer"
                 :class="[
                   selectedContainer?.name === c.name
                     ? 'ring-2 ring-drydock-secondary ring-offset-0'
                     : '',
                 ]"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: selectedContainer?.name === c.name
                     ? '1.5px solid var(--color-drydock-secondary)'
                     : isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }"
                 @click="selectContainer(c)">

              <!-- Card header -->
              <div class="px-4 pt-4 pb-2 flex items-start justify-between">
                <div class="flex items-center gap-2.5 min-w-0">
                  <div class="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                       :style="{ backgroundColor: c.status === 'running' ? '#06D6A0' : '#E53935' }" />
                  <div class="min-w-0">
                    <div class="text-[15px] font-semibold truncate" :class="isDark ? 'text-slate-100' : 'text-slate-800'">
                      {{ c.name }}
                    </div>
                    <div class="text-[11px] truncate mt-0.5" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                      {{ c.image }}:{{ c.currentTag }}
                    </div>
                  </div>
                </div>
                <span class="badge text-[9px] uppercase tracking-wide font-bold shrink-0 ml-2"
                      :style="{ backgroundColor: registryColorBg(c.registry, isDark), color: registryColorText(c.registry, isDark) }">
                  {{ registryLabel(c.registry) }}
                </span>
              </div>

              <!-- Card body — inline Current / Latest -->
              <div class="px-4 py-3">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[11px]" :class="isDark ? 'text-slate-500' : 'text-slate-400'">Current</span>
                  <span class="text-[12px] font-bold" :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                    {{ c.currentTag }}
                  </span>
                  <template v-if="c.newTag">
                    <span class="text-[11px] ml-1" :class="isDark ? 'text-slate-500' : 'text-slate-400'">Latest</span>
                    <span class="px-1.5 py-0.5 rounded text-[11px] font-bold"
                          :style="{ backgroundColor: isDark ? 'rgba(6,214,160,0.15)' : 'rgba(6,214,160,0.12)', color: '#06D6A0' }">
                      {{ c.newTag }}
                    </span>
                  </template>
                  <template v-else>
                    <span class="flex items-center gap-1.5 text-[11px] font-medium ml-2"
                          :style="{ color: isDark ? '#06D6A080' : '#06D6A0' }">
                      <AppIcon name="up-to-date" :size="10" />
                      Up to date
                    </span>
                  </template>
                </div>
              </div>

              <!-- Card footer -->
              <div class="px-4 py-2.5 flex items-center justify-between"
                   :style="{
                     borderTop: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                     backgroundColor: isDark ? '#111827' : '#f1f5f9',
                     borderRadius: '0 0 12px 12px',
                   }">
                <span class="text-[11px] font-semibold capitalize"
                      :style="{ color: c.status === 'running' ? '#06D6A0' : '#E53935' }">
                  {{ c.status === 'running' ? 'Running' : 'Stopped' }}
                </span>
                <div class="flex items-center gap-1.5">
                  <button v-if="c.status === 'running'"
                          class="w-6 h-6 rounded flex items-center justify-center text-[11px] transition-colors"
                          :class="isDark ? 'text-red-400/70 hover:text-red-400 hover:bg-slate-700' : 'text-red-400 hover:text-red-500 hover:bg-red-50'"
                          title="Stop"
                          @click.stop>
                    <AppIcon name="stop" :size="11" />
                  </button>
                  <button v-else
                          class="w-6 h-6 rounded flex items-center justify-center text-[11px] transition-colors"
                          :class="isDark ? 'text-green-400/70 hover:text-green-400 hover:bg-slate-700' : 'text-green-500 hover:text-green-600 hover:bg-green-50'"
                          title="Start"
                          @click.stop>
                    <AppIcon name="play" :size="11" />
                  </button>
                  <button class="w-6 h-6 rounded flex items-center justify-center text-[11px] transition-colors"
                          :class="isDark ? 'text-slate-500 hover:text-slate-300 hover:bg-slate-700' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'"
                          title="Restart"
                          @click.stop>
                    <AppIcon name="restart" :size="11" />
                  </button>
                  <button v-if="c.newTag"
                          class="w-6 h-6 rounded flex items-center justify-center text-[11px] transition-colors"
                          :class="isDark ? 'text-amber-400 hover:text-amber-300 hover:bg-slate-700' : 'text-amber-500 hover:text-amber-600 hover:bg-amber-50'"
                          title="Update"
                          @click.stop>
                    <AppIcon name="cloud-download" :size="11" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- ═══ EMPTY STATE ═══ -->
          <div v-else
               class="flex flex-col items-center justify-center py-16 rounded-xl"
               :style="{
                 backgroundColor: isDark ? '#1e293b' : '#ffffff',
                 border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
               }">
            <AppIcon name="filter" :size="24" class="mb-3" :class="isDark ? 'text-slate-600' : 'text-slate-300'" />
            <p class="text-sm font-medium mb-1" :class="isDark ? 'text-slate-400' : 'text-slate-500'">
              No containers match your filters
            </p>
            <button class="text-xs font-medium mt-2 px-3 py-1.5 rounded-lg transition-colors"
                    :class="isDark
                      ? 'text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/20'
                      : 'text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/15'"
                    @click="clearFilters">
              Clear all filters
            </button>
          </div>

          </div><!-- end left: filters + cards -->

          <!-- ═══ DETAIL SIDE PANEL (inline) ═══ -->
          <!-- Mobile overlay -->
          <div v-if="detailPanelOpen && isMobile"
               class="fixed inset-0 bg-black/50 z-40"
               @click="closePanel" />

          <!-- Panel -->
          <aside v-if="detailPanelOpen && selectedContainer"
                 class="detail-panel-inline flex flex-col rounded-xl overflow-clip transition-all duration-300 ease-in-out"
                 :class="isMobile ? 'fixed top-0 right-0 h-full z-50' : 'sticky top-0'"
                 :style="{
                   flex: isMobile ? undefined : panelFlex,
                   width: isMobile ? '100%' : undefined,
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                   height: isMobile ? '100vh' : 'calc(100vh - 96px)',
                   minHeight: '480px',
                 }">

              <!-- Panel toolbar: expand/shrink + close -->
              <div class="shrink-0 px-4 py-2.5 flex items-center justify-between"
                   :style="{ borderBottom: isDark ? '1px solid #1e293b' : '1px solid #e2e8f0' }">
                <div v-if="!isMobile" class="flex items-center rounded-lg overflow-hidden"
                     :style="{ border: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                  <button v-for="s in (['lg', 'md', 'sm'] as const)" :key="s"
                          class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors"
                          :class="panelSize === s
                            ? (isDark ? 'bg-slate-700 text-slate-200' : 'bg-slate-200 text-slate-700')
                            : (isDark ? 'text-slate-500 hover:text-slate-300 hover:bg-slate-800' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100')"
                          @click="panelSize = s">
                    {{ s === 'sm' ? 'S' : s === 'md' ? 'M' : 'L' }}
                  </button>
                </div>
                <button class="flex items-center justify-center w-7 h-7 rounded-lg text-xs font-medium transition-colors"
                        :class="isDark
                          ? 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                          : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'"
                        @click="closePanel">
                  <AppIcon name="xmark" :size="14" />
                </button>
              </div>

              <!-- Container name -->
              <div class="shrink-0 px-4 pt-3 pb-2">
                <div class="flex items-center gap-2 min-w-0">
                  <div class="w-2.5 h-2.5 rounded-full shrink-0"
                       :style="{ backgroundColor: selectedContainer.status === 'running' ? '#06D6A0' : '#E53935' }" />
                  <span class="text-sm font-bold truncate" :class="isDark ? 'text-slate-100' : 'text-slate-800'">
                    {{ selectedContainer.name }}
                  </span>
                </div>
              </div>

              <!-- Subtitle + badges -->
              <div class="shrink-0 px-4 pb-3 flex flex-wrap items-center gap-2"
                   :style="{ borderBottom: isDark ? '1px solid #1e293b' : '1px solid #e2e8f0' }">
                <span class="text-[11px] font-mono" :class="isDark ? 'text-slate-400' : 'text-slate-500'">
                  {{ selectedContainer.image }}:{{ selectedContainer.currentTag }}
                </span>
                <span class="badge text-[9px]"
                      :style="{
                        backgroundColor: selectedContainer.status === 'running' ? 'rgba(6,214,160,0.15)' : 'rgba(229,57,53,0.15)',
                        color: selectedContainer.status === 'running' ? '#06D6A0' : '#E53935',
                      }">
                  {{ selectedContainer.status }}
                </span>
                <span v-if="selectedContainer.newTag"
                      class="badge text-[9px]"
                      :style="{ backgroundColor: updateKindColor(selectedContainer.updateKind).bg, color: updateKindColor(selectedContainer.updateKind).text }">
                  {{ selectedContainer.updateKind }} update
                </span>
              </div>

              <!-- Detail tabs -->
              <div class="shrink-0 flex px-4 gap-1"
                   :style="{ borderBottom: isDark ? '1px solid #1e293b' : '1px solid #e2e8f0' }">
                <button v-for="tab in detailTabs" :key="tab.id"
                        class="px-3 py-2.5 text-[11px] font-medium transition-colors relative"
                        :class="activeDetailTab === tab.id
                          ? (isDark ? 'text-drydock-secondary' : 'text-drydock-secondary')
                          : (isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600')"
                        @click="activeDetailTab = tab.id">
                  <AppIcon :name="tab.icon" :size="10" class="mr-1" />
                  {{ tab.label }}
                  <div v-if="activeDetailTab === tab.id"
                       class="absolute bottom-0 left-0 right-0 h-[2px] bg-drydock-secondary rounded-t-full" />
                </button>
              </div>

              <!-- Tab content -->
              <div class="flex-1 overflow-y-auto p-4">

                <!-- Overview tab -->
                <div v-if="activeDetailTab === 'overview'" class="space-y-5">
                  <!-- Ports -->
                  <div v-if="selectedContainer.details.ports.length > 0">
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-2"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                      Ports
                    </div>
                    <div class="space-y-1">
                      <div v-for="port in selectedContainer.details.ports" :key="port"
                           class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-mono"
                           :style="{ backgroundColor: isDark ? '#1e293b' : '#f8fafc' }">
                        <AppIcon name="network" :size="9" :class="isDark ? 'text-slate-600' : 'text-slate-400'" />
                        <span :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ port }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Volumes -->
                  <div v-if="selectedContainer.details.volumes.length > 0">
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-2"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                      Volumes
                    </div>
                    <div class="space-y-1">
                      <div v-for="vol in selectedContainer.details.volumes" :key="vol"
                           class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-mono"
                           :style="{ backgroundColor: isDark ? '#1e293b' : '#f8fafc' }">
                        <AppIcon name="hard-drive" :size="9" :class="isDark ? 'text-slate-600' : 'text-slate-400'" />
                        <span class="truncate" :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ vol }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Environment -->
                  <div v-if="selectedContainer.details.env.length > 0">
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-2"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                      Environment
                    </div>
                    <div class="space-y-1">
                      <div v-for="e in selectedContainer.details.env" :key="e.key"
                           class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-mono"
                           :style="{ backgroundColor: isDark ? '#1e293b' : '#f8fafc' }">
                        <span class="font-semibold shrink-0" :class="isDark ? 'text-drydock-secondary' : 'text-drydock-secondary'">{{ e.key }}</span>
                        <span :class="isDark ? 'text-slate-500' : 'text-slate-400'">=</span>
                        <span class="truncate" :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ e.value }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Labels -->
                  <div v-if="selectedContainer.details.labels.length > 0">
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-2"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                      Labels
                    </div>
                    <div class="flex flex-wrap gap-1.5">
                      <span v-for="label in selectedContainer.details.labels" :key="label"
                            class="badge text-[10px] font-semibold"
                            :style="{
                              backgroundColor: isDark ? 'rgba(148,163,184,0.1)' : 'rgba(100,116,139,0.08)',
                              color: isDark ? '#94a3b8' : '#475569',
                            }">
                        {{ label }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Logs tab -->
                <div v-if="activeDetailTab === 'logs'">
                  <div class="rounded-lg overflow-hidden"
                       :style="{ backgroundColor: isDark ? '#0a0f1a' : '#1e293b' }">
                    <div v-for="(line, i) in mockLogLines" :key="i"
                         class="px-3 py-1 font-mono text-[10px] leading-relaxed flex gap-2"
                         :style="{ borderBottom: i < mockLogLines.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }">
                      <span class="text-slate-600 shrink-0">{{ line.time }}</span>
                      <span class="shrink-0 w-10 text-right font-semibold"
                            :style="{
                              color: line.level === 'error' ? '#E53935'
                                   : line.level === 'warn' ? '#FF9800'
                                   : line.level === 'debug' ? '#64748b'
                                   : '#06D6A0'
                            }">
                        {{ line.level }}
                      </span>
                      <span class="text-slate-300">{{ line.msg }}</span>
                    </div>
                  </div>
                </div>

                <!-- Security tab -->
                <div v-if="activeDetailTab === 'security'"
                     class="flex flex-col items-center justify-center py-10">
                  <AppIcon name="security" :size="24" class="mb-3" :class="isDark ? 'text-slate-600' : 'text-slate-300'" />
                  <p class="text-xs font-medium" :class="isDark ? 'text-slate-400' : 'text-slate-500'">
                    No vulnerabilities detected
                  </p>
                  <p class="text-[10px] mt-1" :class="isDark ? 'text-slate-600' : 'text-slate-400'">
                    Last scanned 2 hours ago
                  </p>
                </div>

                <!-- Triggers tab -->
                <div v-if="activeDetailTab === 'triggers'" class="space-y-2">
                  <div v-for="trigger in mockTriggers" :key="trigger.name"
                       class="flex items-center justify-between p-3 rounded-lg"
                       :style="{ backgroundColor: isDark ? '#1e293b' : '#f8fafc' }">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <AppIcon :name="trigger.type === 'webhook' ? 'globe' : trigger.type === 'notification' ? 'notifications' : 'security'"
                               :size="11" class="shrink-0" :class="isDark ? 'text-slate-500' : 'text-slate-400'" />
                      <div class="min-w-0">
                        <div class="text-[11px] font-medium truncate"
                             :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                          {{ trigger.name }}
                        </div>
                        <div class="text-[10px] capitalize" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                          {{ trigger.type }}
                        </div>
                      </div>
                    </div>
                    <div class="w-8 h-4 rounded-full relative cursor-pointer shrink-0 transition-colors"
                         :style="{ backgroundColor: trigger.active ? '#06D6A0' : (isDark ? '#334155' : '#cbd5e1') }">
                      <div class="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform"
                           :style="{ left: trigger.active ? '17px' : '2px' }" />
                    </div>
                  </div>
                </div>

              </div>
          </aside>

          </div><!-- end content + detail panel flex wrapper -->
        </div>

        <!-- ═══════════════════════════════════════════════ -->
        <!-- SETTINGS PAGE (Server)                         -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/server'" class="max-w-4xl">
          <!-- Tabs -->
          <div class="flex gap-1 mb-6"
               :style="{ borderBottom: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
            <button v-for="tab in settingsTabs" :key="tab.id"
                    class="px-4 py-2.5 text-[12px] font-semibold transition-colors relative"
                    :class="activeSettingsTab === tab.id
                      ? 'text-drydock-secondary'
                      : (isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600')"
                    @click="activeSettingsTab = tab.id">
              <AppIcon :name="tab.icon" :size="12" class="mr-1.5" />
              {{ tab.label }}
              <div v-if="activeSettingsTab === tab.id"
                   class="absolute bottom-0 left-0 right-0 h-[2px] bg-drydock-secondary rounded-t-full" />
            </button>
          </div>

          <!-- ═══ GENERAL TAB ═══ -->
          <div v-if="activeSettingsTab === 'general'" class="space-y-6">
            <div class="rounded-xl overflow-hidden"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <div class="px-5 py-3.5 flex items-center gap-2"
                   :style="{ borderBottom: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                <AppIcon name="settings" :size="14" class="text-drydock-secondary" />
                <h2 class="text-sm font-semibold" :class="isDark ? 'text-slate-200' : 'text-slate-700'">Server Info</h2>
              </div>
              <div class="p-5 space-y-4">
                <div v-for="field in serverFields" :key="field.label"
                     class="flex items-center justify-between py-2"
                     :style="{ borderBottom: isDark ? '1px solid #1e293b' : '1px solid #f1f5f9' }">
                  <span class="text-[11px] font-semibold uppercase tracking-wider"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">{{ field.label }}</span>
                  <span class="text-[12px] font-medium font-mono"
                        :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ field.value }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ═══ APPEARANCE TAB ═══ -->
          <div v-if="activeSettingsTab === 'appearance'" class="space-y-6">

            <!-- Theme -->
            <div class="rounded-xl overflow-hidden"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <div class="px-5 py-3.5 flex items-center gap-2"
                   :style="{ borderBottom: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                <AppIcon :name="isDark ? 'moon' : 'sun'" :size="14" class="text-drydock-secondary" />
                <h2 class="text-sm font-semibold" :class="isDark ? 'text-slate-200' : 'text-slate-700'">Theme</h2>
              </div>
              <div class="p-5">
                <div class="flex gap-2">
                  <button v-for="opt in themeOptions" :key="opt.id"
                          class="flex items-center gap-2.5 px-4 py-3 rounded-lg transition-colors"
                          :class="(opt.id === 'dark') === isDark ? 'ring-2 ring-drydock-secondary' : ''"
                          :style="{
                            backgroundColor: (opt.id === 'dark') === isDark
                              ? (isDark ? 'rgba(0,150,199,0.12)' : 'rgba(0,150,199,0.08)')
                              : (isDark ? '#0f172a80' : '#f8fafc'),
                            border: (opt.id === 'dark') === isDark
                              ? '1.5px solid #0096C7'
                              : isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                          }"
                          @click="opt.id === 'dark' ? (isDark || toggleTheme()) : (isDark && toggleTheme())">
                    <AppIcon :name="opt.icon" :size="16"
                             :class="(opt.id === 'dark') === isDark ? 'text-drydock-secondary' : (isDark ? 'text-slate-500' : 'text-slate-400')" />
                    <span class="text-[12px] font-semibold"
                          :class="(opt.id === 'dark') === isDark ? 'text-drydock-secondary' : (isDark ? 'text-slate-400' : 'text-slate-500')">
                      {{ opt.label }}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Font Family -->
            <div class="rounded-xl overflow-hidden"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <div class="px-5 py-3.5 flex items-center gap-2"
                   :style="{ borderBottom: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                <AppIcon name="terminal" :size="14" class="text-drydock-secondary" />
                <h2 class="text-sm font-semibold" :class="isDark ? 'text-slate-200' : 'text-slate-700'">Font Family</h2>
              </div>
              <div class="p-5">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button v-for="f in fontOptions" :key="f.id"
                          class="flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors"
                          :class="activeFont === f.id ? 'ring-2 ring-drydock-secondary' : ''"
                          :style="{
                            backgroundColor: activeFont === f.id
                              ? (isDark ? 'rgba(0,150,199,0.12)' : 'rgba(0,150,199,0.08)')
                              : (isDark ? '#0f172a80' : '#f8fafc'),
                            border: activeFont === f.id
                              ? '1.5px solid #0096C7'
                              : isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                          }"
                          @click="setFont(f.id)">
                    <div class="flex-1 min-w-0">
                      <div class="text-[13px] font-semibold truncate"
                           :style="{ fontFamily: f.family }"
                           :class="activeFont === f.id ? 'text-drydock-secondary' : (isDark ? 'text-slate-200' : 'text-slate-700')">
                        {{ f.label }}
                      </div>
                      <div class="text-[10px] mt-0.5 truncate" :style="{ fontFamily: f.family }"
                           :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                        The quick brown fox jumps over the lazy dog
                      </div>
                    </div>
                    <AppIcon v-if="activeFont === f.id" name="check" :size="14" class="text-drydock-secondary shrink-0" />
                  </button>
                </div>
              </div>
            </div>

            <!-- Icon Library -->
            <div class="rounded-xl overflow-hidden"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <div class="px-5 py-3.5 flex items-center gap-2"
                   :style="{ borderBottom: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                <AppIcon name="dashboard" :size="14" class="text-drydock-secondary" />
                <h2 class="text-sm font-semibold" :class="isDark ? 'text-slate-200' : 'text-slate-700'">Icon Library</h2>
              </div>
              <div class="p-5">
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  <button v-for="(label, lib) in libraryLabels" :key="lib"
                          class="flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors"
                          :class="iconLibrary === lib ? 'ring-2 ring-drydock-secondary' : ''"
                          :style="{
                            backgroundColor: iconLibrary === lib
                              ? (isDark ? 'rgba(0,150,199,0.12)' : 'rgba(0,150,199,0.08)')
                              : (isDark ? '#0f172a80' : '#f8fafc'),
                            border: iconLibrary === lib
                              ? '1.5px solid #0096C7'
                              : isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                          }"
                          @click="setIconLibrary(lib as IconLibrary)">
                    <div class="w-8 h-8 rounded-lg flex items-center justify-center"
                         :style="{
                           backgroundColor: iconLibrary === lib ? 'rgba(0,150,199,0.2)' : (isDark ? '#1e293b' : '#f1f5f9'),
                         }">
                      <iconify-icon :icon="iconMap['dashboard']?.[lib as IconLibrary]" width="18" height="18"
                                    :class="iconLibrary === lib ? 'text-drydock-secondary' : (isDark ? 'text-slate-400' : 'text-slate-500')" />
                    </div>
                    <div class="min-w-0">
                      <div class="text-[12px] font-semibold" :class="iconLibrary === lib ? 'text-drydock-secondary' : (isDark ? 'text-slate-200' : 'text-slate-700')">
                        {{ label }}
                      </div>
                      <div class="text-[10px]" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
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
            <div class="rounded-xl overflow-hidden"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <div class="px-5 py-3.5 flex items-center gap-2"
                   :style="{ borderBottom: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                <AppIcon name="containers" :size="14" class="text-drydock-secondary" />
                <h2 class="text-sm font-semibold" :class="isDark ? 'text-slate-200' : 'text-slate-700'">Icon Size</h2>
              </div>
              <div class="p-5">
                <div class="flex items-center gap-4">
                  <AppIcon name="dashboard" :size="10" :class="isDark ? 'text-slate-500' : 'text-slate-400'" />
                  <input type="range" min="0.8" max="1.5" step="0.05"
                         :value="iconScale"
                         @input="setIconScale(parseFloat(($event.target as HTMLInputElement).value))"
                         class="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                         :style="{ background: isDark ? '#334155' : '#e2e8f0', accentColor: '#0096C7' }" />
                  <AppIcon name="dashboard" :size="20" :class="isDark ? 'text-slate-500' : 'text-slate-400'" />
                </div>
                <div class="text-center mt-2 text-[11px]" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                  {{ Math.round(iconScale * 100) }}%
                </div>
              </div>
            </div>

          </div><!-- end appearance tab -->
        </div>

      </main>
    </div>

    <!-- ═══ SEARCH MODAL (PrimeVue Dialog) ═══ -->
    <Dialog v-model:visible="showSearch"
            modal
            :closable="false"
            :showHeader="false"
            :style="{ width: '32rem' }"
            position="top"
            :pt="{ root: { style: 'margin-top: 15vh; border: none; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);' }, mask: { style: 'background: rgba(0,0,0,0.5)' }, content: { style: 'padding: 0; border-radius: 12px; overflow: hidden; background: ' + (isDark ? '#1e293b' : '#ffffff') + '; border: 1px solid ' + (isDark ? '#334155' : '#e2e8f0') } }">
      <div class="flex items-center gap-3 px-4 py-3"
           :style="{ borderBottom: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
        <i class="pi pi-search text-sm" :class="isDark ? 'text-slate-500' : 'text-slate-400'" />
        <InputText ref="searchInput"
                   v-model="searchQuery"
                   placeholder="Search containers, images, settings..."
                   :unstyled="true"
                   class="flex-1 bg-transparent outline-none text-sm font-mono"
                   :class="isDark ? 'text-slate-200 placeholder-slate-600' : 'text-slate-700 placeholder-slate-400'" />
        <kbd class="px-1.5 py-0.5 rounded text-[10px] font-medium"
             :class="isDark ? 'bg-slate-700 text-slate-500' : 'bg-slate-200 text-slate-400'">ESC</kbd>
      </div>
      <div class="px-4 py-6 text-center text-xs" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
        <AppIcon name="terminal" :size="12" class="mr-1" />
        Start typing to search across your infrastructure...
      </div>
    </Dialog>
  </div>
</template>
