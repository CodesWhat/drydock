<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppBadge from '../components/AppBadge.vue';
import AppIconButton from '../components/AppIconButton.vue';
import AppStatusIndicator from '../components/AppStatusIndicator.vue';
import ContainerUpdateDialog from '../components/containers/ContainerUpdateDialog.vue';
import ProjectLink from '../components/containers/ProjectLink.vue';
import ReleaseNotesLink from '../components/containers/ReleaseNotesLink.vue';
import ScanProgressBanner from '../components/ScanProgressBanner.vue';
import SecurityEmptyState from '../components/SecurityEmptyState.vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { useSbomDetail } from '../composables/useSbomDetail';
import { useScanProgress } from '../composables/useScanProgress';
import { useVulnerabilities, type ImageSummary } from '../composables/useVulnerabilities';
import { preferences } from '../preferences/store';
import { usePreference } from '../preferences/usePreference';
import { useViewMode } from '../preferences/useViewMode';
import { getAllContainers } from '../services/container';
import { getSecurityRuntime } from '../services/server';
import type { Container, UpdateEligibility } from '../types/container';
import { mapApiContainers } from '../utils/container-mapper';
import { errorMessage } from '../utils/error';
import { ROUTES } from '../router/routes';
import { getPrimaryHardBlocker } from '../utils/update-eligibility';
import SecurityContainerChooser from './security/SecurityContainerChooser.vue';
import SecurityDetailPanel from './security/SecurityDetailPanel.vue';
import type {
  ContainerChoice,
  SbomState,
  SecurityRuntimeStatus,
} from './security/securityViewTypes';
import {
  fixableColor,
  fixablePercent,
  highestSeverity,
  severityColor,
  severityIcon,
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
const updateDialogUpdateEligibility = ref<UpdateEligibility | undefined>(undefined);

const chooserSummary = ref<ImageSummary | null>(null);

const { isMobile, windowNarrow: isCompact } = useBreakpoints();
const { scanning, scanProgress, scanAllContainers: runScanAll } = useScanProgress();

const containers = ref<Container[]>([]);

function runtimeToolTone(status: SecurityRuntimeStatus['scanner']['status']) {
  if (status === 'ready') return 'success';
  if (status === 'missing') return 'danger';
  return 'neutral';
}

function scannerStatusLabel(scanner: SecurityRuntimeStatus['scanner']): string {
  if (scanner.status === 'disabled') return t('securityView.runtimeTools.scannerDisabled');
  if (scanner.status === 'missing')
    return t('securityView.runtimeTools.scannerMissing', { command: scanner.command });
  if (scanner.server) return t('securityView.runtimeTools.scannerReadyServer');
  return t('securityView.runtimeTools.scannerReady');
}

function signatureStatusLabel(signature: SecurityRuntimeStatus['signature']): string {
  if (signature.status === 'disabled') return t('securityView.runtimeTools.signatureDisabled');
  if (signature.status === 'missing')
    return t('securityView.runtimeTools.signatureMissing', { command: signature.command });
  return t('securityView.runtimeTools.signatureReady');
}

function severityTone(severity: string) {
  if (severity === 'CRITICAL') return 'danger';
  if (severity === 'HIGH') return 'warning';
  if (severity === 'MEDIUM') return 'caution';
  return 'info';
}

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
    return scannerStatusLabel(runtimeStatus.value.scanner);
  }
  return t('securityView.scanAllContainers');
});

async function fetchSecurityRuntimeStatus() {
  runtimeLoading.value = true;
  runtimeError.value = null;
  try {
    runtimeStatus.value = await getSecurityRuntime();
  } catch (caught: unknown) {
    runtimeError.value = errorMessage(caught, t('securityView.runtimeLoadError'));
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
const displayCountLabel = computed(() =>
  activeSecFilterCount.value > 0
    ? t('securityView.countLabel.images')
    : t('securityView.countLabel.scanned'),
);

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

const sbomState = computed<SbomState>(() => ({
  componentCount: detailSbomComponentCount.value,
  document: detailSbomDocument.value,
  documentJson: detailSbomDocumentJson.value,
  error: detailSbomError.value,
  generatedAt: detailSbomGeneratedAt.value,
  loading: detailSbomLoading.value,
  selectedFormat: selectedSbomFormat.value,
  showDocument: showSbomDocument.value,
}));

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

function getContainerById(id: string): Container | undefined {
  return containers.value.find((c) => c.id === id);
}

function getContainerHardBlocker(id: string) {
  return getPrimaryHardBlocker(getContainerById(id)?.updateEligibility);
}

function isSummaryUpdateBlocked(summary: ImageSummary | null | undefined): boolean {
  const ids = summary?.containersWithUpdate ?? [];
  return ids.length > 0 && ids.every((id) => getContainerHardBlocker(id) !== undefined);
}

function getSummaryUpdateTooltip(summary: ImageSummary | null | undefined): string {
  const ids = summary?.containersWithUpdate ?? [];
  if (isSummaryUpdateBlocked(summary)) {
    if (ids.length === 1) {
      return (
        getContainerHardBlocker(ids[0])?.message ??
        t('containerComponents.groupedViews.blockedTooltip')
      );
    }
    return t('containerComponents.groupHeader.allBlockedTooltip');
  }
  return ids.length > 1
    ? t('securityView.updateOneOfButton', { count: ids.length })
    : t('securityView.updateThisContainerButton');
}

function resolveContainerChoices(summary: ImageSummary): ContainerChoice[] {
  const ids = summary.containersWithUpdate ?? [];
  return ids.map((id) => {
    const found = containers.value.find((c) => c.id === id);
    const blocker = getPrimaryHardBlocker(found?.updateEligibility);
    return {
      id,
      name: found?.name ?? id,
      host: found?.server,
      currentTag: found?.currentTag,
      newTag: found?.newTag ?? undefined,
      updateKind: found?.updateKind,
      updateEligibility: found?.updateEligibility,
      blocked: blocker !== undefined,
      blockerMessage: blocker?.message,
    };
  });
}

function openUpdateAction(summary: ImageSummary) {
  const ids = summary.containersWithUpdate ?? [];
  if (ids.length === 0) {
    return;
  }
  const choices = resolveContainerChoices(summary);
  if (choices.every((choice) => choice.blocked)) {
    return;
  }
  if (ids.length === 1) {
    const choice = choices[0];
    if (choice.blocked) {
      return;
    }
    updateDialogContainerId.value = choice.id;
    updateDialogContainerName.value = choice.name;
    updateDialogCurrentTag.value = choice.currentTag;
    updateDialogNewTag.value = choice.newTag;
    updateDialogUpdateKind.value = choice.updateKind;
    updateDialogUpdateEligibility.value = choice.updateEligibility;
    chooserSummary.value = null;
  } else {
    chooserSummary.value = summary;
  }
}

function openUpdateFromChooser(choice: ContainerChoice) {
  if (choice.blocked) {
    return;
  }
  updateDialogContainerId.value = choice.id;
  updateDialogContainerName.value = choice.name;
  updateDialogCurrentTag.value = choice.currentTag;
  updateDialogNewTag.value = choice.newTag;
  updateDialogUpdateKind.value = choice.updateKind;
  updateDialogUpdateEligibility.value = choice.updateEligibility;
  chooserSummary.value = null;
}

function closeChooser() {
  chooserSummary.value = null;
}

function viewAllChooserContainers() {
  if (!chooserSummary.value) {
    return;
  }
  navigateToContainerUpdate(chooserSummary.value);
  closeChooser();
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
      {
        key: 'image',
        label: t('securityView.columns.image'),
        align: 'text-left',
        size: 320,
        minSize: 220,
        maxSize: 720,
        flex: 1,
      },
      {
        key: 'total',
        label: t('securityView.columns.total'),
        sortable: true,
        size: 96,
        minSize: 80,
        maxSize: 120,
      },
    ];
  }
  return [
    {
      key: 'image',
      label: t('securityView.columns.image'),
      align: 'text-left',
      size: 360,
      minSize: 240,
      maxSize: 760,
      flex: 1,
    },
    {
      key: 'critical',
      label: t('securityView.columns.critical'),
      sortable: true,
      size: 96,
      minSize: 84,
      maxSize: 120,
    },
    {
      key: 'high',
      label: t('securityView.columns.high'),
      sortable: true,
      size: 96,
      minSize: 84,
      maxSize: 120,
    },
    {
      key: 'medium',
      label: t('securityView.columns.medium'),
      sortable: true,
      size: 96,
      minSize: 84,
      maxSize: 120,
    },
    {
      key: 'low',
      label: t('securityView.columns.low'),
      sortable: true,
      size: 96,
      minSize: 84,
      maxSize: 120,
    },
    {
      key: 'fixable',
      label: t('securityView.columns.fixable'),
      sortable: true,
      size: 110,
      minSize: 92,
      maxSize: 140,
    },
    {
      key: 'total',
      label: t('securityView.columns.total'),
      sortable: true,
      size: 96,
      minSize: 84,
      maxSize: 120,
    },
  ];
});

function handleSseReconnected() {
  void fetchContainers();
  handleSseScanCompleted();
}

const sseScanCompletedListener = handleSseScanCompleted as EventListener;
const sseConnectedListener = handleSseReconnected as EventListener;
const sseContainerChangedListener = handleSseContainerChanged as EventListener;
const sseResyncRequiredListener = handleSseReconnected as EventListener;

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
          <AppButton
                  v-if="activeSecFilterCount > 0"
                  size="xs"
                  variant="muted"
                  weight="medium"
                  @click="clearSecFilters">
            {{ t('securityView.filters.clearAll') }}
          </AppButton>
        </template>
        <template #left>
          <template v-if="runtimeStatus">
            <div v-if="isCompact" class="inline-flex items-center gap-2">
              <AppStatusIndicator
                :tone="runtimeToolTone(runtimeStatus.scanner.status)"
                label="T"
                size="xs"
                uppercase
                v-tooltip.top="runtimeStatus.scanner.server ? t('securityView.runtimeTools.scannerTooltipServer', { message: scannerStatusLabel(runtimeStatus.scanner), server: runtimeStatus.scanner.server }) : t('securityView.runtimeTools.scannerTooltip', { message: scannerStatusLabel(runtimeStatus.scanner) })" />
              <AppStatusIndicator
                :tone="runtimeToolTone(runtimeStatus.signature.status)"
                label="C"
                size="xs"
                uppercase
                v-tooltip.top="t('securityView.runtimeTools.cosignTooltip', { message: signatureStatusLabel(runtimeStatus.signature) })" />
              <AppStatusIndicator
                :tone="runtimeStatus.sbom.enabled ? 'info' : 'neutral'"
                label="S"
                size="xs"
                uppercase
                v-tooltip.top="runtimeStatus.sbom.enabled ? t('securityView.runtimeTools.sbomEnabled', { formats: runtimeStatus.sbom.formats.join(', ') }) : t('securityView.runtimeTools.sbomDisabled')" />
            </div>
            <template v-else>
              <AppStatusIndicator
                :tone="runtimeToolTone(runtimeStatus.scanner.status)"
                :label="t('securityView.runtimeTools.trivy')"
                size="xs"
                v-tooltip.top="runtimeStatus.scanner.server ? t('securityView.runtimeTools.scannerTooltipServer', { message: scannerStatusLabel(runtimeStatus.scanner), server: runtimeStatus.scanner.server }) : t('securityView.runtimeTools.scannerTooltip', { message: scannerStatusLabel(runtimeStatus.scanner) })" />
              <AppStatusIndicator
                :tone="runtimeToolTone(runtimeStatus.signature.status)"
                :label="t('securityView.runtimeTools.cosign')"
                size="xs"
                v-tooltip.top="t('securityView.runtimeTools.cosignTooltip', { message: signatureStatusLabel(runtimeStatus.signature) })" />
              <AppStatusIndicator
                :tone="runtimeStatus.sbom.enabled ? 'info' : 'neutral'"
                :label="t('securityView.runtimeTools.sbom')"
                size="xs"
                v-tooltip.top="runtimeStatus.sbom.enabled ? t('securityView.runtimeTools.sbomEnabled', { formats: runtimeStatus.sbom.formats.join(', ') }) : t('securityView.runtimeTools.sbomDisabled')" />
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
            <AppButton v-else size="md" variant="muted" weight="semibold" class="flex items-center justify-center gap-1.5 h-8"
                    :class="[
                      scanning || runtimeLoading || !scannerReady
                        ? 'cursor-not-allowed'
                        : '',
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
                 storage-key="security"
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
                  v-tooltip.top="row.delta.fixed === 1 ? t('securityView.deltaTooltips.fixedSingle', { count: row.delta.fixed }) : t('securityView.deltaTooltips.fixedMultiple', { count: row.delta.fixed })">
              <AppIcon name="trending-down" :size="9" class="mr-0.5" />{{ t('securityView.delta.fixed', { count: row.delta.fixed }) }}
            </AppBadge>
            <AppBadge v-else-if="row.delta && row.delta.new > 0 && row.delta.fixed === 0"
                  tone="warning" size="xs" class="px-1.5 py-0 shrink-0"
                  v-tooltip.top="row.delta.new === 1 ? t('securityView.deltaTooltips.newSingle', { count: row.delta.new }) : t('securityView.deltaTooltips.newMultiple', { count: row.delta.new })">
              <AppIcon name="trending-up" :size="9" class="mr-0.5" />{{ t('securityView.delta.new', { count: row.delta.new }) }}
            </AppBadge>
            <AppBadge v-else-if="row.delta && (row.delta.fixed > 0 || row.delta.new > 0)"
                  tone="caution" size="xs" class="px-1.5 py-0 shrink-0"
                  v-tooltip.top="t('securityView.deltaTooltips.both', { fixed: row.delta.fixed, new: row.delta.new })">
              {{ t('securityView.delta.both', { fixed: row.delta.fixed, new: row.delta.new }) }}
            </AppBadge>
            <template v-if="row.hasUpdate">
              <AppButton
                size="xs"
                :variant="isSummaryUpdateBlocked(row) ? 'danger-subtle' : 'info-subtle'"
                weight="semibold"
                class="inline-flex items-center gap-1 shrink-0 uppercase tracking-wide"
                :class="isSummaryUpdateBlocked(row) ? 'opacity-60 cursor-not-allowed' : ''"
                data-test="security-update-btn"
                :disabled="isSummaryUpdateBlocked(row)"
                v-tooltip.top="getSummaryUpdateTooltip(row)"
                @click.stop="openUpdateAction(row)">
                <AppIcon :name="isSummaryUpdateBlocked(row) ? 'lock' : 'cloud-download'" :size="9" />
                {{ t('securityView.update') }}
              </AppButton>
              <AppButton
                size="xs"
                variant="text-secondary"
                weight="medium"
                class="inline-flex items-center gap-1 shrink-0"
                data-test="security-containers-link"
                v-tooltip.top="t('securityView.viewInContainers')"
                @click.stop="navigateToContainerUpdate(row)">
                {{ t('securityView.viewInContainers') }}
              </AppButton>
            </template>
            <ReleaseNotesLink
              v-if="row.releaseNotes || row.currentReleaseNotes || row.releaseLink"
              :release-notes="row.releaseNotes"
              :current-release-notes="row.currentReleaseNotes"
              :release-link="row.releaseLink"
              icon-only
              icon-size="toolbar"
              data-test="security-release-notes" />
            <ProjectLink
              v-if="row.sourceRepo"
              :source-repo="row.sourceRepo"
              icon-only
              icon-size="toolbar"
              data-test="security-project-link" />
          </div>
        </template>
        <template #cell-critical="{ row }">
          <AppStatusIndicator v-if="row.critical > 0" marker="none" tone="danger" size="sm" :label="row.critical" />
          <span v-else class="text-2xs dd-text-muted">&mdash;</span>
        </template>
        <template #cell-high="{ row }">
          <AppStatusIndicator v-if="row.high > 0" marker="none" tone="warning" size="sm" :label="row.high" />
          <span v-else class="text-2xs dd-text-muted">&mdash;</span>
        </template>
        <template #cell-medium="{ row }">
          <AppStatusIndicator v-if="row.medium > 0" marker="none" tone="caution" size="sm" :label="row.medium" />
          <span v-else class="text-2xs dd-text-muted">&mdash;</span>
        </template>
        <template #cell-low="{ row }">
          <AppStatusIndicator v-if="row.low > 0" marker="none" tone="info" size="sm" :label="row.low" />
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
            :scanner-message="runtimeStatus ? scannerStatusLabel(runtimeStatus.scanner) : undefined"
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
              {{ t('securityView.delta.fixed', { count: summary.delta.fixed }) }}
            </AppBadge>
            <AppBadge v-if="summary.delta.new > 0" tone="warning" size="xs" class="px-1.5 py-0">
              {{ t('securityView.delta.new', { count: summary.delta.new }) }}
            </AppBadge>
            <span class="text-3xs dd-text-muted ml-auto">{{ t('securityView.card.vsUpdate') }}</span>
          </div>
          <div class="px-4 py-2.5 flex items-center justify-between gap-2 mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <span v-if="summary.fixable > 0" class="text-2xs-plus font-medium flex items-center gap-1"
                  :style="{ color: fixableColor(summary.fixable, summary.total) }">
              <AppIcon name="check" :size="11" />
              {{ fixablePercent(summary.fixable, summary.total) }}% {{ t('securityView.card.fixable') }}
            </span>
            <span v-else class="text-2xs-plus dd-text-muted">{{ t('securityView.card.noFixesAvailable') }}</span>
            <div class="flex items-center gap-2 flex-wrap">
              <template v-if="summary.hasUpdate">
                <AppButton
                  size="xs"
                  :variant="isSummaryUpdateBlocked(summary) ? 'danger-subtle' : 'info-subtle'"
                  weight="semibold"
                  class="inline-flex items-center gap-1 uppercase tracking-wide"
                  :class="isSummaryUpdateBlocked(summary) ? 'opacity-60 cursor-not-allowed' : ''"
                  data-test="security-update-btn"
                  :disabled="isSummaryUpdateBlocked(summary)"
                  @click.stop="openUpdateAction(summary)">
                  <AppIcon :name="isSummaryUpdateBlocked(summary) ? 'lock' : 'cloud-download'" :size="9" />
                  {{ t('securityView.update') }}
                </AppButton>
                <AppButton
                  size="xs"
                  variant="text-secondary"
                  weight="medium"
                  class="inline-flex items-center gap-1"
                  data-test="security-containers-link"
                  @click.stop="navigateToContainerUpdate(summary)">
                  {{ t('securityView.viewInContainers') }}
                </AppButton>
              </template>
              <span v-else class="text-2xs dd-text-muted">{{ summary.total }} {{ t('securityView.card.total') }}</span>
              <ReleaseNotesLink
                v-if="summary.releaseNotes || summary.currentReleaseNotes || summary.releaseLink"
                :release-notes="summary.releaseNotes"
                :current-release-notes="summary.currentReleaseNotes"
                :release-link="summary.releaseLink"
                data-test="security-release-notes" />
              <ProjectLink
                v-if="summary.sourceRepo"
                :source-repo="summary.sourceRepo"
                data-test="security-project-link" />
            </div>
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
              {{ t('securityView.delta.fixed', { count: summary.delta.fixed }) }}
            </AppBadge>
            <AppBadge v-else-if="summary.delta && summary.delta.new > 0"
                  tone="warning" size="xs" class="px-1.5 py-0">
              {{ t('securityView.delta.new', { count: summary.delta.new }) }}
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

    <template #panel>
      <SecurityDetailPanel
        v-model:selected-sbom-format="selectedSbomFormat"
        v-model:selected-vuln-export-format="selectedVulnExportFormat"
        v-model:show-sbom-document="showSbomDocument"
        :open="detailOpen"
        :is-mobile="isMobile"
        :selected-image="selectedImage"
        :selected-image-update-blocked="isSummaryUpdateBlocked(selectedImage)"
        :selected-image-vulns="selectedImageVulns"
        :selected-image-vulns-with-safe-url="selectedImageVulnsWithSafeUrl"
        :sbom-state="sbomState"
        @download-detail-sbom="downloadDetailSbom"
        @download-vuln-report="downloadVulnReport"
        @load-detail-sbom="loadDetailSbom"
        @navigate-to-container-update="selectedImage && navigateToContainerUpdate(selectedImage)"
        @open-update="selectedImage && openUpdateAction(selectedImage)"
        @update:open="handleDetailOpenChange" />
    </template>
  </DataViewLayout>

  <ContainerUpdateDialog
    v-model:containerId="updateDialogContainerId"
    :container-name="updateDialogContainerName"
    :current-tag="updateDialogCurrentTag"
    :new-tag="updateDialogNewTag"
    :update-kind="updateDialogUpdateKind"
    :update-eligibility="updateDialogUpdateEligibility" />

  <SecurityContainerChooser
    v-if="chooserSummary"
    :choices="chooserChoices"
    @close="closeChooser"
    @open-choice="openUpdateFromChooser"
    @view-all="viewAllChooserContainers" />
</template>
