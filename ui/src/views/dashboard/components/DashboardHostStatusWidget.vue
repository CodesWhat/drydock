<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import AppStatusIndicator from '@/components/AppStatusIndicator.vue';
import type { DashboardServerRow } from '../dashboardTypes';

interface Props {
  editMode: boolean;
  servers: DashboardServerRow[];
}

const props = defineProps<Props>();

const { t } = useI18n();

const emit = defineEmits<{
  viewAll: [];
}>();

function handleViewAll() {
  emit('viewAll');
}

function serverTone(status: DashboardServerRow['status']) {
  return status === 'connected' ? 'success' : 'danger';
}

const rootEl = ref<HTMLElement | null>(null);
const containerHeight = ref(999);
// full = header + wide rows with vertical scroll
// compact = no header, horizontal cards with horizontal scroll
const mode = ref<'full' | 'compact'>('full');

const FULL_MODE_ROW_HEIGHT = 70;
const FULL_MODE_ROW_GAP = 12;
const FULL_MODE_SCROLL_PADDING = 32;
const FULL_MODE_HEADER_HEIGHT = 49;

let observer: ResizeObserver | null = null;

function getFullModeContentHeight(rowCount: number): number {
  return (
    FULL_MODE_SCROLL_PADDING +
    rowCount * FULL_MODE_ROW_HEIGHT +
    Math.max(0, rowCount - 1) * FULL_MODE_ROW_GAP
  );
}

onMounted(() => {
  if (!rootEl.value) return;
  observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      containerHeight.value = entry.contentRect.height;
    }
  });
  observer.observe(rootEl.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
});

watchEffect(() => {
  const viewportHeight = Math.max(containerHeight.value - FULL_MODE_HEADER_HEIGHT, 0);
  mode.value =
    viewportHeight >= getFullModeContentHeight(props.servers.length) ? 'full' : 'compact';
});
</script>

<template>
  <div
    ref="rootEl"
    :aria-label="t('dashboardView.hostStatus.title')"
    class="dashboard-widget dd-rounded overflow-hidden flex flex-col"
    :style="{ backgroundColor: 'var(--dd-bg-card)' }">

    <!-- Header — full mode only -->
    <div v-if="mode === 'full'" class="shrink-0 flex items-center justify-between px-5 py-3.5" :style="{ borderBottom: '1px solid var(--dd-border)' }">
      <div class="flex items-center gap-2">
        <div v-if="editMode" class="drag-handle dd-drag-handle" v-tooltip.top="t('dashboardView.dragToReorder')"><AppIcon name="ph:dots-six-vertical" :size="14" /></div>
        <AppIcon name="servers" :size="14" class="text-drydock-secondary" />
        <h2 class="dd-text-heading-section dd-text">{{ t('dashboardView.hostStatus.title') }}</h2>
      </div>
      <AppButton size="compact" variant="link-secondary" weight="medium" class="text-2xs-plus" @click="handleViewAll">{{ t('dashboardView.viewAll') }}</AppButton>
    </div>

    <!-- Full mode: wide rows, vertical scroll -->
    <div
      v-if="mode === 'full'"
      class="flex-1 min-h-0 overflow-y-auto overscroll-contain dd-scroll-stable p-4 space-y-3">
      <div
        v-for="server in servers"
        :key="server.name"
        data-host-row
        class="flex items-start gap-3 p-3 dd-rounded cursor-pointer transition-colors hover:dd-bg-elevated"
        :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
        @click="handleViewAll">
        <div class="flex-1 min-w-0">
          <div class="text-xs font-semibold truncate dd-text">{{ server.name }}</div>
          <div v-if="server.host" class="text-2xs font-mono dd-text-muted truncate mt-0.5">{{ server.host }}</div>
          <div class="text-2xs dd-text-muted">{{ t('dashboardView.hostStatus.containerCount', { running: server.containers.running, total: server.containers.total }) }}</div>
        </div>
        <AppStatusIndicator
          v-tooltip.top="server.status === 'connected' ? t('dashboardView.hostStatus.connected') : t('dashboardView.hostStatus.disconnected')"
          size="sm"
          class="mt-0.5 shrink-0"
          :tone="serverTone(server.status)"
          :label="server.statusLabel ?? (server.status === 'connected' ? t('dashboardView.hostStatus.connected') : t('dashboardView.hostStatus.disconnected'))" />
      </div>
    </div>

    <!-- Compact mode: horizontal cards, horizontal scroll -->
    <div v-else class="flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-4 relative">
      <div v-if="editMode" class="drag-handle dd-drag-handle absolute top-2 left-2 z-10" v-tooltip.top="t('dashboardView.dragToReorder')"><AppIcon name="ph:dots-six" :size="14" /></div>
      <div class="flex gap-3 h-full" :class="servers.length <= 3 ? 'justify-center' : ''">
        <div
          v-for="server in servers"
          :key="server.name"
          class="flex-none w-40 p-3 dd-rounded cursor-pointer transition-colors hover:dd-bg-elevated text-center flex flex-col items-center justify-center gap-1.5"
          :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
          @click="handleViewAll">
          <AppStatusIndicator
            v-tooltip.top="server.status === 'connected' ? t('dashboardView.hostStatus.connected') : t('dashboardView.hostStatus.disconnected')"
            marker="icon"
            :icon="server.status === 'connected' ? 'check' : 'xmark'"
            :tone="serverTone(server.status)"
            :label="server.statusLabel ?? (server.status === 'connected' ? t('dashboardView.hostStatus.connected') : t('dashboardView.hostStatus.disconnected'))"
            size="sm"
            class="justify-center" />
          <div class="text-xs font-semibold dd-text truncate w-full">{{ server.name }}</div>
          <div v-if="server.host" class="text-3xs font-mono dd-text-muted truncate w-full">{{ server.host }}</div>
          <div class="text-2xs dd-text-muted">{{ t('dashboardView.hostStatus.containerCount', { running: server.containers.running, total: server.containers.total }) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
