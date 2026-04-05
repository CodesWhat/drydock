<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import AppBadge from '../components/AppBadge.vue';
import AppIconButton from '../components/AppIconButton.vue';
import ScanProgressBanner from '../components/ScanProgressBanner.vue';
import SecurityEmptyState from '../components/SecurityEmptyState.vue';
import StatusDot from '../components/StatusDot.vue';
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
  downloadVulnReport,
  handleDetailOpenChange,
  loadDetailSbom,
  openDetail: openSbomDetail,
  selectedImage,
  selectedSbomFormat,
  selectedVulnExportFormat,
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
const sseConnectedListener = handleSseScanCompleted as EventListener;

onMounted(() => {
  void fetchSecurityRuntimeStatus();
  void fetchVulnerabilities();
  globalThis.addEventListener('dd:sse-scan-completed', sseScanCompletedListener);
  globalThis.addEventListener('dd:sse-connected', sseConnectedListener);
});

onUnmounted(() => {
  clearTimeout(scanCompletedDebounceTimer);
  globalThis.removeEventListener('dd:sse-scan-completed', sseScanCompletedListener);
  globalThis.removeEventListener('dd:sse-connected', sseConnectedListener);
});
</script>

<template>
  <DataViewLayout>
      <div v-if="error"
           class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
           :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
        {{ error }}
      </div>

      <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">Loading vulnerability data...</div>

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
                  class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
            <option value="all">Severity</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <select v-model="secFilterFix"
                  class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
            <option value="all">Fix Available</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
          <AppButton size="none" variant="plain" weight="none" v-if="activeSecFilterCount > 0"
                  class="text-2xs font-medium px-2 py-1 dd-rounded transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                  @click="clearSecFilters">
            Clear all
          </AppButton>
        </template>
        <template #left>
          <template v-if="runtimeStatus">
            <!-- Compact: single combined badge -->
            <AppBadge v-if="isCompact"
                  :custom="{ bg: statusBadgeTone(runtimeStatus.scanner.status).bg, text: statusBadgeTone(runtimeStatus.scanner.status).text }"
                  size="xs" class="cursor-default flex items-center gap-1"
                  v-tooltip.top="`Trivy: ${runtimeStatus.scanner.message} · Cosign: ${runtimeStatus.signature.message} · SBOM: ${runtimeStatus.sbom.enabled ? 'enabled' : 'disabled'}`">
              <StatusDot :color="statusBadgeTone(runtimeStatus.scanner.status).text" size="sm" />
              <StatusDot :color="statusBadgeTone(runtimeStatus.signature.status).text" size="sm" />
              <StatusDot :color="runtimeStatus.sbom.enabled ? 'var(--dd-info)' : 'var(--dd-neutral)'" size="sm" />
            </AppBadge>
            <!-- Full: individual badges -->
            <template v-else>
              <AppBadge :custom="{ bg: statusBadgeTone(runtimeStatus.scanner.status).bg, text: statusBadgeTone(runtimeStatus.scanner.status).text }"
                    size="xs" class="cursor-default"
                    v-tooltip.top="runtimeStatus.scanner.message + (runtimeStatus.scanner.server ? ' · server: ' + runtimeStatus.scanner.server : '')">
                trivy
              </AppBadge>
              <AppBadge :custom="{ bg: statusBadgeTone(runtimeStatus.signature.status).bg, text: statusBadgeTone(runtimeStatus.signature.status).text }"
                    size="xs" class="cursor-default"
                    v-tooltip.top="runtimeStatus.signature.message">
                cosign
              </AppBadge>
              <AppBadge :tone="runtimeStatus.sbom.enabled ? 'info' : 'neutral'"
                    size="xs" class="cursor-default"
                    v-tooltip.top="runtimeStatus.sbom.enabled ? 'SBOM generation enabled (' + runtimeStatus.sbom.formats.join(', ') + ')' : 'SBOM generation disabled'">
                sbom
              </AppBadge>
            </template>
          </template>
        </template>
        <template #center>
          <span class="inline-flex" v-tooltip.top="scanDisabledReason">
            <AppIconButton v-if="isCompact"
                    icon="restart" size="toolbar" variant="plain"
                    :class="[
                      scanning || runtimeLoading || !scannerReady
                        ? 'dd-text-muted'
                        : 'dd-text-secondary hover:dd-text hover:dd-bg-elevated',
                    ]"
                    :loading="scanning"
                    aria-label="Scan all containers"
                    :disabled="scanning || runtimeLoading || !scannerReady"
                    @click="scanAllContainers" />
            <AppButton v-else size="none" variant="plain" weight="none" class="dd-rounded flex items-center justify-center gap-1.5 px-3 text-2xs-plus font-semibold transition-colors h-8"
                    :class="[
                      scanning || runtimeLoading || !scannerReady
                        ? 'dd-text-muted cursor-not-allowed'
                        : 'dd-text-secondary hover:dd-text hover:dd-bg-elevated',
                    ]"
                    :disabled="scanning || runtimeLoading || !scannerReady"
                    @click="scanAllContainers">
              <AppIcon name="restart" :size="11" :class="{ 'animate-spin': scanning }" v-tooltip.top="scanning ? 'Scanning...' : undefined" />
              <span>Scan Now</span>
            </AppButton>
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
                     :style="{ color: severityColor(highestSeverity(row)).text }"
                     v-tooltip.top="highestSeverity(row)" />
            <span class="font-medium dd-text truncate">{{ row.image }}</span>
            <AppBadge v-if="row.delta && row.delta.fixed > 0 && row.delta.new === 0"
                  tone="success" size="xs" class="px-1.5 py-0 shrink-0"
                  v-tooltip.top="`Update fixes ${row.delta.fixed} vulnerability${row.delta.fixed !== 1 ? 'ies' : 'y'}`">
              <AppIcon name="trending-down" :size="9" class="mr-0.5" />{{ row.delta.fixed }} fixed
            </AppBadge>
            <AppBadge v-else-if="row.delta && row.delta.new > 0 && row.delta.fixed === 0"
                  tone="warning" size="xs" class="px-1.5 py-0 shrink-0"
                  v-tooltip.top="`Update introduces ${row.delta.new} new vulnerability${row.delta.new !== 1 ? 'ies' : 'y'}`">
              <AppIcon name="trending-up" :size="9" class="mr-0.5" />{{ row.delta.new }} new
            </AppBadge>
            <AppBadge v-else-if="row.delta && (row.delta.fixed > 0 || row.delta.new > 0)"
                  tone="caution" size="xs" class="px-1.5 py-0 shrink-0"
                  v-tooltip.top="`Update: ${row.delta.fixed} fixed, ${row.delta.new} new`">
              {{ row.delta.fixed }} fixed, {{ row.delta.new }} new
            </AppBadge>
          </div>
        </template>
        <template #cell-critical="{ row }">
          <AppBadge v-if="row.critical > 0" tone="danger" size="xs">
            {{ row.critical }}
          </AppBadge>
          <span v-else class="text-2xs dd-text-muted">&mdash;</span>
        </template>
        <template #cell-high="{ row }">
          <AppBadge v-if="row.high > 0" tone="warning" size="xs">
            {{ row.high }}
          </AppBadge>
          <span v-else class="text-2xs dd-text-muted">&mdash;</span>
        </template>
        <template #cell-medium="{ row }">
          <AppBadge v-if="row.medium > 0" tone="caution" size="xs">
            {{ row.medium }}
          </AppBadge>
          <span v-else class="text-2xs dd-text-muted">&mdash;</span>
        </template>
        <template #cell-low="{ row }">
          <AppBadge v-if="row.low > 0" tone="info" size="xs">
            {{ row.low }}
          </AppBadge>
          <span v-else class="text-2xs dd-text-muted">&mdash;</span>
        </template>
        <template #cell-fixable="{ row }">
          <span v-if="row.fixable > 0" class="text-2xs font-medium"
                :style="{ color: fixableColor(row.fixable, row.total) }">
            {{ fixablePercent(row.fixable, row.total) }}%
          </span>
          <span v-else class="text-2xs dd-text-muted">0%</span>
        </template>
        <template #cell-total="{ row }">
          <span class="text-2xs-plus font-semibold dd-text">{{ row.total }}</span>
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
              <div class="text-2xs mt-0.5 dd-text-muted">{{ summary.total }} vulnerabilities</div>
            </div>
            <AppIcon :name="severityIcon(highestSeverity(summary))" :size="16" class="shrink-0 ml-2"
                     :style="{ color: severityColor(highestSeverity(summary)).text }"
                     v-tooltip.top="highestSeverity(summary)" />
          </div>
          <div class="px-4 py-3">
            <div class="flex items-center gap-1.5 flex-wrap">
              <AppBadge v-if="summary.critical > 0" tone="danger" size="xs">
                {{ summary.critical }} Critical
              </AppBadge>
              <AppBadge v-if="summary.high > 0" tone="warning" size="xs">
                {{ summary.high }} High
              </AppBadge>
              <AppBadge v-if="summary.medium > 0" tone="caution" size="xs">
                {{ summary.medium }} Medium
              </AppBadge>
              <AppBadge v-if="summary.low > 0" tone="info" size="xs">
                {{ summary.low }} Low
              </AppBadge>
            </div>
          </div>
          <div v-if="summary.delta && (summary.delta.fixed > 0 || summary.delta.new > 0)"
               class="px-4 py-2 flex items-center gap-1.5"
               :style="{ borderTop: '1px solid var(--dd-border)' }">
            <AppBadge v-if="summary.delta.fixed > 0" tone="success" size="xs" class="px-1.5 py-0">
              {{ summary.delta.fixed }} fixed
            </AppBadge>
            <AppBadge v-if="summary.delta.new > 0" tone="warning" size="xs" class="px-1.5 py-0">
              {{ summary.delta.new }} new
            </AppBadge>
            <span class="text-3xs dd-text-muted ml-auto">vs update</span>
          </div>
          <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <span v-if="summary.fixable > 0" class="text-2xs-plus font-medium flex items-center gap-1"
                  :style="{ color: fixableColor(summary.fixable, summary.total) }">
              <AppIcon name="check" :size="11" />
              {{ fixablePercent(summary.fixable, summary.total) }}% fixable
            </span>
            <span v-else class="text-2xs-plus dd-text-muted">No fixes available</span>
            <span class="text-2xs dd-text-muted">{{ summary.total }} total</span>
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
                   :style="{ color: severityColor(highestSeverity(summary)).text }"
                   v-tooltip.top="highestSeverity(summary)" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold truncate dd-text">{{ summary.image }}</div>
            <div class="text-2xs dd-text-muted mt-0.5">{{ summary.total }} vulnerabilities</div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <AppBadge v-if="summary.critical > 0" tone="danger" size="xs" class="px-1.5 py-0">
              {{ summary.critical }}C
            </AppBadge>
            <AppBadge v-if="summary.high > 0" tone="warning" size="xs" class="px-1.5 py-0">
              {{ summary.high }}H
            </AppBadge>
            <AppBadge v-if="summary.fixable > 0" tone="success" size="xs" class="px-1.5 py-0">
              {{ summary.fixable }} fix
            </AppBadge>
            <AppBadge v-if="summary.delta && summary.delta.fixed > 0 && summary.delta.new === 0"
                  tone="success" size="xs" class="px-1.5 py-0">
              {{ summary.delta.fixed }} fixed
            </AppBadge>
            <AppBadge v-else-if="summary.delta && summary.delta.new > 0"
                  tone="warning" size="xs" class="px-1.5 py-0">
              {{ summary.delta.new }} new
            </AppBadge>
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
            <AppBadge v-if="selectedImage?.critical" tone="danger" size="xs">
              {{ selectedImage.critical }} Critical
            </AppBadge>
            <AppBadge v-if="selectedImage?.high" tone="warning" size="xs">
              {{ selectedImage.high }} High
            </AppBadge>
            <AppBadge v-if="selectedImage?.medium" tone="caution" size="xs">
              {{ selectedImage.medium }} Medium
            </AppBadge>
            <AppBadge v-if="selectedImage?.low" tone="info" size="xs">
              {{ selectedImage.low }} Low
            </AppBadge>
            <span class="text-2xs dd-text-muted ml-auto">{{ selectedImage?.total }} total</span>
          </div>
        </template>

        <template v-if="selectedImage" #default>
          <!-- Export controls -->
          <div class="px-4 py-3 space-y-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-2xs font-semibold uppercase tracking-wide dd-text-muted">Export</span>
              <select v-model="selectedVulnExportFormat"
                      class="px-2 py-1 dd-rounded text-2xs font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
              <AppButton size="xs" variant="secondary" :disabled="selectedImageVulns.length === 0"
                      @click="downloadVulnReport">
                Download Report
              </AppButton>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-2xs font-semibold uppercase tracking-wide dd-text-muted">SBOM</span>
              <select v-model="selectedSbomFormat"
                      class="px-2 py-1 dd-rounded text-2xs font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
                      @change="loadDetailSbom">
                <option value="spdx-json">spdx-json</option>
                <option value="cyclonedx-json">cyclonedx-json</option>
              </select>
              <AppButton size="xs" variant="secondary" :disabled="detailSbomLoading"
                      @click="loadDetailSbom">
                {{ detailSbomLoading ? 'Loading...' : 'Refresh' }}
              </AppButton>
              <AppButton size="xs" variant="secondary" :disabled="!detailSbomDocument"
                      @click="showSbomDocument = !showSbomDocument">
                {{ showSbomDocument ? 'Hide' : 'View' }}
              </AppButton>
              <AppButton size="xs" variant="secondary" :disabled="!detailSbomDocument"
                      @click="downloadDetailSbom">
                Download
              </AppButton>
            </div>

            <div v-if="detailSbomError"
                 class="px-2.5 py-1.5 dd-rounded text-2xs-plus"
                 :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
              {{ detailSbomError }}
            </div>
            <div v-else-if="detailSbomLoading"
                 class="px-2.5 py-1.5 dd-rounded text-2xs-plus dd-text-muted"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              Loading SBOM document...
            </div>
            <div v-else-if="detailSbomDocument"
                 class="px-2.5 py-1.5 dd-rounded text-2xs space-y-0.5"
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

            <pre v-if="showSbomDocument && detailSbomDocumentJson"
                 class="p-2 dd-rounded text-2xs overflow-auto max-h-64 font-mono"
                 :style="{ backgroundColor: 'var(--dd-bg-code)' }">{{ detailSbomDocumentJson }}</pre>
          </div>

          <!-- Vulnerability list -->
          <div class="divide-y" :style="{ borderColor: 'var(--dd-border)' }">
            <div v-for="vuln in selectedImageVulns" :key="vuln.id + vuln.package"
                 class="px-4 py-3 hover:dd-bg-hover transition-colors">
              <div class="flex items-center gap-2 mb-1.5">
                <AppIcon :name="severityIcon(vuln.severity)" :size="12"
                         :style="{ color: severityColor(vuln.severity).text }" />
                <AppBadge :custom="{ bg: severityColor(vuln.severity).bg, text: severityColor(vuln.severity).text }" size="xs" class="px-1.5 py-0">
                  {{ vuln.severity }}
                </AppBadge>
                <span class="font-mono text-2xs-plus font-semibold dd-text truncate">{{ vuln.id }}</span>
              </div>
              <div class="flex items-center gap-2 text-2xs-plus ml-5">
                <span class="font-medium dd-text">{{ vuln.package }}</span>
                <span class="dd-text-muted">{{ vuln.version }}</span>
                <AppBadge v-if="vuln.fixedIn" tone="success" size="xs" class="ml-auto px-1.5 py-0">
                  <AppIcon name="check" :size="9" class="mr-0.5" />
                  {{ vuln.fixedIn }}
                </AppBadge>
                <span v-else class="ml-auto text-2xs dd-text-muted">No fix</span>
              </div>
              <div
                v-if="vuln.title || vuln.target || vuln.primaryUrl"
                class="ml-5 mt-1.5 space-y-1"
              >
                <div v-if="vuln.title" class="text-2xs dd-text">
                  {{ vuln.title }}
                </div>
                <div v-if="vuln.target" class="text-2xs dd-text-muted">
                  Target:
                  <span class="font-mono dd-text">{{ vuln.target }}</span>
                </div>
                <a
                  v-if="vuln.primaryUrl"
                  :href="vuln.primaryUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex text-2xs underline hover:no-underline break-all"
                  style="color: var(--dd-info);"
                >
                  {{ vuln.primaryUrl }}
                </a>
              </div>
            </div>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
