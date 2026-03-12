<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import ScanProgressBanner from '../components/ScanProgressBanner.vue';
import SecurityEmptyState from '../components/SecurityEmptyState.vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { useSbomDetail } from '../composables/useSbomDetail';
import { useScanProgress } from '../composables/useScanProgress';
import { useVulnerabilities, type ImageSummary } from '../composables/useVulnerabilities';
import { preferences } from '../preferences/store';
import { usePreference } from '../preferences/usePreference';
import { useViewMode } from '../preferences/useViewMode';
import { getSecurityRuntime } from '../services/server';
import { errorMessage } from '../utils/error';
import type { SecurityRuntimeStatus } from './security/securityViewTypes';
import {
  fixableColor,
  fixablePercent,
  formatTimestamp,
  highestSeverity,
  severityColor,
  severityIcon,
  statusBadgeTone,
} from './security/securityViewUtils';

const { isMobile, windowNarrow: isCompact } = useBreakpoints();
const { scanning, scanProgress, scanAllContainers: runScanAll } = useScanProgress();

const runtimeLoading = ref(true);
const runtimeError = ref<string | null>(null);
const runtimeStatus = ref<SecurityRuntimeStatus | null>(null);

const scannerReady = computed(() => {
  if (!runtimeStatus.value) {
    return true;
  }
  return runtimeStatus.value.scanner.status === 'ready';
});

const scannerSetupNeeded = computed(() => {
  return (
    !runtimeLoading.value &&
    !runtimeError.value &&
    Boolean(runtimeStatus.value) &&
    !scannerReady.value
  );
});

const scanDisabledReason = computed(() => {
  if (runtimeLoading.value) {
    return 'Checking scanner availability';
  }
  if (runtimeError.value) {
    return 'Runtime check unavailable; scan can still be attempted';
  }
  if (!runtimeStatus.value) {
    return 'Scan all containers for vulnerabilities';
  }
  if (!scannerReady.value) {
    return runtimeStatus.value.scanner.message;
  }
  return 'Scan all containers for vulnerabilities';
});

async function fetchSecurityRuntimeStatus() {
  runtimeLoading.value = true;
  runtimeError.value = null;
  try {
    runtimeStatus.value = await getSecurityRuntime();
  } catch (caught: unknown) {
    runtimeError.value = errorMessage(caught, 'Failed to load security runtime status');
    runtimeStatus.value = null;
  } finally {
    runtimeLoading.value = false;
  }
}

const securityViewMode = useViewMode('security');

const securitySortField = usePreference(
  () => preferences.views.security.sortField,
  (value) => {
    preferences.views.security.sortField = value;
  },
);
const securitySortAsc = usePreference(
  () => preferences.views.security.sortAsc,
  (value) => {
    preferences.views.security.sortAsc = value;
  },
);

const {
  loading,
  error,
  securityVulnerabilities,
  vulnerabilitiesByImage,
  containerIdsByImage,
  latestSecurityScanAt,
  totalContainerCount,
  scannedContainerCount,
  showSecFilters,
  secFilterSeverity,
  secFilterFix,
  activeSecFilterCount,
  imageSummaries,
  filteredSummaries,
  clearSecFilters,
  fetchVulnerabilities,
} = useVulnerabilities({
  securitySortField,
  securitySortAsc,
});

const displayFilteredCount = computed(() =>
  activeSecFilterCount.value > 0 ? filteredSummaries.value.length : scannedContainerCount.value,
);
const displayTotalCount = computed(() =>
  activeSecFilterCount.value > 0 ? imageSummaries.value.length : totalContainerCount.value,
);
const displayCountLabel = computed(() => (activeSecFilterCount.value > 0 ? 'images' : 'scanned'));

const {
  detailOpen,
  detailSbomComponentCount,
  detailSbomDocument,
  detailSbomDocumentJson,
  detailSbomError,
  detailSbomGeneratedAt,
  detailSbomLoading,
  downloadDetailSbom,
  handleDetailOpenChange,
  loadDetailSbom,
  openDetail: openSbomDetail,
  selectedImage,
  selectedSbomFormat,
  showSbomDocument,
} = useSbomDetail({
  containerIdsByImage,
});

const selectedImageVulns = computed(() => {
  if (!selectedImage.value) return [];
  return vulnerabilitiesByImage.value[selectedImage.value.image] || [];
});

function openDetail(summary: ImageSummary) {
  const vulnerabilities = vulnerabilitiesByImage.value[summary.image] || [];
  openSbomDetail({
    ...summary,
    vulns: vulnerabilities,
  });
}

let scanCompletedDebounceTimer: ReturnType<typeof setTimeout> | undefined;

function handleSseScanCompleted() {
  clearTimeout(scanCompletedDebounceTimer);
  scanCompletedDebounceTimer = setTimeout(() => {
    void fetchVulnerabilities();
  }, 800);
}

async function scanAllContainers() {
  await runScanAll({
    scannerReady: scannerReady.value,
    runtimeLoading: runtimeLoading.value,
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await fetchVulnerabilities();
}

const tableColumns = computed(() => {
  if (isCompact.value) {
    return [
      { key: 'image', label: 'Image', align: 'text-left', width: '99%' },
      { key: 'total', label: 'Total', sortable: true },
    ];
  }
  return [
    { key: 'image', label: 'Image', align: 'text-left', width: '99%' },
    { key: 'critical', label: 'Critical', sortable: true },
    { key: 'high', label: 'High', sortable: true },
    { key: 'medium', label: 'Medium', sortable: true },
    { key: 'low', label: 'Low', sortable: true },
    { key: 'fixable', label: 'Fixable', sortable: true },
    { key: 'total', label: 'Total', sortable: true },
  ];
});

const sseScanCompletedListener = handleSseScanCompleted as EventListener;

onMounted(() => {
  void fetchSecurityRuntimeStatus();
  void fetchVulnerabilities();
  globalThis.addEventListener('dd:sse-scan-completed', sseScanCompletedListener);
});

onUnmounted(() => {
  clearTimeout(scanCompletedDebounceTimer);
  globalThis.removeEventListener('dd:sse-scan-completed', sseScanCompletedListener);
});
</script>

<template>
  <DataViewLayout>
      <div v-if="error"
           class="mb-3 px-3 py-2 text-[0.6875rem] dd-rounded"
           :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
        {{ error }}
      </div>

      <div v-if="loading" class="text-[0.6875rem] dd-text-muted py-3 px-1">Loading vulnerability data...</div>

      <!-- Filter bar -->
      <DataFilterBar
        v-model="securityViewMode"
        v-model:showFilters="showSecFilters"
        :filtered-count="displayFilteredCount"
        :total-count="displayTotalCount"
        :active-filter-count="activeSecFilterCount"
        :count-label="displayCountLabel">
        <template #filters>
          <select v-model="secFilterSeverity"
                  class="px-2 py-1.5 dd-rounded text-[0.6875rem] font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
            <option value="all">Severity</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <select v-model="secFilterFix"
                  class="px-2 py-1.5 dd-rounded text-[0.6875rem] font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
            <option value="all">Fix Available</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
          <button v-if="activeSecFilterCount > 0"
                  class="text-[0.625rem] font-medium px-2 py-1 dd-rounded transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                  @click="clearSecFilters">
            Clear all
          </button>
        </template>
        <template #left>
          <template v-if="runtimeStatus">
            <!-- Compact: single combined badge -->
            <span v-if="isCompact"
                  class="badge text-[0.5625rem] font-bold uppercase cursor-default flex items-center gap-1"
                  :style="{ backgroundColor: statusBadgeTone(runtimeStatus.scanner.status).bg, color: statusBadgeTone(runtimeStatus.scanner.status).text }"
                  v-tooltip.top="`Trivy: ${runtimeStatus.scanner.message} · Cosign: ${runtimeStatus.signature.message} · SBOM: ${runtimeStatus.sbom.enabled ? 'enabled' : 'disabled'}`">
              <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: statusBadgeTone(runtimeStatus.scanner.status).text }" />
              <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: statusBadgeTone(runtimeStatus.signature.status).text }" />
              <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: runtimeStatus.sbom.enabled ? 'var(--dd-info)' : 'var(--dd-neutral)' }" />
            </span>
            <!-- Full: individual badges -->
            <template v-else>
              <span class="badge text-[0.5625rem] font-bold uppercase cursor-default"
                    :style="{ backgroundColor: statusBadgeTone(runtimeStatus.scanner.status).bg, color: statusBadgeTone(runtimeStatus.scanner.status).text }"
                    v-tooltip.top="runtimeStatus.scanner.message + (runtimeStatus.scanner.server ? ' · server: ' + runtimeStatus.scanner.server : '')">
                trivy
              </span>
              <span class="badge text-[0.5625rem] font-bold uppercase cursor-default"
                    :style="{ backgroundColor: statusBadgeTone(runtimeStatus.signature.status).bg, color: statusBadgeTone(runtimeStatus.signature.status).text }"
                    v-tooltip.top="runtimeStatus.signature.message">
                cosign
              </span>
              <span class="badge text-[0.5625rem] font-bold uppercase cursor-default"
                    :style="{
                      backgroundColor: runtimeStatus.sbom.enabled ? 'var(--dd-info-muted)' : 'var(--dd-neutral-muted)',
                      color: runtimeStatus.sbom.enabled ? 'var(--dd-info)' : 'var(--dd-neutral)',
                    }"
                    v-tooltip.top="runtimeStatus.sbom.enabled ? 'SBOM generation enabled (' + runtimeStatus.sbom.formats.join(', ') + ')' : 'SBOM generation disabled'">
                sbom
              </span>
            </template>
          </template>
        </template>
        <template #center>
          <span class="inline-flex" v-tooltip.top="scanDisabledReason">
            <button class="h-7 dd-rounded flex items-center justify-center gap-1.5 text-[0.6875rem] font-semibold transition-colors"
                    :class="[
                      scanning || runtimeLoading || !scannerReady
                        ? 'dd-text-muted cursor-not-allowed'
                        : 'dd-text-secondary hover:dd-text hover:dd-bg-elevated',
                      isCompact ? 'w-7' : 'px-3',
                    ]"
                    :disabled="scanning || runtimeLoading || !scannerReady"
                    @click="scanAllContainers">
              <AppIcon name="restart" :size="11" :class="{ 'animate-spin': scanning }" />
              <span v-if="!isCompact">Scan Now</span>
            </button>
          </span>
        </template>
      </DataFilterBar>

      <!-- Scan progress banner -->
      <ScanProgressBanner v-if="scanning" :progress="scanProgress" />

      <!-- Table view — grouped by image -->
      <DataTable v-if="securityViewMode === 'table' && !loading"
                 :columns="tableColumns"
                 :rows="filteredSummaries"
                 row-key="image"
                 :selected-key="selectedImage?.image"
                 v-model:sort-key="securitySortField"
                 v-model:sort-asc="securitySortAsc"
                 @row-click="openDetail($event)">
        <template #cell-image="{ row }">
          <div class="flex items-center gap-2 min-w-0">
            <AppIcon :name="severityIcon(highestSeverity(row))" :size="13" class="shrink-0 md:!hidden"
                     :style="{ color: severityColor(highestSeverity(row)).text }" />
            <span class="font-medium dd-text truncate">{{ row.image }}</span>
            <span v-if="row.delta && row.delta.fixed > 0 && row.delta.new === 0"
                  class="badge text-[0.5rem] font-bold px-1.5 py-0 shrink-0"
                  :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }"
                  v-tooltip.top="`Update fixes ${row.delta.fixed} vulnerability${row.delta.fixed !== 1 ? 'ies' : 'y'}`">
              <AppIcon name="trending-down" :size="9" class="mr-0.5" />{{ row.delta.fixed }} fixed
            </span>
            <span v-else-if="row.delta && row.delta.new > 0 && row.delta.fixed === 0"
                  class="badge text-[0.5rem] font-bold px-1.5 py-0 shrink-0"
                  :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }"
                  v-tooltip.top="`Update introduces ${row.delta.new} new vulnerability${row.delta.new !== 1 ? 'ies' : 'y'}`">
              <AppIcon name="trending-up" :size="9" class="mr-0.5" />{{ row.delta.new }} new
            </span>
            <span v-else-if="row.delta && (row.delta.fixed > 0 || row.delta.new > 0)"
                  class="badge text-[0.5rem] font-bold px-1.5 py-0 shrink-0"
                  :style="{ backgroundColor: 'var(--dd-caution-muted)', color: 'var(--dd-caution)' }"
                  v-tooltip.top="`Update: ${row.delta.fixed} fixed, ${row.delta.new} new`">
              {{ row.delta.fixed }} fixed, {{ row.delta.new }} new
            </span>
          </div>
        </template>
        <template #cell-critical="{ row }">
          <span v-if="row.critical > 0" class="badge text-[0.5625rem] font-bold"
                :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
            {{ row.critical }}
          </span>
          <span v-else class="text-[0.625rem] dd-text-muted">&mdash;</span>
        </template>
        <template #cell-high="{ row }">
          <span v-if="row.high > 0" class="badge text-[0.5625rem] font-bold"
                :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
            {{ row.high }}
          </span>
          <span v-else class="text-[0.625rem] dd-text-muted">&mdash;</span>
        </template>
        <template #cell-medium="{ row }">
          <span v-if="row.medium > 0" class="badge text-[0.5625rem] font-bold"
                :style="{ backgroundColor: 'var(--dd-caution-muted)', color: 'var(--dd-caution)' }">
            {{ row.medium }}
          </span>
          <span v-else class="text-[0.625rem] dd-text-muted">&mdash;</span>
        </template>
        <template #cell-low="{ row }">
          <span v-if="row.low > 0" class="badge text-[0.5625rem] font-bold"
                :style="{ backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' }">
            {{ row.low }}
          </span>
          <span v-else class="text-[0.625rem] dd-text-muted">&mdash;</span>
        </template>
        <template #cell-fixable="{ row }">
          <span v-if="row.fixable > 0" class="text-[0.625rem] font-medium"
                :style="{ color: fixableColor(row.fixable, row.total) }">
            {{ fixablePercent(row.fixable, row.total) }}%
          </span>
          <span v-else class="text-[0.625rem] dd-text-muted">0%</span>
        </template>
        <template #cell-total="{ row }">
          <span class="text-[0.6875rem] font-semibold dd-text">{{ row.total }}</span>
        </template>
        <template #empty>
          <SecurityEmptyState
            :has-vulnerability-data="securityVulnerabilities.length > 0"
            :scanner-setup-needed="scannerSetupNeeded"
            :scanner-message="runtimeStatus?.scanner.message"
            :active-filter-count="activeSecFilterCount"
            :scan-disabled-reason="scanDisabledReason"
            :scanning="scanning"
            :runtime-loading="runtimeLoading"
            :scanner-ready="scannerReady"
            :scan-progress="scanProgress"
            :boxed="false"
            @clear-filters="clearSecFilters"
            @scan-now="scanAllContainers"
          />
        </template>
      </DataTable>

      <!-- Card view — one card per image -->
      <DataCardGrid v-if="securityViewMode === 'cards' && !loading"
                    :items="filteredSummaries"
                    item-key="image"
                    :selected-key="selectedImage?.image"
                    min-width="280px"
                    @item-click="openDetail($event)">
        <template #card="{ item: summary }">
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="min-w-0">
              <div class="text-sm font-semibold truncate dd-text">{{ summary.image }}</div>
              <div class="text-[0.625rem] mt-0.5 dd-text-muted">{{ summary.total }} vulnerabilities</div>
            </div>
            <AppIcon :name="severityIcon(highestSeverity(summary))" :size="16" class="shrink-0 ml-2"
                     :style="{ color: severityColor(highestSeverity(summary)).text }" />
          </div>
          <div class="px-4 py-3">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span v-if="summary.critical > 0" class="badge text-[0.5625rem] font-bold"
                    :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
                {{ summary.critical }} Critical
              </span>
              <span v-if="summary.high > 0" class="badge text-[0.5625rem] font-bold"
                    :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
                {{ summary.high }} High
              </span>
              <span v-if="summary.medium > 0" class="badge text-[0.5625rem] font-bold"
                    :style="{ backgroundColor: 'var(--dd-caution-muted)', color: 'var(--dd-caution)' }">
                {{ summary.medium }} Medium
              </span>
              <span v-if="summary.low > 0" class="badge text-[0.5625rem] font-bold"
                    :style="{ backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' }">
                {{ summary.low }} Low
              </span>
            </div>
          </div>
          <div v-if="summary.delta && (summary.delta.fixed > 0 || summary.delta.new > 0)"
               class="px-4 py-2 flex items-center gap-1.5"
               :style="{ borderTop: '1px solid var(--dd-border)' }">
            <span v-if="summary.delta.fixed > 0"
                  class="badge text-[0.5rem] font-bold px-1.5 py-0"
                  :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }">
              {{ summary.delta.fixed }} fixed
            </span>
            <span v-if="summary.delta.new > 0"
                  class="badge text-[0.5rem] font-bold px-1.5 py-0"
                  :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
              {{ summary.delta.new }} new
            </span>
            <span class="text-[0.5625rem] dd-text-muted ml-auto">vs update</span>
          </div>
          <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <span v-if="summary.fixable > 0" class="text-[0.6875rem] font-medium flex items-center gap-1"
                  :style="{ color: fixableColor(summary.fixable, summary.total) }">
              <AppIcon name="check" :size="11" />
              {{ fixablePercent(summary.fixable, summary.total) }}% fixable
            </span>
            <span v-else class="text-[0.6875rem] dd-text-muted">No fixes available</span>
            <span class="text-[0.625rem] dd-text-muted">{{ summary.total }} total</span>
          </div>
        </template>
      </DataCardGrid>

      <!-- Empty state for cards -->
      <SecurityEmptyState
        v-if="securityViewMode === 'cards' && filteredSummaries.length === 0 && !loading"
        :has-vulnerability-data="securityVulnerabilities.length > 0"
        :scanner-setup-needed="scannerSetupNeeded"
        :scanner-message="runtimeStatus?.scanner.message"
        :active-filter-count="activeSecFilterCount"
        :scan-disabled-reason="scanDisabledReason"
        :scanning="scanning"
        :runtime-loading="runtimeLoading"
        :scanner-ready="scannerReady"
        :scan-progress="scanProgress"
        :boxed="true"
        @clear-filters="clearSecFilters"
        @scan-now="scanAllContainers"
      />

      <!-- List view — one row per image, expandable -->
      <DataListAccordion v-if="securityViewMode === 'list' && !loading"
                         :items="filteredSummaries"
                         item-key="image"
                         :selected-key="selectedImage?.image"
                         @item-click="openDetail($event)">
        <template #header="{ item: summary }">
          <AppIcon :name="severityIcon(highestSeverity(summary))" :size="13" class="shrink-0"
                   :style="{ color: severityColor(highestSeverity(summary)).text }" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold truncate dd-text">{{ summary.image }}</div>
            <div class="text-[0.625rem] dd-text-muted mt-0.5">{{ summary.total }} vulnerabilities</div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <span v-if="summary.critical > 0" class="badge text-[0.5rem] font-bold px-1.5 py-0"
                  :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
              {{ summary.critical }}C
            </span>
            <span v-if="summary.high > 0" class="badge text-[0.5rem] font-bold px-1.5 py-0"
                  :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
              {{ summary.high }}H
            </span>
            <span v-if="summary.fixable > 0" class="badge text-[0.5rem] font-bold px-1.5 py-0"
                  :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }">
              {{ summary.fixable }} fix
            </span>
            <span v-if="summary.delta && summary.delta.fixed > 0 && summary.delta.new === 0"
                  class="badge text-[0.5rem] font-bold px-1.5 py-0"
                  :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }">
              {{ summary.delta.fixed }} fixed
            </span>
            <span v-else-if="summary.delta && summary.delta.new > 0"
                  class="badge text-[0.5rem] font-bold px-1.5 py-0"
                  :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
              {{ summary.delta.new }} new
            </span>
          </div>
        </template>
      </DataListAccordion>

      <!-- Empty state for list -->
      <SecurityEmptyState
        v-if="securityViewMode === 'list' && filteredSummaries.length === 0 && !loading"
        :has-vulnerability-data="securityVulnerabilities.length > 0"
        :scanner-setup-needed="scannerSetupNeeded"
        :scanner-message="runtimeStatus?.scanner.message"
        :active-filter-count="activeSecFilterCount"
        :scan-disabled-reason="scanDisabledReason"
        :scanning="scanning"
        :runtime-loading="runtimeLoading"
        :scanner-ready="scannerReady"
        :scan-progress="scanProgress"
        :boxed="true"
        @clear-filters="clearSecFilters"
        @scan-now="scanAllContainers"
      />

    <!-- Detail panel — full vulnerability report for selected image -->
    <template #panel>
      <DetailPanel
        :open="detailOpen"
        :is-mobile="isMobile"
        :show-size-controls="false"
        :show-full-page="false"
        @update:open="handleDetailOpenChange"
      >
        <template #header>
          <div class="flex items-center gap-2.5 min-w-0">
            <AppIcon name="security" :size="14" class="shrink-0 dd-text-secondary" />
            <span class="text-sm font-bold truncate dd-text">{{ selectedImage?.image }}</span>
          </div>
        </template>

        <template #subtitle>
          <div class="flex items-center gap-2 flex-wrap">
            <span v-if="selectedImage?.critical" class="badge text-[0.5625rem] font-bold"
                  :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
              {{ selectedImage.critical }} Critical
            </span>
            <span v-if="selectedImage?.high" class="badge text-[0.5625rem] font-bold"
                  :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
              {{ selectedImage.high }} High
            </span>
            <span v-if="selectedImage?.medium" class="badge text-[0.5625rem] font-bold"
                  :style="{ backgroundColor: 'var(--dd-caution-muted)', color: 'var(--dd-caution)' }">
              {{ selectedImage.medium }} Medium
            </span>
            <span v-if="selectedImage?.low" class="badge text-[0.5625rem] font-bold"
                  :style="{ backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' }">
              {{ selectedImage.low }} Low
            </span>
            <span class="text-[0.625rem] dd-text-muted ml-auto">{{ selectedImage?.total }} total</span>
          </div>
        </template>

        <template v-if="selectedImage" #default>
          <!-- Vulnerability list -->
          <div class="divide-y" :style="{ borderColor: 'var(--dd-border)' }">
            <div v-for="vuln in selectedImageVulns" :key="vuln.id + vuln.package"
                 class="px-4 py-3 hover:dd-bg-hover transition-colors">
              <div class="flex items-center gap-2 mb-1.5">
                <AppIcon :name="severityIcon(vuln.severity)" :size="12"
                         :style="{ color: severityColor(vuln.severity).text }" />
                <span class="badge text-[0.5rem] uppercase font-bold"
                      :style="{ backgroundColor: severityColor(vuln.severity).bg, color: severityColor(vuln.severity).text }">
                  {{ vuln.severity }}
                </span>
                <span class="font-mono text-[0.6875rem] font-semibold dd-text truncate">{{ vuln.id }}</span>
              </div>
              <div class="flex items-center gap-2 text-[0.6875rem] ml-5">
                <span class="font-medium dd-text">{{ vuln.package }}</span>
                <span class="dd-text-muted">{{ vuln.version }}</span>
                <span v-if="vuln.fixedIn" class="ml-auto badge text-[0.5rem] font-bold px-1.5 py-0"
                      style="background: var(--dd-success-muted); color: var(--dd-success);">
                  <AppIcon name="check" :size="9" class="mr-0.5" />
                  {{ vuln.fixedIn }}
                </span>
                <span v-else class="ml-auto text-[0.625rem] dd-text-muted">No fix</span>
              </div>
              <div
                v-if="vuln.title || vuln.target || vuln.primaryUrl"
                class="ml-5 mt-1.5 space-y-1"
              >
                <div v-if="vuln.title" class="text-[0.625rem] dd-text">
                  {{ vuln.title }}
                </div>
                <div v-if="vuln.target" class="text-[0.625rem] dd-text-muted">
                  Target:
                  <span class="font-mono dd-text">{{ vuln.target }}</span>
                </div>
                <a
                  v-if="vuln.primaryUrl"
                  :href="vuln.primaryUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex text-[0.625rem] underline hover:no-underline break-all"
                  style="color: var(--dd-info);"
                >
                  {{ vuln.primaryUrl }}
                </a>
              </div>
            </div>
          </div>

          <div class="px-4 py-3 space-y-2" :style="{ borderTop: '1px solid var(--dd-border)' }">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[0.625rem] font-semibold uppercase tracking-wide dd-text-muted">SBOM</span>
              <select v-model="selectedSbomFormat"
                      class="px-2 py-1 dd-rounded text-[0.625rem] font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
                      @change="loadDetailSbom">
                <option value="spdx-json">spdx-json</option>
                <option value="cyclonedx-json">cyclonedx-json</option>
              </select>
              <button class="px-2 py-1 dd-rounded text-[0.625rem] font-semibold transition-colors dd-text-secondary hover:dd-text hover:dd-bg-elevated"
                      :disabled="detailSbomLoading"
                      @click="loadDetailSbom">
                {{ detailSbomLoading ? 'Loading SBOM...' : 'Refresh SBOM' }}
              </button>
              <button class="px-2 py-1 dd-rounded text-[0.625rem] font-semibold transition-colors dd-text-secondary hover:dd-text hover:dd-bg-elevated"
                      :disabled="!detailSbomDocument"
                      @click="showSbomDocument = !showSbomDocument">
                {{ showSbomDocument ? 'Hide SBOM' : 'View SBOM' }}
              </button>
              <button class="px-2 py-1 dd-rounded text-[0.625rem] font-semibold transition-colors dd-text-secondary hover:dd-text hover:dd-bg-elevated"
                      :disabled="!detailSbomDocument"
                      @click="downloadDetailSbom">
                Download SBOM
              </button>
            </div>

            <div v-if="detailSbomError"
                 class="px-2.5 py-1.5 dd-rounded text-[0.6875rem]"
                 :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
              {{ detailSbomError }}
            </div>
            <div v-else-if="detailSbomLoading"
                 class="px-2.5 py-1.5 dd-rounded text-[0.6875rem] dd-text-muted"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              Loading SBOM document...
            </div>
            <div v-else-if="detailSbomDocument"
                 class="px-2.5 py-1.5 dd-rounded text-[0.625rem] space-y-0.5"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              <div class="dd-text-muted">
                format:
                <span class="dd-text font-mono">{{ selectedSbomFormat }}</span>
              </div>
              <div v-if="typeof detailSbomComponentCount === 'number'" class="dd-text-muted">
                components:
                <span class="dd-text">{{ detailSbomComponentCount }}</span>
              </div>
              <div v-if="detailSbomGeneratedAt" class="dd-text-muted">
                generated:
                <span class="dd-text">{{ formatTimestamp(detailSbomGeneratedAt) }}</span>
              </div>
            </div>
            <div v-else
                 class="px-2.5 py-1.5 dd-rounded text-[0.6875rem] dd-text-muted italic"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              SBOM document is not available yet.
            </div>

            <pre v-if="showSbomDocument && detailSbomDocumentJson"
                 class="p-2 dd-rounded text-[0.625rem] overflow-auto max-h-64 font-mono"
                 :style="{ backgroundColor: 'var(--dd-bg-code)' }">{{ detailSbomDocumentJson }}</pre>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
