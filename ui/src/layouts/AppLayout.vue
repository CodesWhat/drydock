<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import whaleLogo from '@/assets/whale-logo.png';
import { useBreakpoints } from '@/composables/useBreakpoints';
import { useIcons } from '@/composables/useIcons';
import { getAgents } from '@/services/agent';
import { getAllAuthentications } from '@/services/authentication';
import { getUser, logout } from '@/services/auth';
import { getAllContainers } from '@/services/container';
import { getEffectiveDisplayIcon } from '@/services/image-icon';
import { getAllNotificationRules } from '@/services/notification';
import { getAllRegistries } from '@/services/registry';
import sseService from '@/services/sse';
import { getAllTriggers } from '@/services/trigger';
import { getAllWatchers } from '@/services/watcher';
import { useTheme } from '@/theme/useTheme';

const router = useRouter();
const route = useRoute();
const { icon } = useIcons();
const { isDark } = useTheme();
const { isMobile, windowNarrow } = useBreakpoints();

const sidebarCollapsed = ref(false);
const isMobileMenuOpen = ref(false);
const isCollapsed = computed(() => sidebarCollapsed.value && !isMobile.value);

// Dynamic badge data
const containerCount = ref('');
const securityIssueCount = ref('');
const currentUser = ref<{ username?: string; displayName?: string } | null>(null);
const userInitials = computed(() => {
  const name = currentUser.value?.displayName || currentUser.value?.username || 'U';
  return name.slice(0, 2).toUpperCase();
});

watch(isMobile, (val) => {
  if (!val) isMobileMenuOpen.value = false;
});

// Close mobile menu on any route change (safety net for non-sidebar navigation)
watch(() => route.path, () => {
  if (isMobile.value) isMobileMenuOpen.value = false;
});

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
interface SearchContainerIndexItem {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  image: string;
  status: string;
  host: string;
}
interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  containerIcon?: string;
  route: string;
  query?: Record<string, string>;
  kind:
    | 'page'
    | 'setting'
    | 'container'
    | 'agent'
    | 'trigger'
    | 'watcher'
    | 'registry'
    | 'auth'
    | 'notification';
  searchable: string;
}

const navGroups = computed<NavGroup[]>(() => [
  {
    label: '',
    items: [
      { label: 'Dashboard', icon: 'dashboard', route: '/' },
      {
        label: 'Containers',
        icon: 'containers',
        route: '/containers',
        badge: containerCount.value || undefined,
        badgeColor: 'blue',
      },
      {
        label: 'Security',
        icon: 'security',
        route: '/security',
        badge: securityIssueCount.value || undefined,
        badgeColor: 'red',
      },
      { label: 'Audit', icon: 'audit', route: '/audit' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { label: 'Hosts', icon: 'servers', route: '/servers' },
      { label: 'Registries', icon: 'registries', route: '/registries' },
      { label: 'Watchers', icon: 'watchers', route: '/watchers' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'General', icon: 'config', route: '/config' },
      { label: 'Notifications', icon: 'notifications', route: '/notifications' },
      { label: 'Triggers', icon: 'triggers', route: '/triggers' },
      { label: 'Auth', icon: 'auth', route: '/auth' },
      { label: 'Agents', icon: 'agents', route: '/agents' },
      { label: 'Playground', icon: 'containers', route: '/playground' },
    ],
  },
]);

const hiddenPages: Record<string, { label: string; icon: string }> = {};

const currentPageLabel = computed(() => {
  for (const group of navGroups.value) {
    for (const item of group.items) {
      if (item.route === route.path) return item.label;
    }
  }
  return hiddenPages[route.path]?.label ?? 'Dashboard';
});

const currentPageIcon = computed(() => {
  for (const group of navGroups.value) {
    for (const item of group.items) {
      if (item.route === route.path) return item.icon;
    }
  }
  return hiddenPages[route.path]?.icon ?? 'dashboard';
});

function navigateTo(navRoute: string) {
  router.push(navRoute);
  if (isMobile.value) isMobileMenuOpen.value = false;
}

const staticSearchResults = computed<SearchResultItem[]>(() => {
  const pageResults: SearchResultItem[] = navGroups.value.flatMap((group) =>
    group.items.map((item) => ({
      id: `page:${item.route}`,
      title: item.label,
      subtitle: `Page · ${item.route}`,
      icon: item.icon,
      route: item.route,
      kind: 'page',
      searchable: `${item.label} ${item.route} ${group.label}`.toLowerCase(),
    })),
  );

  const settingsResults: SearchResultItem[] = [
    {
      id: 'settings:appearance',
      title: 'Appearance Settings',
      subtitle: 'Config · Appearance',
      icon: 'config',
      route: '/config',
      query: { tab: 'appearance' },
      kind: 'setting',
      searchable: 'appearance settings config theme color font icon library',
    },
    {
      id: 'settings:profile',
      title: 'Profile Settings',
      subtitle: 'Config · Profile',
      icon: 'user',
      route: '/config',
      query: { tab: 'profile' },
      kind: 'setting',
      searchable: 'profile settings config account user',
    },
    {
      id: 'settings:logs',
      title: 'Application Logs',
      subtitle: 'Config · Logs',
      icon: 'logs',
      route: '/config',
      query: { tab: 'logs' },
      kind: 'setting',
      searchable: 'logs application logs config troubleshooting',
    },
  ];

  return [...pageResults, ...settingsResults];
});

// User menu
const showUserMenu = ref(false);
function toggleUserMenu() {
  showUserMenu.value = !showUserMenu.value;
}
function handleUserMenuClickOutside(e: PointerEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('.user-menu-wrapper')) showUserMenu.value = false;
}
onMounted(() => document.addEventListener('pointerdown', handleUserMenuClickOutside));
onUnmounted(() => document.removeEventListener('pointerdown', handleUserMenuClickOutside));
async function handleSignOut() {
  showUserMenu.value = false;
  try {
    await logout();
  } finally {
    router.push('/login');
  }
}

// About modal
const showAbout = ref(false);

// Search modal
const showSearch = ref(false);
const searchQuery = ref('');
const searchInput = ref<HTMLInputElement | null>(null);
const searchActiveIndex = ref(0);
const searchContainers = ref<SearchContainerIndexItem[]>([]);
const searchResourceResults = ref<SearchResultItem[]>([]);
const searchResourcesLoading = ref(false);
type SearchScope = 'all' | 'pages' | 'containers' | 'runtime' | 'config';
type SearchPrefix = '/' | '@' | '#';
interface SearchScopeOption {
  id: SearchScope;
  label: string;
  kinds: SearchResultItem['kind'][];
}
interface SearchGroupDefinition {
  id: string;
  label: string;
  kinds: SearchResultItem['kind'][];
}
interface SearchResultGroup {
  id: string;
  label: string;
  items: SearchResultItem[];
}
interface ParsedSearchQuery {
  text: string;
  scopeOverride?: SearchScope;
  prefix?: SearchPrefix;
}

const SEARCH_SCOPE_OPTIONS: SearchScopeOption[] = [
  { id: 'all', label: 'All', kinds: [] },
  { id: 'pages', label: 'Pages', kinds: ['page', 'setting'] },
  { id: 'containers', label: 'Containers', kinds: ['container'] },
  { id: 'runtime', label: 'Runtime', kinds: ['agent', 'trigger', 'watcher'] },
  {
    id: 'config',
    label: 'Config',
    kinds: ['registry', 'auth', 'notification'],
  },
];

const SEARCH_GROUP_DEFINITIONS: SearchGroupDefinition[] = [
  { id: 'navigation', label: 'Navigation', kinds: ['page', 'setting'] },
  { id: 'containers', label: 'Containers', kinds: ['container'] },
  { id: 'runtime', label: 'Runtime', kinds: ['agent', 'trigger', 'watcher'] },
  {
    id: 'configuration',
    label: 'Configuration',
    kinds: ['registry', 'auth', 'notification'],
  },
];

const SEARCH_RECENT_STORAGE_KEY = 'dd-cmdk-recent-v1';
const SEARCH_RECENT_MAX_ITEMS = 8;
const SEARCH_SCOPE_ORDER: SearchScope[] = SEARCH_SCOPE_OPTIONS.map((option) => option.id);
const EMPTY_QUERY_GROUP_LIMIT = 4;
const searchScope = ref<SearchScope>('all');

function scopeFromSearchPrefix(prefix: string): SearchScope | undefined {
  if (prefix === '/') return 'pages';
  if (prefix === '@') return 'runtime';
  if (prefix === '#') return 'config';
  return undefined;
}

function parseSearchQuery(rawQuery: string): ParsedSearchQuery {
  const trimmedStart = rawQuery.trimStart();
  if (!trimmedStart) {
    return { text: '' };
  }
  const prefixCandidate = trimmedStart.charAt(0);
  const scopeOverride = scopeFromSearchPrefix(prefixCandidate);
  if (!scopeOverride) {
    return { text: trimmedStart.trim() };
  }
  return {
    text: trimmedStart.slice(1).trim(),
    scopeOverride,
    prefix: prefixCandidate as SearchPrefix,
  };
}

function normalizeSearchValue(value: unknown): string {
  return `${value ?? ''}`.trim();
}

function loadRecentSearchResults(): SearchResultItem[] {
  try {
    const raw = localStorage.getItem(SEARCH_RECENT_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is SearchResultItem => {
        return (
          item &&
          typeof item === 'object' &&
          typeof item.id === 'string' &&
          typeof item.title === 'string' &&
          typeof item.subtitle === 'string' &&
          typeof item.icon === 'string' &&
          typeof item.route === 'string' &&
          typeof item.kind === 'string'
        );
      })
      .slice(0, SEARCH_RECENT_MAX_ITEMS);
  } catch {
    return [];
  }
}

function saveRecentSearchResults(items: SearchResultItem[]) {
  try {
    localStorage.setItem(SEARCH_RECENT_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage errors.
  }
}

const recentSearchResults = ref<SearchResultItem[]>(loadRecentSearchResults());

function recordRecentSearchResult(result: SearchResultItem) {
  const nextResults = [
    { ...result },
    ...recentSearchResults.value.filter((item) => item.id !== result.id),
  ].slice(0, SEARCH_RECENT_MAX_ITEMS);
  recentSearchResults.value = nextResults;
  saveRecentSearchResults(nextResults);
}

const containerSearchResults = computed<SearchResultItem[]>(() =>
  searchContainers.value.map((container) => ({
    id: `container:${container.id}`,
    title: container.displayName,
    subtitle: `Container · ${container.image} · ${container.status} · ${container.host}`,
    icon: 'containers',
    containerIcon: container.icon,
    route: '/containers',
    query: { q: container.displayName },
    kind: 'container',
    searchable: `${container.displayName} ${container.name} ${container.image} ${container.status} ${container.host}`.toLowerCase(),
  })),
);

function isSearchResultInScope(result: SearchResultItem, scope: SearchScope): boolean {
  if (scope === 'all') {
    return true;
  }
  const scopeOption = SEARCH_SCOPE_OPTIONS.find((option) => option.id === scope);
  if (!scopeOption) {
    return true;
  }
  return scopeOption.kinds.includes(result.kind);
}

function searchScopeChipStyles(scope: SearchScope, active: boolean) {
  if (active) {
    return {
      backgroundColor: 'var(--dd-primary-muted)',
      borderColor: 'var(--dd-primary)',
      color: 'var(--dd-primary)',
    };
  }
  if (scope === 'all') {
    return {
      backgroundColor: 'var(--dd-bg-elevated)',
      borderColor: 'var(--dd-border-strong)',
      color: 'var(--dd-text-secondary)',
    };
  }
  return {
    backgroundColor: 'var(--dd-bg-card)',
    borderColor: 'var(--dd-border)',
    color: 'var(--dd-text-muted)',
  };
}

function buildSearchIndexResults(
  resources: {
    agents?: unknown;
    triggers?: unknown;
    watchers?: unknown;
    registries?: unknown;
    authentications?: unknown;
    notificationRules?: unknown;
  },
): SearchResultItem[] {
  const results: SearchResultItem[] = [];

  const agents = Array.isArray(resources.agents) ? resources.agents : [];
  agents.forEach((agent: any) => {
    const name = normalizeSearchValue(agent.name || agent.id || 'agent');
    const host = normalizeSearchValue(agent.host);
    const port = normalizeSearchValue(agent.port);
    const hostLabel = host ? `${host}${port ? `:${port}` : ''}` : 'unknown host';
    const status = agent.connected ? 'connected' : 'disconnected';
    results.push({
      id: `agent:${name}`,
      title: name,
      subtitle: `Agent · ${status} · ${hostLabel}`,
      icon: 'agents',
      route: '/agents',
      query: { q: name },
      kind: 'agent',
      searchable: `${name} ${hostLabel} ${status} agent`.toLowerCase(),
    });
  });

  const triggers = Array.isArray(resources.triggers) ? resources.triggers : [];
  triggers.forEach((trigger: any) => {
    const name = normalizeSearchValue(trigger.name || trigger.id || 'trigger');
    const type = normalizeSearchValue(trigger.type || 'unknown');
    const id = normalizeSearchValue(trigger.id || `${type}.${name}`);
    results.push({
      id: `trigger:${id}`,
      title: name,
      subtitle: `Trigger · ${type}`,
      icon: 'triggers',
      route: '/triggers',
      query: { q: name },
      kind: 'trigger',
      searchable: `${name} ${id} ${type} trigger`.toLowerCase(),
    });
  });

  const watchers = Array.isArray(resources.watchers) ? resources.watchers : [];
  watchers.forEach((watcher: any) => {
    const name = normalizeSearchValue(watcher.name || watcher.id || 'watcher');
    const type = normalizeSearchValue(watcher.type || 'unknown');
    const id = normalizeSearchValue(watcher.id || `${type}.${name}`);
    results.push({
      id: `watcher:${id}`,
      title: name,
      subtitle: `Watcher · ${type}`,
      icon: 'watchers',
      route: '/watchers',
      query: { q: name },
      kind: 'watcher',
      searchable: `${name} ${id} ${type} watcher`.toLowerCase(),
    });
  });

  const registries = Array.isArray(resources.registries) ? resources.registries : [];
  registries.forEach((registry: any) => {
    const name = normalizeSearchValue(registry.name || registry.id || 'registry');
    const type = normalizeSearchValue(registry.type || 'unknown');
    const id = normalizeSearchValue(registry.id || `${type}.${name}`);
    results.push({
      id: `registry:${id}`,
      title: name,
      subtitle: `Registry · ${type}`,
      icon: 'registries',
      route: '/registries',
      query: { q: name },
      kind: 'registry',
      searchable: `${name} ${id} ${type} registry`.toLowerCase(),
    });
  });

  const authentications = Array.isArray(resources.authentications) ? resources.authentications : [];
  authentications.forEach((authentication: any) => {
    const name = normalizeSearchValue(authentication.name || authentication.id || 'authentication');
    const type = normalizeSearchValue(authentication.type || 'unknown');
    const id = normalizeSearchValue(authentication.id || `${type}.${name}`);
    results.push({
      id: `auth:${id}`,
      title: name,
      subtitle: `Auth · ${type}`,
      icon: 'auth',
      route: '/auth',
      query: { q: name },
      kind: 'auth',
      searchable: `${name} ${id} ${type} auth authentication`.toLowerCase(),
    });
  });

  const notificationRules = Array.isArray(resources.notificationRules)
    ? resources.notificationRules
    : [];
  notificationRules.forEach((rule: any) => {
    const name = normalizeSearchValue(rule.name || rule.id || 'notification');
    const id = normalizeSearchValue(rule.id || name);
    results.push({
      id: `notification:${id}`,
      title: name,
      subtitle: `Notification rule · ${id}`,
      icon: 'notifications',
      route: '/notifications',
      query: { q: name },
      kind: 'notification',
      searchable: `${name} ${id} notification rule alerts`.toLowerCase(),
    });
  });

  return results;
}

async function refreshSearchResources() {
  searchResourcesLoading.value = true;
  try {
    const [agents, triggers, watchers, registries, authentications, notificationRules] =
      await Promise.all([
        getAgents().catch(() => []),
        getAllTriggers().catch(() => []),
        getAllWatchers().catch(() => []),
        getAllRegistries().catch(() => []),
        getAllAuthentications().catch(() => []),
        getAllNotificationRules().catch(() => []),
      ]);
    searchResourceResults.value = buildSearchIndexResults({
      agents,
      triggers,
      watchers,
      registries,
      authentications,
      notificationRules,
    });
  } finally {
    searchResourcesLoading.value = false;
  }
}

const allSearchResults = computed<SearchResultItem[]>(() => [
  ...staticSearchResults.value,
  ...searchResourceResults.value,
  ...containerSearchResults.value,
]);

const parsedSearchQuery = computed<ParsedSearchQuery>(() => parseSearchQuery(searchQuery.value));
const effectiveSearchScope = computed<SearchScope>(
  () => parsedSearchQuery.value.scopeOverride || searchScope.value,
);

const scopePrefixLabel = computed(() => {
  if (parsedSearchQuery.value.scopeOverride === 'pages') return '/ pages';
  if (parsedSearchQuery.value.scopeOverride === 'runtime') return '@ runtime';
  if (parsedSearchQuery.value.scopeOverride === 'config') return '# config';
  return '';
});

const searchResultById = computed(() => {
  const map = new Map<string, SearchResultItem>();
  allSearchResults.value.forEach((result) => {
    map.set(result.id, result);
  });
  return map;
});

const hydratedRecentSearchResults = computed<SearchResultItem[]>(() =>
  recentSearchResults.value.map((result) => searchResultById.value.get(result.id) || result),
);

const scopedRecentSearchResults = computed<SearchResultItem[]>(() =>
  hydratedRecentSearchResults.value
    .filter((result) => isSearchResultInScope(result, effectiveSearchScope.value))
    .slice(0, 5),
);

function scoreSearchResult(result: SearchResultItem, queryNormalized: string): number {
  if (!queryNormalized) {
    return result.kind === 'page' || result.kind === 'setting' ? 110 : 80;
  }
  const title = result.title.toLowerCase();
  const subtitle = result.subtitle.toLowerCase();

  if (title === queryNormalized) {
    return 120;
  }
  if (title.startsWith(queryNormalized)) {
    return 110;
  }
  if (title.includes(queryNormalized)) {
    return 95;
  }
  if (subtitle.includes(queryNormalized)) {
    return 80;
  }
  if (result.searchable.includes(queryNormalized)) {
    return 60;
  }
  return -1;
}

const rankedSearchResults = computed<SearchResultItem[]>(() => {
  const queryNormalized = parsedSearchQuery.value.text.toLowerCase();
  return allSearchResults.value
    .map((result) => ({ result, score: scoreSearchResult(result, queryNormalized) }))
    .filter(({ score }) => score >= 0)
    .sort((left, right) => right.score - left.score || left.result.title.localeCompare(right.result.title))
    .map(({ result }) => result);
});

const searchScopeCounts = computed<Record<SearchScope, number>>(() => {
  const counts: Record<SearchScope, number> = {
    all: rankedSearchResults.value.length,
    pages: 0,
    containers: 0,
    runtime: 0,
    config: 0,
  };

  rankedSearchResults.value.forEach((result) => {
    if (isSearchResultInScope(result, 'pages')) counts.pages += 1;
    if (isSearchResultInScope(result, 'containers')) counts.containers += 1;
    if (isSearchResultInScope(result, 'runtime')) counts.runtime += 1;
    if (isSearchResultInScope(result, 'config')) counts.config += 1;
  });

  return counts;
});

const scopedSearchResults = computed<SearchResultItem[]>(() =>
  rankedSearchResults.value.filter((result) => isSearchResultInScope(result, effectiveSearchScope.value)),
);

const groupedSearchResults = computed<SearchResultGroup[]>(() => {
  const groups: SearchResultGroup[] = [];
  const queryNormalized = parsedSearchQuery.value.text.toLowerCase();
  const seenResultIds = new Set<string>();

  if (!queryNormalized) {
    const recentItems = scopedRecentSearchResults.value.filter((result) => {
      if (seenResultIds.has(result.id)) {
        return false;
      }
      seenResultIds.add(result.id);
      return true;
    });
    if (recentItems.length > 0) {
      groups.push({
        id: 'recent',
        label: 'Recent',
        items: recentItems,
      });
    }
  }

  const baseResults = scopedSearchResults.value.filter((result) => !seenResultIds.has(result.id));

  if (queryNormalized) {
    const limitedResults = baseResults.slice(0, 24);
    SEARCH_GROUP_DEFINITIONS.forEach((groupDefinition) => {
      const groupItems = limitedResults.filter((result) =>
        groupDefinition.kinds.includes(result.kind),
      );
      if (groupItems.length > 0) {
        groups.push({
          id: groupDefinition.id,
          label: groupDefinition.label,
          items: groupItems,
        });
      }
    });
    return groups;
  }

  SEARCH_GROUP_DEFINITIONS.forEach((groupDefinition) => {
    const groupItems = baseResults
      .filter((result) => groupDefinition.kinds.includes(result.kind))
      .slice(0, EMPTY_QUERY_GROUP_LIMIT);
    if (groupItems.length > 0) {
      groups.push({
        id: groupDefinition.id,
        label: groupDefinition.label,
        items: groupItems,
      });
    }
  });

  return groups;
});

const searchResults = computed<SearchResultItem[]>(() =>
  groupedSearchResults.value.flatMap((group) => group.items),
);

const searchResultIndexById = computed(() => {
  const indexMap = new Map<string, number>();
  searchResults.value.forEach((result, index) => {
    indexMap.set(result.id, index);
  });
  return indexMap;
});

function isSearchResultActive(resultId: string): boolean {
  return searchResultIndexById.value.get(resultId) === searchActiveIndex.value;
}

function setActiveSearchResult(resultId: string) {
  const index = searchResultIndexById.value.get(resultId);
  if (index !== undefined) {
    searchActiveIndex.value = index;
  }
}

watch(searchResults, (results) => {
  if (results.length === 0) {
    searchActiveIndex.value = 0;
    return;
  }
  if (searchActiveIndex.value >= results.length) {
    searchActiveIndex.value = results.length - 1;
  }
});

function moveSearchSelection(offset: number) {
  if (searchResults.value.length === 0) {
    return;
  }
  const next = searchActiveIndex.value + offset;
  if (next < 0) {
    searchActiveIndex.value = searchResults.value.length - 1;
    return;
  }
  searchActiveIndex.value = next % searchResults.value.length;
}

function applySearchScope(nextScope: SearchScope) {
  searchScope.value = nextScope;
  if (parsedSearchQuery.value.scopeOverride) {
    searchQuery.value = parsedSearchQuery.value.text;
  }
}

async function selectSearchResult(result: SearchResultItem | undefined) {
  if (!result) {
    return;
  }
  recordRecentSearchResult(result);
  showSearch.value = false;
  await router.push({
    path: result.route,
    query: result.query || undefined,
  });
}

function cycleSearchScope(step = 1) {
  const currentIndex = SEARCH_SCOPE_ORDER.indexOf(effectiveSearchScope.value);
  const startIndex = currentIndex >= 0 ? currentIndex : 0;
  const totalScopes = SEARCH_SCOPE_ORDER.length;
  const nextIndex = (startIndex + step + totalScopes) % totalScopes;
  applySearchScope(SEARCH_SCOPE_ORDER[nextIndex]);
}

function handleSearchInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    event.preventDefault();
    cycleSearchScope(event.shiftKey ? -1 : 1);
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSearchSelection(1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSearchSelection(-1);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    void selectSearchResult(searchResults.value[searchActiveIndex.value]);
  }
}

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
    searchScope.value = 'all';
    searchActiveIndex.value = 0;
    void refreshSidebarData();
    void refreshSearchResources();
    await nextTick();
    searchInput.value?.focus();
  } else {
    searchActiveIndex.value = 0;
  }
});

// Server connectivity monitor
const connectionLost = ref(false);
const selfUpdateInProgress = ref(false);
let connectivityTimer: ReturnType<typeof setInterval> | undefined;
const sidebarDataLoading = ref(false);

async function checkConnectivity() {
  try {
    const res = await fetch('/auth/user', { credentials: 'include', redirect: 'manual' });
    if (connectionLost.value && (res.ok || res.status === 401)) {
      // Server is back — redirect to login (session likely expired)
      connectionLost.value = false;
      clearInterval(connectivityTimer);
      router.push('/login');
    }
  } catch {
    // Network error — server is unreachable
    connectionLost.value = true;
  }
}

const connectionOverlayTitle = computed(() =>
  selfUpdateInProgress.value ? 'Applying Update' : 'Connection Lost',
);
const connectionOverlayMessage = computed(() =>
  selfUpdateInProgress.value
    ? 'Drydock is restarting after a self-update. Reconnecting when the service is back...'
    : 'The server is unreachable. Waiting for it to come back online...',
);
const connectionOverlayStatus = computed(() =>
  selfUpdateInProgress.value ? 'Restarting service' : 'Reconnecting',
);

async function refreshSidebarData() {
  sidebarDataLoading.value = true;
  try {
    const containers = await getAllContainers().catch(() => []);
    if (!Array.isArray(containers)) {
      searchContainers.value = [];
      return;
    }
    containerCount.value = String(containers.length);
    searchContainers.value = containers.map((container: Record<string, any>) => {
      const displayName = String(container.displayName || container.name || container.id || 'container');
      const displayIcon = String(container.displayIcon || '');
      const imageName = String(container.image?.name || '');
      const imageTag = String(container.image?.tag?.value || '');
      const image = imageName ? `${imageName}${imageTag ? `:${imageTag}` : ''}` : 'unknown image';
      return {
        id: String(container.id || displayName),
        name: String(container.name || displayName),
        displayName,
        icon: getEffectiveDisplayIcon(displayIcon, imageName),
        image,
        status: String(container.status || 'unknown'),
        host: String(container.agent || container.watcher || 'local'),
      };
    });
    const issues = containers.filter((c: Record<string, any>) => {
      const summary = c.security?.scan?.summary;
      return Number(summary?.critical || 0) > 0 || Number(summary?.high || 0) > 0;
    }).length;
    securityIssueCount.value = issues > 0 ? String(issues) : '';
  } catch {
    // Sidebar works without badge data
  } finally {
    sidebarDataLoading.value = false;
  }
}

function emitUiSseEvent(name: string) {
  globalThis.dispatchEvent(new CustomEvent(name));
}

function handleSseEvent(event: string) {
  if (event === 'sse:connected') {
    connectionLost.value = false;
    selfUpdateInProgress.value = false;
    emitUiSseEvent('dd:sse-connected');
    return;
  }
  if (event === 'self-update') {
    selfUpdateInProgress.value = true;
    connectionLost.value = true;
    emitUiSseEvent('dd:sse-self-update');
    return;
  }
  if (event === 'scan-started') {
    emitUiSseEvent('dd:sse-scan-started');
    return;
  }
  if (event === 'scan-completed') {
    emitUiSseEvent('dd:sse-scan-completed');
    refreshSidebarData();
    return;
  }
  if (event === 'connection-lost') {
    connectionLost.value = true;
  }
}

onMounted(async () => {
  globalThis.addEventListener('keydown', handleKeydown);
  sseService.connect({
    emit: (event) => handleSseEvent(event),
  });
  // Start connectivity polling (every 10s)
  connectivityTimer = setInterval(checkConnectivity, 10_000);
  // Fetch sidebar badge data and user info
  try {
    const [, , user] = await Promise.all([
      refreshSidebarData(),
      refreshSearchResources(),
      getUser().catch(() => null),
    ]);
    if (user) currentUser.value = user;
  } catch {
    // Sidebar works without badge data
  }
});
onUnmounted(() => {
  globalThis.removeEventListener('keydown', handleKeydown);
  if (connectivityTimer) clearInterval(connectivityTimer);
  sseService.disconnect();
});
</script>

<template>
  <div :class="[isDark ? 'dark' : 'light']"
       class="h-screen flex overflow-hidden font-mono"
       :style="{ background: 'var(--dd-bg)' }">

    <!-- Mobile overlay -->
    <div v-if="isMobileMenuOpen && isMobile"
         class="sidebar-overlay fixed inset-0 bg-black/60 z-40"
         @click="isMobileMenuOpen = false" />

    <!-- SIDEBAR -->
    <aside
      :class="[
        'sidebar-transition flex flex-col z-50 h-full',
        isMobile ? 'fixed top-0 left-0' : 'relative',
        isMobile && !isMobileMenuOpen ? '-translate-x-full' : 'translate-x-0',
        isCollapsed ? 'sidebar-collapsed' : '',
      ]"
      :style="{
        width: isCollapsed ? '56px' : '240px',
        minWidth: isCollapsed ? '56px' : '240px',
        backgroundColor: 'var(--dd-bg-sidebar)',
        borderRight: '1px solid var(--dd-border)',
        overflowX: 'hidden',
      }">

      <!-- Logo -->
      <div class="flex items-center justify-between h-12 shrink-0 overflow-hidden"
           :class="isCollapsed ? 'justify-center px-1' : 'px-3'"
           :style="{ borderBottom: '1px solid var(--dd-border)' }">
        <div class="flex items-center gap-2 overflow-hidden shrink-0">
          <img :src="whaleLogo" alt="Drydock"
               class="h-5 w-auto shrink-0 transition-transform duration-300"
               :style="[isCollapsed ? { transform: 'scaleX(-1)' } : {}, isDark ? { filter: 'invert(1)' } : {}]" />
          <span class="sidebar-label font-bold text-sm tracking-widest dd-text"
                style="letter-spacing:0.15em;">DRYDOCK</span>
        </div>
        <button v-if="isMobile"
                class="p-1 dd-text-muted hover:dd-text transition-colors"
                @click="isMobileMenuOpen = false">
          <AppIcon name="close" :size="14" />
        </button>
      </div>

      <!-- Nav groups -->
      <nav class="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-4">
        <div v-for="group in navGroups" :key="group.label">
          <div v-if="group.label && !isCollapsed"
               class="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider dd-text-muted">
            {{ group.label }}
          </div>
          <div v-else-if="group.label" class="flex justify-center py-1 w-9 mx-auto">
            <div class="w-1 h-1 rounded-full dd-bg-elevated" />
          </div>

          <div v-for="item in group.items" :key="item.route"
               class="nav-item-wrapper relative mt-0.5"
               @click="navigateTo(item.route)">
            <div
              class="nav-item flex items-center gap-3 dd-rounded cursor-pointer relative"
              :class="[
                route.path === item.route
                  ? 'bg-drydock-secondary/10 dark:bg-drydock-secondary/15 text-drydock-secondary'
                  : 'dd-text-secondary hover:dd-bg-elevated hover:dd-text',
              ]"
              style="padding: 6px 12px;">
              <div v-if="route.path === item.route"
                   class="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-drydock-secondary"
                   style="height: 20px;" />
              <AppIcon :name="item.icon" :size="16" class="shrink-0" style="width:20px; text-align:center;" />
              <span class="sidebar-label text-[13px] font-medium">{{ item.label }}</span>
              <span v-if="item.badge && !isCollapsed"
                    class="sidebar-label ml-auto badge text-[10px]"
                    :style="{
                      backgroundColor: item.badgeColor === 'red'
                        ? 'var(--dd-danger-muted)'
                        : 'var(--dd-warning-muted)',
                      color: item.badgeColor === 'red' ? 'var(--dd-danger)' : 'var(--dd-warning)',
                    }">
                {{ item.badge }}
              </span>
            </div>
            <div class="nav-tooltip text-xs font-medium"
                 :style="{
                   backgroundColor: 'var(--dd-bg-card)',
                   color: 'var(--dd-text)',
                   boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                 }">
              {{ item.label }}
            </div>
          </div>
        </div>
      </nav>

      <!-- Sidebar search -->
      <div class="shrink-0 px-3 pt-3 pb-3">
        <button class="w-full flex items-center gap-2 dd-rounded px-3 py-2 text-xs transition-colors dd-bg-card dd-text-secondary hover:dd-bg-elevated hover:dd-text"
                :style="{ border: '1px solid var(--dd-border)' }"
                @click="showSearch = true; isMobileMenuOpen = false">
          <AppIcon name="search" :size="12" />
          <span class="sidebar-label">Search</span>
          <kbd class="sidebar-label ml-auto px-1.5 py-0.5 dd-rounded-sm text-[10px] font-medium dd-bg-elevated dd-text-muted">
            <span class="text-[9px]">&#8984;</span>K
          </kbd>
        </button>
      </div>

      <!-- Sidebar footer -->
      <div class="shrink-0 px-3 py-2.5 flex items-center gap-1"
           :class="isCollapsed ? 'flex-col' : 'flex-row justify-between'"
           :style="{ borderTop: '1px solid var(--dd-border)' }">
        <button class="flex items-center justify-center w-7 h-7 dd-rounded text-xs transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                title="About Drydock"
                @click="showAbout = true">
          <AppIcon name="info" :size="14" />
        </button>
        <button v-if="!isMobile"
                class="flex items-center justify-center w-7 h-7 dd-rounded text-xs transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
                @click="sidebarCollapsed = !sidebarCollapsed">
          <AppIcon :name="sidebarCollapsed ? 'sidebar-expand' : 'sidebar-collapse'" :size="14" />
        </button>
      </div>
    </aside>

    <!-- MAIN AREA -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">

      <!-- TOP BAR -->
      <header class="h-12 grid items-center px-4 shrink-0"
              style="grid-template-columns: 1fr auto 1fr;"
              :style="{
                backgroundColor: 'var(--dd-bg)',
                borderBottom: '1px solid var(--dd-border)',
              }">
        <!-- Left: hamburger + breadcrumb -->
        <div class="flex items-center gap-3">
          <button v-if="isMobile"
                  class="flex flex-col items-center justify-center w-8 h-8 gap-1 rounded-md transition-colors hover:dd-bg-elevated"
                  @click="isMobileMenuOpen = !isMobileMenuOpen">
            <span class="hamburger-line block w-4 h-[2px] rounded-full" style="background: var(--dd-text-muted)" />
            <span class="hamburger-line block w-4 h-[2px] rounded-full" style="background: var(--dd-text-muted)" />
            <span class="hamburger-line block w-4 h-[2px] rounded-full" style="background: var(--dd-text-muted)" />
          </button>

          <nav class="flex items-center gap-1.5 text-[13px]">
            <AppIcon :name="currentPageIcon" :size="16" class="leading-none dd-text-muted" />
            <AppIcon name="chevron-right" :size="13" class="leading-none dd-text-muted" />
            <span class="font-medium leading-none dd-text">
              {{ currentPageLabel }}
            </span>
          </nav>
        </div>

        <!-- Center spacer (search moved to sidebar) -->
        <div />

        <!-- Right: theme, notifications, avatar -->
        <div class="flex items-center gap-2 justify-end">
          <ThemeToggle />

          <button class="relative flex items-center justify-center w-8 h-8 dd-rounded transition-colors dd-text-secondary hover:dd-bg-elevated hover:dd-text">
            <AppIcon name="notifications" :size="18" />
            <span v-if="securityIssueCount" class="badge-pulse absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-bold text-white"
                  style="background:var(--dd-danger);">{{ securityIssueCount }}</span>
          </button>

          <div class="relative user-menu-wrapper">
            <button class="flex items-center gap-2 dd-rounded px-1.5 py-1 transition-colors hover:dd-bg-elevated"
                    @click="toggleUserMenu">
              <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                   style="background: linear-gradient(135deg, var(--dd-primary), var(--dd-success));">
                {{ userInitials }}
              </div>
              <AppIcon name="chevron-down" :size="12" class="dd-text-muted" />
            </button>
            <Transition name="menu-fade">
              <div v-if="showUserMenu"
                   class="absolute right-0 top-full mt-1 min-w-[160px] py-1 dd-rounded-lg shadow-lg z-50"
                   :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)', boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }">
                <div class="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider dd-text-muted"
                     :style="{ borderBottom: '1px solid var(--dd-border)' }">
                  {{ currentUser?.username || 'User' }}
                </div>
                <button class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 dd-text hover:dd-bg-elevated"
                        @click="showUserMenu = false; router.push('/config?tab=profile')">
                  <AppIcon name="user" :size="11" class="dd-text-muted" />
                  Profile
                </button>
                <div class="my-0.5" :style="{ borderTop: '1px solid var(--dd-border)' }" />
                <button class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 hover:dd-bg-elevated"
                        style="color: var(--dd-danger);"
                        @click="handleSignOut">
                  <AppIcon name="sign-out" :size="11" />
                  Sign out
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </header>

      <!-- MAIN CONTENT -->
      <main class="flex-1 min-h-0 overflow-hidden flex flex-col pl-4 pr-1 py-4 sm:pl-6 sm:pr-2 sm:py-6"
            :style="{ backgroundColor: 'var(--dd-bg)' }">
        <router-view />
      </main>
    </div>

    <!-- About Modal -->
    <Teleport to="body">
      <div v-if="showAbout"
           class="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
           @pointerdown.self="showAbout = false">
        <div class="flex items-start justify-center pt-[20vh] min-h-full px-4"
             @pointerdown.self="showAbout = false">
          <div class="relative w-full max-w-[340px] dd-rounded-lg overflow-hidden shadow-2xl"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="flex flex-col items-center pt-6 pb-4 px-6">
              <img :src="whaleLogo" alt="Drydock" class="h-12 w-auto mb-3" :style="{ filter: 'invert(1)' }" />
              <h2 class="text-base font-bold dd-text">Drydock</h2>
              <span class="text-[11px] dd-text-muted mt-0.5">Docker Container Update Manager</span>
              <span class="badge text-[10px] font-semibold mt-2 dd-bg-elevated dd-text-secondary">v1.4.0</span>
            </div>
            <div class="px-6 pb-5 flex flex-col gap-2"
                 :style="{ borderTop: '1px solid var(--dd-border)' }">
              <div class="pt-3 flex flex-col gap-1.5">
                <a href="https://drydock.dev" target="_blank" rel="noopener"
                   class="flex items-center gap-2.5 px-3 py-2 dd-rounded text-[12px] font-medium transition-colors dd-text-secondary hover:dd-text hover:dd-bg-elevated no-underline">
                  <AppIcon name="expand" :size="12" class="dd-text-muted" />
                  Documentation
                </a>
                <a href="https://github.com/CodesWhat/drydock" target="_blank" rel="noopener"
                   class="flex items-center gap-2.5 px-3 py-2 dd-rounded text-[12px] font-medium transition-colors dd-text-secondary hover:dd-text hover:dd-bg-elevated no-underline">
                  <AppIcon name="github" :size="12" class="dd-text-muted" />
                  GitHub
                </a>
                <a href="https://github.com/CodesWhat/drydock/blob/main/CHANGELOG.md" target="_blank" rel="noopener"
                   class="flex items-center gap-2.5 px-3 py-2 dd-rounded text-[12px] font-medium transition-colors dd-text-secondary hover:dd-text hover:dd-bg-elevated no-underline">
                  <AppIcon name="recent-updates" :size="12" class="dd-text-muted" />
                  Changelog
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Search Modal -->
    <Teleport to="body">
      <div v-if="showSearch"
           class="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
           @pointerdown.self="showSearch = false">
        <div class="flex items-start justify-center pt-[15vh] min-h-full px-4"
             @pointerdown.self="showSearch = false">
          <div class="relative w-full max-w-[560px] dd-rounded-lg overflow-hidden shadow-2xl"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-3 px-4 py-3"
                 :style="{ borderBottom: '1px solid var(--dd-border)' }">
              <AppIcon name="search" :size="14" class="dd-text-muted" />
              <input ref="searchInput" v-model="searchQuery"
                     type="text"
                     placeholder="Jump to pages, containers, agents, triggers..."
                     class="flex-1 bg-transparent text-sm dd-text font-mono outline-none placeholder:dd-text-muted"
                     @keydown.escape="showSearch = false"
                     @keydown="handleSearchInputKeydown" />
              <span v-if="scopePrefixLabel"
                    class="px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-semibold dd-rounded-sm dd-bg-elevated dd-text-secondary">
                {{ scopePrefixLabel }}
              </span>
              <kbd class="px-1.5 py-0.5 dd-rounded-sm text-[10px] font-medium dd-bg-elevated dd-text-muted">ESC</kbd>
            </div>
            <div class="px-3 py-2 flex items-center gap-1.5"
                 :style="{ borderBottom: '1px solid var(--dd-border)' }">
              <button
                v-for="scopeOption in SEARCH_SCOPE_OPTIONS"
                :key="scopeOption.id"
                class="inline-flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wide font-semibold border dd-rounded transition-colors"
                :style="searchScopeChipStyles(scopeOption.id, scopeOption.id === effectiveSearchScope)"
                @click="applySearchScope(scopeOption.id)">
                {{ scopeOption.label }}
                <span class="text-[9px] opacity-80">{{ searchScopeCounts[scopeOption.id] }}</span>
              </button>
              <span class="ml-auto text-[10px] dd-text-muted">
                {{ searchResults.length }} shown
              </span>
            </div>
            <div class="max-h-[360px] overflow-y-auto py-1">
              <template v-for="(group, groupIndex) in groupedSearchResults" :key="group.id">
                <div class="px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] dd-text-muted"
                     :style="groupIndex > 0 ? { borderTop: '1px solid var(--dd-border)' } : {}">
                  {{ group.label }}
                </div>
                <button
                  v-for="result in group.items"
                  :key="result.id"
                  class="w-full px-4 py-2.5 text-left flex items-center gap-3 transition-colors"
                  :class="isSearchResultActive(result.id) ? 'dd-bg-elevated' : 'hover:dd-bg-elevated'"
                  @mouseenter="setActiveSearchResult(result.id)"
                  @click="selectSearchResult(result)">
                  <div class="w-7 h-7 dd-rounded flex items-center justify-center shrink-0"
                       :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
                    <ContainerIcon
                      v-if="result.kind === 'container' && result.containerIcon"
                      :icon="result.containerIcon"
                      :size="16" />
                    <AppIcon v-else :name="result.icon" :size="13" class="dd-text-muted" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="text-[12px] font-semibold truncate dd-text">{{ result.title }}</div>
                    <div class="text-[10px] truncate dd-text-muted">{{ result.subtitle }}</div>
                  </div>
                  <AppIcon name="chevron-right" :size="11" class="dd-text-muted shrink-0" />
                </button>
              </template>
              <div v-if="searchResults.length === 0"
                   class="px-4 py-6 text-center text-xs dd-text-muted">
                <span v-if="sidebarDataLoading || searchResourcesLoading">Refreshing search index...</span>
                <span v-else-if="parsedSearchQuery.text">No matches for "{{ parsedSearchQuery.text }}".</span>
                <span v-else>Type to search pages, containers, agents, triggers, watchers, and settings.</span>
              </div>
            </div>
            <div class="px-4 py-2.5 flex items-center justify-between text-[10px] dd-text-muted"
                 :style="{ borderTop: '1px solid var(--dd-border)' }">
              <span>
                <span v-if="scopePrefixLabel">Prefix scope active; use </span>
                <span v-else>
                  Type
                  <kbd class="px-1 py-0.5 dd-rounded-sm dd-bg-elevated">/</kbd>,
                  <kbd class="px-1 py-0.5 dd-rounded-sm dd-bg-elevated">@</kbd>, or
                  <kbd class="px-1 py-0.5 dd-rounded-sm dd-bg-elevated">#</kbd>; use
                </span>
                <kbd class="px-1 py-0.5 dd-rounded-sm dd-bg-elevated">Tab</kbd>
                <span> to change scope</span>
              </span>
              <span>
                <kbd class="px-1 py-0.5 dd-rounded-sm dd-bg-elevated">↑↓</kbd> move
                ·
                <kbd class="px-1 py-0.5 dd-rounded-sm dd-bg-elevated">Enter</kbd> open
              </span>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Connection Lost Overlay -->
    <Teleport to="body">
      <Transition name="menu-fade">
        <div v-if="connectionLost"
             class="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center">
          <div class="w-full max-w-[320px] mx-4 dd-rounded-lg overflow-hidden shadow-2xl text-center"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="flex flex-col items-center px-6 py-8 gap-3">
              <div class="w-10 h-10 rounded-full flex items-center justify-center mb-1"
                   :style="{ backgroundColor: 'var(--dd-danger-muted)' }">
                <AppIcon name="warning" :size="18" :style="{ color: 'var(--dd-danger)' }" />
              </div>
              <h2 class="text-sm font-bold dd-text">{{ connectionOverlayTitle }}</h2>
              <p class="text-[11px] dd-text-muted leading-relaxed">
                {{ connectionOverlayMessage }}
              </p>
              <div class="flex items-center gap-2 mt-1">
                <AppIcon name="spinner" :size="12" class="dd-spin dd-text-muted" />
                <span class="text-[10px] dd-text-muted">{{ connectionOverlayStatus }}</span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
