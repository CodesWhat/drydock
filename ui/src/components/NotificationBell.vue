<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ROUTES } from '../router/routes';
import { useStorageRef } from '../composables/useStorageRef';
import { getAuditLog } from '../services/audit';
import type { AuditEntry } from '../utils/audit-helpers';
import { actionIcon, actionLabel, statusColor, timeAgo } from '../utils/audit-helpers';

const router = useRouter();

const showBell = ref(false);
const bellPanelStyle = ref<Record<string, string>>({});
const entries = ref<AuditEntry[]>([]);
const loading = ref(false);
const lastSeen = useStorageRef('dd-bell-last-seen', '');

const unreadCount = computed(() => {
  if (!lastSeen.value) return entries.value.length;
  return entries.value.filter((e) => e.timestamp > lastSeen.value).length;
});

async function fetchEntries() {
  loading.value = true;
  try {
    const data = await getAuditLog({ limit: 20 });
    entries.value = data.entries ?? [];
  } catch {
    // Silently fail — bell is non-critical.
  } finally {
    loading.value = false;
  }
}

function toggle(event: MouseEvent) {
  showBell.value = !showBell.value;
  if (showBell.value) {
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    bellPanelStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      right: `${window.innerWidth - rect.right}px`,
    };
    fetchEntries();
  }
}

function navigateToEntry(entry: AuditEntry) {
  showBell.value = false;
  router.push({ path: ROUTES.AUDIT, query: { container: entry.containerName } });
}

function viewAll() {
  showBell.value = false;
  router.push(ROUTES.AUDIT);
}

function markAllRead() {
  lastSeen.value = new Date().toISOString();
}

function handleClickOutside(e: PointerEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('.notification-bell-wrapper')) {
    showBell.value = false;
  }
}

let sseDebounceTimer: ReturnType<typeof setTimeout> | undefined;

function handleSseEvent() {
  clearTimeout(sseDebounceTimer);
  sseDebounceTimer = setTimeout(() => {
    fetchEntries();
  }, 800);
}

onMounted(() => {
  fetchEntries();
  document.addEventListener('pointerdown', handleClickOutside);
  globalThis.addEventListener('dd:sse-container-changed', handleSseEvent);
  globalThis.addEventListener('dd:sse-scan-completed', handleSseEvent);
});

onUnmounted(() => {
  clearTimeout(sseDebounceTimer);
  document.removeEventListener('pointerdown', handleClickOutside);
  globalThis.removeEventListener('dd:sse-container-changed', handleSseEvent);
  globalThis.removeEventListener('dd:sse-scan-completed', handleSseEvent);
});

function versionSummary(entry: AuditEntry): string {
  if (entry.fromVersion && entry.toVersion) return `${entry.fromVersion} → ${entry.toVersion}`;
  if (entry.toVersion) return entry.toVersion;
  return '';
}

function isUnread(entry: AuditEntry): boolean {
  if (!lastSeen.value) return true;
  return entry.timestamp > lastSeen.value;
}
</script>

<template>
  <div class="relative notification-bell-wrapper">
    <AppButton size="none" variant="plain" weight="none" aria-label="Notifications"
            :aria-expanded="String(showBell)"
            class="relative flex items-center justify-center w-8 h-8 dd-rounded transition-colors dd-text-secondary hover:dd-bg-elevated hover:dd-text"
            @click="toggle">
      <AppIcon name="notifications" :size="18" />
      <span v-if="unreadCount > 0"
            class="badge-pulse absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center rounded-full text-3xs font-bold text-white"
            style="background: var(--dd-danger);">
        {{ unreadCount > 9 ? '9+' : unreadCount }}
      </span>
    </AppButton>
    <Transition name="menu-fade">
      <div v-if="showBell" data-test="notification-dropdown"
           class="w-[calc(100vw-1rem)] max-w-[380px] dd-rounded-lg shadow-lg"
           :style="{ ...bellPanelStyle, zIndex: 'var(--z-popover)', backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)', boxShadow: 'var(--dd-shadow-tooltip)' }">
        <!-- Header -->
        <div class="flex items-center justify-between px-3 py-2"
             :style="{ borderBottom: '1px solid var(--dd-border)' }">
          <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">Notifications</span>
          <AppButton size="none" variant="plain" weight="none" v-if="unreadCount > 0"
                  class="text-2xs font-medium dd-text-secondary hover:dd-text transition-colors"
                  @click="markAllRead">
            Mark all read
          </AppButton>
        </div>

        <!-- Scrollable list -->
        <div class="max-h-[400px] overflow-y-auto">
          <div v-if="loading && entries.length === 0" class="px-3 py-6 text-center text-2xs-plus dd-text-muted">
            Loading...
          </div>
          <div v-else-if="entries.length === 0" class="px-3 py-6 text-center text-2xs-plus dd-text-muted">
            No notifications yet
          </div>
          <AppButton size="none" variant="plain" weight="none" v-for="entry in entries"
                  :key="entry.id"
                  class="w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors hover:dd-bg-elevated"
                  :style="{ borderBottom: '1px solid var(--dd-border)' }"
                  @click="navigateToEntry(entry)">
            <AppIcon :name="actionIcon(entry.action)"
                     :size="13"
                     class="shrink-0 mt-0.5"
                     :style="{ color: statusColor(entry.status) }" />
            <div class="flex-1 min-w-0">
              <div class="text-2xs-plus truncate dd-text"
                   :class="{ 'font-bold': isUnread(entry), 'font-medium': !isUnread(entry) }">
                {{ actionLabel(entry.action) }}
              </div>
              <div class="text-2xs truncate dd-text-muted font-mono mt-0.5">
                {{ entry.containerName }}
              </div>
              <div v-if="versionSummary(entry)" class="text-2xs dd-text-secondary font-mono mt-0.5">
                {{ versionSummary(entry) }}
              </div>
            </div>
            <span class="text-2xs dd-text-muted whitespace-nowrap shrink-0 mt-0.5">
              {{ timeAgo(entry.timestamp) }}
            </span>
          </AppButton>
        </div>

        <!-- Footer -->
        <AppButton size="none" variant="plain" weight="none" class="w-full text-center px-3 py-2 text-2xs-plus font-medium dd-text-secondary hover:dd-text transition-colors"
                :style="{ borderTop: '1px solid var(--dd-border)' }"
                @click="viewAll">
          View all
        </AppButton>
      </div>
    </Transition>
  </div>
</template>
