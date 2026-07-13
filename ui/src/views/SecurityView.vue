<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppBadge from '../components/AppBadge.vue';
import AppIconButton from '../components/AppIconButton.vue';
import AppStatusIndicator from '../components/AppStatusIndicator.vue';
import ContainerLinkActions from '../components/containers/ContainerLinkActions.vue';
import ContainerUpdateDialog from '../components/containers/ContainerUpdateDialog.vue';
import DataSortControl from '../components/DataSortControl.vue';
import DataTableColumnPicker from '../components/DataTableColumnPicker.vue';
import ScanProgressBanner from '../components/ScanProgressBanner.vue';
import SecurityEmptyState from '../components/SecurityEmptyState.vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { useSbomDetail } from '../composables/useSbomDetail';
import { useScanProgress } from '../composables/useScanProgress';
import { useVulnerabilities, type ImageSummary } from '../composables/useVulnerabilities';
import { useUpdateMode } from '../composables/useUpdateMode';
import { type PickerColumn, useViewColumnVisibility } from '../composables/useViewColumnVisibility';
import { preferences } from '../preferences/store';
import { usePreference } from '../preferences/usePreference';
import { useViewMode } from '../preferences/useViewMode';
import { getAllContainers } from '../services/container';
import { getSecurityRuntime, manageSecurityAsset } from '../services/server';
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
  severityLabel,
  toSafeExternalUrl,
} from './security/securityViewUtils';

const { t } = useI18n();
function localizedSeverity(sev: string): string {
  return severityLabel(sev, t);
}
const router = useRouter();
const { updateMode } = useUpdateMode();
const managedUpdatesAllowed = computed(() => updateMode.value !== 'notify');

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
  return scanner.message;
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

function severityBadgeLabel(severity: string): string {
  if (severity === 'CRITICAL') return t('securityView.badge.critical');
  if (severity === 'HIGH') return t('securityView.badge.high');
  if (severity === 'MEDIUM') return t('securityView.badge.medium');
  return t('securityView.badge.low');
}

function sourceRepoHost(sourceRepo?: string): string | undefined {
  return sourceRepo?.split('/')[0];
}

async function fetchContainers() {
  try {
    const apiContainers = await getAllContainers();
    containers.value = mapApiContainers(apiContainers, t);
  } catch {
    containers.value = [];
  }
}

const runtimeLoading = ref(true);
const runtimeError = ref<string | null>(null);
const runtimeStatus = ref<SecurityRuntimeStatus | null>(null);
const assetOperation = ref<string | null>(null);

async function runAssetOperation(provider: 'trivy' | 'grype' | 'syft', operation: 'pull' | 'warm') {
  assetOperation.value = `${provider}:${operation}`;
  runtimeError.value = null;
  try {
    await manageSecurityAsset(provider, operation);
    await fetchSecurityRuntimeStatus();
  } catch (caught: unknown) {
    runtimeError.value = errorMessage(caught, t('securityView.runtimeTools.assetOperationFailed'));
  } finally {
    assetOperation.value = null;
  }
}

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
// Set by DataTable's measured-width reflow (< 640px): hides the table/cards toggle when the
// width has already forced cards, so the switcher isn't a dead control at that size.
const cardReflowForced = ref(false);
const inCardMode = computed(() => cardReflowForced.value || securityViewMode.value === 'cards');

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
  if (!managedUpdatesAllowed.value) {
    return;
  }
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
  if (!managedUpdatesAllowed.value || choice.blocked) {
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

const tableColumns = computed(() => [
  {
    key: 'image',
    label: t('securityView.columns.image'),
    align: 'text-left',
    size: 360,
    minSize: 240,
    maxSize: 760,
    flex: 1,
    required: true,
  },
  {
    key: 'critical',
    label: t('securityView.columns.critical'),
    sortable: true,
    size: 96,
    minSize: 84,
    maxSize: 120,
    cardPriority: 5,
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
]);

// Card-mode sort options, hoisted into the filter bar (table mode sorts via headers).
const sortableColumns = computed(() =>
  tableColumns.value
    .filter((column) => column.sortable && !column.icon)
    .map((column) => ({ key: column.key, label: column.label })),
);

const pickerColumns = computed<PickerColumn[]>(() =>
  tableColumns.value.map((column) => ({
    key: column.key,
    label: column.label,
    required: 'required' in column ? column.required : undefined,
  })),
);

const {
  hiddenColumnKeys: pickerHiddenColumnKeys,
  toggleColumn,
  resetColumns,
} = useViewColumnVisibility('security', pickerColumns);

/**
 * Compact mode (< 1024px) used to swap `tableColumns` down to just [image, total]. Now
 * `tableColumns` always returns the full 7-column set (so card mode can surface the
 * `critical` cardPriority annotation on mobile), and the severity breakdown columns are
 * force-hidden here instead — the union of the picker's hidden set with the compact-only
 * forced-hidden set. The picker itself is hidden in compact mode (see template) so a user
 * can never toggle back on a column this override is about to re-hide anyway.
 */
const COMPACT_FORCED_HIDDEN_COLUMN_KEYS = ['critical', 'high', 'medium', 'low', 'fixable'];

const hiddenColumnKeys = computed(() =>
  isCompact.value
    ? [...new Set([...pickerHiddenColumnKeys.value, ...COMPACT_FORCED_HIDDEN_COLUMN_KEYS])]
    : pickerHiddenColumnKeys.value,
);

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
        :count-label="displayCountLabel"
        :hide-view-toggle="cardReflowForced">
        <template v-if="inCardMode && sortableColumns.length > 0" #sort>
          <DataSortControl
            :columns="sortableColumns"
            :sort-key="securitySortField"
            :sort-asc="securitySortAsc"
            @update:sort-key="securitySortField = $event"
            @update:sort-asc="securitySortAsc = $event" />
        </template>
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
        <template #extra-buttons>
          <DataTableColumnPicker
            v-if="!isCompact"
            :columns="pickerColumns"
            :hidden-keys="pickerHiddenColumnKeys"
            @toggle="toggleColumn"
            @reset="resetColumns" />
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
              <template v-if="runtimeStatus.backend !== 'command'">
                <AppIconButton
                  v-for="asset in runtimeStatus.assets"
                  :key="`compact-asset-${asset.provider}`"
                  :icon="asset.state === 'ready' ? 'restart' : 'cloud-download'"
                  size="sm"
                  variant="muted"
                  class="shrink-0"
                  :tooltip="t(asset.state === 'ready' ? 'securityView.runtimeTools.warmAsset' : 'securityView.runtimeTools.pullAsset', { provider: asset.provider })"
                  :aria-label="t(asset.state === 'ready' ? 'securityView.runtimeTools.warmAsset' : 'securityView.runtimeTools.pullAsset', { provider: asset.provider })"
                  :loading="assetOperation === `${asset.provider}:${asset.state === 'ready' ? 'warm' : 'pull'}`"
                  :disabled="assetOperation !== null"
                  @click="runAssetOperation(asset.provider, asset.state === 'ready' ? 'warm' : 'pull')" />
              </template>
            </div>
            <template v-else>
              <AppStatusIndicator
                :tone="runtimeToolTone(runtimeStatus.scanner.status)"
                :label="runtimeStatus.scanner.scanner || t('securityView.runtimeTools.scanner')"
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
              <template v-if="runtimeStatus.backend !== 'command'">
                <AppStatusIndicator
                  v-for="provider in runtimeStatus.providers"
                  :key="provider.provider"
                  :tone="runtimeToolTone(provider.status)"
                  :label="provider.provider"
                  size="xs"
                  v-tooltip.top="provider.message" />
                <AppButton
                  v-for="asset in runtimeStatus.assets"
                  :key="`asset-${asset.provider}`"
                  size="md"
                  variant="muted"
                  class="min-h-11"
                  :loading="assetOperation === `${asset.provider}:${asset.state === 'ready' ? 'warm' : 'pull'}`"
                  :disabled="assetOperation !== null"
                  @click="runAssetOperation(asset.provider, asset.state === 'ready' ? 'warm' : 'pull')">
                  {{ t(asset.state === 'ready' ? 'securityView.runtimeTools.warmAsset' : 'securityView.runtimeTools.pullAsset', { provider: asset.provider }) }}
                </AppButton>
              </template>
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
      <DataTable v-if="!loading"
                 :columns="tableColumns"
                 storage-key="security"
                 :rows="filteredSummaries"
                 row-key="image"
                 :hidden-column-keys="hiddenColumnKeys"
                 :selected-key="selectedImage?.image"
                 :prefer-cards="securityViewMode === 'cards'"
                 :hoist-card-sort="inCardMode"
                 v-model:sort-key="securitySortField"
                 v-model:sort-asc="securitySortAsc"
                 @update:card-reflow-forced="cardReflowForced = $event"
                 @row-click="openDetail($event)">
        <template #cell-image="{ row }">
          <div class="flex flex-wrap items-center gap-2 min-w-0">
            <AppIcon :name="severityIcon(highestSeverity(row))" :size="13" class="shrink-0 md:!hidden"
                     :style="{ color: severityColor(highestSeverity(row)).text }"
                     v-tooltip.top="localizedSeverity(highestSeverity(row))" />
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
            <div v-if="row.hasUpdate" class="flex items-center gap-1.5 shrink-0">
              <AppButton
                v-if="managedUpdatesAllowed"
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
            </div>
            <div
              v-if="row.releaseNotes || row.currentReleaseNotes || row.releaseLink || row.sourceRepo || row.registry || row.registryName || row.registryUrl"
              class="basis-full flex justify-end shrink-0"
              data-test="security-resource-actions">
              <ContainerLinkActions
                :source-repo="row.sourceRepo"
                :release-notes="row.releaseNotes"
                :current-release-notes="row.currentReleaseNotes"
                :release-link="row.releaseLink"
                :container-id="row.containerId"
                :from-tag="row.fromTag"
                :to-tag="row.toTag"
                :registry="row.registry"
                :registry-name="row.registryName"
                :registry-url="row.registryUrl"
                icon-size="sm" />
            </div>
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
        <template #card="{ row }">
          <div class="relative flex flex-col flex-1">
            <!-- Header: image name + source host subtitle, severity badge top-right -->
            <div class="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="text-sm-plus font-semibold truncate dd-text">{{ row.image }}</div>
                <div v-if="sourceRepoHost(row.sourceRepo)" class="text-2xs-plus truncate mt-0.5 dd-text-muted">
                  {{ sourceRepoHost(row.sourceRepo) }}
                </div>
              </div>
              <AppBadge v-if="row.total > 0" :tone="severityTone(highestSeverity(row))" size="xs" class="shrink-0">
                {{ severityBadgeLabel(highestSeverity(row)) }}
              </AppBadge>
              <AppBadge v-else tone="success" size="xs" class="shrink-0">
                {{ t('securityView.badge.clean') }}
              </AppBadge>
            </div>

            <!-- Body: per-severity chips + total + fixable percent, delta badges -->
            <div class="px-4 py-3">
              <div class="flex items-center gap-2 flex-wrap min-w-0">
                <AppBadge v-if="row.critical > 0" tone="danger" size="xs">
                  {{ row.critical }} {{ t('securityView.badge.critical') }}
                </AppBadge>
                <AppBadge v-if="row.high > 0" tone="warning" size="xs">
                  {{ row.high }} {{ t('securityView.badge.high') }}
                </AppBadge>
                <AppBadge v-if="row.medium > 0" tone="caution" size="xs">
                  {{ row.medium }} {{ t('securityView.badge.medium') }}
                </AppBadge>
                <AppBadge v-if="row.low > 0" tone="info" size="xs">
                  {{ row.low }} {{ t('securityView.badge.low') }}
                </AppBadge>
                <span class="text-2xs dd-text-muted ml-auto shrink-0">{{ row.total }} {{ t('securityView.card.total') }}</span>
                <span v-if="row.fixable > 0" class="text-2xs font-medium shrink-0"
                      :style="{ color: fixableColor(row.fixable, row.total) }">
                  {{ fixablePercent(row.fixable, row.total) }}%
                </span>
                <span v-else class="text-2xs dd-text-muted shrink-0">0%</span>
              </div>
              <div v-if="row.delta && (row.delta.fixed > 0 || row.delta.new > 0)" class="flex items-center gap-2 flex-wrap mt-2">
                <AppBadge v-if="row.delta.fixed > 0 && row.delta.new === 0"
                      tone="success" size="xs" class="px-1.5 py-0 shrink-0"
                      v-tooltip.top="row.delta.fixed === 1 ? t('securityView.deltaTooltips.fixedSingle', { count: row.delta.fixed }) : t('securityView.deltaTooltips.fixedMultiple', { count: row.delta.fixed })">
                  <AppIcon name="trending-down" :size="9" class="mr-0.5" />{{ t('securityView.delta.fixed', { count: row.delta.fixed }) }}
                </AppBadge>
                <AppBadge v-else-if="row.delta.new > 0 && row.delta.fixed === 0"
                      tone="warning" size="xs" class="px-1.5 py-0 shrink-0"
                      v-tooltip.top="row.delta.new === 1 ? t('securityView.deltaTooltips.newSingle', { count: row.delta.new }) : t('securityView.deltaTooltips.newMultiple', { count: row.delta.new })">
                  <AppIcon name="trending-up" :size="9" class="mr-0.5" />{{ t('securityView.delta.new', { count: row.delta.new }) }}
                </AppBadge>
                <AppBadge v-else
                      tone="caution" size="xs" class="px-1.5 py-0 shrink-0"
                      v-tooltip.top="t('securityView.deltaTooltips.both', { fixed: row.delta.fixed, new: row.delta.new })">
                  {{ t('securityView.delta.both', { fixed: row.delta.fixed, new: row.delta.new }) }}
                </AppBadge>
              </div>
            </div>

            <div
              v-if="row.releaseNotes || row.currentReleaseNotes || row.releaseLink || row.sourceRepo || row.registry || row.registryName || row.registryUrl"
              class="px-4 pt-2.5 flex flex-wrap w-full justify-end mt-auto"
              :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
              <div class="shrink-0" data-test="security-card-resource-actions">
                <ContainerLinkActions
                  :source-repo="row.sourceRepo"
                  :release-notes="row.releaseNotes"
                  :current-release-notes="row.currentReleaseNotes"
                  :release-link="row.releaseLink"
                  :container-id="row.containerId"
                  :from-tag="row.fromTag"
                  :to-tag="row.toTag"
                  :registry="row.registry"
                  :registry-name="row.registryName"
                  :registry-url="row.registryUrl"
                  icon-size="sm" />
              </div>
            </div>

            <!-- Footer: fixable state + lifecycle actions (resources use their own row above). -->
            <div class="px-4 py-2.5 flex items-center justify-between"
                 :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
              <span v-if="row.fixable > 0" class="text-2xs-plus font-semibold"
                    :style="{ color: fixableColor(row.fixable, row.total) }">
                {{ fixablePercent(row.fixable, row.total) }}% {{ t('securityView.columns.fixable') }}
              </span>
              <span v-else class="text-2xs-plus font-medium dd-text-muted">{{ t('securityView.columns.fixable') }}</span>
              <div class="flex flex-wrap items-center justify-end gap-2 shrink-0">
                <div v-if="row.hasUpdate" class="flex items-center gap-1.5 shrink-0">
                  <AppButton
                    v-if="managedUpdatesAllowed"
                    size="xs"
                    :variant="isSummaryUpdateBlocked(row) ? 'danger-subtle' : 'info-subtle'"
                    weight="semibold"
                    class="inline-flex items-center gap-1 shrink-0 uppercase tracking-wide"
                    :class="isSummaryUpdateBlocked(row) ? 'opacity-60 cursor-not-allowed' : ''"
                    data-test="security-card-update-btn"
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
                    data-test="security-card-containers-link"
                    v-tooltip.top="t('securityView.viewInContainers')"
                    @click.stop="navigateToContainerUpdate(row)">
                    {{ t('securityView.viewInContainers') }}
                  </AppButton>
                </div>
              </div>
            </div>
          </div>
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

    <template #panel>
      <SecurityDetailPanel
        v-model:selected-sbom-format="selectedSbomFormat"
        v-model:selected-vuln-export-format="selectedVulnExportFormat"
        v-model:show-sbom-document="showSbomDocument"
        :open="detailOpen"
        :is-mobile="isMobile"
        :selected-image="selectedImage"
        :selected-image-update-blocked="isSummaryUpdateBlocked(selectedImage)"
        :updates-allowed="managedUpdatesAllowed"
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
