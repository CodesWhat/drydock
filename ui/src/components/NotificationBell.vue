<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useStorageRef } from '../composables/useStorageRef';
import { getAuditLog } from '../services/audit';
import type { AuditEntry } from '../utils/audit-helpers';
import { actionIcon, actionLabel, statusColor, timeAgo } from '../utils/audit-helpers';

const router = useRouter();

const showBell = ref(false);
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

function toggle() {
  showBell.value = !showBell.value;
  if (showBell.value) {
    fetchEntries();
  }
}

function navigateToEntry(entry: AuditEntry) {
  showBell.value = false;
  router.push(`/audit?container=${encodeURIComponent(entry.containerName)}`);
}

function viewAll() {
  showBell.value = false;
  router.push('/audit');
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

function handleSseEvent() {
  fetchEntries();
}

onMounted(() => {
  fetchEntries();
  document.addEventListener('pointerdown', handleClickOutside);
  globalThis.addEventListener('dd:sse-container-changed', handleSseEvent);
  globalThis.addEventListener('dd:sse-scan-completed', handleSseEvent);
});

onUnmounted(() => {
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
    <button aria-label="Notifications"
            :aria-expanded="String(showBell)"
            class="relative flex items-center justify-center w-8 h-8 dd-rounded transition-colors dd-text-secondary hover:dd-bg-elevated hover:dd-text"
            @click="toggle">
      <AppIcon name="notifications" :size="18" />
      <span v-if="unreadCount > 0"
            class="badge-pulse absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-bold text-white"
            style="background: var(--dd-danger);">
        {{ unreadCount > 9 ? '9+' : unreadCount }}
      </span>
    </button>
    <Transition name="menu-fade">
      <div v-if="showBell"
           class="absolute right-0 top-full mt-1 w-[380px] dd-rounded-lg shadow-lg z-50"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)', boxShadow: 'var(--dd-shadow-lg)' }">
        <!-- Header -->
        <div class="flex items-center justify-between px-3 py-2"
             :style="{ borderBottom: '1px solid var(--dd-border)' }">
          <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Notifications</span>
          <button v-if="unreadCount > 0"
                  class="text-[10px] font-medium dd-text-secondary hover:dd-text transition-colors"
                  @click="markAllRead">
            Mark all read
          </button>
        </div>

        <!-- Scrollable list -->
        <div class="max-h-[400px] overflow-y-auto">
          <div v-if="loading && entries.length === 0" class="px-3 py-6 text-center text-[11px] dd-text-muted">
            Loading...
          </div>
          <div v-else-if="entries.length === 0" class="px-3 py-6 text-center text-[11px] dd-text-muted">
            No notifications yet
          </div>
          <button v-for="entry in entries"
                  :key="entry.id"
                  class="w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors hover:dd-bg-elevated"
                  :style="{ borderBottom: '1px solid var(--dd-border)' }"
                  @click="navigateToEntry(entry)">
            <AppIcon :name="actionIcon(entry.action)"
                     :size="13"
                     class="shrink-0 mt-0.5"
                     :style="{ color: statusColor(entry.status) }" />
            <div class="flex-1 min-w-0">
              <div class="text-[11px] truncate dd-text"
                   :class="{ 'font-bold': isUnread(entry), 'font-medium': !isUnread(entry) }">
                {{ actionLabel(entry.action) }}
              </div>
              <div class="text-[10px] truncate dd-text-muted font-mono mt-0.5">
                {{ entry.containerName }}
              </div>
              <div v-if="versionSummary(entry)" class="text-[10px] dd-text-secondary font-mono mt-0.5">
                {{ versionSummary(entry) }}
              </div>
            </div>
            <span class="text-[10px] dd-text-muted whitespace-nowrap shrink-0 mt-0.5">
              {{ timeAgo(entry.timestamp) }}
            </span>
          </button>
        </div>

        <!-- Footer -->
        <button class="w-full text-center px-3 py-2 text-[11px] font-medium dd-text-secondary hover:dd-text transition-colors"
                :style="{ borderTop: '1px solid var(--dd-border)' }"
                @click="viewAll">
          View all
        </button>
      </div>
    </Transition>
  </div>
</template>
