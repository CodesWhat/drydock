import { computed, type Ref, ref } from 'vue';
import { getContainerSbom } from '../services/container';
import { errorMessage } from '../utils/error';
import type { SbomFormat } from '../views/security/securityViewTypes';
import { severityOrder, toSafeFileName } from '../views/security/securityViewUtils';
import type { ImageSummaryWithVulns } from './useVulnerabilities';

interface UseSbomDetailOptions {
  containerIdsByImage: Ref<Record<string, string[]>>;
}

type SbomResult = Record<string, unknown> | null;

interface SbomDetailSelectionState {
  selectedImage: Ref<ImageSummaryWithVulns | null>;
  detailOpen: Ref<boolean>;
  detailSbomResult: Ref<SbomResult>;
  detailSbomError: Ref<string | null>;
  showSbomDocument: Ref<boolean>;
}

function resolveSelectedImageContainerId(
  selectedImage: ImageSummaryWithVulns | null,
  containerIdsByImage: Record<string, string[]>,
): string | undefined {
  if (!selectedImage) {
    return undefined;
  }
  const containerIds = containerIdsByImage[selectedImage.image];
  if (!Array.isArray(containerIds) || containerIds.length === 0) {
    return undefined;
  }
  return containerIds[0];
}

function sortSelectedImageVulns(selectedImage: ImageSummaryWithVulns | null) {
  if (!selectedImage) {
    return [];
  }
  const sorted = [...selectedImage.vulns];
  sorted.sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));
  return sorted;
}

function getSbomComponentCount(document: unknown): number | undefined {
  if (!document || typeof document !== 'object') {
    return undefined;
  }
  const documentRecord = document as Record<string, unknown>;
  if (Array.isArray(documentRecord.packages)) {
    return documentRecord.packages.length;
  }
  if (Array.isArray(documentRecord.components)) {
    return documentRecord.components.length;
  }
  return undefined;
}

function toSbomDocumentJson(showSbomDocument: boolean, document: unknown): string {
  if (!showSbomDocument || !document) {
    return '';
  }
  try {
    return JSON.stringify(document, null, 2);
  } catch {
    return '';
  }
}

function resetDetailSbomState(
  state: Pick<
    SbomDetailSelectionState,
    'showSbomDocument' | 'detailSbomResult' | 'detailSbomError'
  >,
): void {
  state.showSbomDocument.value = false;
  state.detailSbomResult.value = null;
  state.detailSbomError.value = null;
}

function handleDetailOpenStateChange(state: SbomDetailSelectionState, open: boolean): void {
  state.detailOpen.value = open;
  if (!open) {
    state.selectedImage.value = null;
    resetDetailSbomState(state);
  }
}

async function loadDetailSbomForContainer({
  containerId,
  selectedSbomFormat,
  detailSbomResult,
  detailSbomLoading,
  detailSbomError,
}: {
  containerId: string | undefined;
  selectedSbomFormat: SbomFormat;
  detailSbomResult: Ref<SbomResult>;
  detailSbomLoading: Ref<boolean>;
  detailSbomError: Ref<string | null>;
}): Promise<void> {
  if (!containerId) {
    detailSbomResult.value = null;
    detailSbomError.value = 'No container identifier is available for this image.';
    return;
  }

  detailSbomLoading.value = true;
  detailSbomError.value = null;
  try {
    detailSbomResult.value = await getContainerSbom(containerId, selectedSbomFormat);
  } catch (caught: unknown) {
    detailSbomResult.value = null;
    detailSbomError.value = errorMessage(caught, 'Failed to load SBOM');
  } finally {
    detailSbomLoading.value = false;
  }
}

function downloadSbomDocument({
  detailSbomDocument,
  selectedImage,
  selectedSbomFormat,
  detailSbomDocumentJson,
}: {
  detailSbomDocument: unknown;
  selectedImage: ImageSummaryWithVulns | null;
  selectedSbomFormat: SbomFormat;
  detailSbomDocumentJson: string;
}): void {
  if (!detailSbomDocument || !selectedImage) {
    return;
  }
  const runtimeDocument = globalThis.document;
  const createObjectUrl = globalThis.URL?.createObjectURL;
  const revokeObjectUrl = globalThis.URL?.revokeObjectURL;
  if (
    !runtimeDocument?.body ||
    typeof createObjectUrl !== 'function' ||
    typeof revokeObjectUrl !== 'function'
  ) {
    return;
  }
  if (!detailSbomDocumentJson) {
    return;
  }
  const blob = new Blob([detailSbomDocumentJson], { type: 'application/json' });
  const objectUrl = createObjectUrl(blob);
  const link = runtimeDocument.createElement('a');
  link.href = objectUrl;
  link.download = `${toSafeFileName(selectedImage.image)}.${selectedSbomFormat}.sbom.json`;
  runtimeDocument.body.appendChild(link);
  try {
    link.click();
  } finally {
    runtimeDocument.body.removeChild(link);
    revokeObjectUrl(objectUrl);
  }
}

export function useSbomDetail({ containerIdsByImage }: UseSbomDetailOptions) {
  const selectedImage = ref<ImageSummaryWithVulns | null>(null);
  const detailOpen = ref(false);
  const selectedSbomFormat = ref<SbomFormat>('spdx-json');
  const detailSbomResult = ref<SbomResult>(null);
  const detailSbomLoading = ref(false);
  const detailSbomError = ref<string | null>(null);
  const showSbomDocument = ref(false);
  const detailState: SbomDetailSelectionState = {
    selectedImage,
    detailOpen,
    detailSbomResult,
    detailSbomError,
    showSbomDocument,
  };

  const selectedImageContainerId = computed(() =>
    resolveSelectedImageContainerId(selectedImage.value, containerIdsByImage.value),
  );

  const selectedImageVulns = computed(() => sortSelectedImageVulns(selectedImage.value));

  const detailSbomDocument = computed(() => detailSbomResult.value?.document);
  const detailSbomGeneratedAt = computed(() => detailSbomResult.value?.generatedAt);
  const detailSbomComponentCount = computed(() => getSbomComponentCount(detailSbomDocument.value));
  const detailSbomDocumentJson = computed(() =>
    toSbomDocumentJson(showSbomDocument.value, detailSbomDocument.value),
  );

  async function loadDetailSbom() {
    await loadDetailSbomForContainer({
      containerId: selectedImageContainerId.value,
      selectedSbomFormat: selectedSbomFormat.value,
      detailSbomResult,
      detailSbomLoading,
      detailSbomError,
    });
  }

  function downloadDetailSbom() {
    downloadSbomDocument({
      detailSbomDocument: detailSbomDocument.value,
      selectedImage: selectedImage.value,
      selectedSbomFormat: selectedSbomFormat.value,
      detailSbomDocumentJson: detailSbomDocumentJson.value,
    });
  }

  function openDetail(summary: ImageSummaryWithVulns) {
    selectedImage.value = summary;
    detailOpen.value = true;
    resetDetailSbomState(detailState);
    void loadDetailSbom();
  }

  function handleDetailOpenChange(open: boolean) {
    handleDetailOpenStateChange(detailState, open);
  }

  return {
    selectedImage,
    detailOpen,
    selectedSbomFormat,
    detailSbomResult,
    detailSbomLoading,
    detailSbomError,
    showSbomDocument,
    selectedImageVulns,
    detailSbomDocument,
    detailSbomGeneratedAt,
    detailSbomComponentCount,
    detailSbomDocumentJson,
    loadDetailSbom,
    downloadDetailSbom,
    openDetail,
    handleDetailOpenChange,
  };
}
