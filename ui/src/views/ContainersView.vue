<script setup lang="ts">
import { useConfirmDialog } from '../composables/useConfirmDialog';
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import ContainerFullPageDetail from '../components/containers/ContainerFullPageDetail.vue';
import ContainersListContent from '../components/containers/ContainersListContent.vue';
import ContainerSideDetail from '../components/containers/ContainerSideDetail.vue';
import { containersViewTemplateContextKey } from '../components/containers/containersViewTemplateContext';
import { useBreakpoints } from '../composables/useBreakpoints';
import {
  LOG_AUTO_FETCH_INTERVALS,
  useAutoFetchLogs,
  useLogViewport,
} from '../composables/useLogViewerBehavior';
import { useColumnVisibility } from '../composables/useColumnVisibility';
import { useContainerFilters } from '../composables/useContainerFilters';
import { useDetailPanel } from '../composables/useDetailPanel';
import { useSorting } from '../composables/useSorting';
import {
  deleteContainer as apiDeleteContainer,
  getContainerLogs as fetchContainerLogs,
  getContainerUpdateOperations as fetchContainerUpdateOperations,
  getContainerSbom as fetchContainerSbom,
  getContainerVulnerabilities as fetchContainerVulnerabilities,
  getAllContainers,
  getContainerGroups,
  getContainerTriggers,
  refreshAllContainers,
  scanContainer as apiScanContainer,
  runTrigger as runContainerTrigger,
  updateContainerPolicy,
} from '../services/container';
import type { ContainerGroup } from '../services/container';
import {
  startContainer as apiStartContainer,
  restartContainer as apiRestartContainer,
  stopContainer as apiStopContainer,
  updateContainer as apiUpdateContainer,
} from '../services/container-actions';
import { getBackups, rollback } from '../services/backup';
import { previewContainer } from '../services/preview';
import type { Container } from '../types/container';
import { mapApiContainers } from '../utils/container-mapper';
import {
  parseServer,
  registryColorBg,
  registryColorText,
  registryLabel,
  serverBadgeColor,
  updateKindColor,
} from '../utils/display';
import { errorMessage } from '../utils/error';
import type { ApiSbomDocument, ApiVulnerability, ApiContainerTrigger } from '../types/api';

const confirm = useConfirmDialog();

// Loading and error state
const loading = ref(true);
const error = ref<string | null>(null);

// Container data (reactive ref, fetched from API)
const containers = ref<Container[]>([]);

// Map from container name -> API id (needed to call actions/logs by id)
const containerIdMap = ref<Record<string, string>>({});
const containerMetaMap = ref<Record<string, unknown>>({});

// Fetch containers from API
async function loadContainers() {
  try {
    const apiContainers = await getAllContainers();
    containers.value = mapApiContainers(apiContainers);
    // Build id lookup map
    const idMap: Record<string, string> = {};
    const metaMap: Record<string, unknown> = {};
    for (const ac of apiContainers) {
      const uiName = ac.displayName || ac.name;
      idMap[uiName] = ac.id;
      metaMap[uiName] = ac;
    }
    containerIdMap.value = idMap;
    containerMetaMap.value = metaMap;
    if (groupByStack.value) {
      await loadGroups();
    }
  } catch (e: unknown) {
    error.value = errorMessage(e, 'Failed to load containers');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadContainers();
});

const rechecking = ref(false);

async function recheckAll() {
  rechecking.value = true;
  try {
    await refreshAllContainers();
    await new Promise((r) => setTimeout(r, 2000));
    await loadContainers();
  } finally {
    rechecking.value = false;
  }
}

// Container logs (fetched async, cached per container)
const containerLogsCache = ref<Record<string, string[]>>({});
const containerLogsLoading = ref<Record<string, boolean>>({});

async function loadContainerLogs(containerName: string, force = false) {
  const containerId = containerIdMap.value[containerName];
  if (!containerId) return;
  if (!force && containerLogsCache.value[containerName]) return;
  containerLogsLoading.value[containerName] = true;
  try {
    const result = await fetchContainerLogs(containerId, 100);
    const logs = result?.logs ?? '';
    containerLogsCache.value[containerName] = logs
      ? logs.split('\n').filter((l: string) => l.length > 0)
      : ['No logs available for this container'];
  } catch {
    containerLogsCache.value[containerName] = ['Failed to load container logs'];
  } finally {
    containerLogsLoading.value[containerName] = false;
  }
}

function getContainerLogs(containerName: string): string[] {
  if (!containerLogsCache.value[containerName]) {
    loadContainerLogs(containerName);
    return ['Loading logs...'];
  }
  return containerLogsCache.value[containerName];
}

// Container log viewer behavior
const {
  logContainer: containerLogRef,
  scrollBlocked: containerScrollBlocked,
  scrollToBottom: containerScrollToBottom,
  handleLogScroll: containerHandleLogScroll,
  resumeAutoScroll: containerResumeAutoScroll,
} = useLogViewport();

async function refreshCurrentContainerLogs() {
  if (selectedContainer.value) {
    await loadContainerLogs(selectedContainer.value.name, true);
  }
}

const { autoFetchInterval: containerAutoFetchInterval } = useAutoFetchLogs({
  fetchFn: refreshCurrentContainerLogs,
  scrollToBottom: containerScrollToBottom,
  scrollBlocked: containerScrollBlocked,
});

// Breakpoints
const { isMobile, windowNarrow } = useBreakpoints();

// Detail panel (declared early so isCompact can react to panel state)
const {
  selectedContainer,
  detailPanelOpen,
  activeDetailTab,
  panelSize,
  containerFullPage,
  panelFlex,
  detailTabs,
  selectContainer,
  openFullPage,
  closeFullPage,
  closePanel,
} = useDetailPanel();

const isCompact = computed(() => windowNarrow.value || detailPanelOpen.value);

// Reset auto-fetch when switching containers or tabs
watch([() => selectedContainer.value, () => activeDetailTab.value], () => {
  containerAutoFetchInterval.value = 0;
});

function syncSelectedContainerReference() {
  if (!selectedContainer.value) {
    return;
  }
  const refreshed = containers.value.find(
    (container) => container.name === selectedContainer.value?.name,
  );
  if (refreshed) {
    selectedContainer.value = refreshed;
    return;
  }
  closePanel();
}

watch(
  () => containers.value,
  () => {
    syncSelectedContainerReference();
  },
);

const selectedContainerId = computed(() =>
  selectedContainer.value ? containerIdMap.value[selectedContainer.value.name] : undefined,
);
const selectedContainerMeta = computed(() =>
  selectedContainer.value ? containerMetaMap.value[selectedContainer.value.name] : undefined,
);
type RuntimeOrigin = 'explicit' | 'inherited' | 'unknown';

function normalizeRuntimeOrigin(originValue: unknown): RuntimeOrigin {
  const normalizedOrigin = typeof originValue === 'string' ? originValue.trim().toLowerCase() : '';
  if (normalizedOrigin === 'explicit' || normalizedOrigin === 'inherited') {
    return normalizedOrigin;
  }
  return 'unknown';
}

function getRuntimeOriginValue(labels: unknown, ddKey: string, wudKey: string): RuntimeOrigin {
  if (!labels || typeof labels !== 'object') {
    return 'unknown';
  }
  const labelRecord = labels as Record<string, unknown>;
  const ddValue = labelRecord[ddKey];
  if (ddValue !== undefined) {
    return normalizeRuntimeOrigin(ddValue);
  }
  return normalizeRuntimeOrigin(labelRecord[wudKey]);
}

function getPreferredLabelString(
  labels: unknown,
  ddKey: string,
  wudKey: string,
): string | undefined {
  if (!labels || typeof labels !== 'object') {
    return undefined;
  }
  const labelRecord = labels as Record<string, unknown>;
  const ddValue = labelRecord[ddKey];
  if (ddValue !== undefined && ddValue !== null) {
    const value = `${ddValue}`.trim();
    if (value.length > 0) {
      return value;
    }
  }
  const wudValue = labelRecord[wudKey];
  if (wudValue !== undefined && wudValue !== null) {
    const value = `${wudValue}`.trim();
    if (value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function parseBooleanLabelValue(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return undefined;
}

const selectedRuntimeOrigins = computed(() => ({
  entrypoint: getRuntimeOriginValue(
    selectedContainerMeta.value?.labels,
    'dd.runtime.entrypoint.origin',
    'wud.runtime.entrypoint.origin',
  ),
  cmd: getRuntimeOriginValue(
    selectedContainerMeta.value?.labels,
    'dd.runtime.cmd.origin',
    'wud.runtime.cmd.origin',
  ),
}));

const selectedLifecycleHooks = computed(() => {
  const labels = selectedContainerMeta.value?.labels;
  const preUpdate = getPreferredLabelString(labels, 'dd.hook.pre', 'wud.hook.pre');
  const postUpdate = getPreferredLabelString(labels, 'dd.hook.post', 'wud.hook.post');
  const timeoutRaw = getPreferredLabelString(labels, 'dd.hook.timeout', 'wud.hook.timeout');
  const timeoutParsed = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : Number.NaN;
  const preAbortRaw = getPreferredLabelString(labels, 'dd.hook.pre.abort', 'wud.hook.pre.abort');
  const preAbort = parseBooleanLabelValue(preAbortRaw);

  return {
    preUpdate,
    postUpdate,
    timeoutLabel:
      Number.isFinite(timeoutParsed) && timeoutParsed > 0
        ? `${timeoutParsed}ms`
        : '60000ms (default)',
    preAbortBehavior:
      preAbort === undefined
        ? undefined
        : preAbort
          ? 'Abort update on pre-hook failure'
          : 'Continue update on pre-hook failure',
  };
});

const lifecycleHookTemplateVariables = [
  { name: 'DD_CONTAINER_NAME', description: 'Container name' },
  { name: 'DD_CONTAINER_ID', description: 'Container ID' },
  { name: 'DD_IMAGE_NAME', description: 'Image name (without registry)' },
  { name: 'DD_IMAGE_TAG', description: 'Current image tag' },
  { name: 'DD_UPDATE_KIND', description: 'Update type (tag or digest)' },
  { name: 'DD_UPDATE_FROM', description: 'Current tag or digest' },
  { name: 'DD_UPDATE_TO', description: 'New tag or digest' },
];

const selectedAutoRollbackConfig = computed(() => {
  const labels = selectedContainerMeta.value?.labels;
  const enabledRaw = getPreferredLabelString(labels, 'dd.rollback.auto', 'wud.rollback.auto');
  const enabled = parseBooleanLabelValue(enabledRaw);
  const windowRaw = getPreferredLabelString(labels, 'dd.rollback.window', 'wud.rollback.window');
  const intervalRaw = getPreferredLabelString(
    labels,
    'dd.rollback.interval',
    'wud.rollback.interval',
  );

  const windowParsed = windowRaw ? Number.parseInt(windowRaw, 10) : Number.NaN;
  const intervalParsed = intervalRaw ? Number.parseInt(intervalRaw, 10) : Number.NaN;
  const windowMs = Number.isFinite(windowParsed) && windowParsed > 0 ? windowParsed : 300000;
  const intervalMs = Number.isFinite(intervalParsed) && intervalParsed > 0 ? intervalParsed : 10000;

  return {
    enabledLabel:
      enabled === true ? 'Enabled' : enabled === false ? 'Disabled' : 'Disabled (default)',
    windowLabel: `${windowMs}ms`,
    intervalLabel: `${intervalMs}ms`,
  };
});

const selectedRuntimeDriftWarnings = computed<string[]>(() => {
  if (!selectedContainerMeta.value) {
    return [];
  }

  const missingOrigins: string[] = [];
  if (selectedRuntimeOrigins.value.entrypoint === 'unknown') {
    missingOrigins.push('Entrypoint');
  }
  if (selectedRuntimeOrigins.value.cmd === 'unknown') {
    missingOrigins.push('Cmd');
  }
  if (missingOrigins.length === 0) {
    return [];
  }

  return [
    `Runtime origin metadata is missing for ${missingOrigins.join(
      ' and ',
    )}. Updates will preserve current values to avoid dropping explicit overrides, which can cause runtime drift.`,
  ];
});

function runtimeOriginLabel(origin: RuntimeOrigin): string {
  if (origin === 'explicit') {
    return 'Explicit';
  }
  if (origin === 'inherited') {
    return 'Inherited';
  }
  return 'Unknown';
}

function runtimeOriginStyle(origin: RuntimeOrigin) {
  if (origin === 'explicit') {
    return { backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' };
  }
  if (origin === 'inherited') {
    return { backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' };
  }
  return { backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' };
}

const selectedImageMetadata = computed(() => {
  const image = selectedContainerMeta.value?.image;
  const digestValue = image?.digest?.value || image?.digest?.repo;
  return {
    architecture: typeof image?.architecture === 'string' ? image.architecture : undefined,
    os: typeof image?.os === 'string' ? image.os : undefined,
    digest: typeof digestValue === 'string' ? digestValue : undefined,
    created: typeof image?.created === 'string' ? image.created : undefined,
  };
});
const selectedUpdatePolicy = computed<Record<string, unknown>>(
  () => selectedContainerMeta.value?.updatePolicy || {},
);
const selectedSkipTags = computed<string[]>(() =>
  Array.isArray(selectedUpdatePolicy.value.skipTags) ? selectedUpdatePolicy.value.skipTags : [],
);
const selectedSkipDigests = computed<string[]>(() =>
  Array.isArray(selectedUpdatePolicy.value.skipDigests)
    ? selectedUpdatePolicy.value.skipDigests
    : [],
);
const selectedSnoozeUntil = computed<string | undefined>(
  () => selectedUpdatePolicy.value.snoozeUntil,
);
const snoozeDateInput = ref('');

const detailPreview = ref<Record<string, unknown> | null>(null);
const previewLoading = ref(false);
const previewError = ref<string | null>(null);

const detailTriggers = ref<Record<string, unknown>[]>([]);
const triggersLoading = ref(false);
const triggerRunInProgress = ref<string | null>(null);
const triggerMessage = ref<string | null>(null);
const triggerError = ref<string | null>(null);

const detailBackups = ref<Record<string, unknown>[]>([]);
const backupsLoading = ref(false);
const rollbackInProgress = ref<string | null>(null);
const rollbackMessage = ref<string | null>(null);
const rollbackError = ref<string | null>(null);
const detailUpdateOperations = ref<Record<string, unknown>[]>([]);
const updateOperationsLoading = ref(false);
const updateOperationsError = ref<string | null>(null);

const policyInProgress = ref<string | null>(null);
const policyMessage = ref<string | null>(null);
const policyError = ref<string | null>(null);

const selectedSbomFormat = ref<'spdx-json' | 'cyclonedx-json'>('spdx-json');
const detailVulnerabilityResult = ref<Record<string, unknown> | null>(null);
const detailVulnerabilityLoading = ref(false);
const detailVulnerabilityError = ref<string | null>(null);
const detailSbomResult = ref<Record<string, unknown> | null>(null);
const detailSbomLoading = ref(false);
const detailSbomError = ref<string | null>(null);

const vulnerabilitySummary = computed(() => {
  const summary = detailVulnerabilityResult.value?.summary;
  return {
    critical: summary?.critical ?? 0,
    high: summary?.high ?? 0,
    medium: summary?.medium ?? 0,
    low: summary?.low ?? 0,
    unknown: summary?.unknown ?? 0,
  };
});

const vulnerabilityTotal = computed(
  () =>
    vulnerabilitySummary.value.critical +
    vulnerabilitySummary.value.high +
    vulnerabilitySummary.value.medium +
    vulnerabilitySummary.value.low +
    vulnerabilitySummary.value.unknown,
);

const vulnerabilityPreview = computed(() => {
  const vulnerabilities = detailVulnerabilityResult.value?.vulnerabilities;
  if (!Array.isArray(vulnerabilities)) {
    return [];
  }
  return vulnerabilities.slice(0, 5);
});

const sbomDocument = computed(() => detailSbomResult.value?.document);
const sbomGeneratedAt = computed(() => detailSbomResult.value?.generatedAt);

function detectSbomComponentCount(document: ApiSbomDocument): number | undefined {
  if (Array.isArray(document?.packages)) {
    return document.packages.length;
  }
  if (Array.isArray(document?.components)) {
    return document.components.length;
  }
  return undefined;
}

const sbomComponentCount = computed(() => detectSbomComponentCount(sbomDocument.value));

function normalizeSeverity(value: unknown): string {
  if (typeof value !== 'string') {
    return 'UNKNOWN';
  }
  const normalized = value.toUpperCase();
  if (
    normalized === 'CRITICAL' ||
    normalized === 'HIGH' ||
    normalized === 'MEDIUM' ||
    normalized === 'LOW'
  ) {
    return normalized;
  }
  return 'UNKNOWN';
}

function severityStyle(severity: string) {
  if (severity === 'CRITICAL') {
    return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)' };
  }
  if (severity === 'HIGH') {
    return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)' };
  }
  if (severity === 'MEDIUM') {
    return { bg: 'var(--dd-caution-muted)', text: 'var(--dd-caution)' };
  }
  return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)' };
}

function getVulnerabilityPackage(vulnerability: ApiVulnerability): string {
  return vulnerability?.packageName || vulnerability?.package || 'unknown';
}

async function loadDetailVulnerabilities() {
  const containerId = selectedContainerId.value;
  if (!containerId) {
    detailVulnerabilityResult.value = null;
    detailVulnerabilityError.value = null;
    return;
  }
  detailVulnerabilityLoading.value = true;
  detailVulnerabilityError.value = null;
  try {
    detailVulnerabilityResult.value = await fetchContainerVulnerabilities(containerId);
  } catch (e: unknown) {
    detailVulnerabilityResult.value = null;
    detailVulnerabilityError.value = errorMessage(e, 'Failed to load vulnerabilities');
  } finally {
    detailVulnerabilityLoading.value = false;
  }
}

async function loadDetailSbom() {
  const containerId = selectedContainerId.value;
  if (!containerId) {
    detailSbomResult.value = null;
    detailSbomError.value = null;
    return;
  }
  detailSbomLoading.value = true;
  detailSbomError.value = null;
  try {
    detailSbomResult.value = await fetchContainerSbom(containerId, selectedSbomFormat.value);
  } catch (e: unknown) {
    detailSbomResult.value = null;
    detailSbomError.value = errorMessage(e, 'Failed to load SBOM');
  } finally {
    detailSbomLoading.value = false;
  }
}

async function loadDetailSecurityData() {
  await Promise.all([loadDetailVulnerabilities(), loadDetailSbom()]);
}

function formatTimestamp(timestamp: string | undefined): string {
  if (!timestamp) {
    return 'Unknown';
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }
  return parsed.toLocaleString();
}

function formatOperationValue(value: unknown): string {
  if (typeof value !== 'string') {
    return 'unknown';
  }
  return value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

function formatOperationPhase(phase: unknown): string {
  return formatOperationValue(phase);
}

function formatRollbackReason(reason: unknown): string {
  return formatOperationValue(reason);
}

function formatOperationStatus(status: unknown): string {
  return formatOperationValue(status);
}

function getOperationStatusStyle(status: unknown) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'succeeded') {
    return {
      backgroundColor: 'var(--dd-success-muted)',
      color: 'var(--dd-success)',
    };
  }
  if (normalized === 'rolled-back') {
    return {
      backgroundColor: 'var(--dd-warning-muted)',
      color: 'var(--dd-warning)',
    };
  }
  if (normalized === 'failed') {
    return {
      backgroundColor: 'var(--dd-danger-muted)',
      color: 'var(--dd-danger)',
    };
  }
  return {
    backgroundColor: 'var(--dd-info-muted)',
    color: 'var(--dd-info)',
  };
}

function toDateInputValue(timestamp: string | undefined): string {
  if (!timestamp) {
    return '';
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resetDetailMessages() {
  triggerMessage.value = null;
  triggerError.value = null;
  rollbackMessage.value = null;
  rollbackError.value = null;
  policyMessage.value = null;
  policyError.value = null;
  updateOperationsError.value = null;
}

function getTriggerKey(trigger: ApiContainerTrigger): string {
  if (trigger.id) {
    return trigger.id;
  }
  const prefix = trigger.agent ? `${trigger.agent}.` : '';
  return `${prefix}${trigger.type}.${trigger.name}`;
}

async function loadDetailTriggers() {
  const containerId = selectedContainerId.value;
  if (!containerId) {
    detailTriggers.value = [];
    return;
  }
  triggersLoading.value = true;
  triggerError.value = null;
  try {
    detailTriggers.value = await getContainerTriggers(containerId);
  } catch (e: unknown) {
    detailTriggers.value = [];
    triggerError.value = errorMessage(e, 'Failed to load associated triggers');
  } finally {
    triggersLoading.value = false;
  }
}

async function loadDetailBackups() {
  const containerId = selectedContainerId.value;
  if (!containerId) {
    detailBackups.value = [];
    return;
  }
  backupsLoading.value = true;
  rollbackError.value = null;
  try {
    detailBackups.value = await getBackups(containerId);
  } catch (e: unknown) {
    detailBackups.value = [];
    rollbackError.value = errorMessage(e, 'Failed to load backups');
  } finally {
    backupsLoading.value = false;
  }
}

async function loadDetailUpdateOperations() {
  const containerId = selectedContainerId.value;
  if (!containerId) {
    detailUpdateOperations.value = [];
    updateOperationsError.value = null;
    return;
  }

  updateOperationsLoading.value = true;
  updateOperationsError.value = null;
  try {
    detailUpdateOperations.value = await fetchContainerUpdateOperations(containerId);
  } catch (e: unknown) {
    detailUpdateOperations.value = [];
    updateOperationsError.value = errorMessage(e, 'Failed to load update operation history');
  } finally {
    updateOperationsLoading.value = false;
  }
}

async function refreshActionTabData() {
  await Promise.all([loadDetailTriggers(), loadDetailBackups(), loadDetailUpdateOperations()]);
}

async function runContainerPreview() {
  const containerId = selectedContainerId.value;
  if (!containerId || previewLoading.value) {
    return;
  }
  previewLoading.value = true;
  previewError.value = null;
  try {
    detailPreview.value = await previewContainer(containerId);
  } catch (e: unknown) {
    detailPreview.value = null;
    previewError.value = errorMessage(e, 'Failed to generate update preview');
  } finally {
    previewLoading.value = false;
  }
}

async function runAssociatedTrigger(trigger: ApiContainerTrigger) {
  const containerId = selectedContainerId.value;
  if (!containerId || triggerRunInProgress.value) {
    return;
  }
  const triggerKey = getTriggerKey(trigger);
  triggerRunInProgress.value = triggerKey;
  triggerMessage.value = null;
  triggerError.value = null;
  try {
    await runContainerTrigger({
      containerId,
      triggerType: trigger.type,
      triggerName: trigger.name,
      triggerAgent: trigger.agent,
    });
    triggerMessage.value = `Trigger ${triggerKey} ran successfully`;
    await loadContainers();
    await refreshActionTabData();
  } catch (e: unknown) {
    triggerError.value = errorMessage(e, `Failed to run ${triggerKey}`);
  } finally {
    triggerRunInProgress.value = null;
  }
}

async function rollbackToBackup(backupId?: string) {
  const containerId = selectedContainerId.value;
  if (!containerId || rollbackInProgress.value) {
    return;
  }
  rollbackInProgress.value = backupId || 'latest';
  rollbackMessage.value = null;
  rollbackError.value = null;
  try {
    await rollback(containerId, backupId);
    rollbackMessage.value = backupId
      ? 'Rollback completed from selected backup'
      : 'Rollback completed from latest backup';
    skippedUpdates.value.delete(selectedContainer.value?.name || '');
    await loadContainers();
    await Promise.all([loadDetailBackups(), loadDetailUpdateOperations()]);
  } catch (e: unknown) {
    rollbackError.value = errorMessage(e, 'Rollback failed');
  } finally {
    rollbackInProgress.value = null;
  }
}

async function applyPolicy(
  name: string,
  action: string,
  payload: Record<string, unknown> = {},
  message?: string,
) {
  const containerId = containerIdMap.value[name];
  if (!containerId || policyInProgress.value) {
    return false;
  }
  policyInProgress.value = `${action}:${name}`;
  policyError.value = null;
  try {
    await updateContainerPolicy(containerId, action, payload);
    if (message) {
      policyMessage.value = message;
    }
    await loadContainers();
    return true;
  } catch (e: unknown) {
    policyError.value = errorMessage(e, 'Failed to update policy');
    return false;
  } finally {
    policyInProgress.value = null;
  }
}

async function skipCurrentForSelected() {
  const containerName = selectedContainer.value?.name;
  if (!containerName) {
    return;
  }
  const applied = await applyPolicy(
    containerName,
    'skip-current',
    {},
    `Skipped current update for ${containerName}`,
  );
  if (applied) {
    skippedUpdates.value.add(containerName);
    await refreshActionTabData();
  }
}

async function snoozeSelected(days: number) {
  const containerName = selectedContainer.value?.name;
  if (!containerName) {
    return;
  }
  await applyPolicy(
    containerName,
    'snooze',
    { days },
    `Snoozed updates for ${days} day${days === 1 ? '' : 's'}`,
  );
}

function resolveSnoozeUntilFromInput(dateInput: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return undefined;
  }
  // Apply snooze through the end of the selected local date.
  const parsed = new Date(`${dateInput}T23:59:59`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

async function snoozeSelectedUntilDate() {
  const containerName = selectedContainer.value?.name;
  if (!containerName) {
    return;
  }
  const snoozeUntil = resolveSnoozeUntilFromInput(snoozeDateInput.value);
  if (!snoozeUntil) {
    policyError.value = 'Select a valid snooze date';
    return;
  }
  await applyPolicy(
    containerName,
    'snooze',
    { snoozeUntil },
    `Snoozed until ${snoozeDateInput.value}`,
  );
}

async function unsnoozeSelected() {
  const containerName = selectedContainer.value?.name;
  if (!containerName) {
    return;
  }
  await applyPolicy(containerName, 'unsnooze', {}, 'Snooze cleared');
}

async function clearSkipsSelected() {
  const containerName = selectedContainer.value?.name;
  if (!containerName) {
    return;
  }
  skippedUpdates.value.delete(containerName);
  await applyPolicy(containerName, 'clear-skips', {}, 'Skipped updates cleared');
}

async function clearPolicySelected() {
  const containerName = selectedContainer.value?.name;
  if (!containerName) {
    return;
  }
  skippedUpdates.value.delete(containerName);
  await applyPolicy(containerName, 'clear', {}, 'Update policy cleared');
}

async function removeSkipSelected(kind: 'tag' | 'digest', value: string) {
  const containerName = selectedContainer.value?.name;
  if (!containerName || !value) {
    return;
  }
  skippedUpdates.value.delete(containerName);
  await applyPolicy(
    containerName,
    'remove-skip',
    { kind, value },
    `Removed skipped ${kind} ${value}`,
  );
}

async function removeSkipTagSelected(value: string) {
  await removeSkipSelected('tag', value);
}

async function removeSkipDigestSelected(value: string) {
  await removeSkipSelected('digest', value);
}

watch(
  () => [selectedContainer.value?.name, activeDetailTab.value],
  ([containerName, tabName]) => {
    detailPreview.value = null;
    previewError.value = null;
    if (!containerName) {
      detailTriggers.value = [];
      detailBackups.value = [];
      detailUpdateOperations.value = [];
      updateOperationsError.value = null;
      resetDetailMessages();
      return;
    }
    if (tabName === 'actions') {
      resetDetailMessages();
      void refreshActionTabData();
    }
  },
  { immediate: true },
);

watch(
  () => selectedSnoozeUntil.value,
  (snoozeUntil) => {
    snoozeDateInput.value = toDateInputValue(snoozeUntil);
  },
  { immediate: true },
);

watch(
  () => selectedContainerId.value,
  (containerId) => {
    if (!containerId) {
      detailVulnerabilityResult.value = null;
      detailVulnerabilityError.value = null;
      detailSbomResult.value = null;
      detailSbomError.value = null;
      return;
    }
    void loadDetailSecurityData();
  },
  { immediate: true },
);

watch(
  () => selectedSbomFormat.value,
  () => {
    if (!selectedContainerId.value) {
      return;
    }
    void loadDetailSbom();
  },
);

// View mode
const containerViewMode = ref<'table' | 'cards' | 'list'>('table');
const tableActionStyle = ref<'icons' | 'buttons'>(
  (localStorage.getItem('dd-table-actions-v1') as 'icons' | 'buttons') || 'icons',
);
watch(
  () => tableActionStyle.value,
  (v) => localStorage.setItem('dd-table-actions-v1', v),
);

// Filters
const {
  filterSearch,
  filterStatus,
  filterRegistry,
  filterBouncer,
  filterServer,
  filterKind,
  showFilters,
  activeFilterCount,
  filteredContainers,
  clearFilters,
} = useContainerFilters(containers);
const route = useRoute();
const VALID_FILTER_KINDS = new Set(['all', 'any', 'major', 'minor', 'patch', 'digest']);

function applyFilterKindFromQuery(queryValue: unknown) {
  const raw = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  if (typeof raw !== 'string') {
    filterKind.value = 'all';
    return;
  }
  filterKind.value = VALID_FILTER_KINDS.has(raw) ? raw : 'all';
}

function applyFilterSearchFromQuery(queryValue: unknown) {
  const raw = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  filterSearch.value = typeof raw === 'string' ? raw : '';
}

applyFilterSearchFromQuery(route.query.q);
watch(
  () => route.query.q,
  (value) => applyFilterSearchFromQuery(value),
);

applyFilterKindFromQuery(route.query.filterKind);
watch(
  () => route.query.filterKind,
  (value) => applyFilterKindFromQuery(value),
);

const serverNames = computed(() => [...new Set(containers.value.map((c) => c.server))]);

// Sorting
const {
  sortKey: containerSortKey,
  sortAsc: containerSortAsc,
  toggleSort: toggleContainerSort,
} = useSorting('name');

const sortedContainers = computed(() => {
  const list = [...filteredContainers.value];
  const key = containerSortKey.value;
  const dir = containerSortAsc.value ? 1 : -1;
  const kindOrder: Record<string, number> = { major: 0, minor: 1, patch: 2, digest: 3 };
  const bouncerOrder: Record<string, number> = { blocked: 0, unsafe: 1, safe: 2 };
  return list.sort((a, b) => {
    let av: string | number;
    let bv: string | number;
    if (key === 'name') {
      av = a.name.toLowerCase();
      bv = b.name.toLowerCase();
    } else if (key === 'image') {
      av = a.image.toLowerCase();
      bv = b.image.toLowerCase();
    } else if (key === 'status') {
      av = a.status;
      bv = b.status;
    } else if (key === 'server') {
      av = a.server;
      bv = b.server;
    } else if (key === 'registry') {
      av = a.registry;
      bv = b.registry;
    } else if (key === 'bouncer') {
      av = bouncerOrder[a.bouncer] ?? 9;
      bv = bouncerOrder[b.bouncer] ?? 9;
    } else if (key === 'kind') {
      av = kindOrder[a.updateKind ?? ''] ?? 9;
      bv = kindOrder[b.updateKind ?? ''] ?? 9;
    } else if (key === 'version') {
      av = a.currentTag;
      bv = b.currentTag;
    } else return 0;
    return av < bv ? -dir : av > bv ? dir : 0;
  });
});

// Apply skip-update masking and merge ghost containers
const displayContainers = computed(() => {
  const live = sortedContainers.value.map((c) =>
    skippedUpdates.value.has(c.name)
      ? {
          ...c,
          newTag: undefined,
          releaseLink: undefined,
          updateKind: undefined,
        }
      : c,
  );
  // Merge pending (ghost) containers that disappeared during action
  const liveNames = new Set(live.map((c) => c.name));
  const ghosts = [...actionPending.value.entries()]
    .filter(([name]) => !liveNames.has(name))
    .map(([, snapshot]) => ({ ...snapshot, _pending: true as const }));
  return [...live, ...ghosts];
});

// Grouping / stacks
const groupByStack = ref(localStorage.getItem('dd-group-by-stack-v1') === 'true');
const groupMembershipMap = ref<Record<string, string>>({});
const collapsedGroups = ref(new Set<string>());
const groupUpdateInProgress = ref(new Set<string>());

watch(
  () => groupByStack.value,
  (v) => {
    localStorage.setItem('dd-group-by-stack-v1', String(v));
    if (v && Object.keys(groupMembershipMap.value).length === 0) {
      loadGroups();
    }
  },
);

function toggleGroupCollapse(key: string) {
  const next = new Set(collapsedGroups.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  collapsedGroups.value = next;
}

async function loadGroups() {
  try {
    const groups: ContainerGroup[] = await getContainerGroups();
    const map: Record<string, string> = {};
    for (const group of groups) {
      if (!group.name) continue;
      for (const c of group.containers) {
        const uiName = c.displayName || c.name;
        map[uiName] = group.name;
      }
    }
    groupMembershipMap.value = map;
  } catch {
    groupMembershipMap.value = {};
  }
}

interface RenderGroup {
  key: string;
  name: string | null;
  containers: typeof displayContainers.value;
  containerCount: number;
  updatesAvailable: number;
  updatableCount: number;
}

const groupedContainers = computed<RenderGroup[]>(() => {
  const map = groupMembershipMap.value;
  const buckets: Record<string, typeof displayContainers.value> = {};
  for (const c of displayContainers.value) {
    const groupName = map[c.name] ?? null;
    const key = groupName ?? '__ungrouped__';
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(c);
  }
  const named: RenderGroup[] = [];
  let ungrouped: RenderGroup | null = null;
  for (const [key, containers] of Object.entries(buckets)) {
    const group: RenderGroup = {
      key,
      name: key === '__ungrouped__' ? null : key,
      containers,
      containerCount: containers.length,
      updatesAvailable: containers.filter((c) => c.newTag).length,
      updatableCount: containers.filter((c) => c.newTag && c.bouncer !== 'blocked').length,
    };
    if (key === '__ungrouped__') {
      ungrouped = group;
    } else {
      named.push(group);
    }
  }
  named.sort((a, b) => a.key.localeCompare(b.key));
  if (ungrouped) named.push(ungrouped);
  return named;
});

const renderGroups = computed<RenderGroup[]>(() => {
  if (!groupByStack.value) {
    return [
      {
        key: '__flat__',
        name: null,
        containers: displayContainers.value,
        containerCount: displayContainers.value.length,
        updatesAvailable: displayContainers.value.filter((c) => c.newTag).length,
        updatableCount: displayContainers.value.filter((c) => c.newTag && c.bouncer !== 'blocked')
          .length,
      },
    ];
  }
  return groupedContainers.value;
});

// Column visibility
const { allColumns, visibleColumns, activeColumns, showColumnPicker, toggleColumn } =
  useColumnVisibility(isCompact);

// Map activeColumns to DataTable format
const tableColumns = computed(() =>
  activeColumns.value.map((col) => ({
    key: col.key,
    label: col.label,
    align: col.align,
    sortable: col.key !== 'icon',
    width: col.key === 'name' ? '99%' : col.key === 'icon' ? '40px' : undefined,
    icon: col.key === 'icon',
  })),
);

// Restore panel state on mount
onMounted(() => {
  const saved = sessionStorage.getItem('dd-panel');
  if (saved) {
    try {
      const s = JSON.parse(saved);
      const c = containers.value.find((x) => x.name === s.name);
      if (c) {
        selectedContainer.value = c;
        activeDetailTab.value = s.tab || 'overview';
        detailPanelOpen.value = s.panel ?? false;
        containerFullPage.value = s.full ?? false;
        panelSize.value = s.size || 'sm';
      }
    } catch {
      /* ignore corrupt data */
    }
  }
});

// Skipped updates (optimistic client masking while policy updates propagate)
const skippedUpdates = ref(new Set<string>());

// Actions menu
const openActionsMenu = ref<string | null>(null);
const actionsMenuStyle = ref<Record<string, string>>({});

function toggleActionsMenu(name: string, event: MouseEvent) {
  if (openActionsMenu.value === name) {
    openActionsMenu.value = null;
    return;
  }
  openActionsMenu.value = name;
  const btn = event.currentTarget as HTMLElement;
  const rect = btn.getBoundingClientRect();
  actionsMenuStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    right: `${window.innerWidth - rect.right}px`,
  };
}

function closeActionsMenu() {
  openActionsMenu.value = null;
}

// Column picker fixed positioning
const columnPickerStyle = ref<Record<string, string>>({});
function toggleColumnPicker(event: MouseEvent) {
  showColumnPicker.value = !showColumnPicker.value;
  if (showColumnPicker.value) {
    const btn = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    columnPickerStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
    };
  }
}

// Close menus on outside click
function handleGlobalClick() {
  openActionsMenu.value = null;
  showColumnPicker.value = false;
}
async function handleSseScanCompleted() {
  await loadContainers();
  if (selectedContainerId.value) {
    await loadDetailSecurityData();
  }
}
const sseScanCompletedListener = handleSseScanCompleted as EventListener;
onMounted(() => {
  document.addEventListener('click', handleGlobalClick);
  globalThis.addEventListener('dd:sse-scan-completed', sseScanCompletedListener);
});
onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick);
  globalThis.removeEventListener('dd:sse-scan-completed', sseScanCompletedListener);
});

// Container action handlers
const actionInProgress = ref<string | null>(null);

// Ghost state: hold container position during update/restart/stop (#80)
const actionPending = ref<Map<string, Container>>(new Map());
const actionPendingStartTimes = ref<Map<string, number>>(new Map());
const pendingActionsPollTimer = ref<ReturnType<typeof setInterval> | null>(null);
const pendingActionsPollInFlight = ref(false);
const POLL_INTERVAL = 2000;
const POLL_TIMEOUT = 30000;

function stopPendingActionsPolling() {
  if (!pendingActionsPollTimer.value) return;
  clearInterval(pendingActionsPollTimer.value);
  pendingActionsPollTimer.value = null;
}

function clearPendingAction(name: string) {
  actionPending.value.delete(name);
  actionPendingStartTimes.value.delete(name);
}

function prunePendingActions(now: number) {
  const liveContainerNames = new Set(containers.value.map((container) => container.name));
  for (const [name, startTime] of actionPendingStartTimes.value.entries()) {
    if (liveContainerNames.has(name) || now - startTime > POLL_TIMEOUT) {
      clearPendingAction(name);
    }
  }
  if (actionPending.value.size === 0) {
    stopPendingActionsPolling();
  }
}

async function pollPendingActions() {
  if (pendingActionsPollInFlight.value) {
    return;
  }
  pendingActionsPollInFlight.value = true;
  try {
    await loadContainers();
  } finally {
    prunePendingActions(Date.now());
    pendingActionsPollInFlight.value = false;
  }
}

function startPolling(name: string) {
  if (!actionPendingStartTimes.value.has(name)) {
    actionPendingStartTimes.value.set(name, Date.now());
  }
  if (pendingActionsPollTimer.value) {
    return;
  }
  pendingActionsPollTimer.value = setInterval(() => {
    void pollPendingActions();
  }, POLL_INTERVAL);
}

onUnmounted(() => {
  stopPendingActionsPolling();
});

async function executeAction(name: string, action: (id: string) => Promise<unknown>) {
  const containerId = containerIdMap.value[name];
  if (!containerId || actionInProgress.value) return false;
  actionInProgress.value = name;
  // Snapshot current state before action
  const snapshot = containers.value.find((c) => c.name === name);
  try {
    await action(containerId);
    await loadContainers();
    // If container disappeared after reload, hold its position
    const stillPresent = containers.value.find((c) => c.name === name);
    if (!stillPresent && snapshot) {
      actionPending.value.set(name, snapshot);
      startPolling(name);
    }
    if (selectedContainer.value?.name === name && activeDetailTab.value === 'actions') {
      await refreshActionTabData();
    }
    return true;
  } catch (e: unknown) {
    console.error(`Action failed for ${name}:`, errorMessage(e));
    return false;
  } finally {
    actionInProgress.value = null;
  }
}

function setGroupUpdateState(groupKey: string, updating: boolean) {
  const next = new Set(groupUpdateInProgress.value);
  if (updating) {
    next.add(groupKey);
  } else {
    next.delete(groupKey);
  }
  groupUpdateInProgress.value = next;
}

async function updateAllInGroup(group: RenderGroup) {
  if (groupUpdateInProgress.value.has(group.key)) {
    return;
  }
  const updatableContainers = group.containers.filter((container) => {
    return container.newTag && container.bouncer !== 'blocked';
  });
  if (updatableContainers.length === 0) {
    return;
  }
  setGroupUpdateState(group.key, true);
  try {
    for (const container of updatableContainers) {
      await executeAction(container.name, apiUpdateContainer);
    }
  } finally {
    setGroupUpdateState(group.key, false);
  }
}

async function startContainer(name: string) {
  await executeAction(name, apiStartContainer);
}

async function updateContainer(name: string) {
  await executeAction(name, apiUpdateContainer);
}

async function scanContainer(name: string) {
  await executeAction(name, apiScanContainer);
}

async function skipUpdate(name: string) {
  const applied = await applyPolicy(name, 'skip-current', {}, `Skipped current update for ${name}`);
  if (applied) {
    skippedUpdates.value.add(name);
    if (selectedContainer.value?.name === name && activeDetailTab.value === 'actions') {
      await refreshActionTabData();
    }
  }
}

async function forceUpdate(name: string) {
  await applyPolicy(name, 'clear', {}, `Cleared update policy for ${name}`);
  await executeAction(name, apiUpdateContainer);
}

async function deleteContainer(name: string) {
  const containerId = containerIdMap.value[name];
  if (!containerId || actionInProgress.value) {
    return false;
  }
  actionInProgress.value = name;
  try {
    await apiDeleteContainer(containerId);
    skippedUpdates.value.delete(name);
    if (selectedContainer.value?.name === name) {
      closeFullPage();
      closePanel();
    }
    await loadContainers();
    return true;
  } catch (e: unknown) {
    error.value = errorMessage(e, `Failed to delete ${name}`);
    return false;
  } finally {
    actionInProgress.value = null;
  }
}

// Tooltip shorthand — shows on 400ms delay
const tt = (label: string) => ({ value: label, showDelay: 400 });

function hasRegistryError(container: Container): boolean {
  return typeof container.registryError === 'string' && container.registryError.trim().length > 0;
}

function registryErrorTooltip(container: Container): string {
  if (!hasRegistryError(container)) {
    return 'Registry error';
  }
  return `Registry error: ${container.registryError}`;
}

interface ContainerListPolicyState {
  snoozed: boolean;
  skipped: boolean;
  skipCount: number;
  snoozeUntil?: string;
}

const EMPTY_CONTAINER_POLICY_STATE: ContainerListPolicyState = {
  snoozed: false,
  skipped: false,
  skipCount: 0,
};

function normalizePolicyEntries(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function getContainerListPolicyState(containerName: string): ContainerListPolicyState {
  const updatePolicy = containerMetaMap.value[containerName]?.updatePolicy;
  if (!updatePolicy || typeof updatePolicy !== 'object') {
    return EMPTY_CONTAINER_POLICY_STATE;
  }

  const policy = updatePolicy as Record<string, unknown>;
  const skipCount =
    normalizePolicyEntries(policy.skipTags).length +
    normalizePolicyEntries(policy.skipDigests).length;

  const rawSnoozeUntil = typeof policy.snoozeUntil === 'string' ? policy.snoozeUntil : undefined;
  const snoozeUntilMs = rawSnoozeUntil ? new Date(rawSnoozeUntil).getTime() : Number.NaN;
  const snoozed = Number.isFinite(snoozeUntilMs) && snoozeUntilMs > Date.now();

  if (!snoozed && skipCount === 0) {
    return EMPTY_CONTAINER_POLICY_STATE;
  }

  return {
    snoozed,
    skipped: skipCount > 0,
    skipCount,
    snoozeUntil: snoozed ? rawSnoozeUntil : undefined,
  };
}

function containerPolicyTooltip(containerName: string, kind: 'snoozed' | 'skipped'): string {
  const state = getContainerListPolicyState(containerName);
  if (kind === 'snoozed') {
    return state.snoozeUntil
      ? `Updates snoozed until ${formatTimestamp(state.snoozeUntil)}`
      : 'Updates snoozed';
  }
  if (state.skipCount <= 0) {
    return 'Skipped updates policy active';
  }
  return `Skipped updates policy active (${state.skipCount} entr${state.skipCount === 1 ? 'y' : 'ies'})`;
}

// Confirm wrappers for destructive actions
function confirmStop(name: string) {
  confirm.require({
    header: 'Stop Container',
    message: `Stop ${name}?`,
    rejectLabel: 'Cancel',
    acceptLabel: 'Stop',
    severity: 'danger',
    accept: () => executeAction(name, apiStopContainer),
  });
}

function confirmRestart(name: string) {
  confirm.require({
    header: 'Restart Container',
    message: `Restart ${name}?`,
    rejectLabel: 'Cancel',
    acceptLabel: 'Restart',
    severity: 'warn',
    accept: () => executeAction(name, apiRestartContainer),
  });
}

function confirmForceUpdate(name: string) {
  confirm.require({
    header: 'Force Update',
    message: `Force update ${name}? This clears skip/snooze policy before attempting update.`,
    rejectLabel: 'Cancel',
    acceptLabel: 'Force Update',
    severity: 'warn',
    accept: () => forceUpdate(name),
  });
}

function confirmDelete(name: string) {
  confirm.require({
    header: 'Delete Container',
    message: `Delete ${name}? This will remove it from Drydock tracking until rediscovered.`,
    rejectLabel: 'Cancel',
    acceptLabel: 'Delete',
    severity: 'danger',
    accept: () => deleteContainer(name),
  });
}

provide(containersViewTemplateContextKey, {
  error,
  loading,
  containers,
  containerViewMode,
  showFilters,
  filteredContainers,
  activeFilterCount,
  filterSearch,
  filterStatus,
  filterBouncer,
  filterRegistry,
  filterServer,
  serverNames,
  filterKind,
  clearFilters,
  showColumnPicker,
  toggleColumnPicker,
  columnPickerStyle,
  allColumns,
  toggleColumn,
  visibleColumns,
  tt,
  groupByStack,
  rechecking,
  recheckAll,
  renderGroups,
  toggleGroupCollapse,
  collapsedGroups,
  groupUpdateInProgress,
  actionInProgress,
  updateAllInGroup,
  tableColumns,
  containerSortKey,
  containerSortAsc,
  selectedContainer,
  isCompact,
  selectContainer,
  tableActionStyle,
  openActionsMenu,
  toggleActionsMenu,
  updateContainer,
  confirmStop,
  startContainer,
  confirmRestart,
  scanContainer,
  confirmForceUpdate,
  skipUpdate,
  closeActionsMenu,
  confirmDelete,
  displayContainers,
  actionsMenuStyle,
  updateKindColor,
  hasRegistryError,
  registryErrorTooltip,
  containerPolicyTooltip,
  getContainerListPolicyState,
  serverBadgeColor,
  parseServer,
  registryColorBg,
  registryColorText,
  registryLabel,
  detailPanelOpen,
  isMobile,
  panelSize,
  closePanel,
  openFullPage,
  detailTabs,
  activeDetailTab,
  selectedRuntimeOrigins,
  runtimeOriginStyle,
  runtimeOriginLabel,
  selectedRuntimeDriftWarnings,
  selectedLifecycleHooks,
  lifecycleHookTemplateVariables,
  selectedAutoRollbackConfig,
  selectedImageMetadata,
  formatTimestamp,
  detailVulnerabilityLoading,
  detailSbomLoading,
  loadDetailSecurityData,
  detailVulnerabilityError,
  vulnerabilitySummary,
  vulnerabilityTotal,
  vulnerabilityPreview,
  severityStyle,
  normalizeSeverity,
  getVulnerabilityPackage,
  selectedSbomFormat,
  loadDetailSbom,
  detailSbomError,
  sbomDocument,
  sbomComponentCount,
  sbomGeneratedAt,
  LOG_AUTO_FETCH_INTERVALS,
  containerAutoFetchInterval,
  getContainerLogs,
  containerLogRef,
  containerHandleLogScroll,
  containerScrollBlocked,
  containerResumeAutoScroll,
  previewLoading,
  runContainerPreview,
  policyInProgress,
  skipCurrentForSelected,
  snoozeSelected,
  snoozeDateInput,
  snoozeSelectedUntilDate,
  selectedSnoozeUntil,
  unsnoozeSelected,
  selectedSkipTags,
  selectedSkipDigests,
  clearSkipsSelected,
  selectedUpdatePolicy,
  clearPolicySelected,
  policyMessage,
  policyError,
  removeSkipTagSelected,
  removeSkipDigestSelected,
  detailPreview,
  previewError,
  triggersLoading,
  detailTriggers,
  getTriggerKey,
  triggerRunInProgress,
  runAssociatedTrigger,
  triggerMessage,
  triggerError,
  backupsLoading,
  detailBackups,
  rollbackInProgress,
  rollbackToBackup,
  rollbackMessage,
  rollbackError,
  updateOperationsLoading,
  detailUpdateOperations,
  getOperationStatusStyle,
  formatOperationStatus,
  formatOperationPhase,
  formatRollbackReason,
  updateOperationsError,
  closeFullPage,
});
</script>

<template>
  <ConfirmDialog />
  <DataViewLayout v-if="!containerFullPage">
    <ContainersListContent />
    <template #panel>
      <ContainerSideDetail />
    </template>
  </DataViewLayout>
  <ContainerFullPageDetail v-if="containerFullPage && selectedContainer" />
</template>
