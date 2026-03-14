import { computed, type Ref, ref, watch } from 'vue';
import {
  getContainerSbom as fetchContainerSbom,
  getContainerVulnerabilities as fetchContainerVulnerabilities,
} from '../../services/container';
import type { ApiSbomDocument, ApiVulnerability } from '../../types/api';
import { errorMessage } from '../../utils/error';
import { normalizeSeverity } from '../../utils/security';

type RuntimeOrigin = 'explicit' | 'inherited' | 'unknown';

interface UseContainerSecurityInput {
  selectedContainerId: Readonly<Ref<string | undefined>>;
  selectedContainerMeta: Readonly<Ref<Record<string, unknown> | undefined>>;
}

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

function normalizeComposePathList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  if (typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return normalizeComposePathList(parsed);
      }
    } catch {
      // Fall through to delimiter-based parsing.
    }
  }

  return trimmed
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function getComposePathsFromMeta(meta: Record<string, unknown> | undefined): string[] {
  if (!meta) {
    return [];
  }

  const compose = meta.compose as Record<string, unknown> | undefined;
  const composeContext = meta.composeContext as Record<string, unknown> | undefined;
  const runtimeContext = meta.runtimeContext as Record<string, unknown> | undefined;
  const labels = meta.labels as Record<string, unknown> | undefined;

  const detectedPaths = [
    ...normalizeComposePathList(meta.composePaths),
    ...normalizeComposePathList(meta.compose_paths),
    ...normalizeComposePathList(compose?.paths),
    ...normalizeComposePathList(compose?.files),
    ...normalizeComposePathList(compose?.composePaths),
    ...normalizeComposePathList(compose?.composeFiles),
    ...normalizeComposePathList(compose?.file),
    ...normalizeComposePathList(compose?.composeFile),
    ...normalizeComposePathList(composeContext?.paths),
    ...normalizeComposePathList(composeContext?.files),
    ...normalizeComposePathList(composeContext?.composePaths),
    ...normalizeComposePathList(composeContext?.composeFiles),
    ...normalizeComposePathList(composeContext?.file),
    ...normalizeComposePathList(composeContext?.composeFile),
    ...normalizeComposePathList(runtimeContext?.paths),
    ...normalizeComposePathList(runtimeContext?.files),
    ...normalizeComposePathList(runtimeContext?.composePaths),
    ...normalizeComposePathList(runtimeContext?.composeFiles),
    ...normalizeComposePathList(runtimeContext?.file),
    ...normalizeComposePathList(runtimeContext?.composeFile),
    ...normalizeComposePathList(labels?.['com.docker.compose.project.config_files']),
    ...normalizeComposePathList(labels?.['dd.compose.files']),
    ...normalizeComposePathList(labels?.['wud.compose.files']),
    ...normalizeComposePathList(labels?.['dd.compose.file']),
    ...normalizeComposePathList(labels?.['wud.compose.file']),
  ];
  const deduplicatedPaths = [...new Set(detectedPaths)];

  if (deduplicatedPaths.length > 0) {
    return deduplicatedPaths;
  }

  const trigger = meta.trigger as Record<string, unknown> | undefined;
  const triggerConfiguration = (trigger?.configuration ??
    meta.triggerConfiguration ??
    meta.configuration) as Record<string, unknown> | undefined;

  return normalizeComposePathList(triggerConfiguration?.file);
}

function detectSbomComponentCount(document: ApiSbomDocument): number | undefined {
  if (Array.isArray(document?.packages)) {
    return document.packages.length;
  }
  if (Array.isArray(document?.components)) {
    return document.components.length;
  }
  return undefined;
}

interface RuntimeOrigins {
  entrypoint: RuntimeOrigin;
  cmd: RuntimeOrigin;
}

interface DetailSecurityState {
  detailVulnerabilityResult: Ref<Record<string, unknown> | null>;
  detailVulnerabilityLoading: Ref<boolean>;
  detailVulnerabilityError: Ref<string | null>;
  detailSbomResult: Ref<Record<string, unknown> | null>;
  detailSbomLoading: Ref<boolean>;
  detailSbomError: Ref<string | null>;
}

function createSelectedRuntimeOrigins(
  selectedContainerMeta: Readonly<Ref<Record<string, unknown> | undefined>>,
) {
  return computed<RuntimeOrigins>(() => ({
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
}

function createSelectedLifecycleHooks(
  selectedContainerMeta: Readonly<Ref<Record<string, unknown> | undefined>>,
) {
  return computed(() => {
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
}

function createSelectedAutoRollbackConfig(
  selectedContainerMeta: Readonly<Ref<Record<string, unknown> | undefined>>,
) {
  return computed(() => {
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
    const intervalMs =
      Number.isFinite(intervalParsed) && intervalParsed > 0 ? intervalParsed : 10000;

    return {
      enabledLabel:
        enabled === true ? 'Enabled' : enabled === false ? 'Disabled' : 'Disabled (default)',
      windowLabel: `${windowMs}ms`,
      intervalLabel: `${intervalMs}ms`,
    };
  });
}

function createSelectedRuntimeDriftWarnings(
  selectedContainerMeta: Readonly<Ref<Record<string, unknown> | undefined>>,
  selectedRuntimeOrigins: Readonly<Ref<RuntimeOrigins>>,
) {
  return computed<string[]>(() => {
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
}

function createSelectedComposePaths(
  selectedContainerMeta: Readonly<Ref<Record<string, unknown> | undefined>>,
) {
  return computed<string[]>(() => getComposePathsFromMeta(selectedContainerMeta.value));
}

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

function createSelectedImageMetadata(
  selectedContainerMeta: Readonly<Ref<Record<string, unknown> | undefined>>,
) {
  return computed(() => {
    const image = selectedContainerMeta.value?.image as Record<string, unknown> | undefined;
    const digest = image?.digest as Record<string, unknown> | undefined;
    const digestValue = digest?.value || digest?.repo;
    return {
      architecture: typeof image?.architecture === 'string' ? image.architecture : undefined,
      os: typeof image?.os === 'string' ? image.os : undefined,
      digest: typeof digestValue === 'string' ? digestValue : undefined,
      created: typeof image?.created === 'string' ? image.created : undefined,
    };
  });
}

function createVulnerabilitySummary(
  detailVulnerabilityResult: Ref<Record<string, unknown> | null>,
) {
  return computed(() => {
    const summary = detailVulnerabilityResult.value?.summary as Record<string, number> | undefined;
    return {
      critical: summary?.critical ?? 0,
      high: summary?.high ?? 0,
      medium: summary?.medium ?? 0,
      low: summary?.low ?? 0,
      unknown: summary?.unknown ?? 0,
    };
  });
}

function createVulnerabilityTotal(
  vulnerabilitySummary: Readonly<
    Ref<{
      critical: number;
      high: number;
      medium: number;
      low: number;
      unknown: number;
    }>
  >,
) {
  return computed(
    () =>
      vulnerabilitySummary.value.critical +
      vulnerabilitySummary.value.high +
      vulnerabilitySummary.value.medium +
      vulnerabilitySummary.value.low +
      vulnerabilitySummary.value.unknown,
  );
}

function createVulnerabilityPreview(
  detailVulnerabilityResult: Ref<Record<string, unknown> | null>,
) {
  return computed(() => {
    const vulnerabilities = detailVulnerabilityResult.value?.vulnerabilities;
    if (!Array.isArray(vulnerabilities)) {
      return [];
    }
    return vulnerabilities.slice(0, 5);
  });
}

function createSbomDocument(detailSbomResult: Ref<Record<string, unknown> | null>) {
  return computed(() => detailSbomResult.value?.document as ApiSbomDocument | undefined);
}

function createSbomGeneratedAt(detailSbomResult: Ref<Record<string, unknown> | null>) {
  return computed(() => detailSbomResult.value?.generatedAt as string | undefined);
}

function createSbomComponentCount(sbomDocument: Readonly<Ref<ApiSbomDocument | undefined>>) {
  return computed(() => detectSbomComponentCount(sbomDocument.value));
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

function resetVulnerabilityState(state: DetailSecurityState) {
  state.detailVulnerabilityResult.value = null;
  state.detailVulnerabilityError.value = null;
}

function resetSbomState(state: DetailSecurityState) {
  state.detailSbomResult.value = null;
  state.detailSbomError.value = null;
}

function resetSecurityDataState(state: DetailSecurityState) {
  resetVulnerabilityState(state);
  resetSbomState(state);
}

function createDetailSecurityActions(
  input: UseContainerSecurityInput,
  selectedSbomFormat: Readonly<Ref<'spdx-json' | 'cyclonedx-json'>>,
  state: DetailSecurityState,
) {
  async function loadDetailVulnerabilities() {
    const containerId = input.selectedContainerId.value;
    if (!containerId) {
      resetVulnerabilityState(state);
      return;
    }

    state.detailVulnerabilityLoading.value = true;
    state.detailVulnerabilityError.value = null;
    try {
      state.detailVulnerabilityResult.value = await fetchContainerVulnerabilities(containerId);
    } catch (e: unknown) {
      state.detailVulnerabilityResult.value = null;
      state.detailVulnerabilityError.value = errorMessage(e, 'Failed to load vulnerabilities');
    } finally {
      state.detailVulnerabilityLoading.value = false;
    }
  }

  async function loadDetailSbom() {
    const containerId = input.selectedContainerId.value;
    if (!containerId) {
      resetSbomState(state);
      return;
    }

    state.detailSbomLoading.value = true;
    state.detailSbomError.value = null;
    try {
      state.detailSbomResult.value = await fetchContainerSbom(
        containerId,
        selectedSbomFormat.value,
      );
    } catch (e: unknown) {
      state.detailSbomResult.value = null;
      state.detailSbomError.value = errorMessage(e, 'Failed to load SBOM');
    } finally {
      state.detailSbomLoading.value = false;
    }
  }

  async function loadDetailSecurityData() {
    await Promise.all([loadDetailVulnerabilities(), loadDetailSbom()]);
  }

  return {
    loadDetailSbom,
    loadDetailSecurityData,
  };
}

function setupDetailSecurityWatchers(
  input: UseContainerSecurityInput,
  selectedSbomFormat: Readonly<Ref<'spdx-json' | 'cyclonedx-json'>>,
  state: DetailSecurityState,
  actions: {
    loadDetailSbom: () => Promise<void>;
    loadDetailSecurityData: () => Promise<void>;
  },
) {
  watch(
    () => input.selectedContainerId.value,
    (containerId) => {
      if (!containerId) {
        resetSecurityDataState(state);
        return;
      }
      void actions.loadDetailSecurityData();
    },
    { immediate: true },
  );

  watch(
    () => selectedSbomFormat.value,
    () => {
      if (!input.selectedContainerId.value) {
        return;
      }
      void actions.loadDetailSbom();
    },
  );
}

const lifecycleHookTemplateVariables = [
  { name: 'DD_CONTAINER_NAME', description: 'Container name' },
  { name: 'DD_CONTAINER_ID', description: 'Container ID' },
  { name: 'DD_IMAGE_NAME', description: 'Image name (without registry)' },
  { name: 'DD_IMAGE_TAG', description: 'Current image tag' },
  { name: 'DD_UPDATE_KIND', description: 'Update type (tag or digest)' },
  { name: 'DD_UPDATE_FROM', description: 'Current tag or digest' },
  { name: 'DD_UPDATE_TO', description: 'New tag or digest' },
];

export function useContainerSecurity(input: UseContainerSecurityInput) {
  const selectedRuntimeOrigins = createSelectedRuntimeOrigins(input.selectedContainerMeta);
  const selectedLifecycleHooks = createSelectedLifecycleHooks(input.selectedContainerMeta);
  const selectedAutoRollbackConfig = createSelectedAutoRollbackConfig(input.selectedContainerMeta);
  const selectedRuntimeDriftWarnings = createSelectedRuntimeDriftWarnings(
    input.selectedContainerMeta,
    selectedRuntimeOrigins,
  );
  const selectedComposePaths = createSelectedComposePaths(input.selectedContainerMeta);
  const selectedImageMetadata = createSelectedImageMetadata(input.selectedContainerMeta);

  const selectedSbomFormat = ref<'spdx-json' | 'cyclonedx-json'>('spdx-json');
  const detailVulnerabilityResult = ref<Record<string, unknown> | null>(null);
  const detailVulnerabilityLoading = ref(false);
  const detailVulnerabilityError = ref<string | null>(null);
  const detailSbomResult = ref<Record<string, unknown> | null>(null);
  const detailSbomLoading = ref(false);
  const detailSbomError = ref<string | null>(null);

  const detailSecurityState: DetailSecurityState = {
    detailVulnerabilityResult,
    detailVulnerabilityLoading,
    detailVulnerabilityError,
    detailSbomResult,
    detailSbomLoading,
    detailSbomError,
  };

  const vulnerabilitySummary = createVulnerabilitySummary(detailVulnerabilityResult);
  const vulnerabilityTotal = createVulnerabilityTotal(vulnerabilitySummary);
  const vulnerabilityPreview = createVulnerabilityPreview(detailVulnerabilityResult);

  const sbomDocument = createSbomDocument(detailSbomResult);
  const sbomGeneratedAt = createSbomGeneratedAt(detailSbomResult);
  const sbomComponentCount = createSbomComponentCount(sbomDocument);

  const { loadDetailSbom, loadDetailSecurityData } = createDetailSecurityActions(
    input,
    selectedSbomFormat,
    detailSecurityState,
  );
  setupDetailSecurityWatchers(input, selectedSbomFormat, detailSecurityState, {
    loadDetailSbom,
    loadDetailSecurityData,
  });

  return {
    detailSbomError,
    detailSbomLoading,
    detailVulnerabilityError,
    detailVulnerabilityLoading,
    getVulnerabilityPackage,
    lifecycleHookTemplateVariables,
    loadDetailSbom,
    loadDetailSecurityData,
    normalizeSeverity,
    runtimeOriginLabel,
    runtimeOriginStyle,
    sbomComponentCount,
    sbomDocument,
    sbomGeneratedAt,
    selectedAutoRollbackConfig,
    selectedImageMetadata,
    selectedLifecycleHooks,
    selectedComposePaths,
    selectedRuntimeDriftWarnings,
    selectedRuntimeOrigins,
    selectedSbomFormat,
    severityStyle,
    vulnerabilityPreview,
    vulnerabilitySummary,
    vulnerabilityTotal,
  };
}
