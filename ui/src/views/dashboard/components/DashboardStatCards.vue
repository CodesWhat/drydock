<script setup lang="ts">
import { computed, ref } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { useDraggable } from 'vue-draggable-plus';
import type { DashboardStatCard, DashboardWidgetId, WidgetOrderItem } from '../dashboardTypes';

interface Props {
  editMode: boolean;
  isWidgetVisible: (id: DashboardWidgetId) => boolean;
  statOrder: WidgetOrderItem[];
  stats: DashboardStatCard[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  navigate: [route: RouteLocationRaw];
}>();

const statById = computed(() => {
  const map = new Map<string, DashboardStatCard>();
  for (const s of props.stats) map.set(s.id, s);
  return map;
});

const visibleCount = computed(
  () => props.statOrder.filter((w) => props.isWidgetVisible(w.id)).length,
);

function handleNavigate(route?: RouteLocationRaw) {
  if (!props.editMode && route) {
    emit('navigate', route);
  }
}

const gridRef = ref<HTMLElement | null>(null);

useDraggable(gridRef, () => props.statOrder, {
  animation: 150,
  handle: '.drag-handle',
  ghostClass: 'dd-drag-ghost',
  dragClass: 'dd-drag-active',
  disabled: computed(() => !props.editMode),
});
</script>

<template>
  <div
    ref="gridRef"
    class="grid gap-4 mb-4"
    :class="visibleCount <= 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'">
    <component
      :is="statById.get(item.id)?.route && !editMode ? 'button' : 'div'"
      v-for="item in statOrder"
      v-show="isWidgetVisible(item.id) || editMode"
      :key="item.id"
      :aria-label="(statById.get(item.id)?.label ?? '') + ': ' + (statById.get(item.id)?.value ?? '')"
      :type="statById.get(item.id)?.route && !editMode ? 'button' : undefined"
      class="stat-card dd-rounded p-4 text-left w-full dd-widget-card"
      :class="[
        statById.get(item.id)?.route && !editMode ? 'cursor-pointer transition-colors hover:dd-bg-elevated' : '',
        editMode ? 'dd-edit-mode' : '',
        editMode && !isWidgetVisible(item.id) ? 'opacity-30' : '',
      ]"
      :style="{ backgroundColor: 'var(--dd-bg-card)' }"
      @click="handleNavigate(statById.get(item.id)?.route)">
      <div v-if="editMode" class="drag-handle dd-drag-handle flex items-center justify-center -mt-1 mb-1" v-tooltip.top="'Drag to reorder'">
        <AppIcon name="ph:dots-six" :size="14" />
      </div>
      <div class="flex items-center justify-between mb-2">
        <span class="text-2xs-plus font-medium uppercase tracking-wider dd-text-muted">
          {{ statById.get(item.id)?.label }}
        </span>
        <div
          class="w-9 h-9 dd-rounded flex items-center justify-center"
          :style="{ backgroundColor: statById.get(item.id)?.colorMuted, color: statById.get(item.id)?.color }">
          <AppIcon :name="statById.get(item.id)?.icon ?? 'dashboard'" :size="20" />
        </div>
      </div>
      <div class="text-2xl font-bold dd-text">
        {{ statById.get(item.id)?.value }}
      </div>
      <div v-if="statById.get(item.id)?.detail" class="mt-1 text-2xs font-medium dd-text-muted">
        {{ statById.get(item.id)?.detail }}
      </div>
    </component>
  </div>
</template>
