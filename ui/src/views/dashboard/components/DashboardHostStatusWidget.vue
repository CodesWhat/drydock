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
// full = header + wide rows with vertical scroll
// compact = no header, horizontal cards with horizontal scroll
const mode = ref<'full' | 'compact'>('full');

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

watchEffect(() => {
  mode.value = containerHeight.value >= 250 ? 'full' : 'compact';
});
</script>

<template>
  <div
    ref="rootEl"
    aria-label="Host Status widget"
    class="dashboard-widget dd-rounded overflow-hidden flex flex-col"
    :style="{ backgroundColor: 'var(--dd-bg-card)' }">

    <!-- Header — full mode only -->
    <div v-if="mode === 'full'" class="shrink-0 flex items-center justify-between px-5 py-3.5" :style="{ borderBottom: '1px solid var(--dd-border)' }">
      <div class="flex items-center gap-2">
        <div v-if="editMode" class="drag-handle dd-drag-handle"><AppIcon name="ph:dots-six-vertical" :size="14" /></div>
        <AppIcon name="servers" :size="14" class="text-drydock-secondary" />
        <h2 class="text-sm font-semibold dd-text">Host Status</h2>
      </div>
      <AppButton size="none" variant="link-secondary" weight="medium" class="text-2xs-plus" @click="handleViewAll">View all &rarr;</AppButton>
    </div>

    <!-- Full mode: wide rows, vertical scroll -->
    <div v-if="mode === 'full'" class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3">
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

    <!-- Compact mode: horizontal cards, horizontal scroll -->
    <div v-else class="flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-4 relative">
      <div v-if="editMode" class="drag-handle dd-drag-handle absolute top-2 left-2 z-10"><AppIcon name="ph:dots-six" :size="14" /></div>
      <div class="flex gap-3 h-full" :class="servers.length <= 3 ? 'justify-center' : ''">
        <div
          v-for="server in servers"
          :key="server.name"
          class="flex-none w-40 p-3 dd-rounded cursor-pointer transition-colors hover:dd-bg-elevated text-center flex flex-col items-center justify-center gap-1.5"
          :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
          @click="handleViewAll">
          <span
            class="w-7 h-7 dd-rounded flex items-center justify-center"
            :style="{
              backgroundColor: server.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
              color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
            }">
            <AppIcon :name="server.status === 'connected' ? 'check' : 'xmark'" :size="14" />
          </span>
          <div class="text-xs font-semibold dd-text truncate w-full">{{ server.name }}</div>
          <div v-if="server.host" class="text-3xs font-mono dd-text-muted truncate w-full">{{ server.host }}</div>
          <div class="text-2xs dd-text-muted">{{ server.containers.running }}/{{ server.containers.total }} containers</div>
          <span
            class="text-3xs font-bold uppercase"
            :style="{ color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }">
            {{ server.statusLabel ?? server.status }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
