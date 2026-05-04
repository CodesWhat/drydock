<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ContainerStatsSummarySnapshot } from '../../../services/stats';
import {
  getUsageThresholdColor,
  getUsageThresholdMutedColor,
} from '../../../utils/stats-thresholds';

interface Props {
  editMode: boolean;
  summary: ContainerStatsSummarySnapshot;
}

defineProps<Props>();

const { t } = useI18n();

const emit = defineEmits<{
  viewAll: [];
}>();

function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let nextValue = Math.max(0, Number.isFinite(value) ? value : 0);
  let unitIndex = 0;
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${nextValue.toFixed(precision)} ${units[unitIndex]}`;
}

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

// Progressive collapse thresholds
const showHeader = ref(true);
const topListLimit = ref(5);

watchEffect(() => {
  const h = containerHeight.value;
  showHeader.value = h >= 200;
  // Progressively reduce top list items — always show at least 1 if space permits
  if (h >= 500) topListLimit.value = 5;
  else if (h >= 400) topListLimit.value = 3;
  else if (h >= 250) topListLimit.value = 2;
  else if (h >= 180) topListLimit.value = 1;
  else topListLimit.value = 0;
});
</script>

<template>
  <div
    ref="rootEl"
    :aria-label="t('dashboardView.resourceUsage.title')"
    class="dashboard-widget dd-rounded overflow-hidden flex flex-col"
    :style="{ backgroundColor: 'var(--dd-bg-card)' }">

    <!-- Header — hides when compact -->
    <div v-if="showHeader" class="shrink-0 flex items-center justify-between px-5 py-3.5" :style="{ borderBottom: '1px solid var(--dd-border)' }">
      <div class="flex items-center gap-2">
        <div v-if="editMode" class="drag-handle dd-drag-handle" v-tooltip.top="t('dashboardView.dragToReorder')"><AppIcon name="ph:dots-six-vertical" :size="14" /></div>
        <AppIcon name="uptime" :size="14" class="text-drydock-secondary" />
        <h2 class="dd-text-heading-section dd-text">
          {{ t('dashboardView.resourceUsage.title') }}
        </h2>
      </div>
      <AppButton size="none" variant="link-secondary" weight="medium" class="text-2xs-plus" @click="handleViewAll">{{ t('dashboardView.viewAll') }}</AppButton>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain dd-scroll-stable p-4 space-y-4 relative">
      <!-- Drag handle when header is hidden — pinned top-left -->
      <div v-if="!showHeader && editMode" class="drag-handle dd-drag-handle absolute top-2 left-2 z-10" v-tooltip.top="t('dashboardView.dragToReorder')"><AppIcon name="ph:dots-six" :size="14" /></div>

      <div>
        <div v-if="showHeader" class="dd-text-label mb-2 dd-text-muted">
          {{ t('dashboardView.resourceUsage.totalUsage', { watched: summary.watchedCount }) }}
        </div>
        <div class="space-y-2">
          <div>
            <div class="flex items-center justify-between text-2xs dd-text-secondary mb-1">
              <span>{{ t('dashboardView.resourceUsage.cpu') }}</span>
              <span>{{ summary.avgCpuPercent.toFixed(1) }}%</span>
            </div>
            <div class="h-2 dd-rounded overflow-hidden" :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
              <div
                class="h-full dd-rounded transition-[width,color,background-color]"
                :style="{
                  width: `${summary.avgCpuPercent}%`,
                  backgroundColor: getUsageThresholdColor(summary.avgCpuPercent),
                }" />
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between text-2xs dd-text-secondary mb-1">
              <span>{{ t('dashboardView.resourceUsage.memory') }}</span>
              <span>
                {{ formatBytes(summary.totalMemoryUsageBytes) }} / {{ formatBytes(summary.totalMemoryLimitBytes) }} ({{ summary.totalMemoryPercent.toFixed(1) }}%)
              </span>
            </div>
            <div class="h-2 dd-rounded overflow-hidden" :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
              <div
                class="h-full dd-rounded transition-[width,color,background-color]"
                :style="{
                  width: `${summary.totalMemoryPercent}%`,
                  backgroundColor: getUsageThresholdColor(summary.totalMemoryPercent),
                }" />
            </div>
          </div>
        </div>
      </div>

      <div v-if="topListLimit > 0" class="grid grid-cols-1 gap-3">
        <div>
          <div class="dd-text-label mb-2 dd-text-muted">
            {{ t('dashboardView.resourceUsage.topCpu') }}
          </div>
          <div class="space-y-1.5">
            <div
              v-for="row in summary.topCpu.slice(0, topListLimit)"
              :key="`cpu-${row.id}`"
              class="px-2.5 py-2 dd-rounded"
              :style="{ backgroundColor: getUsageThresholdMutedColor(row.cpuPercent) }">
              <div class="flex items-center justify-between gap-2">
                <span class="text-2xs-plus font-semibold truncate dd-text">{{ row.name }}</span>
                <span class="text-2xs font-semibold" :style="{ color: getUsageThresholdColor(row.cpuPercent) }">
                  {{ row.cpuPercent.toFixed(1) }}%
                </span>
              </div>
            </div>
            <div
              v-if="summary.topCpu.length === 0"
              class="px-2.5 py-2 dd-rounded text-2xs-plus text-center dd-text-muted"
              :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              {{ t('dashboardView.resourceUsage.noCpuData') }}
            </div>
          </div>
        </div>

        <div>
          <div class="dd-text-label mb-2 dd-text-muted">
            {{ t('dashboardView.resourceUsage.topMemory') }}
          </div>
          <div class="space-y-1.5">
            <div
              v-for="row in summary.topMemory.slice(0, topListLimit)"
              :key="`memory-${row.id}`"
              class="px-2.5 py-2 dd-rounded"
              :style="{ backgroundColor: getUsageThresholdMutedColor(row.memoryPercent) }">
              <div class="flex items-center justify-between gap-2">
                <span class="text-2xs-plus font-semibold truncate dd-text">{{ row.name }}</span>
                <span class="text-2xs font-semibold" :style="{ color: getUsageThresholdColor(row.memoryPercent) }">
                  {{ row.memoryPercent.toFixed(1) }}%
                </span>
              </div>
            </div>
            <div
              v-if="summary.topMemory.length === 0"
              class="px-2.5 py-2 dd-rounded text-2xs-plus text-center dd-text-muted"
              :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              {{ t('dashboardView.resourceUsage.noMemoryData') }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
