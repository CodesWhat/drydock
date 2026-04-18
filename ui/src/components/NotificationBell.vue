<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import AppIconButton from '@/components/AppIconButton.vue';
import { ROUTES } from '../router/routes';
import { useStorageRef } from '../composables/useStorageRef';
import { getAuditLog } from '../services/audit';
import type { AuditEntry } from '../utils/audit-helpers';
import { actionIcon, actionLabel, statusColor, timeAgo } from '../utils/audit-helpers';

const router = useRouter();

const BELL_ACTIONS = [
  'update-available',
  'update-applied',
  'update-failed',
  'notification-delivery-failed',
  'security-alert',
  'agent-disconnect',
];

const showBell = ref(false);
const bellPanelStyle = ref<Record<string, string>>({});
const entries = ref<AuditEntry[]>([]);
const loading = ref(false);
const lastSeen = useStorageRef('dd-bell-last-seen', '');
const dismissedIds = useStorageRef<string[]>(
  'dd-bell-dismissed-ids',
  [],
  (v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string'),
);

const visibleEntries = computed(() => {
  const dismissed = new Set(dismissedIds.value);
  return entries.value.filter((e) => !dismissed.has(e.id));
});

const unreadCount = computed(() => {
  if (!lastSeen.value) return visibleEntries.value.length;
  return visibleEntries.value.filter((e) => e.timestamp > lastSeen.value).length;
});

async function fetchEntries() {
  loading.value = true;
  try {
    const data = await getAuditLog({ limit: 20, actions: BELL_ACTIONS });
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

function openAuditLog() {
  showBell.value = false;
  router.push(ROUTES.AUDIT);
}

function markAllRead() {
  lastSeen.value = new Date().toISOString();
}

function dismissOne(entry: AuditEntry) {
  if (dismissedIds.value.includes(entry.id)) return;
  dismissedIds.value = [...dismissedIds.value, entry.id];
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
  globalThis.addEventListener('dd:sse-connected', handleSseEvent);
});

onUnmounted(() => {
  clearTimeout(sseDebounceTimer);
  document.removeEventListener('pointerdown', handleClickOutside);
  globalThis.removeEventListener('dd:sse-container-changed', handleSseEvent);
  globalThis.removeEventListener('dd:sse-scan-completed', handleSseEvent);
  globalThis.removeEventListener('dd:sse-connected', handleSseEvent);
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
    <AppIconButton
            icon="notifications"
            size="sm"
            variant="secondary"
            tooltip="Notifications"
            aria-label="Notifications"
            :aria-expanded="String(showBell)"
            class="relative"
            @click="toggle"
    />
    <span v-if="unreadCount > 0"
          class="badge-pulse absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center rounded-full text-3xs font-bold text-white pointer-events-none"
          style="background: var(--dd-danger);">
      {{ unreadCount > 9 ? '9+' : unreadCount }}
    </span>
    <Transition name="menu-fade">
      <div v-if="showBell" data-test="notification-dropdown"
           class="w-[calc(100vw-1rem)] max-w-[380px] dd-rounded-lg shadow-lg"
           :style="{ ...bellPanelStyle, zIndex: 'var(--z-popover)', backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)', boxShadow: 'var(--dd-shadow-tooltip)' }">
        <!-- Header: title only -->
        <div class="flex items-center px-3 py-2"
             :style="{ borderBottom: '1px solid var(--dd-border)' }">
          <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">Notifications</span>
        </div>

        <!-- Scrollable list -->
        <div class="max-h-[400px] overflow-y-auto">
          <div v-if="loading && visibleEntries.length === 0" class="px-3 py-6 text-center text-2xs-plus dd-text-muted">
            Loading...
          </div>
          <div v-else-if="visibleEntries.length === 0" class="px-3 py-6 text-center text-2xs-plus dd-text-muted">
            No notifications yet
          </div>
          <div v-for="(entry, index) in visibleEntries"
               :key="entry.id"
               data-test="notification-row"
               class="group relative flex items-stretch transition-colors hover:dd-bg-elevated"
               :style="{ backgroundColor: index % 2 === 0 ? 'var(--dd-bg-card)' : 'var(--dd-zebra-stripe)' }">
            <AppButton size="none" variant="plain" weight="none"
                    class="flex-1 text-left px-3 py-2 flex items-start gap-2.5 min-w-0"
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
                <div class="text-2xs truncate dd-text-muted font-mono mt-0.5"
                     :title="entry.containerName"
                     v-tooltip.top="entry.containerName">
                  {{ entry.containerName }}
                </div>
                <div v-if="versionSummary(entry)"
                     class="text-2xs dd-text-secondary font-mono mt-0.5 truncate"
                     data-test="notification-version-summary"
                     :title="versionSummary(entry)"
                     v-tooltip.top="versionSummary(entry)">
                  {{ versionSummary(entry) }}
                </div>
              </div>
              <span class="text-2xs dd-text-muted whitespace-nowrap shrink-0 mt-0.5">
                {{ timeAgo(entry.timestamp) }}
              </span>
            </AppButton>
            <div class="dd-bell-dismiss flex items-center pr-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <AppIconButton icon="xmark"
                             size="sm"
                             variant="danger"
                             tooltip="Dismiss"
                             aria-label="Dismiss notification"
                             data-test="notification-dismiss"
                             @click.stop="dismissOne(entry)" />
            </div>
          </div>
        </div>

        <!-- Footer: split actions -->
        <div class="flex items-stretch"
             :style="{ borderTop: '1px solid var(--dd-border)' }">
          <AppButton v-if="unreadCount > 0"
                  size="none" variant="plain" weight="none"
                  class="flex-1 px-3 py-2 text-2xs-plus font-medium dd-text-secondary hover:dd-text transition-colors flex items-center justify-center gap-1.5"
                  data-test="mark-all-read-btn"
                  @click="markAllRead">
            <AppIcon name="check" :size="11" />
            Mark all as read
          </AppButton>
          <div v-if="unreadCount > 0"
               aria-hidden="true"
               class="w-px"
               :style="{ backgroundColor: 'var(--dd-border)' }" />
          <AppButton size="none" variant="plain" weight="none"
                  class="flex-1 px-3 py-2 text-2xs-plus font-medium dd-text-secondary hover:dd-text transition-colors flex items-center justify-center gap-1.5"
                  data-test="open-audit-log-btn"
                  @click="openAuditLog">
            Open audit log
            <AppIcon name="external-link" :size="10" />
          </AppButton>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
@media (pointer: coarse) {
  .dd-bell-dismiss {
    opacity: 1 !important;
  }
}
</style>
