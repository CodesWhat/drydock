<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import whaleLogo from '@/assets/whale-logo.png';
import { useBreakpoints } from '@/composables/useBreakpoints';
import { useIcons } from '@/composables/useIcons';
import { getUser, logout } from '@/services/auth';
import { getAllContainers } from '@/services/container';
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

const hiddenPages: Record<string, { label: string; icon: string }> = {
  '/profile': { label: 'Profile', icon: 'user' },
};

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
  try { await logout(); } finally { router.push('/login'); }
}

// Search modal
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

onMounted(async () => {
  globalThis.addEventListener('keydown', handleKeydown);
  // Fetch sidebar badge data and user info
  try {
    const [containers, user] = await Promise.all([
      getAllContainers().catch(() => []),
      getUser().catch(() => null),
    ]);
    if (Array.isArray(containers)) {
      containerCount.value = String(containers.length);
      const issues = containers.filter(
        (c: Record<string, unknown>) =>
          c.updateKind === 'major' || c.result?.vulnerabilities?.length,
      ).length;
      if (issues > 0) securityIssueCount.value = String(issues);
    }
    if (user) currentUser.value = user;
  } catch {
    // Sidebar works without badge data
  }
});
onUnmounted(() => {
  globalThis.removeEventListener('keydown', handleKeydown);
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
      <div class="flex items-center h-12 shrink-0 overflow-hidden"
           :class="isCollapsed ? 'justify-center px-1' : 'px-3'"
           :style="{ borderBottom: '1px solid var(--dd-border)' }">
        <div class="flex items-center gap-2 overflow-hidden shrink-0">
          <img :src="whaleLogo" alt="Drydock"
               class="h-5 w-auto shrink-0 transition-transform duration-300"
               :style="[isCollapsed ? { transform: 'scaleX(-1)' } : {}, isDark ? { filter: 'invert(1)' } : {}]" />
          <span class="sidebar-label font-bold text-sm tracking-widest dd-text"
                style="letter-spacing:0.15em;">DRYDOCK</span>
        </div>
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

      <!-- Sidebar search (mobile only) -->
      <div v-if="isMobile" class="shrink-0 px-3 pt-3 pb-1">
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
      <div class="shrink-0 px-3 py-3 space-y-2"
           :style="{ borderTop: '1px solid var(--dd-border)' }">
        <div class="flex items-center justify-between"
             :style="isCollapsed ? { justifyContent: 'center' } : {}">
          <span class="text-[10px] font-medium px-1.5 py-0.5 dd-rounded-sm dd-bg-card dd-text-muted">
            v1.4.0
          </span>
          <a v-if="!isCollapsed"
             href="#" class="text-[10px] font-medium px-1.5 py-0.5 dd-rounded-sm no-underline hover:underline dd-bg-card dd-text-muted hover:dd-text">
            Docs
          </a>
        </div>
        <button v-if="!isMobile"
                class="w-full flex items-center gap-2 dd-rounded text-xs font-medium transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                :style="{
                  padding: sidebarCollapsed ? '6px 0' : '6px 8px',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                }"
                @click="sidebarCollapsed = !sidebarCollapsed">
          <AppIcon :name="sidebarCollapsed ? 'sidebar-expand' : 'sidebar-collapse'" :size="14" />
          <span class="sidebar-label">Collapse</span>
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
            <AppIcon :name="currentPageIcon" :size="14" class="leading-none dd-text-muted" />
            <AppIcon name="chevron-right" :size="11" class="leading-none dd-text-muted" />
            <span class="font-medium leading-none dd-text">
              {{ currentPageLabel }}
            </span>
          </nav>
        </div>

        <!-- Center: search trigger (hidden on mobile — shown in sidebar instead) -->
        <button class="hidden sm:flex items-center gap-2 dd-rounded px-3 py-1.5 text-xs transition-colors min-w-[220px] dd-bg-card dd-text-secondary hover:dd-bg-elevated hover:dd-text"
                :style="{ border: '1px solid var(--dd-border)' }"
                @click="showSearch = true">
          <AppIcon name="search" :size="12" />
          <span>Search</span>
          <kbd class="inline-flex items-center gap-0.5 ml-auto px-1.5 py-0.5 dd-rounded-sm text-[10px] font-medium dd-bg-elevated dd-text-muted">
            <span class="text-[9px]">&#8984;</span>K
          </kbd>
        </button>
        <!-- Placeholder to keep grid balanced on mobile -->
        <div class="sm:hidden" />

        <!-- Right: theme, notifications, avatar -->
        <div class="flex items-center gap-2 justify-end">
          <ThemeToggle />

          <button class="relative flex items-center justify-center w-8 h-8 dd-rounded transition-colors dd-text-secondary hover:dd-bg-elevated hover:dd-text">
            <AppIcon name="notifications" :size="14" />
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
              <AppIcon name="chevron-down" :size="10" class="dd-text-muted" />
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
                        @click="showUserMenu = false; router.push('/profile')">
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
      <main class="flex-1 min-h-0 overflow-hidden flex flex-col"
            :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
        <router-view />
      </main>
    </div>

    <!-- Search Modal -->
    <Teleport to="body">
      <div v-if="showSearch"
           class="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
           @pointerdown.self="showSearch = false">
        <div class="flex items-start justify-center pt-[15vh] min-h-full px-4"
             @pointerdown.self="showSearch = false">
          <div class="relative w-full max-w-[500px] dd-rounded-lg overflow-hidden shadow-2xl"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-3 px-4 py-3"
                 :style="{ borderBottom: '1px solid var(--dd-border)' }">
              <AppIcon name="search" :size="14" class="dd-text-muted" />
              <input ref="searchInput" v-model="searchQuery"
                     type="text"
                     placeholder="Search containers, settings..."
                     class="flex-1 bg-transparent text-sm dd-text font-mono outline-none placeholder:dd-text-muted"
                     @keydown.escape="showSearch = false" />
              <kbd class="px-1.5 py-0.5 dd-rounded-sm text-[10px] font-medium dd-bg-elevated dd-text-muted">ESC</kbd>
            </div>
            <div class="px-4 py-6 text-center text-xs dd-text-muted">
              Start typing to search...
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
