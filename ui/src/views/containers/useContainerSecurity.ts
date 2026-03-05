import { computed, type Ref, ref, watch } from 'vue';
import {
  getContainerSbom as fetchContainerSbom,
  getContainerVulnerabilities as fetchContainerVulnerabilities,
} from '../../services/container';
import type { ApiSbomDocument, ApiVulnerability } from '../../types/api';
import { errorMessage } from '../../utils/error';

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

function detectSbomComponentCount(document: ApiSbomDocument): number | undefined {
  if (Array.isArray(document?.packages)) {
    return document.packages.length;
  }
  if (Array.isArray(document?.components)) {
    return document.components.length;
  }
  return undefined;
}

export function useContainerSecurity(input: UseContainerSecurityInput) {
  const selectedRuntimeOrigins = computed(() => ({
    entrypoint: getRuntimeOriginValue(
      input.selectedContainerMeta.value?.labels,
      'dd.runtime.entrypoint.origin',
      'wud.runtime.entrypoint.origin',
    ),
    cmd: getRuntimeOriginValue(
      input.selectedContainerMeta.value?.labels,
      'dd.runtime.cmd.origin',
      'wud.runtime.cmd.origin',
    ),
  }));

  const selectedLifecycleHooks = computed(() => {
    const labels = input.selectedContainerMeta.value?.labels;
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
    const labels = input.selectedContainerMeta.value?.labels;
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

  const selectedRuntimeDriftWarnings = computed<string[]>(() => {
    if (!input.selectedContainerMeta.value) {
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
    const image = input.selectedContainerMeta.value?.image as Record<string, unknown> | undefined;
    const digest = image?.digest as Record<string, unknown> | undefined;
    const digestValue = digest?.value || digest?.repo;
    return {
      architecture: typeof image?.architecture === 'string' ? image.architecture : undefined,
      os: typeof image?.os === 'string' ? image.os : undefined,
      digest: typeof digestValue === 'string' ? digestValue : undefined,
      created: typeof image?.created === 'string' ? image.created : undefined,
    };
  });

  const selectedSbomFormat = ref<'spdx-json' | 'cyclonedx-json'>('spdx-json');
  const detailVulnerabilityResult = ref<Record<string, unknown> | null>(null);
  const detailVulnerabilityLoading = ref(false);
  const detailVulnerabilityError = ref<string | null>(null);
  const detailSbomResult = ref<Record<string, unknown> | null>(null);
  const detailSbomLoading = ref(false);
  const detailSbomError = ref<string | null>(null);

  const vulnerabilitySummary = computed(() => {
    const summary = detailVulnerabilityResult.value?.summary as Record<string, number> | undefined;
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

  const sbomDocument = computed(
    () => detailSbomResult.value?.document as ApiSbomDocument | undefined,
  );
  const sbomGeneratedAt = computed(() => detailSbomResult.value?.generatedAt as string | undefined);
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
    const containerId = input.selectedContainerId.value;
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
    const containerId = input.selectedContainerId.value;
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

  watch(
    () => input.selectedContainerId.value,
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
      if (!input.selectedContainerId.value) {
        return;
      }
      void loadDetailSbom();
    },
  );

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
    selectedRuntimeDriftWarnings,
    selectedRuntimeOrigins,
    selectedSbomFormat,
    severityStyle,
    vulnerabilityPreview,
    vulnerabilitySummary,
    vulnerabilityTotal,
  };
}
