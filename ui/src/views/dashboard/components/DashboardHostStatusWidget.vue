<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import type { DashboardServerRow } from '../dashboardTypes';

interface Props {
  editMode: boolean;
  servers: DashboardServerRow[];
}

defineProps<Props>();

const emit = defineEmits<{
  viewAll: [];
}>();

function handleViewAll() {
  emit('viewAll');
}

const rootEl = ref<HTMLElement | null>(null);
const containerHeight = ref(999);

let observer: ResizeObserver | null = null;

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

const showHeader = ref(true);

watchEffect(() => {
  showHeader.value = containerHeight.value >= 200;
});
</script>

<template>
  <div
    ref="rootEl"
    aria-label="Host Status widget"
    class="dashboard-widget dd-rounded overflow-hidden flex flex-col"
    :style="{ backgroundColor: 'var(--dd-bg-card)' }">

    <div v-if="showHeader" class="shrink-0 flex items-center justify-between px-5 py-3.5" :style="{ borderBottom: '1px solid var(--dd-border)' }">
      <div class="flex items-center gap-2">
        <div v-if="editMode" class="drag-handle dd-drag-handle"><AppIcon name="ph:dots-six-vertical" :size="14" /></div>
        <AppIcon name="servers" :size="14" class="text-drydock-secondary" />
        <h2 class="text-sm font-semibold dd-text">Host Status</h2>
      </div>
      <AppButton size="none" variant="link-secondary" weight="medium" class="text-2xs-plus" @click="handleViewAll">View all &rarr;</AppButton>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 relative">
      <div v-if="!showHeader && editMode" class="drag-handle dd-drag-handle absolute top-2 left-2 z-10"><AppIcon name="ph:dots-six" :size="14" /></div>
      <div
        v-for="server in servers"
        :key="server.name"
        class="flex items-center gap-3 p-3 dd-rounded cursor-pointer transition-colors hover:dd-bg-elevated"
        :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
        @click="handleViewAll">
        <span
          class="badge px-1.5 py-0 text-3xs"
          :style="{
            backgroundColor: server.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
            color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
          }">
          <AppIcon :name="server.status === 'connected' ? 'check' : 'xmark'" :size="12" />
        </span>
        <div class="flex-1 min-w-0">
          <div class="text-xs font-semibold truncate dd-text">{{ server.name }}</div>
          <div v-if="server.host" class="text-2xs font-mono dd-text-muted truncate mt-0.5">{{ server.host }}</div>
          <div class="text-2xs dd-text-muted">{{ server.containers.running }}/{{ server.containers.total }} containers</div>
        </div>
        <span
          class="badge text-3xs uppercase font-bold"
          :style="{
            backgroundColor: server.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
            color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
          }">
          {{ server.statusLabel ?? server.status }}
        </span>
      </div>
    </div>
  </div>
</template>
