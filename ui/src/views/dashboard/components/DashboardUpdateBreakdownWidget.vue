<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { UpdateBreakdownBucket } from '../dashboardTypes';

interface Props {
  editMode: boolean;
  totalUpdates: number;
  updateBreakdownBuckets: UpdateBreakdownBucket[];
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

// full: header + big icon grid
// medium: header + compact inline row
// compact: no header, just inline row
const mode = ref<'full' | 'medium' | 'compact'>('full');

let observer: ResizeObserver | null = null;

onMounted(() => {
  if (!rootEl.value) return;
  observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const h = entry.contentRect.height;
      containerHeight.value = h;
      // full = header + icon grid (needs ~250px for header + cards)
      // medium = icon grid only, no header (fits any reasonable size)
      // compact = tiny inline row (truly tiny widgets only)
      if (h >= 250) mode.value = 'full';
      else if (h >= 60) mode.value = 'medium';
      else mode.value = 'compact';
    }
  });
  observer.observe(rootEl.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
});
</script>

<template>
  <div
    ref="rootEl"
    aria-label="Update Breakdown widget"
    class="dashboard-widget dd-rounded overflow-hidden flex flex-col"
    :style="{ backgroundColor: 'var(--dd-bg-card)' }">

    <!-- Header — shown in full mode only -->
    <div v-if="mode === 'full'" class="shrink-0 flex items-center justify-between px-5 py-3.5" :style="{ borderBottom: '1px solid var(--dd-border)' }">
      <div class="flex items-center gap-2">
        <div v-if="editMode" class="drag-handle dd-drag-handle"><AppIcon name="ph:dots-six-vertical" :size="14" /></div>
        <AppIcon name="updates" :size="14" class="text-drydock-secondary" />
        <h2 class="dd-text-heading-section dd-text">Update Breakdown</h2>
      </div>
      <AppButton size="none" variant="link-secondary" weight="medium" class="text-2xs-plus" @click="handleViewAll">View all &rarr;</AppButton>
    </div>

    <!-- Icon grid — shown in full and medium modes (medium = no header) -->
    <div v-if="mode !== 'compact'" class="flex-1 min-h-0 flex items-center justify-center p-4 relative">
      <div v-if="mode === 'medium' && editMode" class="drag-handle dd-drag-handle absolute top-2 left-2 z-10"><AppIcon name="ph:dots-six-vertical" :size="14" /></div>
      <div
        v-if="totalUpdates === 0"
        class="p-3 dd-rounded text-2xs-plus text-center dd-text-muted"
        :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
        No updates to categorize
      </div>
      <div v-else class="grid grid-cols-4 gap-3 w-full">
        <div
          v-for="kind in updateBreakdownBuckets"
          :key="kind.label"
          class="text-center p-2.5 dd-rounded"
          :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
          <div class="w-8 h-8 mx-auto dd-rounded flex items-center justify-center mb-1.5"
            :style="{ backgroundColor: kind.colorMuted, color: kind.color }">
            <AppIcon :name="kind.icon" :size="18" />
          </div>
          <div class="text-lg font-bold dd-text">{{ kind.count }}</div>
          <div class="text-3xs font-medium uppercase tracking-wider mt-0.5 dd-text-muted">{{ kind.label }}</div>
          <div class="mt-1.5 h-1 dd-rounded-sm overflow-hidden" style="background: var(--dd-bg-elevated);">
            <div
              class="h-full dd-rounded-sm"
              :style="{ width: Math.max(kind.count / Math.max(totalUpdates, 1) * 100, 4) + '%', backgroundColor: kind.color }" />
          </div>
        </div>
      </div>
    </div>

    <!-- Compact: tiny inline row for extremely small widgets -->
    <div v-else class="flex items-center flex-1 min-h-0 px-4 gap-3 relative">
      <div v-if="editMode" class="drag-handle dd-drag-handle absolute top-2 left-2 z-10"><AppIcon name="ph:dots-six" :size="14" /></div>
      <div
        v-for="kind in updateBreakdownBuckets"
        :key="kind.label"
        class="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 dd-rounded"
        :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
        <div class="w-6 h-6 shrink-0 dd-rounded flex items-center justify-center"
          :style="{ backgroundColor: kind.colorMuted, color: kind.color }">
          <AppIcon :name="kind.icon" :size="14" />
        </div>
        <div class="min-w-0">
          <div class="text-sm font-bold dd-text leading-none">{{ kind.count }}</div>
          <div class="text-3xs font-medium uppercase tracking-wider dd-text-muted leading-none mt-0.5">{{ kind.label }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
