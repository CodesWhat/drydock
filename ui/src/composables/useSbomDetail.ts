import { computed, type Ref, ref } from 'vue';
import { getContainerSbom } from '../services/container';
import { errorMessage } from '../utils/error';
import { severityOrder, toSafeFileName } from '../views/security/securityViewUtils';
import type { ImageSummaryWithVulns } from './useVulnerabilities';

export type SbomFormat = 'spdx-json' | 'cyclonedx-json';

interface UseSbomDetailOptions {
  containerIdsByImage: Ref<Record<string, string[]>>;
}

export function useSbomDetail({ containerIdsByImage }: UseSbomDetailOptions) {
  const selectedImage = ref<ImageSummaryWithVulns | null>(null);
  const detailOpen = ref(false);
  const selectedSbomFormat = ref<SbomFormat>('spdx-json');
  const detailSbomResult = ref<Record<string, unknown> | null>(null);
  const detailSbomLoading = ref(false);
  const detailSbomError = ref<string | null>(null);
  const showSbomDocument = ref(false);

  const selectedImageContainerId = computed(() => {
    if (!selectedImage.value) {
      return undefined;
    }
    const containerIds = containerIdsByImage.value[selectedImage.value.image];
    if (!Array.isArray(containerIds) || containerIds.length === 0) {
      return undefined;
    }
    return containerIds[0];
  });

  const selectedImageVulns = computed(() => {
    if (!selectedImage.value) return [];
    const sorted = [...selectedImage.value.vulns];
    sorted.sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));
    return sorted;
  });

  const detailSbomDocument = computed(() => detailSbomResult.value?.document);
  const detailSbomGeneratedAt = computed(() => detailSbomResult.value?.generatedAt);
  const detailSbomComponentCount = computed(() => {
    const document = detailSbomDocument.value;
    if (Array.isArray(document?.packages)) {
      return document.packages.length;
    }
    if (Array.isArray(document?.components)) {
      return document.components.length;
    }
    return undefined;
  });
  const detailSbomDocumentJson = computed(() => {
    if (!detailSbomDocument.value) {
      return '';
    }
    try {
      return JSON.stringify(detailSbomDocument.value, null, 2);
    } catch {
      return '';
    }
  });

  async function loadDetailSbom() {
    const containerId = selectedImageContainerId.value;
    if (!containerId) {
      detailSbomResult.value = null;
      detailSbomError.value = 'No container identifier is available for this image.';
      return;
    }

    detailSbomLoading.value = true;
    detailSbomError.value = null;
    try {
      detailSbomResult.value = await getContainerSbom(containerId, selectedSbomFormat.value);
    } catch (caught: unknown) {
      detailSbomResult.value = null;
      detailSbomError.value = errorMessage(caught, 'Failed to load SBOM');
    } finally {
      detailSbomLoading.value = false;
    }
  }

  function downloadDetailSbom() {
    if (!detailSbomDocument.value || !selectedImage.value) {
      return;
    }
    const payload = detailSbomDocumentJson.value;
    if (!payload) {
      return;
    }
    const blob = new Blob([payload], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${toSafeFileName(selectedImage.value.image)}.${selectedSbomFormat.value}.sbom.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  }

  function openDetail(summary: ImageSummaryWithVulns) {
    selectedImage.value = summary;
    detailOpen.value = true;
    showSbomDocument.value = false;
    detailSbomResult.value = null;
    detailSbomError.value = null;
    void loadDetailSbom();
  }

  function handleDetailOpenChange(open: boolean) {
    detailOpen.value = open;
    if (!open) {
      selectedImage.value = null;
      showSbomDocument.value = false;
      detailSbomResult.value = null;
      detailSbomError.value = null;
    }
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
