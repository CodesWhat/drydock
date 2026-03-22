<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

interface SecuritySeverityTotals {
  critical: number;
  high: number;
  low: number;
  medium: number;
}

interface VulnerabilityRow {
  id: string;
  image: string;
  package: string;
  severity: 'CRITICAL' | 'HIGH';
}

interface Props {
  donutCircumference: number;
  editMode: boolean;
  securityCleanArcLength: number;
  securityCleanCount: number;
  securityIssueArcLength: number;
  securityIssueCount: number;
  securityNotScannedArcLength: number;
  securityNotScannedCount: number;
  securitySeverityTotals: SecuritySeverityTotals;
  securityTotalCount: number;
  showSecuritySeverityBreakdown: boolean;
  vulnerabilities: VulnerabilityRow[];
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

// Progressive collapse thresholds
const showHeader = ref(true);
const showLegend = ref(true);
const showBreakdown = ref(true);
const showVulns = ref(true);

// Reactively update based on height
import { watchEffect } from 'vue';
watchEffect(() => {
  const h = containerHeight.value;
  showVulns.value = h >= 400;
  showBreakdown.value = h >= 300;
  showLegend.value = h >= 200;
  showHeader.value = h >= 200;
});
</script>

<template>
  <div
    ref="rootEl"
    aria-label="Security Overview widget"
    class="dashboard-widget dd-rounded overflow-hidden flex flex-col"
    :style="{ backgroundColor: 'var(--dd-bg-card)' }">

    <!-- Header — hides when very small -->
    <div v-if="showHeader" class="shrink-0 flex items-center justify-between px-5 py-3.5" :style="{ borderBottom: '1px solid var(--dd-border)' }">
      <div class="flex items-center gap-2">
        <div v-if="editMode" class="drag-handle dd-drag-handle"><AppIcon name="ph:dots-six-vertical" :size="14" /></div>
        <AppIcon name="security" :size="14" class="text-drydock-accent" />
        <h2 class="text-xs font-semibold dd-text">Security Overview</h2>
      </div>
      <AppButton size="none" variant="link-secondary" weight="medium" class="text-2xs-plus" @click="handleViewAll">View all &rarr;</AppButton>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 flex flex-col items-center justify-center relative">
      <!-- Drag handle when header is hidden — pinned top-left -->
      <div v-if="!showHeader && editMode" class="drag-handle dd-drag-handle absolute top-2 left-2 z-10"><AppIcon name="ph:dots-six" :size="14" /></div>

      <!-- Donut chart — always visible -->
      <div class="flex items-center justify-center" :class="showLegend ? 'mb-5' : ''">
        <div class="relative" :style="{ width: showLegend ? '140px' : '100px', height: showLegend ? '140px' : '100px' }">
          <svg viewBox="0 0 120 120" class="w-full h-full" style="transform: rotate(-90deg);">
            <circle cx="60" cy="60" r="48" fill="none" stroke="var(--dd-border-strong)" stroke-width="14" />
            <circle cx="60" cy="60" r="48" fill="none" stroke="var(--dd-success)" stroke-width="14"
              stroke-linecap="round" class="donut-ring"
              :stroke-dasharray="securityCleanArcLength + ' ' + donutCircumference" />
            <circle v-if="securityIssueCount > 0" cx="60" cy="60" r="48" fill="none" stroke="var(--dd-danger)" stroke-width="14"
              stroke-linecap="round" class="donut-ring"
              :stroke-dasharray="securityIssueArcLength + ' ' + donutCircumference"
              :stroke-dashoffset="-securityCleanArcLength" />
            <circle v-if="securityNotScannedCount > 0" cx="60" cy="60" r="48" fill="none" stroke="var(--dd-neutral)" stroke-width="14"
              stroke-linecap="round" class="donut-ring"
              :stroke-dasharray="securityNotScannedArcLength + ' ' + donutCircumference"
              :stroke-dashoffset="-(securityCleanArcLength + securityIssueArcLength)" />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-xl font-bold dd-text">{{ securityTotalCount }}</span>
            <span class="text-2xs dd-text-muted">images</span>
          </div>
        </div>
      </div>

      <!-- Legend -->
      <div v-if="showLegend" class="flex justify-center gap-5" :class="showBreakdown ? 'mb-5' : ''">
        <div class="flex items-center gap-1.5">
          <div class="w-2.5 h-2.5 rounded-full" style="background:var(--dd-success);" />
          <span class="text-2xs-plus dd-text-secondary">{{ securityCleanCount }} Clean</span>
        </div>
        <div v-if="securityIssueCount > 0" class="flex items-center gap-1.5">
          <div class="w-2.5 h-2.5 rounded-full" style="background:var(--dd-danger);" />
          <span class="text-2xs-plus dd-text-secondary">{{ securityIssueCount }} Issues</span>
        </div>
        <div v-if="securityNotScannedCount > 0" class="flex items-center gap-1.5">
          <div class="w-2.5 h-2.5 rounded-full" style="background:var(--dd-neutral);" />
          <span class="text-2xs-plus dd-text-secondary">{{ securityNotScannedCount }} Not Scanned</span>
        </div>
      </div>

      <!-- Severity breakdown -->
      <div v-if="showBreakdown && showSecuritySeverityBreakdown" data-test="security-severity-breakdown" class="w-full mb-5">
        <div class="text-2xs font-semibold uppercase tracking-wider mb-2 dd-text-muted">Severity Breakdown</div>
        <div class="grid grid-cols-2 gap-2">
          <div class="flex items-center justify-between px-2 py-1.5 dd-rounded" :style="{ backgroundColor: 'var(--dd-danger-muted)' }">
            <span class="text-2xs font-semibold" style="color: var(--dd-danger);">{{ securitySeverityTotals.critical }} Critical</span>
          </div>
          <div class="flex items-center justify-between px-2 py-1.5 dd-rounded" :style="{ backgroundColor: 'var(--dd-warning-muted)' }">
            <span class="text-2xs font-semibold" style="color: var(--dd-warning);">{{ securitySeverityTotals.high }} High</span>
          </div>
          <div class="flex items-center justify-between px-2 py-1.5 dd-rounded" :style="{ backgroundColor: 'var(--dd-caution-muted)' }">
            <span class="text-2xs font-semibold" style="color: var(--dd-caution);">{{ securitySeverityTotals.medium }} Medium</span>
          </div>
          <div class="flex items-center justify-between px-2 py-1.5 dd-rounded" :style="{ backgroundColor: 'var(--dd-info-muted)' }">
            <span class="text-2xs font-semibold" style="color: var(--dd-info);">{{ securitySeverityTotals.low }} Low</span>
          </div>
        </div>
      </div>

      <!-- Top Vulnerabilities -->
      <template v-if="showVulns">
        <div class="w-full mb-4" :style="{ borderTop: '1px solid var(--dd-border)' }" />
        <div class="w-full text-2xs font-semibold uppercase tracking-wider mb-3 dd-text-muted">Top Vulnerabilities</div>
        <div class="w-full space-y-2.5 overflow-y-auto max-h-[200px]">
          <div v-for="vuln in vulnerabilities" :key="vuln.id"
            class="flex items-start gap-3 p-2.5 dd-rounded"
            :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
            <div class="shrink-0 mt-0.5">
              <span class="badge text-3xs"
                :style="{
                  backgroundColor: vuln.severity === 'CRITICAL' ? 'var(--dd-danger-muted)' : 'var(--dd-warning-muted)',
                  color: vuln.severity === 'CRITICAL' ? 'var(--dd-danger)' : 'var(--dd-warning)',
                }">
                {{ vuln.severity }}
              </span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-2xs-plus font-semibold truncate dd-text">{{ vuln.id }}</div>
              <div class="text-2xs mt-0.5 truncate dd-text-muted">{{ vuln.package }} &middot; {{ vuln.image }}</div>
            </div>
          </div>
          <div v-if="vulnerabilities.length === 0"
            class="p-2.5 dd-rounded text-2xs-plus text-center dd-text-muted"
            :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
            No vulnerabilities reported
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
