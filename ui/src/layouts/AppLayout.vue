<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import whaleLogo from '@/assets/whale-logo.png?inline';
import AnnouncementBanner from '@/components/AnnouncementBanner.vue';
import AppIconButton from '@/components/AppIconButton.vue';
import NotificationBell from '@/components/NotificationBell.vue';
import { useBreakpoints } from '@/composables/useBreakpoints';
import { useDeprecationBanner } from '@/composables/useDeprecationBanner';
import { useIcons } from '@/composables/useIcons';
import { useStorageRef } from '@/composables/useStorageRef';
import { loadRecentItems, saveRecentItems } from '@/layouts/recentStorage';
import { preferences } from '@/preferences/store';
import { usePreference } from '@/preferences/usePreference';
import { getAgents } from '@/services/agent';
import { getAppInfos } from '@/services/app';
import { getUser, logout } from '@/services/auth';
import { getAllAuthentications } from '@/services/authentication';
import { getAllContainers } from '@/services/container';
import { getEffectiveDisplayIcon } from '@/services/image-icon';
import { getAllNotificationRules } from '@/services/notification';
import { getAllRegistries } from '@/services/registry';
import { getServer } from '@/services/server';
import sseService from '@/services/sse';
import { getAllTriggers } from '@/services/trigger';
import { getAllWatchers } from '@/services/watcher';
import { ROUTES } from '@/router/routes';
import { useTheme } from '@/theme/useTheme';

const router = useRouter();
const route = useRoute();
const { icon } = useIcons();
const { isDark } = useTheme();
const { isMobile, windowNarrow } = useBreakpoints();

const sidebarCollapsed = usePreference(
  () => preferences.layout.sidebarCollapsed,
  (v) => {
    preferences.layout.sidebarCollapsed = v;
  },
);
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

// Close mobile menu on route changes (safety net for non-sidebar navigation)
watch(
  () => route.path,
  () => {
    if (isMobile.value) isMobileMenuOpen.value = false;
  },
);

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
  // Cached flag so the sidebar security badge can update from a single-container
  // SSE patch without re-walking the raw API response's nested security.scan.summary.
  hasSecurityIssues: boolean;
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
      { label: 'Dashboard', icon: 'dashboard', route: ROUTES.DASHBOARD },
      {
        label: 'Containers',
        icon: 'containers',
        route: ROUTES.CONTAINERS,
        badge: containerCount.value || undefined,
        badgeColor: 'blue',
      },
      {
        label: 'Security',
        icon: 'security',
        route: ROUTES.SECURITY,
        badge: securityIssueCount.value || undefined,
        badgeColor: 'red',
      },
      { label: 'Audit', icon: 'audit', route: ROUTES.AUDIT },
      { label: 'System Logs', icon: 'logs', route: ROUTES.LOGS },
    ],
  },
  {
    label: 'Manage',
    items: [
      { label: 'Hosts', icon: 'servers', route: ROUTES.SERVERS },
      { label: 'Registries', icon: 'registries', route: ROUTES.REGISTRIES },
      { label: 'Watchers', icon: 'watchers', route: ROUTES.WATCHERS },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'General', icon: 'config', route: ROUTES.CONFIG },
      { label: 'Notifications', icon: 'notifications', route: ROUTES.NOTIFICATIONS },
      { label: 'Triggers', icon: 'triggers', route: ROUTES.TRIGGERS },
      { label: 'Auth', icon: 'auth', route: ROUTES.AUTH },
      { label: 'Agents', icon: 'agents', route: ROUTES.AGENTS },
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
      route: ROUTES.CONFIG,
      query: { tab: 'appearance' },
      kind: 'setting',
      searchable: 'appearance settings config theme color font icon library',
    },
    {
      id: 'settings:profile',
      title: 'Profile Settings',
      subtitle: 'Config · Profile',
      icon: 'user',
      route: ROUTES.CONFIG,
      query: { tab: 'profile' },
      kind: 'setting',
      searchable: 'profile settings config account user',
    },
  ];

  return [...pageResults, ...settingsResults];
});

// User menu
const showUserMenu = ref(false);
const userMenuStyle = ref<Record<string, string>>({});
function toggleUserMenu(event: MouseEvent) {
  showUserMenu.value = !showUserMenu.value;
  if (showUserMenu.value) {
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    userMenuStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      right: `${window.innerWidth - rect.right}px`,
    };
  }
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
    router.push(ROUTES.LOGIN);
  }
}

// About modal
const showAbout = ref(false);
const appVersion = ref('');

// Search modal
const showSearch = ref(false);
const searchQuery = ref('');
const searchInput = ref<HTMLInputElement | null>(null);
const searchActiveIndex = ref(0);
const searchContainers = ref<SearchContainerIndexItem[]>([]);
const searchResourceResults = ref<SearchResultItem[]>([]);
const searchResourcesLoading = ref(false);
const oidcHttpDiscoveryDetected = ref(false);
const hideOidcHttpBannerForSession = ref(false);
const hideOidcHttpBannerPermanently = useStorageRef<boolean>(
  'dd-banner-oidc-http-discovery-v1',
  false,
  (value): value is boolean => typeof value === 'boolean',
);
const legacyHashDetected = ref(false);
const hideLegacyHashBannerForSession = ref(false);
const hideLegacyHashBannerPermanently = useStorageRef<boolean>(
  'dd-banner-sha-hash-v1',
  false,
  (value): value is boolean => typeof value === 'boolean',
);

interface LegacyInputSourceSummary {
  total: number;
  keys: string[];
}

interface LegacyInputSummary {
  total: number;
  env: LegacyInputSourceSummary;
  label: LegacyInputSourceSummary;
  api?: LegacyInputSourceSummary;
}

interface CurlHealthcheckOverrideSummary {
  detected: boolean;
  commandPreview?: string;
}

const LEGACY_KEY_PREVIEW_LIMIT = 6;
const stackedBannerInlineStyle = {
  position: 'static',
  top: 'auto',
  left: 'auto',
  translate: 'none',
  width: '100%',
  maxWidth: 'none',
} as const;
const legacyInputSummary = ref<LegacyInputSummary | null>(null);
const curlHealthcheckOverrideSummary = ref<CurlHealthcheckOverrideSummary | null>(null);
const legacyConfigDeprecationBanner = useDeprecationBanner('dd-banner-legacy-config-v1');
const legacyApiPathDeprecationBanner = useDeprecationBanner('dd-banner-legacy-api-paths-v1');
const curlHealthcheckDeprecationBanner = useDeprecationBanner('dd-banner-curl-healthcheck-v1');

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

const SEARCH_RECENT_STORAGE_KEY = 'dd-cmdk-recent';
const SEARCH_RECENT_STORAGE_LEGACY_KEY = 'dd-cmdk-recent-v1';
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

function isSearchResultItem(item: unknown): item is SearchResultItem {
  return (
    item !== null &&
    typeof item === 'object' &&
    typeof (item as Record<string, unknown>).id === 'string' &&
    typeof (item as Record<string, unknown>).title === 'string' &&
    typeof (item as Record<string, unknown>).subtitle === 'string' &&
    typeof (item as Record<string, unknown>).icon === 'string' &&
    typeof (item as Record<string, unknown>).route === 'string' &&
    typeof (item as Record<string, unknown>).kind === 'string'
  );
}

function loadRecentSearchResults(): SearchResultItem[] {
  return loadRecentItems({
    key: SEARCH_RECENT_STORAGE_KEY,
    legacyKey: SEARCH_RECENT_STORAGE_LEGACY_KEY,
    maxItems: SEARCH_RECENT_MAX_ITEMS,
    validate: isSearchResultItem,
  });
}

function saveRecentSearchResults(items: SearchResultItem[]) {
  saveRecentItems(SEARCH_RECENT_STORAGE_KEY, items);
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
    route: ROUTES.CONTAINERS,
    query: { q: container.displayName },
    kind: 'container',
    searchable:
      `${container.displayName} ${container.name} ${container.image} ${container.status} ${container.host}`.toLowerCase(),
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

function buildSearchIndexResults(resources: {
  agents?: unknown;
  triggers?: unknown;
  watchers?: unknown;
  registries?: unknown;
  authentications?: unknown;
  notificationRules?: unknown;
}): SearchResultItem[] {
  const results: SearchResultItem[] = [];

  const agents = Array.isArray(resources.agents) ? resources.agents : [];
  agents.forEach((agent: Record<string, unknown>) => {
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
      route: ROUTES.AGENTS,
      query: { q: name },
      kind: 'agent',
      searchable: `${name} ${hostLabel} ${status} agent`.toLowerCase(),
    });
  });

  const triggers = Array.isArray(resources.triggers) ? resources.triggers : [];
  triggers.forEach((trigger: Record<string, unknown>) => {
    const name = normalizeSearchValue(trigger.name || trigger.id || 'trigger');
    const type = normalizeSearchValue(trigger.type || 'unknown');
    const id = normalizeSearchValue(trigger.id || `${type}.${name}`);
    results.push({
      id: `trigger:${id}`,
      title: name,
      subtitle: `Trigger · ${type}`,
      icon: 'triggers',
      route: ROUTES.TRIGGERS,
      query: { q: name },
      kind: 'trigger',
      searchable: `${name} ${id} ${type} trigger`.toLowerCase(),
    });
  });

  const watchers = Array.isArray(resources.watchers) ? resources.watchers : [];
  watchers.forEach((watcher: Record<string, unknown>) => {
    const name = normalizeSearchValue(watcher.name || watcher.id || 'watcher');
    const type = normalizeSearchValue(watcher.type || 'unknown');
    const id = normalizeSearchValue(watcher.id || `${type}.${name}`);
    results.push({
      id: `watcher:${id}`,
      title: name,
      subtitle: `Watcher · ${type}`,
      icon: 'watchers',
      route: ROUTES.WATCHERS,
      query: { q: name },
      kind: 'watcher',
      searchable: `${name} ${id} ${type} watcher`.toLowerCase(),
    });
  });

  const registries = Array.isArray(resources.registries) ? resources.registries : [];
  registries.forEach((registry: Record<string, unknown>) => {
    const name = normalizeSearchValue(registry.name || registry.id || 'registry');
    const type = normalizeSearchValue(registry.type || 'unknown');
    const id = normalizeSearchValue(registry.id || `${type}.${name}`);
    results.push({
      id: `registry:${id}`,
      title: name,
      subtitle: `Registry · ${type}`,
      icon: 'registries',
      route: ROUTES.REGISTRIES,
      query: { q: name },
      kind: 'registry',
      searchable: `${name} ${id} ${type} registry`.toLowerCase(),
    });
  });

  const authentications = Array.isArray(resources.authentications) ? resources.authentications : [];
  authentications.forEach((authentication: Record<string, unknown>) => {
    const name = normalizeSearchValue(authentication.name || authentication.id || 'authentication');
    const type = normalizeSearchValue(authentication.type || 'unknown');
    const id = normalizeSearchValue(authentication.id || `${type}.${name}`);
    results.push({
      id: `auth:${id}`,
      title: name,
      subtitle: `Auth · ${type}`,
      icon: 'auth',
      route: ROUTES.AUTH,
      query: { q: name },
      kind: 'auth',
      searchable: `${name} ${id} ${type} auth authentication`.toLowerCase(),
    });
  });

  const notificationRules = Array.isArray(resources.notificationRules)
    ? resources.notificationRules
    : [];
  notificationRules.forEach((rule: Record<string, unknown>) => {
    const name = normalizeSearchValue(rule.name || rule.id || 'notification');
    const id = normalizeSearchValue(rule.id || name);
    results.push({
      id: `notification:${id}`,
      title: name,
      subtitle: `Notification rule · ${id}`,
      icon: 'notifications',
      route: ROUTES.NOTIFICATIONS,
      query: { q: name },
      kind: 'notification',
      searchable: `${name} ${id} notification rule alerts`.toLowerCase(),
    });
  });

  return results;
}

function isHttpOidcDiscovery(authentication: unknown): boolean {
  if (!authentication || typeof authentication !== 'object') {
    return false;
  }
  const authRecord = authentication as Record<string, unknown>;
  if (authRecord.type !== 'oidc') {
    return false;
  }
  const configuration = authRecord.configuration;
  if (!configuration || typeof configuration !== 'object') {
    return false;
  }
  const discovery = (configuration as Record<string, unknown>).discovery;
  if (typeof discovery !== 'string') {
    return false;
  }
  try {
    return new URL(discovery).protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeLegacyInputSourceSummary(rawValue: unknown): LegacyInputSourceSummary {
  const parsedTotal = Number((rawValue as { total?: unknown })?.total);
  const parsedKeys = Array.isArray((rawValue as { keys?: unknown })?.keys)
    ? (rawValue as { keys: unknown[] }).keys.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  const uniqueKeys = Array.from(new Set(parsedKeys)).sort((left, right) =>
    left.localeCompare(right),
  );
  const total =
    Number.isFinite(parsedTotal) && parsedTotal >= 0
      ? Math.max(Math.floor(parsedTotal), uniqueKeys.length)
      : uniqueKeys.length;
  return { total, keys: uniqueKeys };
}

function normalizeLegacyInputSummary(rawValue: unknown): LegacyInputSummary | null {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const env = normalizeLegacyInputSourceSummary((rawValue as { env?: unknown }).env);
  const label = normalizeLegacyInputSourceSummary((rawValue as { label?: unknown }).label);
  const apiSource =
    (rawValue as { api?: unknown }).api ??
    (rawValue as { path?: unknown }).path ??
    (rawValue as { paths?: unknown }).paths;
  const api = normalizeLegacyInputSourceSummary(apiSource);
  const parsedTotal = Number((rawValue as { total?: unknown }).total);
  const totalFromSources = env.total + label.total + api.total;
  const total =
    Number.isFinite(parsedTotal) && parsedTotal >= 0
      ? Math.max(Math.floor(parsedTotal), totalFromSources)
      : totalFromSources;

  if (total <= 0) {
    return null;
  }

  const summary: LegacyInputSummary = { total, env, label };
  if (api.total > 0 || api.keys.length > 0) {
    summary.api = api;
  }
  return summary;
}

function normalizeCurlHealthcheckOverrideSummary(
  rawValue: unknown,
): CurlHealthcheckOverrideSummary | null {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const detected = (rawValue as { detected?: unknown }).detected === true;
  const commandPreview =
    typeof (rawValue as { commandPreview?: unknown }).commandPreview === 'string'
      ? (rawValue as { commandPreview: string }).commandPreview
      : undefined;

  return {
    detected,
    ...(commandPreview ? { commandPreview } : {}),
  };
}

function summarizeLegacyKeys(keys: string[]): string {
  if (keys.length === 0) {
    return '';
  }
  const previewKeys = keys.slice(0, LEGACY_KEY_PREVIEW_LIMIT);
  const hiddenCount = keys.length - previewKeys.length;
  return hiddenCount > 0
    ? `${previewKeys.join(', ')} (+${hiddenCount} more)`
    : previewKeys.join(', ');
}

const legacyEnvKeysPreview = computed(() =>
  summarizeLegacyKeys(legacyInputSummary.value?.env.keys ?? []),
);
const legacyLabelKeysPreview = computed(() =>
  summarizeLegacyKeys(legacyInputSummary.value?.label.keys ?? []),
);
const legacyApiPathKeysPreview = computed(() =>
  summarizeLegacyKeys(legacyInputSummary.value?.api?.keys ?? []),
);

const showOidcHttpCompatibilityBanner = computed(
  () =>
    oidcHttpDiscoveryDetected.value &&
    !hideOidcHttpBannerForSession.value &&
    !hideOidcHttpBannerPermanently.value,
);

function dismissOidcHttpBannerForSession() {
  hideOidcHttpBannerForSession.value = true;
}

function dismissOidcHttpBannerPermanently() {
  hideOidcHttpBannerPermanently.value = true;
}

function isLegacyBasicHash(authentication: unknown): boolean {
  if (!authentication || typeof authentication !== 'object') {
    return false;
  }
  const authRecord = authentication as Record<string, unknown>;
  if (authRecord.type !== 'basic') {
    return false;
  }
  const metadata = authRecord.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return (metadata as Record<string, unknown>).usesLegacyHash === true;
}

const showLegacyHashDeprecationBanner = computed(
  () =>
    legacyHashDetected.value &&
    !hideLegacyHashBannerForSession.value &&
    !hideLegacyHashBannerPermanently.value,
);

const showLegacyConfigDeprecationBanner = computed(
  () => legacyConfigDeprecationBanner.visible.value,
);
const showLegacyApiPathDeprecationBanner = computed(
  () => legacyApiPathDeprecationBanner.visible.value,
);
const showCurlHealthcheckDeprecationBanner = computed(
  () => curlHealthcheckDeprecationBanner.visible.value,
);
const legacyConfigBannerTitle = computed(() => {
  const envCount = legacyInputSummary.value?.env.total ?? 0;
  const labelCount = legacyInputSummary.value?.label.total ?? 0;
  const total = envCount + labelCount;
  return `${total} legacy configuration alias${total !== 1 ? 'es' : ''} detected`;
});
const legacyApiPathBannerTitle = computed(
  () => `${legacyInputSummary.value?.api?.total ?? 0} legacy API paths detected`,
);
const hasVisibleAnnouncementBanners = computed(
  () =>
    showOidcHttpCompatibilityBanner.value ||
    showLegacyHashDeprecationBanner.value ||
    showLegacyConfigDeprecationBanner.value ||
    showLegacyApiPathDeprecationBanner.value ||
    showCurlHealthcheckDeprecationBanner.value,
);

function dismissLegacyHashBannerForSession() {
  hideLegacyHashBannerForSession.value = true;
}

function dismissLegacyHashBannerPermanently() {
  hideLegacyHashBannerPermanently.value = true;
}

async function refreshLegacyInputSummary() {
  const serverData = await getServer().catch(() => null);
  const summary = normalizeLegacyInputSummary(serverData?.compatibility?.legacyInputs);
  const curlHealthcheckOverride = normalizeCurlHealthcheckOverrideSummary(
    serverData?.compatibility?.curlHealthcheckOverride,
  );
  legacyInputSummary.value = summary;
  curlHealthcheckOverrideSummary.value = curlHealthcheckOverride;
  legacyConfigDeprecationBanner.detected.value =
    (summary?.env.total ?? 0) > 0 || (summary?.label.total ?? 0) > 0;
  legacyApiPathDeprecationBanner.detected.value = (summary?.api?.total ?? 0) > 0;
  curlHealthcheckDeprecationBanner.detected.value = curlHealthcheckOverride?.detected === true;
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
    oidcHttpDiscoveryDetected.value = Array.isArray(authentications)
      ? authentications.some((authentication) => isHttpOidcDiscovery(authentication))
      : false;
    legacyHashDetected.value = Array.isArray(authentications)
      ? authentications.some((authentication) => isLegacyBasicHash(authentication))
      : false;
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
    .sort(
      (left, right) =>
        right.score - left.score || left.result.title.localeCompare(right.result.title),
    )
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
  rankedSearchResults.value.filter((result) =>
    isSearchResultInScope(result, effectiveSearchScope.value),
  ),
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
const selfUpdateOperationId = ref<string | undefined>(undefined);
const CONNECTIVITY_POLL_INTERVAL_MS = 5_000;
let connectivityTimer: ReturnType<typeof setInterval> | undefined;
let sidebarRefreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;
const sidebarDataLoading = ref(false);

function startConnectivityPolling() {
  if (connectivityTimer) {
    return;
  }
  connectivityTimer = setInterval(checkConnectivity, CONNECTIVITY_POLL_INTERVAL_MS);
}

function stopConnectivityPolling() {
  if (!connectivityTimer) {
    return;
  }
  clearInterval(connectivityTimer);
  connectivityTimer = undefined;
}

async function checkConnectivity() {
  if (!connectionLost.value) {
    stopConnectivityPolling();
    return;
  }

  try {
    const res = await fetch('/auth/user', { credentials: 'include', redirect: 'manual' });
    if (res.ok || res.status === 401) {
      // Server is back — stop SSE reconnect loop, then hard-reload to login.
      // Hard reload is required because a server restart produces new asset
      // hashes; router.push would try to lazy-load stale chunks and fail.
      sseService.disconnect();
      stopConnectivityPolling();
      globalThis.location.replace('/login');
    }
  } catch {
    // Network error — server is unreachable
    connectionLost.value = true;
    startConnectivityPolling();
  }
}

const connectionOverlayTitle = computed(() =>
  selfUpdateInProgress.value ? 'Applying Update' : 'Connection Lost',
);
const connectionOverlayMessage = computed(() =>
  selfUpdateInProgress.value
    ? `Drydock is restarting after a self-update${
        selfUpdateOperationId.value ? ` (${selfUpdateOperationId.value.slice(0, 8)})` : ''
      }. Reconnecting when the service is back...`
    : 'The server is unreachable. Waiting for it to come back online...',
);
const connectionOverlayStatus = computed(() =>
  selfUpdateInProgress.value ? 'Restarting service' : 'Reconnecting',
);

function rawContainerHasSecurityIssues(container: Record<string, unknown>): boolean {
  const summary = container.security?.scan?.summary;
  return Number(summary?.critical || 0) > 0 || Number(summary?.high || 0) > 0;
}

function buildSidebarContainerEntry(container: Record<string, unknown>): SearchContainerIndexItem {
  const displayName = String(
    container.displayName || container.name || container.id || 'container',
  );
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
    hasSecurityIssues: rawContainerHasSecurityIssues(container),
  };
}

function recomputeSidebarCounts() {
  containerCount.value = String(searchContainers.value.length);
  const issues = searchContainers.value.filter((entry) => entry.hasSecurityIssues).length;
  securityIssueCount.value = issues > 0 ? String(issues) : '';
}

// Apply a single-container SSE payload to the sidebar's search index in place,
// then recompute the container + security badge counts. Replaces the previous
// 800ms-debounced full GET /api/v1/containers for every lifecycle event.
// Returns false if the payload cannot be patched (caller falls back to a full
// refresh).
function applySidebarContainerPatch(
  payload: unknown,
  kind: 'added' | 'updated' | 'removed',
): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const raw = payload as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : undefined;
  const name = typeof raw.name === 'string' ? raw.name : undefined;
  if (!id && !name) {
    return false;
  }

  const idx = searchContainers.value.findIndex(
    (entry) =>
      (typeof id === 'string' && id.length > 0 && entry.id === id) ||
      (typeof name === 'string' && name.length > 0 && entry.name === name),
  );

  if (kind === 'removed') {
    if (idx !== -1) {
      searchContainers.value.splice(idx, 1);
    }
    recomputeSidebarCounts();
    return true;
  }

  const entry = buildSidebarContainerEntry(raw);
  if (idx === -1) {
    searchContainers.value.push(entry);
  } else {
    searchContainers.value.splice(idx, 1, entry);
  }
  recomputeSidebarCounts();
  return true;
}

async function refreshSidebarData() {
  sidebarDataLoading.value = true;
  try {
    const containers = await getAllContainers().catch(() => []);
    if (!Array.isArray(containers)) {
      searchContainers.value = [];
      return;
    }
    searchContainers.value = containers.map((container: Record<string, unknown>) =>
      buildSidebarContainerEntry(container),
    );
    recomputeSidebarCounts();
  } catch {
    // Sidebar works without badge data
  } finally {
    sidebarDataLoading.value = false;
  }
}

function scheduleSidebarDataRefresh() {
  clearTimeout(sidebarRefreshDebounceTimer);
  sidebarRefreshDebounceTimer = setTimeout(() => {
    void refreshSidebarData();
  }, 800);
}

function emitUiSseEvent(name: string, detail?: unknown) {
  globalThis.dispatchEvent(new CustomEvent(name, detail !== undefined ? { detail } : undefined));
}

function handleSseEvent(event: string, payload?: unknown) {
  if (event === 'sse:connected') {
    connectionLost.value = false;
    stopConnectivityPolling();
    selfUpdateInProgress.value = false;
    selfUpdateOperationId.value = undefined;
    emitUiSseEvent('dd:sse-connected');
    return;
  }
  if (event === 'self-update') {
    selfUpdateInProgress.value = true;
    connectionLost.value = true;
    startConnectivityPolling();
    selfUpdateOperationId.value =
      payload && typeof payload === 'object'
        ? String((payload as Record<string, unknown>).opId || '') || undefined
        : undefined;
    emitUiSseEvent('dd:sse-self-update');
    return;
  }
  if (event === 'scan-started') {
    emitUiSseEvent('dd:sse-scan-started');
    return;
  }
  if (event === 'scan-completed') {
    emitUiSseEvent('dd:sse-scan-completed');
    scheduleSidebarDataRefresh();
    return;
  }
  if (event === 'container-added') {
    emitUiSseEvent('dd:sse-container-added', payload);
    if (!applySidebarContainerPatch(payload, 'added')) {
      scheduleSidebarDataRefresh();
    }
    return;
  }
  if (event === 'container-updated') {
    emitUiSseEvent('dd:sse-container-updated', payload);
    if (!applySidebarContainerPatch(payload, 'updated')) {
      scheduleSidebarDataRefresh();
    }
    return;
  }
  if (event === 'container-removed') {
    emitUiSseEvent('dd:sse-container-removed', payload);
    if (!applySidebarContainerPatch(payload, 'removed')) {
      scheduleSidebarDataRefresh();
    }
    return;
  }
  if (event === 'container-changed') {
    // Legacy bare signal — still fired from sse.ts alongside the granular
    // events for back-compat. The granular branches above already patched the
    // sidebar in place, so do not schedule a redundant full refresh here.
    emitUiSseEvent('dd:sse-container-changed', payload);
    return;
  }
  if (event === 'update-operation-changed') {
    emitUiSseEvent('dd:sse-update-operation-changed', payload);
    return;
  }
  if (event === 'agent-status-changed') {
    emitUiSseEvent('dd:sse-agent-status-changed');
    return;
  }
  if (event === 'resync-required') {
    const reason =
      payload && typeof payload === 'object'
        ? String((payload as Record<string, unknown>).reason || 'boot-mismatch')
        : 'boot-mismatch';
    emitUiSseEvent('dd:sse-resync-required', { reason });
    return;
  }
  if (event === 'connection-lost') {
    connectionLost.value = true;
    startConnectivityPolling();
  }
}

onMounted(async () => {
  globalThis.addEventListener('keydown', handleKeydown);
  sseService.connect({
    emit: (event, payload) => handleSseEvent(event, payload),
  });
  // Fetch sidebar badge data and user info
  try {
    const [, , , user, appInfos] = await Promise.all([
      refreshSidebarData(),
      refreshSearchResources(),
      refreshLegacyInputSummary(),
      getUser().catch(() => null),
      getAppInfos().catch(() => null),
    ]);
    if (user) currentUser.value = user;
    if (appInfos?.version) appVersion.value = appInfos.version;
  } catch {
    // Sidebar works without badge data
  }
});
onUnmounted(() => {
  clearTimeout(sidebarRefreshDebounceTimer);
  globalThis.removeEventListener('keydown', handleKeydown);
  stopConnectivityPolling();
  sseService.disconnect();
});
</script>

<template>
  <div :class="[isDark ? 'dark' : 'light']"
       class="h-dvh flex overflow-clip font-mono"
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
        width: isCollapsed ? 'var(--dd-layout-sidebar-collapsed-width)' : 'var(--dd-layout-sidebar-expanded-width)',
        minWidth: isCollapsed ? 'var(--dd-layout-sidebar-collapsed-width)' : 'var(--dd-layout-sidebar-expanded-width)',
        backgroundColor: 'var(--dd-bg-sidebar)',
        overflowX: 'clip',
      }">

      <!-- Logo -->
      <div class="flex items-center h-12 shrink-0 overflow-hidden"
           :class="isCollapsed ? 'justify-center px-1' : 'justify-between px-3'">
        <div class="flex items-center overflow-hidden" :class="isCollapsed ? '' : 'gap-2 shrink-0'">
          <img :src="whaleLogo" alt="Drydock"
               class="h-5 w-auto shrink-0 transition-transform duration-300"
               :style="[isCollapsed ? { transform: 'scaleX(-1)' } : {}, isDark ? { filter: 'invert(1)' } : {}]" />
          <span class="sidebar-label font-bold text-sm tracking-widest dd-text"
                style="letter-spacing: var(--dd-letter-spacing-brand);">DRYDOCK</span>
        </div>
        <AppIconButton v-if="isMobile"
                icon="xmark"
                size="xs"
                variant="muted"
                tooltip="Close menu"
                aria-label="Close menu"
                @click="isMobileMenuOpen = false"
        />
      </div>

      <!-- Nav groups -->
      <nav class="flex-1 overflow-y-auto overflow-x-hidden pt-1 pb-3 px-2 space-y-4">
        <div v-for="group in navGroups" :key="group.label">
          <div v-if="group.label && !isCollapsed"
               class="px-2 mb-1 text-2xs font-semibold uppercase tracking-wider dd-text-muted">
            {{ group.label }}
          </div>
          <div v-else-if="group.label" class="flex justify-center py-1 w-9 mx-auto">
            <div class="w-1 h-1 rounded-full dd-bg-elevated" />
          </div>

          <div v-for="item in group.items" :key="item.route"
               class="nav-item-wrapper relative mt-0.5"
               @click="navigateTo(item.route)">
            <div
              class="nav-item flex items-center gap-3 dd-rounded cursor-pointer relative py-[var(--dd-space-6)] px-[var(--dd-space-12)]"
              :class="[
                route.path === item.route
                  ? 'bg-drydock-secondary/10 dark:bg-drydock-secondary/15 text-drydock-secondary'
                  : 'dd-text-secondary hover:dd-bg-elevated hover:dd-text',
              ]">
              <AppIcon :name="item.icon" :size="16" class="shrink-0" style="width:20px; text-align:center;" />
              <span class="sidebar-label text-xs-plus font-medium">{{ item.label }}</span>
              <span v-if="item.badge && !isCollapsed"
                    class="sidebar-label ml-auto badge text-2xs"
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
                   boxShadow: 'var(--dd-shadow-tooltip)',
                 }">
              {{ item.label }}
            </div>
          </div>
        </div>
      </nav>

      <!-- Sidebar search -->
      <div class="shrink-0 pt-3 pb-3" :class="isCollapsed ? 'px-2' : 'px-3'">
        <AppButton size="none" variant="plain" weight="none" aria-label="Search"
                class="w-full flex items-center dd-rounded text-xs transition-colors dd-bg-card dd-text-secondary hover:dd-bg-elevated hover:dd-text"
                :class="isCollapsed ? 'justify-center py-2.5' : 'gap-2 px-3 py-2'"
                :style="{ border: 'none' }"
                @click="showSearch = true; isMobileMenuOpen = false">
          <AppIcon name="search" :size="12" class="shrink-0" />
          <template v-if="!isCollapsed">
            <span class="sidebar-label">Search</span>
            <kbd class="sidebar-label ml-auto px-1.5 py-0.5 dd-rounded-sm text-2xs font-medium dd-text-secondary" style="background: var(--dd-border);">
              <span class="text-3xs">&#8984;</span>K
            </kbd>
          </template>
        </AppButton>
      </div>

      <!-- Sidebar footer -->
      <div class="shrink-0 px-3 py-2.5 flex items-center gap-1"
           :class="isCollapsed ? 'flex-col' : 'flex-row justify-between'">
        <AppIconButton
                icon="info"
                size="xs"
                variant="muted"
                tooltip="About Drydock"
                aria-label="About Drydock"
                @click="showAbout = true"
        />
        <AppIconButton v-if="!isMobile"
                :icon="sidebarCollapsed ? 'sidebar-expand' : 'sidebar-collapse'"
                size="xs"
                variant="muted"
                :tooltip="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
                :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
                @click="sidebarCollapsed = !sidebarCollapsed"
        />
      </div>
    </aside>

    <!-- MAIN AREA -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden" :style="{ backgroundColor: 'var(--dd-bg-sidebar)' }">

      <!-- TOP BAR -->
      <header class="h-12 grid items-center px-4 shrink-0"
              style="grid-template-columns: 1fr auto 1fr;"
              :style="{
                backgroundColor: 'var(--dd-bg-sidebar)',
              }">
        <!-- Left: hamburger + breadcrumb -->
        <div class="flex items-center gap-3">
          <AppButton size="none" variant="plain" weight="none" v-if="isMobile"
                  :tooltip="isMobileMenuOpen ? 'Close menu' : 'Open menu'"
                  :aria-label="isMobileMenuOpen ? 'Close menu' : 'Open menu'"
                  :aria-expanded="String(isMobileMenuOpen)"
                  class="flex flex-col items-center justify-center w-8 h-8 gap-1 rounded-md transition-colors hover:dd-bg-elevated"
                  @click="isMobileMenuOpen = !isMobileMenuOpen">
            <span class="hamburger-line block w-4 h-[2px] rounded-full" style="background: var(--dd-text-muted)" />
            <span class="hamburger-line block w-4 h-[2px] rounded-full" style="background: var(--dd-text-muted)" />
            <span class="hamburger-line block w-4 h-[2px] rounded-full" style="background: var(--dd-text-muted)" />
          </AppButton>

          <nav class="flex items-center gap-1.5 text-xs-plus">
            <AppIcon :name="currentPageIcon" :size="16" class="leading-none dd-text-muted" />
            <span class="font-medium leading-none dd-text">
              {{ currentPageLabel }}
            </span>
            <div id="breadcrumb-actions" class="flex items-center" />
          </nav>
        </div>

        <div /><!-- empty center grid cell -->

        <!-- Right: theme, notifications, avatar -->
        <div class="flex items-center gap-2 justify-end">
          <ThemeToggle />

          <NotificationBell />

          <div class="relative user-menu-wrapper">
            <AppButton size="none" variant="plain" weight="none" tooltip="User menu" aria-label="User menu"
                    :aria-expanded="String(showUserMenu)"
                    class="flex items-center gap-2 dd-rounded px-1.5 py-1 transition-colors hover:dd-bg-elevated"
                    @click="toggleUserMenu">
              <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                   style="background: linear-gradient(135deg, var(--dd-primary), var(--dd-success));">
                {{ userInitials }}
              </div>
              <AppIcon name="chevron-down" :size="12" class="dd-text-muted" />
            </AppButton>
            <Transition name="menu-fade">
              <div v-if="showUserMenu"
                   class="min-w-[160px] py-1 dd-rounded-lg shadow-lg"
                   :style="{ ...userMenuStyle, zIndex: 'var(--z-popover)', backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)', boxShadow: 'var(--dd-shadow-tooltip)' }">
                <div
                  class="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider dd-text-muted max-w-[220px] truncate"
                  v-tooltip.top="currentUser?.username || currentUser?.displayName || 'User'"
                     :style="{ borderBottom: '1px solid var(--dd-border)' }">
                  {{ currentUser?.username || currentUser?.displayName || 'User' }}
                </div>
                <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="showUserMenu = false; router.push({ path: ROUTES.CONFIG, query: { tab: 'profile' } })">
                  <AppIcon name="user" :size="11" class="dd-text-muted" />
                  Profile
                </AppButton>
                <div class="my-0.5" :style="{ borderTop: '1px solid var(--dd-border)' }" />
                <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2" style="color: var(--dd-danger);"
                        @click="handleSignOut">
                  <AppIcon name="sign-out" :size="11" />
                  Sign out
                </AppButton>
              </div>
            </Transition>
          </div>
        </div>
      </header>

      <div
        v-if="hasVisibleAnnouncementBanners"
        class="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-4xl flex flex-col gap-2"
      >
        <AnnouncementBanner
          v-if="showOidcHttpCompatibilityBanner"
          data-testid="oidc-http-compat-banner"
          title="HTTP OIDC discovery detected"
          permanent-dismiss-label="Don't show again"
          link-href="https://getdrydock.com/docs/deprecations#oidc-http-discovery"
          link-label="View migration guide"
          :style="stackedBannerInlineStyle"
          @dismiss="dismissOidcHttpBannerForSession"
          @dismiss-permanent="dismissOidcHttpBannerPermanently">
          One or more OIDC providers use an insecure
          <code class="px-1 py-0.5 dd-rounded-sm" :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-warning)' }">http://</code>
          discovery URL. HTTP discovery is deprecated and will be removed in v1.6.0.
          Upgrade your OIDC discovery URL to use HTTPS, or set
          <code class="px-1 py-0.5 dd-rounded-sm" :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-warning)' }">DD_AUTH_OIDC_{name}_ALLOW_INSECURE_HTTP=true</code>
          only for trusted internal issuers.
        </AnnouncementBanner>

        <AnnouncementBanner
          v-if="showLegacyHashDeprecationBanner"
          data-testid="sha-hash-deprecation-banner"
          title="Legacy password hash detected"
          permanent-dismiss-label="Don't show again"
          link-href="https://getdrydock.com/docs/deprecations#legacy-password-hashes"
          link-label="View migration guide"
          :style="stackedBannerInlineStyle"
          @dismiss="dismissLegacyHashBannerForSession"
          @dismiss-permanent="dismissLegacyHashBannerPermanently">
          Your basic authentication uses a legacy password hash format. Legacy v1.3.9 formats are deprecated and will be removed in v1.6.0.
          Re-hash your admin password with argon2id (see the migration guide for the one-liner).
        </AnnouncementBanner>

        <AnnouncementBanner
          v-if="showLegacyConfigDeprecationBanner"
          data-testid="legacy-config-deprecation-banner"
          :title="legacyConfigBannerTitle"
          permanent-dismiss-label="Don't show again"
          link-href="https://getdrydock.com/docs/deprecations#legacy-env-vars"
          link-label="View migration guide"
          :style="stackedBannerInlineStyle"
          @dismiss="legacyConfigDeprecationBanner.dismissForSession"
          @dismiss-permanent="legacyConfigDeprecationBanner.dismissPermanently">
          Deprecated configuration aliases are in use. Rename
          <code class="px-1 py-0.5 dd-rounded-sm" :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-warning)' }">WUD_*</code>
          env vars to
          <code class="px-1 py-0.5 dd-rounded-sm" :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-warning)' }">DD_*</code>
          and
          <code class="px-1 py-0.5 dd-rounded-sm" :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-warning)' }">wud.*</code>
          Docker labels to
          <code class="px-1 py-0.5 dd-rounded-sm" :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-warning)' }">dd.*</code>.
          <code class="px-1 py-0.5 dd-rounded-sm" :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-warning)' }">DD_TRIGGER_*</code>
          variables should also migrate to
          <code class="px-1 py-0.5 dd-rounded-sm" :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-warning)' }">DD_ACTION_*</code>
          or
          <code class="px-1 py-0.5 dd-rounded-sm" :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-warning)' }">DD_NOTIFICATION_*</code>
          (see the migration guide for the full rename map).
          <span v-if="legacyEnvKeysPreview" class="block mt-1 truncate">
            Env keys ({{ legacyInputSummary?.env.total }}): {{ legacyEnvKeysPreview }}
          </span>
          <span v-if="legacyLabelKeysPreview" class="block mt-1 truncate">
            Label keys ({{ legacyInputSummary?.label.total }}): {{ legacyLabelKeysPreview }}
          </span>
        </AnnouncementBanner>

        <AnnouncementBanner
          v-if="showLegacyApiPathDeprecationBanner"
          data-testid="legacy-api-path-deprecation-banner"
          :title="legacyApiPathBannerTitle"
          permanent-dismiss-label="Don't show again"
          link-href="https://getdrydock.com/docs/deprecations#unversioned-api-paths"
          link-label="View migration guide"
          :style="stackedBannerInlineStyle"
          @dismiss="legacyApiPathDeprecationBanner.dismissForSession"
          @dismiss-permanent="legacyApiPathDeprecationBanner.dismissPermanently">
          Unversioned API paths are deprecated. Update API clients to the
          <code class="px-1 py-0.5 dd-rounded-sm" :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-warning)' }">/api/v1/*</code>
          prefix. Unversioned
          <code class="px-1 py-0.5 dd-rounded-sm" :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-warning)' }">/api/*</code>
          aliases are removed in v1.6.0.
          <span v-if="legacyApiPathKeysPreview" class="block mt-1 truncate">
            API paths ({{ legacyInputSummary?.api?.total }}): {{ legacyApiPathKeysPreview }}
          </span>
        </AnnouncementBanner>

        <AnnouncementBanner
          v-if="showCurlHealthcheckDeprecationBanner"
          data-testid="curl-healthcheck-deprecation-banner"
          title="Custom curl healthcheck override detected"
          permanent-dismiss-label="Don't show again"
          link-href="https://getdrydock.com/docs/deprecations#curl-healthcheck-override"
          link-label="View migration guide"
          :style="stackedBannerInlineStyle"
          @dismiss="curlHealthcheckDeprecationBanner.dismissForSession"
          @dismiss-permanent="curlHealthcheckDeprecationBanner.dismissPermanently">
          Your Drydock container uses a custom curl-based healthcheck override. curl remains
          supported for backward compatibility in v1.5.x. v1.6.0 is the final warning release,
          and curl will be removed from the image in v1.7.0. Remove the
          <code class="px-1 py-0.5 dd-rounded-sm" :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-warning)' }">DD_DISABLE_WGET_HEALTHCHECK=true</code>
          override; the image now uses wget and curl is no longer bundled. Prefer the built-in image
          healthcheck or
          <code class="px-1 py-0.5 dd-rounded-sm" :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-warning)' }">/bin/healthcheck</code>
          for custom intervals.
          <span v-if="curlHealthcheckOverrideSummary?.commandPreview" class="block mt-1 truncate">
            Healthcheck command: {{ curlHealthcheckOverrideSummary.commandPreview }}
          </span>
        </AnnouncementBanner>
      </div>

      <!-- MAIN CONTENT -->
      <main class="flex-1 min-h-0 overflow-clip flex flex-col pl-4 pr-2 py-4 sm:pl-6 sm:pr-[9px] sm:py-6"
            :style="{ backgroundColor: 'var(--dd-bg)', borderTopLeftRadius: 'var(--dd-radius-lg)' }">
        <router-view />
      </main>

    </div>

    <!-- About Modal -->
    <Teleport to="body">
      <div v-if="showAbout"
           class="fixed inset-0 z-overlay bg-black/50 backdrop-blur-sm"
           @pointerdown.self="showAbout = false">
        <div class="flex items-start justify-center pt-[20vh] min-h-full px-4"
             @pointerdown.self="showAbout = false">
          <div role="dialog"
               aria-modal="true"
               aria-labelledby="about-dialog-title"
               class="relative w-full max-w-[var(--dd-layout-about-max-width)] dd-rounded-lg overflow-hidden shadow-2xl"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <AppIconButton
                    icon="xmark"
                    size="xs"
                    variant="muted"
                    tooltip="Close"
                    aria-label="Close"
                    class="absolute top-3 right-3 z-10"
                    @click="showAbout = false"
            />
            <div class="flex flex-col items-center pt-6 pb-4 px-6">
              <div class="-mx-6 w-[calc(100%+3rem)] h-12 mb-3 relative pointer-events-none">
                <img :src="whaleLogo" alt="Drydock" class="h-10 w-[65px] absolute top-1 about-swim"
                     :style="isDark ? { filter: 'invert(1)' } : {}" />
              </div>
              <h2 id="about-dialog-title" class="text-base font-bold dd-text">Drydock</h2>
              <span class="text-2xs-plus dd-text-muted mt-0.5">Docker Container Update Manager</span>
              <span v-if="appVersion" class="badge text-2xs font-semibold mt-2 dd-bg-elevated dd-text-secondary">v{{ appVersion }}</span>
            </div>
            <div class="px-6 pb-5 flex flex-col gap-2"
                 :style="{ borderTop: '1px solid var(--dd-border)' }">
              <div class="pt-3 flex flex-col gap-1.5">
                <a href="https://getdrydock.com" target="_blank" rel="noopener"
                   class="flex items-center gap-2.5 px-3 py-2 dd-rounded text-xs font-medium transition-colors dd-text-secondary hover:dd-text hover:dd-bg-elevated no-underline">
                  <AppIcon name="book" :size="12" class="dd-text-muted" />
                  Documentation
                </a>
                <a href="https://github.com/CodesWhat/drydock" target="_blank" rel="noopener"
                   class="flex items-center gap-2.5 px-3 py-2 dd-rounded text-xs font-medium transition-colors dd-text-secondary hover:dd-text hover:dd-bg-elevated no-underline">
                  <AppIcon name="github" :size="12" class="dd-text-muted" />
                  GitHub
                </a>
                <a href="https://github.com/CodesWhat/drydock/blob/main/CHANGELOG.md" target="_blank" rel="noopener"
                   class="flex items-center gap-2.5 px-3 py-2 dd-rounded text-xs font-medium transition-colors dd-text-secondary hover:dd-text hover:dd-bg-elevated no-underline">
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
           class="fixed inset-0 z-overlay bg-black/50 backdrop-blur-sm"
           @pointerdown.self="showSearch = false">
        <div class="flex items-start justify-center pt-[15vh] min-h-full px-4"
             @pointerdown.self="showSearch = false">
          <div role="dialog"
               aria-modal="true"
               aria-label="Search"
               class="relative w-full max-w-[var(--dd-layout-search-max-width)] dd-rounded-lg overflow-hidden shadow-2xl"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-3 px-4 py-3"
                 :style="{ borderBottom: '1px solid var(--dd-border)' }">
              <AppIcon name="search" :size="14" class="dd-text-muted" />
              <input ref="searchInput" v-model="searchQuery"
                     type="text"
                     aria-label="Search"
                     placeholder="Jump to pages, containers, agents, triggers..."
                     class="flex-1 bg-transparent text-sm dd-text font-mono outline-none placeholder:dd-text-muted"
                     @keydown.escape="showSearch = false"
                     @keydown="handleSearchInputKeydown" />
              <span v-if="scopePrefixLabel"
                    class="px-1.5 py-0.5 text-2xs uppercase tracking-wide font-semibold dd-rounded-sm dd-bg-elevated dd-text-secondary">
                {{ scopePrefixLabel }}
              </span>
              <kbd class="px-1.5 py-0.5 dd-rounded-sm text-2xs font-medium dd-bg-elevated dd-text-muted">ESC</kbd>
            </div>
            <div class="px-3 py-2 flex items-center gap-1.5"
                 :style="{ borderBottom: '1px solid var(--dd-border)' }">
              <AppButton size="none" variant="plain" weight="none"
                v-for="scopeOption in SEARCH_SCOPE_OPTIONS"
                :key="scopeOption.id"
                class="inline-flex items-center gap-1 px-2 py-1 text-2xs uppercase tracking-wide font-semibold border dd-rounded transition-colors"
                :aria-pressed="String(scopeOption.id === effectiveSearchScope)"
                :style="searchScopeChipStyles(scopeOption.id, scopeOption.id === effectiveSearchScope)"
                @click="applySearchScope(scopeOption.id)">
                {{ scopeOption.label }}
                <span class="text-3xs opacity-80">{{ searchScopeCounts[scopeOption.id] }}</span>
              </AppButton>
              <span class="ml-auto text-2xs dd-text-muted">
                {{ searchResults.length }} shown
              </span>
            </div>
            <div class="max-h-[360px] overflow-y-auto py-1">
              <template v-for="(group, groupIndex) in groupedSearchResults" :key="group.id">
                <div class="px-4 py-1.5 text-2xs font-bold uppercase tracking-[var(--dd-letter-spacing-section)] dd-text-muted"
                     :style="groupIndex > 0 ? { borderTop: '1px solid var(--dd-border)' } : {}">
                  {{ group.label }}
                </div>
                <AppButton size="none" variant="plain" weight="none"
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
                    <div class="text-xs font-semibold truncate dd-text">{{ result.title }}</div>
                    <div class="text-2xs truncate dd-text-muted">{{ result.subtitle }}</div>
                  </div>
                  <AppIcon name="chevron-right" :size="11" class="dd-text-muted shrink-0" />
                </AppButton>
              </template>
              <div v-if="searchResults.length === 0"
                   class="px-4 py-6 text-center text-xs dd-text-muted">
                <span v-if="sidebarDataLoading || searchResourcesLoading">Refreshing search index...</span>
                <span v-else-if="parsedSearchQuery.text">No matches for "{{ parsedSearchQuery.text }}".</span>
                <span v-else>Type to search pages, containers, agents, triggers, watchers, and settings.</span>
              </div>
            </div>
            <div class="px-4 py-2.5 flex items-center justify-between text-2xs dd-text-muted"
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
             class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center"
             style="z-index: var(--z-modal, 200)">
          <div class="w-full max-w-[var(--dd-layout-overlay-max-width)] mx-4 dd-rounded-lg overflow-hidden shadow-2xl text-center"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="flex flex-col items-center px-6 py-8 gap-3">
              <div class="disconnect-bounce h-10 mb-1">
                <img :src="whaleLogo" alt="" class="h-10 w-auto"
                     :style="[{ transform: 'rotate(180deg) scaleX(-1)' }, isDark ? { filter: 'invert(1)' } : {}]" />
              </div>
              <h2 class="text-sm font-bold dd-text">{{ connectionOverlayTitle }}</h2>
              <p class="text-2xs-plus dd-text-muted leading-relaxed">
                {{ connectionOverlayMessage }}
              </p>
              <div class="flex items-center gap-2 mt-1">
                <AppIcon name="spinner" :size="12" class="dd-spin dd-text-muted" />
                <span class="text-2xs dd-text-muted">{{ connectionOverlayStatus }}</span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
@keyframes swim {
  0% { left: 0; transform: scaleX(-1); }
  45% { left: calc(100% - 65px); transform: scaleX(-1); }
  50% { left: calc(100% - 65px); transform: scaleX(1); }
  95% { left: 0; transform: scaleX(1); }
  100% { left: 0; transform: scaleX(-1); }
}
.about-swim {
  animation: swim var(--dd-duration-decorative) ease-in-out infinite;
}
.disconnect-bounce {
  animation: disconnect-bounce var(--dd-duration-pulse) ease-in-out infinite;
}
@keyframes disconnect-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(var(--dd-motion-bounce-y)); }
}
</style>
