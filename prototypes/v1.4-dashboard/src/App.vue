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
      { label: 'Servers', icon: 'servers', route: '/servers' },
      { label: 'Registries', icon: 'registries', route: '/registries' },
      { label: 'Agents', icon: 'agents', route: '/agents' },
      { label: 'Triggers', icon: 'triggers', route: '/triggers' },
      { label: 'Watchers', icon: 'watchers', route: '/watchers' },
      { label: 'Auth', icon: 'auth', route: '/auth' },
      { label: 'Notifications', icon: 'notifications', route: '/notifications' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'Config', icon: 'config', route: '/config' },
      { label: 'Profile', icon: 'user', route: '/profile' },
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

// ── Updates Page ──────────────────────────────────────
const updatesFilterSearch = ref('');
const updatesFilterKind = ref('all');
const updatesFilterBouncer = ref('all');
const updatesFilterRegistry = ref('all');

const updatesData = computed(() =>
  containers.value.filter((c) => c.newTag !== null)
);

const filteredUpdates = computed(() => {
  return updatesData.value.filter((c) => {
    if (updatesFilterSearch.value) {
      const q = updatesFilterSearch.value.toLowerCase();
      if (!c.name.toLowerCase().includes(q) && !c.image.toLowerCase().includes(q)) return false;
    }
    if (updatesFilterKind.value !== 'all' && c.updateKind !== updatesFilterKind.value) return false;
    if (updatesFilterBouncer.value !== 'all' && c.bouncer !== updatesFilterBouncer.value) return false;
    if (updatesFilterRegistry.value !== 'all' && c.registry !== updatesFilterRegistry.value) return false;
    return true;
  });
});

const updatesStats = computed(() => {
  const data = updatesData.value;
  return {
    total: data.length,
    major: data.filter((c) => c.updateKind === 'major').length,
    minor: data.filter((c) => c.updateKind === 'minor').length,
    patch: data.filter((c) => c.updateKind === 'patch').length,
    digest: data.filter((c) => c.updateKind === 'digest').length,
  };
});

const updatesFiltersActive = computed(() =>
  updatesFilterSearch.value !== '' ||
  updatesFilterKind.value !== 'all' ||
  updatesFilterBouncer.value !== 'all' ||
  updatesFilterRegistry.value !== 'all'
);

function clearUpdatesFilters() {
  updatesFilterSearch.value = '';
  updatesFilterKind.value = 'all';
  updatesFilterBouncer.value = 'all';
  updatesFilterRegistry.value = 'all';
}

function bouncerColor(status: string) {
  if (status === 'safe') return { bg: 'rgba(6,214,160,0.15)', text: '#06D6A0' };
  if (status === 'unsafe') return { bg: 'rgba(255,152,0,0.15)', text: '#FF9800' };
  return { bg: 'rgba(229,57,53,0.15)', text: '#E53935' };
}

// Stub actions (no-op for prototype)
function updateContainer(_name: string) { /* no-op */ }
function skipUpdate(_name: string) { /* no-op */ }
function forceUpdate(_name: string) { /* no-op */ }
function updateAll() { /* no-op */ }

// ── Security Page ────────────────────────────────────
const securityStats = {
  scannedImages: 47,
  clean: 41,
  critical: 2,
  high: 3,
  medium: 8,
  low: 12,
};

const securityVulnerabilities = [
  { id: 'CVE-2024-21626', severity: 'CRITICAL', package: 'runc', version: '1.1.11', fixedIn: '1.1.12', image: 'nginx-proxy', publishedDate: '2024-01-31' },
  { id: 'CVE-2024-0727', severity: 'CRITICAL', package: 'openssl', version: '3.1.4', fixedIn: '3.1.5', image: 'traefik', publishedDate: '2024-01-26' },
  { id: 'CVE-2023-50164', severity: 'HIGH', package: 'curl', version: '8.4.0', fixedIn: '8.4.1', image: 'postgres-db', publishedDate: '2023-12-07' },
  { id: 'CVE-2024-1086', severity: 'HIGH', package: 'linux-kernel', version: '6.6.8', fixedIn: '6.6.15', image: 'grafana', publishedDate: '2024-01-31' },
  { id: 'CVE-2023-46218', severity: 'HIGH', package: 'curl', version: '8.4.0', fixedIn: '8.5.0', image: 'redis-cache', publishedDate: '2023-12-06' },
  { id: 'CVE-2024-0553', severity: 'MEDIUM', package: 'gnutls', version: '3.8.2', fixedIn: '3.8.3', image: 'traefik', publishedDate: '2024-01-16' },
  { id: 'CVE-2023-6129', severity: 'MEDIUM', package: 'openssl', version: '3.1.4', fixedIn: '3.1.5', image: 'drydock-api', publishedDate: '2024-01-09' },
  { id: 'CVE-2023-5678', severity: 'MEDIUM', package: 'openssl', version: '3.0.12', fixedIn: '3.0.13', image: 'registry-mirror', publishedDate: '2023-11-06' },
  { id: 'CVE-2024-0567', severity: 'MEDIUM', package: 'gnutls', version: '3.8.2', fixedIn: '3.8.3', image: 'prometheus', publishedDate: '2024-01-16' },
  { id: 'CVE-2023-44487', severity: 'MEDIUM', package: 'nghttp2', version: '1.57.0', fixedIn: null, image: 'nginx-proxy', publishedDate: '2023-10-10' },
  { id: 'CVE-2023-50495', severity: 'MEDIUM', package: 'ncurses', version: '6.4', fixedIn: '6.4-20231217', image: 'postgres-db', publishedDate: '2023-12-12' },
  { id: 'CVE-2023-52425', severity: 'MEDIUM', package: 'expat', version: '2.5.0', fixedIn: '2.6.0', image: 'grafana', publishedDate: '2024-02-04' },
  { id: 'CVE-2023-45853', severity: 'LOW', package: 'zlib', version: '1.3', fixedIn: '1.3.1', image: 'redis-cache', publishedDate: '2023-10-14' },
  { id: 'CVE-2023-39615', severity: 'LOW', package: 'libxml2', version: '2.11.5', fixedIn: null, image: 'traefik', publishedDate: '2023-08-29' },
  { id: 'CVE-2023-31484', severity: 'LOW', package: 'perl', version: '5.36.0', fixedIn: '5.38.0', image: 'prometheus', publishedDate: '2023-04-29' },
];

const securityScanHistory = [
  { container: 'traefik', image: 'traefik:2.10.7', scannedAt: '14 min ago', vulnCount: 3, status: 'issues' as const },
  { container: 'postgres-db', image: 'postgres:15.4', scannedAt: '22 min ago', vulnCount: 2, status: 'issues' as const },
  { container: 'redis-cache', image: 'redis:7.0.12', scannedAt: '35 min ago', vulnCount: 2, status: 'issues' as const },
  { container: 'drydock-api', image: 'ghcr.io/drydock/api:1.3.1', scannedAt: '1h ago', vulnCount: 0, status: 'clean' as const },
  { container: 'watchtower', image: 'containrrr/watchtower:1.7.1', scannedAt: '2h ago', vulnCount: 0, status: 'clean' as const },
];

// Security page filters
const securityFilterSeverity = ref('all');
const securitySortField = ref<'severity' | 'published'>('severity');
const securitySortAsc = ref(false);

const severityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function severityColor(sev: string) {
  if (sev === 'CRITICAL') return { bg: 'rgba(229,57,53,0.15)', text: '#E53935' };
  if (sev === 'HIGH') return { bg: 'rgba(255,152,0,0.15)', text: '#FF9800' };
  if (sev === 'MEDIUM') return { bg: 'rgba(234,179,8,0.15)', text: '#EAB308' };
  return { bg: 'rgba(59,130,246,0.15)', text: '#3B82F6' };
}

function scanStatusColor(status: string) {
  if (status === 'clean') return { bg: 'rgba(6,214,160,0.15)', text: '#06D6A0' };
  if (status === 'issues') return { bg: 'rgba(255,152,0,0.15)', text: '#FF9800' };
  return { bg: 'rgba(229,57,53,0.15)', text: '#E53935' };
}

const filteredSecurityVulns = computed(() => {
  let items = [...securityVulnerabilities];
  if (securityFilterSeverity.value !== 'all') {
    items = items.filter((v) => v.severity === securityFilterSeverity.value);
  }
  items.sort((a, b) => {
    if (securitySortField.value === 'severity') {
      const diff = severityOrder[a.severity] - severityOrder[b.severity];
      return securitySortAsc.value ? diff : -diff;
    }
    const diff = new Date(a.publishedDate).getTime() - new Date(b.publishedDate).getTime();
    return securitySortAsc.value ? diff : -diff;
  });
  return items;
});

function toggleSecuritySort(field: 'severity' | 'published') {
  if (securitySortField.value === field) {
    securitySortAsc.value = !securitySortAsc.value;
  } else {
    securitySortField.value = field;
    securitySortAsc.value = false;
  }
}

// ── Servers Page ──────────────────────────────────────
interface Server {
  name: string;
  host: string;
  status: 'connected' | 'disconnected';
  dockerVersion: string;
  os: string;
  arch: string;
  cpus: number;
  memoryGb: number;
  containers: { total: number; running: number; stopped: number };
  images: number;
  lastSeen: string;
}

const servers = ref<Server[]>([
  { name: 'Local', host: 'unix:///var/run/docker.sock', status: 'connected', dockerVersion: '27.5.1', os: 'Ubuntu 24.04', arch: 'amd64', cpus: 8, memoryGb: 32, containers: { total: 31, running: 28, stopped: 3 }, images: 45, lastSeen: 'Just now' },
  { name: 'Agent-01 (prod-east)', host: 'https://10.0.1.50:3001', status: 'connected', dockerVersion: '27.5.1', os: 'Debian 12', arch: 'amd64', cpus: 16, memoryGb: 64, containers: { total: 12, running: 12, stopped: 0 }, images: 23, lastSeen: '2s ago' },
  { name: 'Agent-02 (staging)', host: 'https://10.0.2.10:3001', status: 'disconnected', dockerVersion: '26.1.4', os: 'Alpine 3.20', arch: 'arm64', cpus: 4, memoryGb: 8, containers: { total: 4, running: 0, stopped: 4 }, images: 12, lastSeen: '14m ago' },
]);

const serversStats = computed(() => {
  const all = servers.value;
  return {
    total: all.length,
    totalContainers: all.reduce((sum, s) => sum + s.containers.total, 0),
    connected: all.filter((s) => s.status === 'connected').length,
    disconnected: all.filter((s) => s.status === 'disconnected').length,
  };
});

// Stub server actions (no-op for prototype)
function refreshServer(_name: string) { /* no-op */ }
function viewServerContainers(_name: string) { /* no-op */ }

// ── Logs Page ─────────────────────────────────────────
const logSourceFilter = ref('all');
const logLevelFilter = ref('all');
const logLinesLimit = ref('50');
const logAutoScroll = ref(true);
const logPaused = ref(false);

const logLines = ref([
  { timestamp: '2025-02-17T14:23:01.482Z', level: 'info', component: 'api', message: 'Server started on 0.0.0.0:3001' },
  { timestamp: '2025-02-17T14:23:01.519Z', level: 'info', component: 'docker', message: 'Connected to Docker engine v24.0.7 via /var/run/docker.sock' },
  { timestamp: '2025-02-17T14:23:02.104Z', level: 'info', component: 'watcher:hub', message: 'Polling 47 containers across 3 registries' },
  { timestamp: '2025-02-17T14:23:02.881Z', level: 'debug', component: 'registry:ghcr', message: 'Authenticated with ghcr.io using token (expires 2025-02-18T14:00:00Z)' },
  { timestamp: '2025-02-17T14:23:03.217Z', level: 'info', component: 'watcher:hub', message: 'Checking traefik:2.10.7 for updates on dockerhub' },
  { timestamp: '2025-02-17T14:23:04.550Z', level: 'warn', component: 'watcher:hub', message: 'Rate limit approaching for dockerhub (87/100 requests used)' },
  { timestamp: '2025-02-17T14:23:05.012Z', level: 'info', component: 'watcher:hub', message: 'Update available: traefik 2.10.7 -> 3.0.1 (major)' },
  { timestamp: '2025-02-17T14:23:05.884Z', level: 'info', component: 'docker', message: 'Container postgres-db health check passed (latency: 4ms)' },
  { timestamp: '2025-02-17T14:23:06.192Z', level: 'info', component: 'watcher:hub', message: 'Update available: postgres 15.4 -> 16.1 (major)' },
  { timestamp: '2025-02-17T14:23:06.741Z', level: 'error', component: 'registry:ghcr', message: 'Failed to fetch manifest for ghcr.io/drydock/api:latest (HTTP 429 Too Many Requests)' },
  { timestamp: '2025-02-17T14:23:07.103Z', level: 'info', component: 'watcher:hub', message: 'Retrying ghcr.io/drydock/api manifest fetch in 30s (attempt 1/3)' },
  { timestamp: '2025-02-17T14:23:08.290Z', level: 'info', component: 'watcher:hub', message: 'Update available: redis 7.0.12 -> 7.2.4 (minor)' },
  { timestamp: '2025-02-17T14:23:09.441Z', level: 'debug', component: 'docker', message: 'Inspecting container nginx-proxy: status=exited, exitCode=137' },
  { timestamp: '2025-02-17T14:23:10.115Z', level: 'warn', component: 'docker', message: 'Container nginx-proxy is stopped (exit code 137 - OOM killed)' },
  { timestamp: '2025-02-17T14:23:11.320Z', level: 'info', component: 'trigger:slack', message: 'Webhook delivered to #infrastructure (update summary: 6 containers)' },
  { timestamp: '2025-02-17T14:23:12.087Z', level: 'debug', component: 'auth', message: 'Session refreshed for user admin (token valid until 2025-02-17T15:23:12Z)' },
  { timestamp: '2025-02-17T14:23:13.550Z', level: 'info', component: 'watcher:hub', message: 'Update available: grafana/grafana 10.1.5 -> 10.2.3 (minor)' },
  { timestamp: '2025-02-17T14:23:14.920Z', level: 'info', component: 'watcher:hub', message: 'Scan complete: 6 updates found across 47 containers' },
  { timestamp: '2025-02-17T14:23:15.445Z', level: 'info', component: 'api', message: 'GET /api/v1/containers 200 (23ms) - 47 results' },
  { timestamp: '2025-02-17T14:23:16.880Z', level: 'error', component: 'trigger:slack', message: 'Webhook delivery failed to #security-alerts (timeout after 10s)' },
  { timestamp: '2025-02-17T14:23:17.201Z', level: 'info', component: 'trigger:slack', message: 'Retrying webhook to #security-alerts in 5s (attempt 1/3)' },
  { timestamp: '2025-02-17T14:23:18.620Z', level: 'debug', component: 'registry:ghcr', message: 'Pulling manifest list for ghcr.io/drydock/ui:1.3.1 (sha256:a1b2c3...)' },
  { timestamp: '2025-02-17T14:23:19.330Z', level: 'info', component: 'docker', message: 'Container drydock-api health check passed (latency: 8ms)' },
  { timestamp: '2025-02-17T14:23:20.880Z', level: 'warn', component: 'auth', message: 'Failed login attempt for user "guest" from 192.168.1.105 (invalid credentials)' },
  { timestamp: '2025-02-17T14:23:22.015Z', level: 'info', component: 'api', message: 'GET /api/v1/updates 200 (45ms) - 6 results' },
  { timestamp: '2025-02-17T14:23:23.440Z', level: 'info', component: 'trigger:slack', message: 'Webhook retry successful to #security-alerts (attempt 2/3)' },
  { timestamp: '2025-02-17T14:23:25.710Z', level: 'debug', component: 'docker', message: 'Image layer cache hit for grafana/grafana:10.1.5 (4/4 layers cached)' },
  { timestamp: '2025-02-17T14:23:27.050Z', level: 'error', component: 'watcher:hub', message: 'Registry registry.internal/mirror unreachable (ECONNREFUSED 10.0.0.50:5000)' },
  { timestamp: '2025-02-17T14:23:28.330Z', level: 'info', component: 'api', message: 'POST /api/v1/containers/traefik/update 202 (12ms) - update queued' },
  { timestamp: '2025-02-17T14:23:30.100Z', level: 'info', component: 'docker', message: 'All container health checks passed (8/8 running, 2 stopped)' },
]);

function clearLogLines() {
  logLines.value = [];
}

function formatLogTimestamp(iso: string) {
  const d = new Date(iso);
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

// ── Config Pages (shared expandable state) ──────────────
const expandedConfigItems = ref(new Set<string>());

function toggleConfigItem(id: string) {
  const s = expandedConfigItems.value;
  if (s.has(id)) s.delete(id); else s.add(id);
  expandedConfigItems.value = new Set(s);
}

// ── Registries Page ─────────────────────────────────────
const registriesData = [
  { id: 'hub', name: 'Docker Hub', type: 'hub', status: 'connected', config: { login: 'drydock-bot', url: 'https://registry-1.docker.io' } },
  { id: 'ghcr', name: 'GitHub Packages', type: 'ghcr', status: 'connected', config: { login: 'CodesWhat', url: 'https://ghcr.io' } },
  { id: 'quay', name: 'Quay.io', type: 'quay', status: 'connected', config: { namespace: 'drydock', url: 'https://quay.io' } },
  { id: 'ecr', name: 'AWS ECR (prod)', type: 'ecr', status: 'error', config: { region: 'us-east-1', accountId: '123456789012', accessKeyId: 'AKIA***' } },
  { id: 'gitlab', name: 'GitLab Registry', type: 'gitlab', status: 'connected', config: { url: 'https://registry.gitlab.com', token: '***' } },
];

function registryTypeBadge(type: string) {
  if (type === 'hub') return { bg: 'rgba(59,130,246,0.15)', text: '#3B82F6', label: 'Hub' };
  if (type === 'ghcr') return { bg: 'rgba(168,85,247,0.15)', text: '#A855F7', label: 'GHCR' };
  if (type === 'quay') return { bg: 'rgba(229,57,53,0.15)', text: '#E53935', label: 'Quay' };
  if (type === 'ecr') return { bg: 'rgba(255,152,0,0.15)', text: '#FF9800', label: 'ECR' };
  if (type === 'gitlab') return { bg: 'rgba(255,152,0,0.15)', text: '#FF9800', label: 'GitLab' };
  return { bg: 'rgba(100,116,139,0.15)', text: '#64748b', label: type };
}

// ── Agents Page ─────────────────────────────────────────
const agentsData = [
  { id: 'agent-01', name: 'prod-east', host: 'https://10.0.1.50:3001', status: 'connected', lastSeen: '2s ago', containers: 12, version: '1.3.2' },
  { id: 'agent-02', name: 'staging', host: 'https://10.0.2.10:3001', status: 'disconnected', lastSeen: '14m ago', containers: 4, version: '1.3.1' },
  { id: 'agent-03', name: 'dev-local', host: 'https://192.168.1.100:3001', status: 'connected', lastSeen: '1s ago', containers: 8, version: '1.3.2' },
];

// ── Triggers Page ───────────────────────────────────────
const triggersData = [
  { id: 'slack-ops', name: 'Slack #ops-updates', type: 'slack', status: 'active', config: { channel: '#ops-updates', webhook: 'https://hooks.slack.com/***' } },
  { id: 'discord-dev', name: 'Discord Dev', type: 'discord', status: 'active', config: { webhook: 'https://discord.com/api/webhooks/***' } },
  { id: 'email-admin', name: 'Admin Email', type: 'smtp', status: 'active', config: { to: 'admin@example.com', from: 'drydock@example.com', host: 'smtp.sendgrid.net' } },
  { id: 'http-ci', name: 'CI Pipeline Webhook', type: 'http', status: 'error', config: { url: 'https://ci.example.com/api/trigger', method: 'POST' } },
  { id: 'telegram-alerts', name: 'Telegram Alerts', type: 'telegram', status: 'active', config: { botToken: '***', chatId: '-1001234567890' } },
  { id: 'mqtt-home', name: 'MQTT Home Automation', type: 'mqtt', status: 'active', config: { broker: 'mqtt://192.168.1.5:1883', topic: 'drydock/updates' } },
];

function triggerTypeBadge(type: string) {
  if (type === 'slack') return { bg: 'rgba(59,130,246,0.15)', text: '#3B82F6', label: 'Slack' };
  if (type === 'discord') return { bg: 'rgba(168,85,247,0.15)', text: '#A855F7', label: 'Discord' };
  if (type === 'smtp') return { bg: 'rgba(6,214,160,0.15)', text: '#06D6A0', label: 'SMTP' };
  if (type === 'http') return { bg: 'rgba(255,152,0,0.15)', text: '#FF9800', label: 'HTTP' };
  if (type === 'telegram') return { bg: 'rgba(0,150,199,0.15)', text: '#0096C7', label: 'Telegram' };
  if (type === 'mqtt') return { bg: 'rgba(234,179,8,0.15)', text: '#EAB308', label: 'MQTT' };
  return { bg: 'rgba(100,116,139,0.15)', text: '#64748b', label: type };
}

// ── Watchers Page ───────────────────────────────────────
const watchersData = [
  { id: 'local', name: 'Local Docker', type: 'docker', status: 'watching', containers: 31, cron: '0 */6 * * *', lastRun: '2h ago', config: { socket: '/var/run/docker.sock', watchByDefault: 'true' } },
  { id: 'agent-01-watcher', name: 'prod-east', type: 'docker', status: 'watching', containers: 12, cron: '0 */4 * * *', lastRun: '45m ago', config: { agent: 'agent-01', watchByDefault: 'true' } },
  { id: 'agent-02-watcher', name: 'staging', type: 'docker', status: 'paused', containers: 4, cron: '0 8 * * 1', lastRun: '6d ago', config: { agent: 'agent-02', maintenanceWindow: 'true', maintenanceOpen: 'false', nextWindow: '2026-02-17T08:00:00Z' } },
];

function watcherStatusColor(status: string) {
  if (status === 'watching') return '#06D6A0';
  if (status === 'paused') return '#FF9800';
  return '#64748b';
}

// ── Auth Page ───────────────────────────────────────────
const authData = [
  { id: 'basic', name: 'Basic Auth', type: 'basic', status: 'active', config: { username: 'admin', hash: 'argon2id:***' } },
  { id: 'oidc', name: 'Google OIDC', type: 'oidc', status: 'active', config: { issuer: 'https://accounts.google.com', clientId: '***', redirectUri: 'https://drydock.example.com/auth/callback' } },
];

function authTypeBadge(type: string) {
  if (type === 'basic') return { bg: 'rgba(100,116,139,0.15)', text: '#64748b', label: 'Basic' };
  if (type === 'oidc') return { bg: 'rgba(0,150,199,0.15)', text: '#0096C7', label: 'OIDC' };
  return { bg: 'rgba(100,116,139,0.15)', text: '#64748b', label: type };
}

// ── Notifications Page ──────────────────────────────────
const notificationsData = ref([
  { id: 'update-available', name: 'Update Available', enabled: true, triggers: ['slack-ops', 'discord-dev', 'email-admin'], description: 'When a container has a new version' },
  { id: 'update-applied', name: 'Update Applied', enabled: true, triggers: ['slack-ops'], description: 'After a container is successfully updated' },
  { id: 'update-failed', name: 'Update Failed', enabled: true, triggers: ['slack-ops', 'email-admin', 'telegram-alerts'], description: 'When an update fails or is rolled back' },
  { id: 'security-alert', name: 'Security Alert', enabled: true, triggers: ['email-admin', 'telegram-alerts'], description: 'Critical/High vulnerability detected' },
  { id: 'agent-disconnect', name: 'Agent Disconnected', enabled: false, triggers: [] as string[], description: 'When a remote agent loses connection' },
]);

function toggleNotification(id: string) {
  const item = notificationsData.value.find(n => n.id === id);
  if (item) item.enabled = !item.enabled;
}

function triggerNameById(id: string) {
  const t = triggersData.find(tr => tr.id === id);
  return t ? t.name : id;
}

// ── Profile Page ────────────────────────────────────────
const profileData = { username: 'admin', email: 'admin@example.com', role: 'Administrator', lastLogin: '2026-02-16 14:23:01', sessions: 3 };

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
                    Container Log
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
        <!-- UPDATES PAGE                                   -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/updates'">

          <!-- ═══ FILTER BAR ═══ -->
          <div class="sticky top-0 z-10 mb-5">
            <div class="px-3 py-2 rounded-xl relative z-[1]"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <div class="flex flex-wrap items-center gap-2.5">
                <!-- Kind filter -->
                <select v-model="updatesFilterKind"
                        class="px-2 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide outline-none cursor-pointer"
                        :class="isDark
                          ? 'bg-slate-800 text-slate-300 border border-slate-700'
                          : 'bg-slate-50 text-slate-600 border border-slate-200'">
                  <option value="all">Kind</option>
                  <option value="major">Major</option>
                  <option value="minor">Minor</option>
                  <option value="patch">Patch</option>
                  <option value="digest">Digest</option>
                </select>

                <!-- Bouncer filter -->
                <select v-model="updatesFilterBouncer"
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
                <select v-model="updatesFilterRegistry"
                        class="px-2 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide outline-none cursor-pointer"
                        :class="isDark
                          ? 'bg-slate-800 text-slate-300 border border-slate-700'
                          : 'bg-slate-50 text-slate-600 border border-slate-200'">
                  <option value="all">Registry</option>
                  <option value="dockerhub">Docker Hub</option>
                  <option value="ghcr">GHCR</option>
                  <option value="custom">Custom</option>
                </select>

                <!-- Result count -->
                <span class="text-[10px] font-semibold tabular-nums shrink-0 px-2 py-1 rounded-lg ml-auto"
                      :class="isDark ? 'text-slate-500 bg-slate-800/50' : 'text-slate-400 bg-slate-100'">
                  {{ filteredUpdates.length }}/{{ updatesData.length }}
                </span>
              </div>
            </div>
            <!-- Background shield -->
            <div class="absolute -inset-x-4 -top-4 z-0 pointer-events-none"
                 :style="{
                   bottom: '-24px',
                   background: isDark
                     ? 'linear-gradient(to bottom, #151d2e 0%, #151d2e calc(100% - 24px), #151d2e00 100%)'
                     : 'linear-gradient(to bottom, #f1f5f9 0%, #f1f5f9 calc(100% - 24px), #f1f5f900 100%)',
                 }" />
          </div>

          <!-- ═══ UPDATES TABLE ═══ -->
          <div v-if="filteredUpdates.length > 0"
               class="rounded-xl overflow-hidden"
               :style="{
                 backgroundColor: isDark ? '#1e293b' : '#ffffff',
                 border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
               }">
            <div class="overflow-x-auto">
              <table class="w-full text-xs" style="min-width: 480px;">
                <thead>
                  <tr :style="{ backgroundColor: isDark ? '#0f172a40' : '#f8fafc' }">
                    <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]" style="width: 99%;"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Container</th>
                    <th class="text-center px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Version</th>
                    <th class="text-center px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Kind</th>
                    <th class="hidden sm:table-cell text-center px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Bouncer</th>
                    <th class="hidden sm:table-cell text-center px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Registry</th>
                    <th class="text-center px-0 py-2.5 font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Actions</th>
                    <th class="pl-0 pr-1 py-2.5 text-center">
                      <button class="w-7 h-7 rounded-lg inline-flex items-center justify-center text-sm transition-colors mx-auto"
                              :class="isDark
                                ? 'text-slate-500 hover:text-slate-300 hover:bg-slate-700'
                                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200'"
                              title="Update All"
                              @click="updateAll">
                        &hellip;
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(c, i) in filteredUpdates" :key="c.name"
                      class="transition-colors"
                      :class="isDark ? 'hover:bg-slate-700/30' : 'hover:bg-slate-50'"
                      :style="{ borderBottom: i < filteredUpdates.length - 1 ? (isDark ? '1px solid #334155' : '1px solid #f1f5f9') : 'none' }">
                    <!-- Container name + image -->
                    <td class="px-5 py-3">
                      <div class="flex items-center gap-2 min-w-0">
                        <div class="w-2 h-2 rounded-full shrink-0"
                             :style="{ backgroundColor: c.status === 'running' ? '#06D6A0' : '#64748b' }" />
                        <div class="min-w-0">
                          <div class="font-medium truncate" :class="isDark ? 'text-slate-200' : 'text-slate-700'">{{ c.name }}</div>
                          <div class="text-[10px] mt-0.5 truncate" :class="isDark ? 'text-slate-500' : 'text-slate-400'">{{ c.image }}</div>
                        </div>
                      </div>
                    </td>
                    <!-- Version comparison -->
                    <td class="px-5 py-3">
                      <!-- Inline on sm+ -->
                      <div class="hidden sm:grid items-center gap-1.5" style="grid-template-columns: 1fr auto 1fr;">
                        <span class="px-1.5 py-0.5 rounded text-[10px] font-medium text-right justify-self-end"
                              :class="isDark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-500'">
                          {{ c.currentTag }}
                        </span>
                        <AppIcon name="arrow-right" :size="8" class="justify-self-center"
                           :class="isDark ? 'text-slate-600' : 'text-slate-300'" />
                        <span class="px-1.5 py-0.5 rounded text-[10px] font-medium justify-self-start"
                              style="background: rgba(0,150,199,0.15); color: #0096C7;">
                          {{ c.newTag }}
                        </span>
                      </div>
                      <!-- Stacked on mobile -->
                      <div class="sm:hidden flex flex-col items-center gap-0.5">
                        <span class="px-1.5 py-0.5 rounded text-[10px] font-medium"
                              :class="isDark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-500'">
                          {{ c.currentTag }}
                        </span>
                        <AppIcon name="trend-down" :size="7" :class="isDark ? 'text-slate-600' : 'text-slate-300'" />
                        <span class="px-1.5 py-0.5 rounded text-[10px] font-medium"
                              style="background: rgba(0,150,199,0.15); color: #0096C7;">
                          {{ c.newTag }}
                        </span>
                      </div>
                    </td>
                    <!-- Kind badge -->
                    <td class="px-3 py-3 text-center whitespace-nowrap">
                      <span class="badge text-[9px] uppercase font-bold"
                            :style="{ backgroundColor: updateKindColor(c.updateKind).bg, color: updateKindColor(c.updateKind).text }">
                        <template v-if="isMobile">{{ c.updateKind === 'major' ? '⬆⬆' : c.updateKind === 'minor' ? '⬆' : '#' }}</template>
                        <template v-else>{{ c.updateKind }}</template>
                      </span>
                    </td>
                    <!-- Bouncer badge -->
                    <td class="hidden sm:table-cell px-3 py-3 text-center whitespace-nowrap">
                      <span class="badge text-[9px] uppercase font-bold"
                            :style="{ backgroundColor: bouncerColor(c.bouncer).bg, color: bouncerColor(c.bouncer).text }">
                        <AppIcon :name="c.bouncer === 'safe' ? 'check' : c.bouncer === 'unsafe' ? 'pending' : 'xmark'"
                                 :size="8" class="mr-1" />
                        {{ c.bouncer }}
                      </span>
                    </td>
                    <!-- Registry badge -->
                    <td class="hidden sm:table-cell px-3 py-3 text-center whitespace-nowrap">
                      <span class="badge text-[9px] uppercase tracking-wide font-bold"
                            :style="{ backgroundColor: registryColorBg(c.registry, isDark), color: registryColorText(c.registry, isDark) }">
                        {{ registryLabel(c.registry) }}
                      </span>
                    </td>
                    <!-- Actions -->
                    <td class="px-0 py-3 text-center whitespace-nowrap">
                      <button v-if="c.bouncer === 'blocked'"
                              class="inline-flex items-center whitespace-nowrap px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wide cursor-not-allowed"
                              :style="{
                                backgroundColor: '#0f172a',
                                color: '#475569',
                              }">
                        🥊 Blocked
                      </button>
                      <button v-else
                              class="inline-flex items-center whitespace-nowrap px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wide transition-all"
                              :style="{
                                background: 'linear-gradient(135deg, #0096C7, #0077b6)',
                                color: '#ffffff',
                                boxShadow: '0 1px 3px rgba(0,150,199,0.3)',
                              }"
                              @click="updateContainer(c.name)">
                        <AppIcon name="updates" :size="10" class="mr-1" />
                        Update
                      </button>
                    </td>
                    <td class="pl-0 pr-1 py-3 text-center">
                      <button class="w-7 h-7 rounded-lg inline-flex items-center justify-center text-sm transition-colors mx-auto"
                              :class="isDark
                                ? 'text-slate-500 hover:text-slate-300 hover:bg-slate-700'
                                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200'"
                              title="Skip update"
                              @click="skipUpdate(c.name)">
                        &hellip;
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- ═══ EMPTY STATE ═══ -->
          <div v-else
               class="flex flex-col items-center justify-center py-16 rounded-xl"
               :style="{
                 backgroundColor: isDark ? '#1e293b' : '#ffffff',
                 border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
               }">
            <AppIcon name="up-to-date" :size="24" class="mb-3" :class="isDark ? 'text-slate-600' : 'text-slate-300'" />
            <p class="text-sm font-medium mb-1" :class="isDark ? 'text-slate-400' : 'text-slate-500'">
              {{ updatesFiltersActive ? 'No updates match your filters' : 'All containers are up to date' }}
            </p>
            <button v-if="updatesFiltersActive"
                    class="text-xs font-medium mt-2 px-3 py-1.5 rounded-lg transition-colors"
                    :class="isDark
                      ? 'text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/20'
                      : 'text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/15'"
                    @click="clearUpdatesFilters">
              Clear all filters
            </button>
          </div>

        </div>

        <!-- ═══════════════════════════════════════════════ -->
        <!-- SECURITY PAGE                                  -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/security'">

          <!-- ═══ STAT CARDS ═══ -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div class="stat-card rounded-xl p-4"
                 :style="{
                   borderLeftColor: '#0096C7',
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                   borderLeftWidth: '4px',
                 }">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[11px] font-medium uppercase tracking-wider"
                      :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                  Total Scanned
                </span>
                <div class="w-8 h-8 rounded-lg flex items-center justify-center"
                     style="background-color: rgba(0,150,199,0.1); color: #0096C7;">
                  <AppIcon name="security" :size="14" />
                </div>
              </div>
              <div class="text-2xl font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">
                {{ securityStats.scannedImages }}
              </div>
              <div class="text-[11px] mt-1" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                images scanned
              </div>
            </div>

            <div class="stat-card rounded-xl p-4"
                 :style="{
                   borderLeftColor: '#06D6A0',
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                   borderLeftWidth: '4px',
                 }">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[11px] font-medium uppercase tracking-wider"
                      :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                  Clean
                </span>
                <div class="w-8 h-8 rounded-lg flex items-center justify-center"
                     style="background-color: rgba(6,214,160,0.1); color: #06D6A0;">
                  <AppIcon name="check" :size="14" />
                </div>
              </div>
              <div class="text-2xl font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">
                {{ securityStats.clean }}
              </div>
              <div class="text-[11px] mt-1 flex items-center gap-1" style="color: #06D6A0;">
                <AppIcon name="trend-up" :size="9" />
                {{ Math.round(securityStats.clean / securityStats.scannedImages * 100) }}% pass rate
              </div>
            </div>

            <div class="stat-card rounded-xl p-4"
                 :style="{
                   borderLeftColor: '#E53935',
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                   borderLeftWidth: '4px',
                 }">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[11px] font-medium uppercase tracking-wider"
                      :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                  Critical + High
                </span>
                <div class="w-8 h-8 rounded-lg flex items-center justify-center"
                     style="background-color: rgba(229,57,53,0.1); color: #E53935;">
                  <AppIcon name="security" :size="14" />
                </div>
              </div>
              <div class="text-2xl font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">
                {{ securityStats.critical + securityStats.high }}
              </div>
              <div class="text-[11px] mt-1" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                {{ securityStats.critical }} critical, {{ securityStats.high }} high
              </div>
            </div>

            <div class="stat-card rounded-xl p-4"
                 :style="{
                   borderLeftColor: '#EAB308',
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                   borderLeftWidth: '4px',
                 }">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[11px] font-medium uppercase tracking-wider"
                      :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                  Medium + Low
                </span>
                <div class="w-8 h-8 rounded-lg flex items-center justify-center"
                     style="background-color: rgba(234,179,8,0.1); color: #EAB308;">
                  <AppIcon name="info" :size="14" />
                </div>
              </div>
              <div class="text-2xl font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">
                {{ securityStats.medium + securityStats.low }}
              </div>
              <div class="text-[11px] mt-1" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                {{ securityStats.medium }} medium, {{ securityStats.low }} low
              </div>
            </div>
          </div>

          <!-- ═══ VULNERABILITY TABLE ═══ -->
          <div class="rounded-xl overflow-hidden mb-6"
               :style="{
                 backgroundColor: isDark ? '#1e293b' : '#ffffff',
                 border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
               }">
            <div class="flex items-center justify-between px-5 py-3.5"
                 :style="{ borderBottom: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
              <div class="flex items-center gap-2">
                <AppIcon name="security" :size="14" class="text-drydock-secondary" />
                <h2 class="text-sm font-semibold" :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                  Vulnerabilities
                </h2>
                <span class="badge text-[10px] ml-1"
                      :style="{
                        backgroundColor: isDark ? 'rgba(229,57,53,0.2)' : 'rgba(229,57,53,0.12)',
                        color: '#E53935',
                      }">
                  {{ filteredSecurityVulns.length }}
                </span>
              </div>
              <div class="flex items-center gap-2">
                <select v-model="securityFilterSeverity"
                        class="px-2 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide outline-none cursor-pointer"
                        :class="isDark
                          ? 'bg-slate-800 text-slate-300 border border-slate-700'
                          : 'bg-slate-50 text-slate-600 border border-slate-200'">
                  <option value="all">All Severities</option>
                  <option value="CRITICAL">Critical</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
              </div>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-xs" style="min-width: 640px;">
                <thead>
                  <tr :style="{ backgroundColor: isDark ? '#0f172a40' : '#f8fafc' }">
                    <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] cursor-pointer select-none"
                        :class="isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'"
                        @click="toggleSecuritySort('severity')">
                      Severity
                      <span v-if="securitySortField === 'severity'" class="ml-0.5">{{ securitySortAsc ? '&#9650;' : '&#9660;' }}</span>
                    </th>
                    <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">CVE ID</th>
                    <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Package</th>
                    <th class="text-center px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Fixed In</th>
                    <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Image</th>
                    <th class="text-right px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] cursor-pointer select-none"
                        :class="isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'"
                        @click="toggleSecuritySort('published')">
                      Published
                      <span v-if="securitySortField === 'published'" class="ml-0.5">{{ securitySortAsc ? '&#9650;' : '&#9660;' }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(vuln, i) in filteredSecurityVulns" :key="vuln.id"
                      class="transition-colors"
                      :class="isDark ? 'hover:bg-slate-700/30' : 'hover:bg-slate-50'"
                      :style="{ borderBottom: i < filteredSecurityVulns.length - 1 ? (isDark ? '1px solid #334155' : '1px solid #f1f5f9') : 'none' }">
                    <td class="px-5 py-3">
                      <span class="badge text-[9px] uppercase font-bold"
                            :style="{ backgroundColor: severityColor(vuln.severity).bg, color: severityColor(vuln.severity).text }">
                        {{ vuln.severity }}
                      </span>
                    </td>
                    <td class="px-5 py-3 font-medium font-mono" :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                      {{ vuln.id }}
                    </td>
                    <td class="px-5 py-3">
                      <div>
                        <span class="font-medium" :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ vuln.package }}</span>
                        <span class="ml-1.5 text-[10px]" :class="isDark ? 'text-slate-500' : 'text-slate-400'">{{ vuln.version }}</span>
                      </div>
                    </td>
                    <td class="px-5 py-3 text-center">
                      <span v-if="vuln.fixedIn"
                            class="px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style="background: rgba(6,214,160,0.15); color: #06D6A0;">
                        {{ vuln.fixedIn }}
                      </span>
                      <span v-else class="text-[10px]" :class="isDark ? 'text-slate-600' : 'text-slate-400'">
                        No fix
                      </span>
                    </td>
                    <td class="px-5 py-3" :class="isDark ? 'text-slate-400' : 'text-slate-500'">
                      {{ vuln.image }}
                    </td>
                    <td class="px-5 py-3 text-right" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                      {{ vuln.publishedDate }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- ═══ RECENT SCANS ═══ -->
          <div class="rounded-xl overflow-hidden"
               :style="{
                 backgroundColor: isDark ? '#1e293b' : '#ffffff',
                 border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
               }">
            <div class="flex items-center justify-between px-5 py-3.5"
                 :style="{ borderBottom: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
              <div class="flex items-center gap-2">
                <AppIcon name="recent-updates" :size="14" class="text-drydock-secondary" />
                <h2 class="text-sm font-semibold" :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                  Recent Scans
                </h2>
              </div>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr :style="{ backgroundColor: isDark ? '#0f172a40' : '#f8fafc' }">
                    <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Container</th>
                    <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Image</th>
                    <th class="text-center px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Vulnerabilities</th>
                    <th class="text-center px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Status</th>
                    <th class="text-right px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Scanned</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(scan, i) in securityScanHistory" :key="scan.container"
                      class="transition-colors"
                      :class="isDark ? 'hover:bg-slate-700/30' : 'hover:bg-slate-50'"
                      :style="{ borderBottom: i < securityScanHistory.length - 1 ? (isDark ? '1px solid #334155' : '1px solid #f1f5f9') : 'none' }">
                    <td class="px-5 py-3 font-medium" :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                      {{ scan.container }}
                    </td>
                    <td class="px-5 py-3" :class="isDark ? 'text-slate-400' : 'text-slate-500'">
                      {{ scan.image }}
                    </td>
                    <td class="px-5 py-3 text-center">
                      <span class="font-bold tabular-nums"
                            :style="{ color: scan.vulnCount > 0 ? '#FF9800' : '#06D6A0' }">
                        {{ scan.vulnCount }}
                      </span>
                    </td>
                    <td class="px-5 py-3 text-center">
                      <span class="badge"
                            :style="{
                              backgroundColor: scanStatusColor(scan.status).bg,
                              color: scanStatusColor(scan.status).text,
                            }">
                        <AppIcon :name="scan.status === 'clean' ? 'check' : scan.status === 'issues' ? 'pending' : 'xmark'"
                           :size="8" class="mr-1" />
                        {{ scan.status }}
                      </span>
                    </td>
                    <td class="px-5 py-3 text-right" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                      {{ scan.scannedAt }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

        </div>

        <!-- ═══════════════════════════════════════════════ -->
        <!-- LOGS PAGE                                       -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/logs'" class="flex flex-col" style="height: calc(100vh - 80px);">

          <!-- ═══ TOOLBAR ═══ -->
          <div class="shrink-0 mb-3">
            <div class="px-3 py-2 rounded-xl"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <div class="flex flex-wrap items-center gap-2.5">
                <!-- Source filter -->
                <select v-model="logSourceFilter"
                        class="px-2 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide outline-none cursor-pointer"
                        :class="isDark
                          ? 'bg-slate-800 text-slate-300 border border-slate-700'
                          : 'bg-slate-50 text-slate-600 border border-slate-200'">
                  <option value="all">All Sources</option>
                  <option value="server">Server</option>
                  <option value="agent-01">Agent-01</option>
                  <option value="agent-02">Agent-02</option>
                </select>

                <!-- Level filter -->
                <select v-model="logLevelFilter"
                        class="px-2 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide outline-none cursor-pointer"
                        :class="isDark
                          ? 'bg-slate-800 text-slate-300 border border-slate-700'
                          : 'bg-slate-50 text-slate-600 border border-slate-200'">
                  <option value="all">All Levels</option>
                  <option value="debug">Debug</option>
                  <option value="info">Info</option>
                  <option value="warn">Warn</option>
                  <option value="error">Error</option>
                </select>

                <!-- Lines limit -->
                <select v-model="logLinesLimit"
                        class="px-2 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide outline-none cursor-pointer"
                        :class="isDark
                          ? 'bg-slate-800 text-slate-300 border border-slate-700'
                          : 'bg-slate-50 text-slate-600 border border-slate-200'">
                  <option value="50">50 lines</option>
                  <option value="100">100 lines</option>
                  <option value="500">500 lines</option>
                  <option value="1000">1000 lines</option>
                </select>

                <!-- Spacer -->
                <div class="flex-1" />

                <!-- Auto-scroll toggle -->
                <label class="flex items-center gap-1.5 cursor-pointer select-none">
                  <span class="text-[10px] font-semibold uppercase tracking-wider"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">Auto-scroll</span>
                  <div class="w-8 h-4 rounded-full relative cursor-pointer shrink-0 transition-colors"
                       :style="{ backgroundColor: logAutoScroll ? '#06D6A0' : (isDark ? '#334155' : '#cbd5e1') }"
                       @click="logAutoScroll = !logAutoScroll">
                    <div class="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform"
                         :style="{ left: logAutoScroll ? '17px' : '2px' }" />
                  </div>
                </label>

                <!-- Pause button -->
                <button class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
                        :class="logPaused
                          ? 'bg-amber-500/15 text-amber-500'
                          : isDark ? 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700' : 'bg-slate-50 text-slate-500 hover:text-slate-700 border border-slate-200'"
                        @click="logPaused = !logPaused">
                  <AppIcon :name="logPaused ? 'play' : 'pause'" :size="10" />
                  {{ logPaused ? 'Resume' : 'Pause' }}
                </button>

                <!-- Clear button -->
                <button class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
                        :class="isDark
                          ? 'bg-slate-800 text-slate-400 hover:text-red-400 border border-slate-700'
                          : 'bg-slate-50 text-slate-500 hover:text-red-500 border border-slate-200'"
                        @click="clearLogLines">
                  <AppIcon name="trash" :size="10" />
                  Clear
                </button>
              </div>
            </div>
          </div>

          <!-- ═══ TERMINAL DISPLAY ═══ -->
          <div class="flex-1 min-h-0 flex flex-col rounded-xl overflow-hidden"
               :style="{
                 backgroundColor: isDark ? '#0a0f1a' : '#1e293b',
                 border: isDark ? '1px solid #334155' : '1px solid #334155',
               }">
            <!-- Log lines -->
            <div class="flex-1 overflow-y-auto px-1"
                 style="box-shadow: inset 0 8px 16px -8px rgba(0,0,0,0.4);">
              <div v-if="logLines.length === 0"
                   class="flex flex-col items-center justify-center h-full">
                <AppIcon name="logs" :size="24" class="mb-3 text-slate-600" />
                <p class="text-xs font-medium text-slate-500">No log entries</p>
                <p class="text-[10px] mt-1 text-slate-600">Waiting for new events...</p>
              </div>
              <div v-for="(line, i) in logLines" :key="i"
                   class="px-3 py-[3px] font-mono text-[11px] leading-relaxed flex gap-3 hover:bg-white/[0.03] transition-colors"
                   :style="{ borderBottom: '1px solid rgba(255,255,255,0.03)' }">
                <span class="text-slate-600 shrink-0 tabular-nums">{{ formatLogTimestamp(line.timestamp) }}</span>
                <span class="shrink-0 w-11 text-right font-semibold uppercase text-[10px]"
                      :style="{
                        color: line.level === 'error' ? '#E53935'
                             : line.level === 'warn' ? '#FF9800'
                             : line.level === 'debug' ? '#64748b'
                             : '#06D6A0'
                      }">
                  {{ line.level }}
                </span>
                <span class="shrink-0 text-drydock-secondary">{{ line.component }}</span>
                <span class="text-slate-300 break-all">{{ line.message }}</span>
              </div>
            </div>

            <!-- Status bar -->
            <div class="shrink-0 px-4 py-2 flex items-center justify-between"
                 :style="{ borderTop: '1px solid rgba(255,255,255,0.06)', backgroundColor: 'rgba(0,0,0,0.2)' }">
              <span class="text-[10px] font-medium text-slate-500">
                Showing {{ logLines.length }} of 1,247 entries
              </span>
              <div class="flex items-center gap-1.5">
                <div class="w-2 h-2 rounded-full"
                     :style="{ backgroundColor: logPaused ? '#E53935' : '#06D6A0' }" />
                <span class="text-[10px] font-semibold"
                      :style="{ color: logPaused ? '#E53935' : '#06D6A0' }">
                  {{ logPaused ? 'Paused' : 'Connected' }}
                </span>
              </div>
            </div>
          </div>

        </div>

        <!-- ═══════════════════════════════════════════════ -->
        <!-- SERVERS PAGE                                    -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/servers'">

          <!-- ═══ STAT CARDS ═══ -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <!-- Total Servers -->
            <div class="stat-card rounded-xl p-4"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                   borderLeftWidth: '4px',
                   borderLeftColor: '#0096C7',
                 }">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[11px] font-medium uppercase tracking-wider"
                      :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                  Total Servers
                </span>
                <div class="w-8 h-8 rounded-lg flex items-center justify-center"
                     style="background-color: rgba(0,150,199,0.1); color: #0096C7;">
                  <AppIcon name="servers" :size="14" />
                </div>
              </div>
              <div class="text-2xl font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">
                {{ serversStats.total }}
              </div>
              <div class="text-[11px] mt-1" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                Docker hosts monitored
              </div>
            </div>

            <!-- Total Containers -->
            <div class="stat-card rounded-xl p-4"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                   borderLeftWidth: '4px',
                   borderLeftColor: '#06D6A0',
                 }">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[11px] font-medium uppercase tracking-wider"
                      :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                  Total Containers
                </span>
                <div class="w-8 h-8 rounded-lg flex items-center justify-center"
                     style="background-color: rgba(6,214,160,0.1); color: #06D6A0;">
                  <AppIcon name="containers" :size="14" />
                </div>
              </div>
              <div class="text-2xl font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">
                {{ serversStats.totalContainers }}
              </div>
              <div class="text-[11px] mt-1" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                Across all servers
              </div>
            </div>

            <!-- Connected / Disconnected -->
            <div class="stat-card rounded-xl p-4"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                   borderLeftWidth: '4px',
                   borderLeftColor: serversStats.disconnected > 0 ? '#E53935' : '#06D6A0',
                 }">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[11px] font-medium uppercase tracking-wider"
                      :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                  Connection Status
                </span>
                <div class="w-8 h-8 rounded-lg flex items-center justify-center"
                     :style="{
                       backgroundColor: serversStats.disconnected > 0 ? 'rgba(229,57,53,0.1)' : 'rgba(6,214,160,0.1)',
                       color: serversStats.disconnected > 0 ? '#E53935' : '#06D6A0',
                     }">
                  <AppIcon name="agents" :size="14" />
                </div>
              </div>
              <div class="flex items-baseline gap-3">
                <div>
                  <span class="text-2xl font-bold" style="color: #06D6A0;">{{ serversStats.connected }}</span>
                  <span class="text-[11px] ml-1" :class="isDark ? 'text-slate-500' : 'text-slate-400'">connected</span>
                </div>
                <div>
                  <span class="text-2xl font-bold" :style="{ color: serversStats.disconnected > 0 ? '#E53935' : '#64748b' }">{{ serversStats.disconnected }}</span>
                  <span class="text-[11px] ml-1" :class="isDark ? 'text-slate-500' : 'text-slate-400'">disconnected</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ═══ SERVER CARDS ═══ -->
          <div class="space-y-4">
            <div v-for="server in servers" :key="server.name"
                 class="rounded-xl overflow-hidden"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">

              <!-- Card header -->
              <div class="px-5 py-3.5 flex items-center gap-3"
                   :style="{ borderBottom: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                <div class="w-2.5 h-2.5 rounded-full shrink-0"
                     :style="{ backgroundColor: server.status === 'connected' ? '#06D6A0' : '#E53935' }" />
                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                  <AppIcon name="servers" :size="14" class="shrink-0"
                           :style="{ color: server.status === 'connected' ? '#0096C7' : '#64748b' }" />
                  <h2 class="text-sm font-semibold truncate" :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                    {{ server.name }}
                  </h2>
                  <span class="text-[11px] font-mono truncate"
                        :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                    {{ server.host }}
                  </span>
                </div>
                <span class="badge text-[9px] uppercase tracking-wide font-bold shrink-0"
                      :style="{
                        backgroundColor: server.status === 'connected'
                          ? (isDark ? 'rgba(6,214,160,0.15)' : 'rgba(6,214,160,0.1)')
                          : (isDark ? 'rgba(229,57,53,0.15)' : 'rgba(229,57,53,0.1)'),
                        color: server.status === 'connected' ? '#06D6A0' : '#E53935',
                      }">
                  {{ server.status }}
                </span>
              </div>

              <!-- Card body grid -->
              <div class="p-5">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">

                  <!-- Left column -->
                  <div class="space-y-4">
                    <div>
                      <div class="text-[10px] font-semibold uppercase tracking-wider mb-1"
                           :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                        Docker Version
                      </div>
                      <div class="text-[13px] font-medium font-mono"
                           :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                        {{ server.dockerVersion }}
                      </div>
                    </div>
                    <div>
                      <div class="text-[10px] font-semibold uppercase tracking-wider mb-1"
                           :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                        Operating System
                      </div>
                      <div class="text-[13px] font-medium"
                           :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                        {{ server.os }}
                      </div>
                    </div>
                    <div>
                      <div class="text-[10px] font-semibold uppercase tracking-wider mb-1"
                           :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                        Architecture
                      </div>
                      <div class="text-[13px] font-medium font-mono"
                           :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                        {{ server.arch }}
                      </div>
                    </div>
                    <div class="flex gap-6">
                      <div>
                        <div class="text-[10px] font-semibold uppercase tracking-wider mb-1"
                             :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                          CPUs
                        </div>
                        <div class="text-[13px] font-medium font-mono"
                             :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                          {{ server.cpus }}
                        </div>
                      </div>
                      <div>
                        <div class="text-[10px] font-semibold uppercase tracking-wider mb-1"
                             :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                          Memory
                        </div>
                        <div class="text-[13px] font-medium font-mono"
                             :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                          {{ server.memoryGb }} GB
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Right column -->
                  <div class="space-y-4">
                    <div>
                      <div class="text-[10px] font-semibold uppercase tracking-wider mb-1"
                           :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                        Containers
                      </div>
                      <div class="flex items-baseline gap-3">
                        <span class="text-[13px] font-bold" :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                          {{ server.containers.total }}
                        </span>
                        <span class="text-[11px] font-medium" style="color: #06D6A0;">
                          {{ server.containers.running }} running
                        </span>
                        <span v-if="server.containers.stopped > 0"
                              class="text-[11px] font-medium" style="color: #E53935;">
                          {{ server.containers.stopped }} stopped
                        </span>
                      </div>
                    </div>
                    <div>
                      <div class="text-[10px] font-semibold uppercase tracking-wider mb-1"
                           :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                        Images
                      </div>
                      <div class="text-[13px] font-medium font-mono"
                           :class="isDark ? 'text-slate-200' : 'text-slate-700'">
                        {{ server.images }}
                      </div>
                    </div>
                    <div>
                      <div class="text-[10px] font-semibold uppercase tracking-wider mb-1"
                           :class="isDark ? 'text-slate-500' : 'text-slate-400'">
                        Last Seen
                      </div>
                      <div class="text-[13px] font-medium"
                           :class="server.status === 'connected'
                             ? (isDark ? 'text-slate-200' : 'text-slate-700')
                             : ''
                           "
                           :style="server.status === 'disconnected' ? { color: '#E53935' } : {}">
                        {{ server.lastSeen }}
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              <!-- Card footer -->
              <div class="px-5 py-3 flex items-center justify-end gap-2"
                   :style="{
                     borderTop: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                     backgroundColor: isDark ? '#111827' : '#f1f5f9',
                   }">
                <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
                        :class="isDark
                          ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                          : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200'"
                        @click="refreshServer(server.name)">
                  <AppIcon name="restart" :size="10" />
                  Refresh
                </button>
                <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
                        :class="isDark
                          ? 'text-drydock-secondary hover:bg-drydock-secondary/15'
                          : 'text-drydock-secondary hover:bg-drydock-secondary/10'"
                        @click="viewServerContainers(server.name)">
                  <AppIcon name="containers" :size="10" />
                  View Containers
                </button>
              </div>

            </div>
          </div>

        </div>

        <!-- ═══════════════════════════════════════════════ -->
        <!-- SETTINGS PAGE (Server)                         -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/config'" class="max-w-4xl">
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

        <!-- ═══════════════════════════════════════════════ -->
        <!-- REGISTRIES PAGE                                -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/registries'" class="max-w-4xl">
          <!-- Page header -->
          <div class="flex items-center gap-3 mb-6">
            <div class="w-9 h-9 rounded-lg flex items-center justify-center"
                 :style="{ backgroundColor: 'rgba(0,150,199,0.15)', color: '#0096C7' }">
              <AppIcon name="registries" :size="16" />
            </div>
            <div>
              <h1 class="text-lg font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">Registries</h1>
              <p class="text-[11px]" :class="isDark ? 'text-slate-500' : 'text-slate-400'">Manage container registry connections</p>
            </div>
            <span class="badge text-[10px] font-bold ml-auto"
                  :style="{ backgroundColor: 'rgba(0,150,199,0.15)', color: '#0096C7' }">
              {{ registriesData.length }}
            </span>
          </div>

          <!-- Registry cards -->
          <div class="space-y-3">
            <div v-for="reg in registriesData" :key="reg.id"
                 class="rounded-xl overflow-hidden transition-all"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <!-- Card header -->
              <div class="flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors"
                   :class="isDark ? 'hover:bg-slate-700/30' : 'hover:bg-slate-50'"
                   @click="toggleConfigItem(reg.id)">
                <div class="w-2.5 h-2.5 rounded-full shrink-0"
                     :style="{ backgroundColor: reg.status === 'connected' ? '#06D6A0' : reg.status === 'error' ? '#E53935' : '#64748b' }" />
                <AppIcon name="registries" :size="14" :class="isDark ? 'text-slate-400' : 'text-slate-500'" />
                <span class="text-sm font-semibold flex-1 min-w-0 truncate"
                      :class="isDark ? 'text-slate-200' : 'text-slate-700'">{{ reg.name }}</span>
                <span class="badge text-[9px] uppercase font-bold shrink-0"
                      :style="{ backgroundColor: registryTypeBadge(reg.type).bg, color: registryTypeBadge(reg.type).text }">
                  {{ registryTypeBadge(reg.type).label }}
                </span>
                <i class="pi text-[10px] transition-transform shrink-0"
                   :class="[
                     expandedConfigItems.has(reg.id) ? 'pi-angle-up' : 'pi-angle-down',
                     isDark ? 'text-slate-500' : 'text-slate-400',
                   ]" />
              </div>
              <!-- Expanded config -->
              <div v-if="expandedConfigItems.has(reg.id)"
                   class="px-5 pb-4 pt-1"
                   :style="{ borderTop: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
                  <div v-for="(val, key) in reg.config" :key="key">
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">{{ key }}</div>
                    <div class="text-[12px] font-mono"
                         :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ val }}</div>
                  </div>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">Status</div>
                    <span class="badge text-[10px] font-semibold"
                          :style="{
                            backgroundColor: reg.status === 'connected' ? 'rgba(6,214,160,0.15)' : 'rgba(229,57,53,0.15)',
                            color: reg.status === 'connected' ? '#06D6A0' : '#E53935',
                          }">{{ reg.status }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════ -->
        <!-- AGENTS PAGE                                    -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/agents'" class="max-w-4xl">
          <!-- Page header -->
          <div class="flex items-center gap-3 mb-6">
            <div class="w-9 h-9 rounded-lg flex items-center justify-center"
                 :style="{ backgroundColor: 'rgba(0,150,199,0.15)', color: '#0096C7' }">
              <AppIcon name="agents" :size="16" />
            </div>
            <div>
              <h1 class="text-lg font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">Agents</h1>
              <p class="text-[11px]" :class="isDark ? 'text-slate-500' : 'text-slate-400'">Remote agent connections</p>
            </div>
            <span class="badge text-[10px] font-bold ml-auto"
                  :style="{ backgroundColor: 'rgba(0,150,199,0.15)', color: '#0096C7' }">
              {{ agentsData.length }}
            </span>
          </div>

          <!-- Agent cards -->
          <div class="space-y-3">
            <div v-for="agent in agentsData" :key="agent.id"
                 class="rounded-xl overflow-hidden transition-all"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <!-- Card header -->
              <div class="flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors"
                   :class="isDark ? 'hover:bg-slate-700/30' : 'hover:bg-slate-50'"
                   @click="toggleConfigItem(agent.id)">
                <div class="w-2.5 h-2.5 rounded-full shrink-0"
                     :style="{ backgroundColor: agent.status === 'connected' ? '#06D6A0' : '#E53935' }" />
                <AppIcon name="agents" :size="14" :class="isDark ? 'text-slate-400' : 'text-slate-500'" />
                <span class="text-sm font-semibold flex-1 min-w-0 truncate"
                      :class="isDark ? 'text-slate-200' : 'text-slate-700'">{{ agent.name }}</span>
                <span class="badge text-[9px] uppercase font-bold shrink-0"
                      :style="{
                        backgroundColor: agent.status === 'connected' ? 'rgba(6,214,160,0.15)' : 'rgba(229,57,53,0.15)',
                        color: agent.status === 'connected' ? '#06D6A0' : '#E53935',
                      }">
                  {{ agent.status }}
                </span>
                <i class="pi text-[10px] transition-transform shrink-0"
                   :class="[
                     expandedConfigItems.has(agent.id) ? 'pi-angle-up' : 'pi-angle-down',
                     isDark ? 'text-slate-500' : 'text-slate-400',
                   ]" />
              </div>
              <!-- Expanded config -->
              <div v-if="expandedConfigItems.has(agent.id)"
                   class="px-5 pb-4 pt-1"
                   :style="{ borderTop: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">Host</div>
                    <div class="text-[12px] font-mono"
                         :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ agent.host }}</div>
                  </div>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">Last Seen</div>
                    <div class="text-[12px] font-mono"
                         :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ agent.lastSeen }}</div>
                  </div>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">Containers</div>
                    <div class="text-[12px] font-mono"
                         :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ agent.containers }}</div>
                  </div>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">Version</div>
                    <div class="text-[12px] font-mono"
                         :class="isDark ? 'text-slate-300' : 'text-slate-600'">v{{ agent.version }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════ -->
        <!-- TRIGGERS PAGE                                  -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/triggers'" class="max-w-4xl">
          <!-- Page header -->
          <div class="flex items-center gap-3 mb-6">
            <div class="w-9 h-9 rounded-lg flex items-center justify-center"
                 :style="{ backgroundColor: 'rgba(0,150,199,0.15)', color: '#0096C7' }">
              <AppIcon name="triggers" :size="16" />
            </div>
            <div>
              <h1 class="text-lg font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">Triggers</h1>
              <p class="text-[11px]" :class="isDark ? 'text-slate-500' : 'text-slate-400'">Notification and webhook endpoints</p>
            </div>
            <span class="badge text-[10px] font-bold ml-auto"
                  :style="{ backgroundColor: 'rgba(0,150,199,0.15)', color: '#0096C7' }">
              {{ triggersData.length }}
            </span>
          </div>

          <!-- Trigger cards -->
          <div class="space-y-3">
            <div v-for="trigger in triggersData" :key="trigger.id"
                 class="rounded-xl overflow-hidden transition-all"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <!-- Card header -->
              <div class="flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors"
                   :class="isDark ? 'hover:bg-slate-700/30' : 'hover:bg-slate-50'"
                   @click="toggleConfigItem(trigger.id)">
                <div class="w-2.5 h-2.5 rounded-full shrink-0"
                     :style="{ backgroundColor: trigger.status === 'active' ? '#06D6A0' : '#E53935' }" />
                <AppIcon name="triggers" :size="14" :class="isDark ? 'text-slate-400' : 'text-slate-500'" />
                <span class="text-sm font-semibold flex-1 min-w-0 truncate"
                      :class="isDark ? 'text-slate-200' : 'text-slate-700'">{{ trigger.name }}</span>
                <span class="badge text-[9px] uppercase font-bold shrink-0"
                      :style="{ backgroundColor: triggerTypeBadge(trigger.type).bg, color: triggerTypeBadge(trigger.type).text }">
                  {{ triggerTypeBadge(trigger.type).label }}
                </span>
                <i class="pi text-[10px] transition-transform shrink-0"
                   :class="[
                     expandedConfigItems.has(trigger.id) ? 'pi-angle-up' : 'pi-angle-down',
                     isDark ? 'text-slate-500' : 'text-slate-400',
                   ]" />
              </div>
              <!-- Expanded config -->
              <div v-if="expandedConfigItems.has(trigger.id)"
                   class="px-5 pb-4 pt-1"
                   :style="{ borderTop: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
                  <div v-for="(val, key) in trigger.config" :key="key">
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">{{ key }}</div>
                    <div class="text-[12px] font-mono"
                         :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ val }}</div>
                  </div>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">Status</div>
                    <span class="badge text-[10px] font-semibold"
                          :style="{
                            backgroundColor: trigger.status === 'active' ? 'rgba(6,214,160,0.15)' : 'rgba(229,57,53,0.15)',
                            color: trigger.status === 'active' ? '#06D6A0' : '#E53935',
                          }">{{ trigger.status }}</span>
                  </div>
                </div>
                <!-- Test button -->
                <div class="mt-4 pt-3" :style="{ borderTop: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                  <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wide transition-all"
                          :style="{
                            background: 'linear-gradient(135deg, #0096C7, #0077b6)',
                            color: '#ffffff',
                            boxShadow: '0 1px 3px rgba(0,150,199,0.3)',
                          }">
                    <AppIcon name="play" :size="10" />
                    Test
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════ -->
        <!-- WATCHERS PAGE                                  -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/watchers'" class="max-w-4xl">
          <!-- Page header -->
          <div class="flex items-center gap-3 mb-6">
            <div class="w-9 h-9 rounded-lg flex items-center justify-center"
                 :style="{ backgroundColor: 'rgba(0,150,199,0.15)', color: '#0096C7' }">
              <AppIcon name="watchers" :size="16" />
            </div>
            <div>
              <h1 class="text-lg font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">Watchers</h1>
              <p class="text-[11px]" :class="isDark ? 'text-slate-500' : 'text-slate-400'">Container update monitoring sources</p>
            </div>
            <span class="badge text-[10px] font-bold ml-auto"
                  :style="{ backgroundColor: 'rgba(0,150,199,0.15)', color: '#0096C7' }">
              {{ watchersData.length }}
            </span>
          </div>

          <!-- Watcher cards -->
          <div class="space-y-3">
            <div v-for="watcher in watchersData" :key="watcher.id"
                 class="rounded-xl overflow-hidden transition-all"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <!-- Card header -->
              <div class="flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors"
                   :class="isDark ? 'hover:bg-slate-700/30' : 'hover:bg-slate-50'"
                   @click="toggleConfigItem(watcher.id)">
                <div class="w-2.5 h-2.5 rounded-full shrink-0"
                     :style="{ backgroundColor: watcherStatusColor(watcher.status) }" />
                <AppIcon name="watchers" :size="14" :class="isDark ? 'text-slate-400' : 'text-slate-500'" />
                <span class="text-sm font-semibold flex-1 min-w-0 truncate"
                      :class="isDark ? 'text-slate-200' : 'text-slate-700'">{{ watcher.name }}</span>
                <span class="badge text-[9px] uppercase font-bold shrink-0"
                      :style="{
                        backgroundColor: watcher.status === 'watching' ? 'rgba(6,214,160,0.15)' : 'rgba(255,152,0,0.15)',
                        color: watcher.status === 'watching' ? '#06D6A0' : '#FF9800',
                      }">
                  {{ watcher.status }}
                </span>
                <span v-if="watcher.config.maintenanceWindow"
                      class="badge text-[9px] uppercase font-bold shrink-0"
                      :style="{ backgroundColor: 'rgba(168,85,247,0.15)', color: '#A855F7' }">
                  Maint
                </span>
                <i class="pi text-[10px] transition-transform shrink-0"
                   :class="[
                     expandedConfigItems.has(watcher.id) ? 'pi-angle-up' : 'pi-angle-down',
                     isDark ? 'text-slate-500' : 'text-slate-400',
                   ]" />
              </div>
              <!-- Expanded config -->
              <div v-if="expandedConfigItems.has(watcher.id)"
                   class="px-5 pb-4 pt-1"
                   :style="{ borderTop: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">Cron</div>
                    <div class="text-[12px] font-mono"
                         :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ watcher.cron }}</div>
                  </div>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">Last Run</div>
                    <div class="text-[12px] font-mono"
                         :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ watcher.lastRun }}</div>
                  </div>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">Containers Watched</div>
                    <div class="text-[12px] font-mono"
                         :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ watcher.containers }}</div>
                  </div>
                  <div v-for="(val, key) in watcher.config" :key="key">
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">{{ key }}</div>
                    <div class="text-[12px] font-mono"
                         :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ val }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════ -->
        <!-- AUTH PAGE                                      -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/auth'" class="max-w-4xl">
          <!-- Page header -->
          <div class="flex items-center gap-3 mb-6">
            <div class="w-9 h-9 rounded-lg flex items-center justify-center"
                 :style="{ backgroundColor: 'rgba(0,150,199,0.15)', color: '#0096C7' }">
              <AppIcon name="auth" :size="16" />
            </div>
            <div>
              <h1 class="text-lg font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">Authentication</h1>
              <p class="text-[11px]" :class="isDark ? 'text-slate-500' : 'text-slate-400'">Authentication providers and methods</p>
            </div>
            <span class="badge text-[10px] font-bold ml-auto"
                  :style="{ backgroundColor: 'rgba(0,150,199,0.15)', color: '#0096C7' }">
              {{ authData.length }}
            </span>
          </div>

          <!-- Auth cards -->
          <div class="space-y-3">
            <div v-for="auth in authData" :key="auth.id"
                 class="rounded-xl overflow-hidden transition-all"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <!-- Card header -->
              <div class="flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors"
                   :class="isDark ? 'hover:bg-slate-700/30' : 'hover:bg-slate-50'"
                   @click="toggleConfigItem(auth.id)">
                <div class="w-2.5 h-2.5 rounded-full shrink-0"
                     :style="{ backgroundColor: auth.status === 'active' ? '#06D6A0' : '#64748b' }" />
                <AppIcon name="auth" :size="14" :class="isDark ? 'text-slate-400' : 'text-slate-500'" />
                <span class="text-sm font-semibold flex-1 min-w-0 truncate"
                      :class="isDark ? 'text-slate-200' : 'text-slate-700'">{{ auth.name }}</span>
                <span class="badge text-[9px] uppercase font-bold shrink-0"
                      :style="{ backgroundColor: authTypeBadge(auth.type).bg, color: authTypeBadge(auth.type).text }">
                  {{ authTypeBadge(auth.type).label }}
                </span>
                <i class="pi text-[10px] transition-transform shrink-0"
                   :class="[
                     expandedConfigItems.has(auth.id) ? 'pi-angle-up' : 'pi-angle-down',
                     isDark ? 'text-slate-500' : 'text-slate-400',
                   ]" />
              </div>
              <!-- Expanded config -->
              <div v-if="expandedConfigItems.has(auth.id)"
                   class="px-5 pb-4 pt-1"
                   :style="{ borderTop: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
                  <div v-for="(val, key) in auth.config" :key="key">
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">{{ key }}</div>
                    <div class="text-[12px] font-mono"
                         :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ String(val).includes('***') ? val : val }}</div>
                  </div>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                         :class="isDark ? 'text-slate-500' : 'text-slate-400'">Status</div>
                    <span class="badge text-[10px] font-semibold"
                          :style="{
                            backgroundColor: auth.status === 'active' ? 'rgba(6,214,160,0.15)' : 'rgba(100,116,139,0.15)',
                            color: auth.status === 'active' ? '#06D6A0' : '#64748b',
                          }">{{ auth.status }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════ -->
        <!-- NOTIFICATIONS PAGE                             -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/notifications'" class="max-w-4xl">
          <!-- Page header -->
          <div class="flex items-center gap-3 mb-6">
            <div class="w-9 h-9 rounded-lg flex items-center justify-center"
                 :style="{ backgroundColor: 'rgba(0,150,199,0.15)', color: '#0096C7' }">
              <AppIcon name="notifications" :size="16" />
            </div>
            <div>
              <h1 class="text-lg font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">Notifications</h1>
              <p class="text-[11px]" :class="isDark ? 'text-slate-500' : 'text-slate-400'">Configure which events fire which triggers</p>
            </div>
            <span class="badge text-[10px] font-bold ml-auto"
                  :style="{ backgroundColor: 'rgba(0,150,199,0.15)', color: '#0096C7' }">
              {{ notificationsData.length }}
            </span>
          </div>

          <!-- Notification cards -->
          <div class="space-y-3">
            <div v-for="notif in notificationsData" :key="notif.id"
                 class="rounded-xl overflow-hidden transition-all"
                 :style="{
                   backgroundColor: isDark ? '#1e293b' : '#ffffff',
                   border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
                 }">
              <div class="flex items-center gap-3 px-5 py-3.5">
                <!-- Enable/disable toggle -->
                <div class="w-8 h-4 rounded-full relative cursor-pointer shrink-0 transition-colors"
                     :style="{ backgroundColor: notif.enabled ? '#06D6A0' : (isDark ? '#334155' : '#cbd5e1') }"
                     @click="toggleNotification(notif.id)">
                  <div class="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform"
                       :style="{ left: notif.enabled ? '17px' : '2px' }" />
                </div>

                <!-- Name and description -->
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold"
                       :class="isDark ? 'text-slate-200' : 'text-slate-700'">{{ notif.name }}</div>
                  <div class="text-[11px] mt-0.5"
                       :class="isDark ? 'text-slate-500' : 'text-slate-400'">{{ notif.description }}</div>
                </div>

                <!-- Trigger badges -->
                <div class="flex flex-wrap gap-1.5 shrink-0 max-w-[260px] justify-end">
                  <span v-for="tId in notif.triggers" :key="tId"
                        class="badge text-[9px] font-semibold"
                        :style="{
                          backgroundColor: isDark ? 'rgba(148,163,184,0.1)' : 'rgba(100,116,139,0.08)',
                          color: isDark ? '#94a3b8' : '#475569',
                        }">
                    {{ triggerNameById(tId) }}
                  </span>
                  <span v-if="notif.triggers.length === 0"
                        class="text-[10px] italic"
                        :class="isDark ? 'text-slate-600' : 'text-slate-400'">
                    No triggers
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════ -->
        <!-- PROFILE PAGE                                   -->
        <!-- ═══════════════════════════════════════════════ -->
        <div v-if="activeRoute === '/profile'" class="max-w-2xl">
          <div class="rounded-xl overflow-hidden"
               :style="{
                 backgroundColor: isDark ? '#1e293b' : '#ffffff',
                 border: isDark ? '1px solid #334155' : '1px solid #e2e8f0',
               }">
            <!-- Profile header -->
            <div class="px-6 py-6 flex items-center gap-5"
                 :style="{ borderBottom: isDark ? '1px solid #334155' : '1px solid #e2e8f0' }">
              <!-- Large avatar -->
              <div class="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white shrink-0"
                   style="background: linear-gradient(135deg, #0096C7, #06D6A0);">
                SB
              </div>
              <div>
                <h1 class="text-lg font-bold" :class="isDark ? 'text-slate-100' : 'text-slate-800'">
                  {{ profileData.username }}
                </h1>
                <p class="text-[12px] mt-0.5" :class="isDark ? 'text-slate-400' : 'text-slate-500'">
                  {{ profileData.email }}
                </p>
                <span class="badge text-[10px] font-semibold mt-1.5 inline-flex"
                      :style="{ backgroundColor: 'rgba(0,150,199,0.15)', color: '#0096C7' }">
                  {{ profileData.role }}
                </span>
              </div>
            </div>

            <!-- Profile details -->
            <div class="p-6 space-y-4">
              <div class="flex items-center justify-between py-2"
                   :style="{ borderBottom: isDark ? '1px solid #1e293b' : '1px solid #f1f5f9' }">
                <span class="text-[11px] font-semibold uppercase tracking-wider"
                      :class="isDark ? 'text-slate-500' : 'text-slate-400'">Username</span>
                <span class="text-[12px] font-medium font-mono"
                      :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ profileData.username }}</span>
              </div>
              <div class="flex items-center justify-between py-2"
                   :style="{ borderBottom: isDark ? '1px solid #1e293b' : '1px solid #f1f5f9' }">
                <span class="text-[11px] font-semibold uppercase tracking-wider"
                      :class="isDark ? 'text-slate-500' : 'text-slate-400'">Email</span>
                <span class="text-[12px] font-medium font-mono"
                      :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ profileData.email }}</span>
              </div>
              <div class="flex items-center justify-between py-2"
                   :style="{ borderBottom: isDark ? '1px solid #1e293b' : '1px solid #f1f5f9' }">
                <span class="text-[11px] font-semibold uppercase tracking-wider"
                      :class="isDark ? 'text-slate-500' : 'text-slate-400'">Role</span>
                <span class="text-[12px] font-medium font-mono"
                      :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ profileData.role }}</span>
              </div>
              <div class="flex items-center justify-between py-2"
                   :style="{ borderBottom: isDark ? '1px solid #1e293b' : '1px solid #f1f5f9' }">
                <span class="text-[11px] font-semibold uppercase tracking-wider"
                      :class="isDark ? 'text-slate-500' : 'text-slate-400'">Last Login</span>
                <span class="text-[12px] font-medium font-mono"
                      :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ profileData.lastLogin }}</span>
              </div>
              <div class="flex items-center justify-between py-2"
                   :style="{ borderBottom: isDark ? '1px solid #1e293b' : '1px solid #f1f5f9' }">
                <span class="text-[11px] font-semibold uppercase tracking-wider"
                      :class="isDark ? 'text-slate-500' : 'text-slate-400'">Active Sessions</span>
                <span class="text-[12px] font-medium font-mono"
                      :class="isDark ? 'text-slate-300' : 'text-slate-600'">{{ profileData.sessions }}</span>
              </div>
            </div>

            <!-- Sign Out -->
            <div class="px-6 pb-6">
              <button class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-bold transition-colors"
                      :style="{
                        backgroundColor: isDark ? 'rgba(229,57,53,0.12)' : 'rgba(229,57,53,0.08)',
                        color: '#E53935',
                        border: isDark ? '1px solid rgba(229,57,53,0.25)' : '1px solid rgba(229,57,53,0.2)',
                      }">
                <AppIcon name="sign-out" :size="12" />
                Sign Out
              </button>
            </div>
          </div>
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
