<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppBadge from '../components/AppBadge.vue';
import AppIconButton from '../components/AppIconButton.vue';
import ContainerUpdateDialog from '../components/containers/ContainerUpdateDialog.vue';
import ReleaseNotesLink from '../components/containers/ReleaseNotesLink.vue';
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
import { getAllContainers } from '../services/container';
import { getSecurityRuntime } from '../services/server';
import type { Container } from '../types/container';
import { mapApiContainers } from '../utils/container-mapper';
import { errorMessage } from '../utils/error';
import { ROUTES } from '../router/routes';
import type { SecurityRuntimeStatus } from './security/securityViewTypes';
import {
  fixableColor,
  fixablePercent,
  formatTimestamp,
  highestSeverity,
  severityColor,
  severityIcon,
  statusBadgeTone,
  toSafeExternalUrl,
} from './security/securityViewUtils';

const { t } = useI18n();
const router = useRouter();

const updateDialogContainerId = ref<string | null>(null);
const updateDialogContainerName = ref<string | undefined>(undefined);
const updateDialogCurrentTag = ref<string | undefined>(undefined);
const updateDialogNewTag = ref<string | undefined>(undefined);
const updateDialogUpdateKind = ref<'major' | 'minor' | 'patch' | 'digest' | null | undefined>(
  undefined,
);

const chooserSummary = ref<ImageSummary | null>(null);
const chooserAnchorStyle = ref<Record<string, string>>({});

interface ContainerChoice {
  id: string;
  name: string;
  host?: string;
  currentTag?: string;
  newTag?: string;
  updateKind?: 'major' | 'minor' | 'patch' | 'digest' | null;
}

const { isMobile, windowNarrow: isCompact } = useBreakpoints();
const { scanning, scanProgress, scanAllContainers: runScanAll } = useScanProgress();

const containers = ref<Container[]>([]);

async function fetchContainers() {
  try {
    const apiContainers = await getAllContainers();
    containers.value = mapApiContainers(apiContainers);
  } catch {
    containers.value = [];
  }
}

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
    return t('securityView.checkingScanner');
  }
  if (runtimeError.value) {
    return t('securityView.runtimeUnavailable');
  }
  if (!runtimeStatus.value) {
    return t('securityView.scanAllContainers');
  }
  if (!scannerReady.value) {
    return runtimeStatus.value.scanner.message;
  }
  return t('securityView.scanAllContainers');
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
  containers,
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

const selectedImageVulnsWithSafeUrl = computed(() =>
  selectedImageVulns.value.map((vuln) => ({
    ...vuln,
    safePrimaryUrl: toSafeExternalUrl(vuln.primaryUrl),
  })),
);

function openDetail(summary: ImageSummary) {
  const vulnerabilities = vulnerabilitiesByImage.value[summary.image] || [];
  openSbomDetail({
    ...summary,
    vulns: vulnerabilities,
  });
}

function navigateToContainerUpdate(summary: ImageSummary) {
  const ids = summary.containersWithUpdate;
  if (!ids || ids.length === 0) {
    return;
  }
  void router.push({
    path: ROUTES.CONTAINERS,
    query: { containerIds: ids.join(',') },
  });
}

function resolveContainerChoices(summary: ImageSummary): ContainerChoice[] {
  const ids = summary.containersWithUpdate ?? [];
  return ids.map((id) => {
    const found = containers.value.find((c) => c.id === id);
    return {
      id,
      name: found?.name ?? id,
      host: found?.server,
      currentTag: found?.currentTag,
      newTag: found?.newTag ?? undefined,
      updateKind: found?.updateKind,
    };
  });
}

function openUpdateAction(summary: ImageSummary) {
  const ids = summary.containersWithUpdate ?? [];
  if (ids.length === 0) {
    return;
  }
  if (ids.length === 1) {
    const choices = resolveContainerChoices(summary);
    const choice = choices[0];
    updateDialogContainerId.value = choice.id;
    updateDialogContainerName.value = choice.name;
    updateDialogCurrentTag.value = choice.currentTag;
    updateDialogNewTag.value = choice.newTag;
    updateDialogUpdateKind.value = choice.updateKind;
    chooserSummary.value = null;
  } else {
    chooserSummary.value = summary;
  }
}

function openUpdateFromChooser(choice: ContainerChoice) {
  updateDialogContainerId.value = choice.id;
  updateDialogContainerName.value = choice.name;
  updateDialogCurrentTag.value = choice.currentTag;
  updateDialogNewTag.value = choice.newTag;
  updateDialogUpdateKind.value = choice.updateKind;
  chooserSummary.value = null;
}

function closeChooser() {
  chooserSummary.value = null;
}

const chooserChoices = computed<ContainerChoice[]>(() => {
  if (!chooserSummary.value) {
    return [];
  }
  return resolveContainerChoices(chooserSummary.value);
});

let scanCompletedDebounceTimer: ReturnType<typeof setTimeout> | undefined;
let containerChangedDebounceTimer: ReturnType<typeof setTimeout> | undefined;

function handleSseScanCompleted() {
  clearTimeout(scanCompletedDebounceTimer);
  scanCompletedDebounceTimer = setTimeout(() => {
    void fetchVulnerabilities();
  }, 800);
}

function handleSseContainerChanged() {
  clearTimeout(containerChangedDebounceTimer);
  containerChangedDebounceTimer = setTimeout(() => {
    void fetchContainers();
  }, 400);
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
      { key: 'image', label: t('securityView.columns.image'), align: 'text-left', width: '99%' },
      { key: 'total', label: t('securityView.columns.total'), sortable: true },
    ];
  }
  return [
    { key: 'image', label: t('securityView.columns.image'), align: 'text-left', width: '99%' },
    { key: 'critical', label: t('securityView.columns.critical'), sortable: true },
    { key: 'high', label: t('securityView.columns.high'), sortable: true },
    { key: 'medium', label: t('securityView.columns.medium'), sortable: true },
    { key: 'low', label: t('securityView.columns.low'), sortable: true },
    { key: 'fixable', label: t('securityView.columns.fixable'), sortable: true },
    { key: 'total', label: t('securityView.columns.total'), sortable: true },
  ];
});

const sseScanCompletedListener = handleSseScanCompleted as EventListener;
const sseConnectedListener = handleSseScanCompleted as EventListener;
const sseContainerChangedListener = handleSseContainerChanged as EventListener;
const sseResyncRequiredListener = handleSseScanCompleted as EventListener;

onMounted(() => {
  void fetchSecurityRuntimeStatus();
  void fetchContainers();
  void fetchVulnerabilities();
  globalThis.addEventListener('dd:sse-scan-completed', sseScanCompletedListener);
  globalThis.addEventListener('dd:sse-connected', sseConnectedListener);
  globalThis.addEventListener('dd:sse-container-changed', sseContainerChangedListener);
  globalThis.addEventListener('dd:sse-resync-required', sseResyncRequiredListener);
});

onUnmounted(() => {
  clearTimeout(scanCompletedDebounceTimer);
  clearTimeout(containerChangedDebounceTimer);
  globalThis.removeEventListener('dd:sse-scan-completed', sseScanCompletedListener);
  globalThis.removeEventListener('dd:sse-connected', sseConnectedListener);
  globalThis.removeEventListener('dd:sse-container-changed', sseContainerChangedListener);
  globalThis.removeEventListener('dd:sse-resync-required', sseResyncRequiredListener);
});
</script>

<template>
  <DataViewLayout>
      <div v-if="error"
           class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
           :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
        {{ error }}
      </div>

      <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">{{ t('securityView.loadingVulnerabilityData') }}</div>

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
            <option value="all">{{ t('securityView.filters.severity') }}</option>
            <option value="CRITICAL">{{ t('securityView.filters.severityCritical') }}</option>
            <option value="HIGH">{{ t('securityView.filters.severityHigh') }}</option>
            <option value="MEDIUM">{{ t('securityView.filters.severityMedium') }}</option>
            <option value="LOW">{{ t('securityView.filters.severityLow') }}</option>
          </select>
          <select v-model="secFilterFix"
                  class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
            <option value="all">{{ t('securityView.filters.fixAvailable') }}</option>
            <option value="yes">{{ t('securityView.filters.fixYes') }}</option>
            <option value="no">{{ t('securityView.filters.fixNo') }}</option>
          </select>
          <AppButton size="none" variant="plain" weight="none" v-if="activeSecFilterCount > 0"
                  class="text-2xs font-medium px-2 py-1 dd-rounded transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                  @click="clearSecFilters">
            {{ t('securityView.filters.clearAll') }}
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
                    :aria-label="t('securityView.scanAllAriaLabel')"
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
              <AppIcon name="restart" :size="11" :class="{ 'animate-spin': scanning }" v-tooltip.top="scanning ? t('securityView.scanning') : undefined" />
              <span>{{ t('securityView.scanNow') }}</span>
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
            <template v-if="row.hasUpdate">
              <AppButton
                size="none"
                variant="plain"
                weight="none"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 dd-rounded text-3xs font-semibold uppercase tracking-wide shrink-0 transition-colors"
                :style="{ backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' }"
                data-test="security-update-btn"
                v-tooltip.top="(row.containersWithUpdate?.length ?? 0) > 1 ? `Update one of ${row.containersWithUpdate?.length} containers` : 'Update this container'"
                @click.stop="openUpdateAction(row)">
                <AppIcon name="cloud-download" :size="9" />
                {{ t('securityView.update') }}
              </AppButton>
              <AppButton
                size="none"
                variant="plain"
                weight="none"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 dd-rounded text-3xs font-medium shrink-0 transition-colors"
                :style="{ color: 'var(--dd-text-secondary)' }"
                data-test="security-containers-link"
                v-tooltip.top="t('securityView.viewInContainers')"
                @click.stop="navigateToContainerUpdate(row)">
                {{ t('securityView.viewInContainers') }}
              </AppButton>
              <ReleaseNotesLink
                v-if="row.releaseNotes || row.currentReleaseNotes || row.releaseLink"
                :release-notes="row.releaseNotes"
                :current-release-notes="row.currentReleaseNotes"
                :release-link="row.releaseLink"
                data-test="security-release-notes" />
            </template>
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
              <div class="text-2xs mt-0.5 dd-text-muted">{{ summary.total }} {{ t('securityView.card.vulnerabilities') }}</div>
            </div>
            <AppIcon :name="severityIcon(highestSeverity(summary))" :size="16" class="shrink-0 ml-2"
                     :style="{ color: severityColor(highestSeverity(summary)).text }"
                     v-tooltip.top="highestSeverity(summary)" />
          </div>
          <div class="px-4 py-3">
            <div class="flex items-center gap-1.5 flex-wrap">
              <AppBadge v-if="summary.critical > 0" tone="danger" size="xs">
                {{ summary.critical }} {{ t('securityView.badge.critical') }}
              </AppBadge>
              <AppBadge v-if="summary.high > 0" tone="warning" size="xs">
                {{ summary.high }} {{ t('securityView.badge.high') }}
              </AppBadge>
              <AppBadge v-if="summary.medium > 0" tone="caution" size="xs">
                {{ summary.medium }} {{ t('securityView.badge.medium') }}
              </AppBadge>
              <AppBadge v-if="summary.low > 0" tone="info" size="xs">
                {{ summary.low }} {{ t('securityView.badge.low') }}
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
            <span class="text-3xs dd-text-muted ml-auto">{{ t('securityView.card.vsUpdate') }}</span>
          </div>
          <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <span v-if="summary.fixable > 0" class="text-2xs-plus font-medium flex items-center gap-1"
                  :style="{ color: fixableColor(summary.fixable, summary.total) }">
              <AppIcon name="check" :size="11" />
              {{ fixablePercent(summary.fixable, summary.total) }}% {{ t('securityView.card.fixable') }}
            </span>
            <span v-else class="text-2xs-plus dd-text-muted">{{ t('securityView.card.noFixesAvailable') }}</span>
            <template v-if="summary.hasUpdate">
              <AppButton
                size="none"
                variant="plain"
                weight="none"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 dd-rounded text-3xs font-semibold uppercase tracking-wide transition-colors"
                :style="{ backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' }"
                data-test="security-update-btn"
                @click.stop="openUpdateAction(summary)">
                <AppIcon name="cloud-download" :size="9" />
                {{ t('securityView.update') }}
              </AppButton>
              <AppButton
                size="none"
                variant="plain"
                weight="none"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 dd-rounded text-3xs font-medium transition-colors"
                :style="{ color: 'var(--dd-text-secondary)' }"
                data-test="security-containers-link"
                @click.stop="navigateToContainerUpdate(summary)">
                {{ t('securityView.viewInContainers') }}
              </AppButton>
              <ReleaseNotesLink
                v-if="summary.releaseNotes || summary.currentReleaseNotes || summary.releaseLink"
                :release-notes="summary.releaseNotes"
                :current-release-notes="summary.currentReleaseNotes"
                :release-link="summary.releaseLink"
                data-test="security-release-notes" />
            </template>
            <span v-else class="text-2xs dd-text-muted">{{ summary.total }} {{ t('securityView.card.total') }}</span>
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
            <div class="text-2xs dd-text-muted mt-0.5">{{ summary.total }} {{ t('securityView.card.vulnerabilities') }}</div>
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
              {{ selectedImage.critical }} {{ t('securityView.badge.critical') }}
            </AppBadge>
            <AppBadge v-if="selectedImage?.high" tone="warning" size="xs">
              {{ selectedImage.high }} {{ t('securityView.badge.high') }}
            </AppBadge>
            <AppBadge v-if="selectedImage?.medium" tone="caution" size="xs">
              {{ selectedImage.medium }} {{ t('securityView.badge.medium') }}
            </AppBadge>
            <AppBadge v-if="selectedImage?.low" tone="info" size="xs">
              {{ selectedImage.low }} {{ t('securityView.badge.low') }}
            </AppBadge>
            <span class="text-2xs dd-text-muted ml-auto">{{ selectedImage?.total }} {{ t('securityView.card.total') }}</span>
          </div>
          <div v-if="selectedImage?.hasUpdate" class="mt-2 flex items-center gap-2 flex-wrap">
            <AppButton
              size="xs"
              variant="secondary"
              class="inline-flex items-center gap-1.5"
              data-test="security-detail-update-btn"
              @click="openUpdateAction(selectedImage)">
              <AppIcon name="cloud-download" :size="10" />
              {{ t('securityView.update') }}
            </AppButton>
            <AppButton
              size="none"
              variant="plain"
              weight="none"
              class="inline-flex items-center text-2xs font-medium underline hover:no-underline"
              :style="{ color: 'var(--dd-text-secondary)' }"
              data-test="security-detail-containers-link"
              @click="navigateToContainerUpdate(selectedImage)">
              {{ t('securityView.viewInContainers') }}
            </AppButton>
            <ReleaseNotesLink
              v-if="selectedImage.releaseNotes || selectedImage.currentReleaseNotes || selectedImage.releaseLink"
              :release-notes="selectedImage.releaseNotes"
              :current-release-notes="selectedImage.currentReleaseNotes"
              :release-link="selectedImage.releaseLink"
              data-test="security-detail-release-notes" />
          </div>
        </template>

        <template v-if="selectedImage" #default>
          <!-- Export controls -->
          <div class="px-4 py-3 space-y-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-2xs font-semibold uppercase tracking-wide dd-text-muted">{{ t('securityView.export.label') }}</span>
              <select v-model="selectedVulnExportFormat"
                      class="px-2 py-1 dd-rounded text-2xs font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
              <AppButton size="xs" variant="secondary" :disabled="selectedImageVulns.length === 0"
                      @click="downloadVulnReport">
                {{ t('securityView.export.downloadReport') }}
              </AppButton>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-2xs font-semibold uppercase tracking-wide dd-text-muted">{{ t('securityView.sbom.label') }}</span>
              <select v-model="selectedSbomFormat"
                      class="px-2 py-1 dd-rounded text-2xs font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
                      @change="loadDetailSbom">
                <option value="spdx-json">spdx-json</option>
                <option value="cyclonedx-json">cyclonedx-json</option>
              </select>
              <AppButton size="xs" variant="secondary" :disabled="detailSbomLoading"
                      @click="loadDetailSbom">
                {{ detailSbomLoading ? t('securityView.sbom.loadingButton') : t('securityView.sbom.refresh') }}
              </AppButton>
              <AppButton size="xs" variant="secondary" :disabled="!detailSbomDocument"
                      @click="showSbomDocument = !showSbomDocument">
                {{ showSbomDocument ? t('securityView.sbom.hide') : t('securityView.sbom.view') }}
              </AppButton>
              <AppButton size="xs" variant="secondary" :disabled="!detailSbomDocument"
                      @click="downloadDetailSbom">
                {{ t('securityView.sbom.download') }}
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
              {{ t('securityView.sbom.loading') }}
            </div>
            <div v-else-if="detailSbomDocument"
                 class="px-2.5 py-1.5 dd-rounded text-2xs space-y-0.5"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              <div class="dd-text-muted">
                {{ t('securityView.sbom.format') }}
                <span class="dd-text font-mono">{{ selectedSbomFormat }}</span>
              </div>
              <div v-if="typeof detailSbomComponentCount === 'number'" class="dd-text-muted">
                {{ t('securityView.sbom.components') }}
                <span class="dd-text">{{ detailSbomComponentCount }}</span>
              </div>
              <div v-if="detailSbomGeneratedAt" class="dd-text-muted">
                {{ t('securityView.sbom.generated') }}
                <span class="dd-text">{{ formatTimestamp(detailSbomGeneratedAt) }}</span>
              </div>
            </div>

            <pre v-if="showSbomDocument && detailSbomDocumentJson"
                 class="p-2 dd-rounded text-2xs overflow-auto max-h-64 font-mono"
                 :style="{ backgroundColor: 'var(--dd-bg-code)' }">{{ detailSbomDocumentJson }}</pre>
          </div>

          <!-- Vulnerability list -->
          <div class="divide-y" :style="{ borderColor: 'var(--dd-border)' }">
            <div v-for="vuln in selectedImageVulnsWithSafeUrl" :key="vuln.id + vuln.package"
                 class="px-4 py-3 hover:dd-bg-hover transition-colors">
              <div class="flex items-start gap-2 mb-1.5">
                <AppIcon :name="severityIcon(vuln.severity)" :size="12"
                         class="mt-0.5 shrink-0"
                         :style="{ color: severityColor(vuln.severity).text }" />
                <AppBadge :custom="{ bg: severityColor(vuln.severity).bg, text: severityColor(vuln.severity).text }" size="xs" class="mt-0.5 shrink-0 px-1.5 py-0">
                  {{ vuln.severity }}
                </AppBadge>
                <span class="min-w-0 font-mono text-2xs-plus font-semibold dd-text truncate">{{ vuln.id }}</span>
              </div>
              <div class="flex items-start gap-2 text-2xs-plus ml-5 min-w-0">
                <span class="font-medium dd-text">{{ vuln.package }}</span>
                <span class="dd-text-muted">{{ vuln.version }}</span>
                <AppBadge v-if="vuln.fixedIn" tone="success" size="xs" class="ml-auto mt-0.5 shrink-0 px-1.5 py-0">
                  <AppIcon name="check" :size="9" class="mr-0.5 shrink-0" />
                  {{ vuln.fixedIn }}
                </AppBadge>
                <span v-else class="ml-auto mt-0.5 shrink-0 text-2xs dd-text-muted">{{ t('securityView.vuln.noFix') }}</span>
              </div>
              <div
                v-if="vuln.title || vuln.target || vuln.safePrimaryUrl"
                class="ml-5 mt-1.5 space-y-1"
              >
                <div v-if="vuln.title" class="text-2xs dd-text">
                  {{ vuln.title }}
                </div>
                <div v-if="vuln.target" class="text-2xs dd-text-muted">
                  {{ t('securityView.vuln.target') }}
                  <span class="font-mono dd-text">{{ vuln.target }}</span>
                </div>
                <a
                  v-if="vuln.safePrimaryUrl"
                  :href="vuln.safePrimaryUrl"
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

  <ContainerUpdateDialog
    v-model:containerId="updateDialogContainerId"
    :container-name="updateDialogContainerName"
    :current-tag="updateDialogCurrentTag"
    :new-tag="updateDialogNewTag"
    :update-kind="updateDialogUpdateKind" />

  <!-- Multi-container chooser -->
  <Teleport v-if="chooserSummary" to="body">
    <div
      class="fixed inset-0 z-overlay"
      @pointerdown.self="closeChooser"
      @keydown.escape="closeChooser">
      <div
        class="fixed left-1/2 top-1/3 -translate-x-1/2 w-full max-w-xs mx-4 dd-rounded-lg overflow-hidden shadow-lg"
        :style="{
          backgroundColor: 'var(--dd-bg-card)',
          border: '1px solid var(--dd-border-strong)',
          boxShadow: 'var(--dd-shadow-modal)',
        }">
        <div class="px-4 pt-3 pb-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
          <span class="text-2xs-plus font-semibold dd-text">{{ t('securityView.chooser.title') }}</span>
        </div>
        <div class="py-1 max-h-64 overflow-y-auto">
          <AppButton
            v-for="choice in chooserChoices"
            :key="choice.id"
            size="none"
            variant="plain"
            weight="none"
            class="w-full text-left px-4 py-2.5 flex items-start gap-2 hover:dd-bg-hover transition-colors"
            data-test="security-chooser-item"
            @click="openUpdateFromChooser(choice)">
            <div class="min-w-0 flex-1">
              <div class="text-2xs-plus font-semibold dd-text truncate">{{ choice.name }}</div>
              <div v-if="choice.host" class="text-3xs dd-text-muted mt-0.5">{{ choice.host }}</div>
            </div>
            <AppBadge v-if="choice.newTag" tone="info" size="xs" class="shrink-0 mt-0.5">
              {{ choice.newTag }}
            </AppBadge>
          </AppButton>
        </div>
        <div class="px-4 py-2.5 flex items-center justify-between" :style="{ borderTop: '1px solid var(--dd-border)' }">
          <AppButton
            size="none"
            variant="plain"
            weight="none"
            class="text-2xs font-medium underline hover:no-underline"
            :style="{ color: 'var(--dd-text-secondary)' }"
            data-test="security-chooser-view-all"
            @click="navigateToContainerUpdate(chooserSummary!); closeChooser()">
            {{ t('securityView.viewAllInContainers') }}
          </AppButton>
          <AppButton size="xs" variant="secondary" @click="closeChooser">{{ t('securityView.chooser.cancel') }}</AppButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>
