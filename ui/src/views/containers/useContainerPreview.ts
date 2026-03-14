import { computed, type Ref, ref } from 'vue';
import type { ContainerComposePreview, ContainerPreviewPayload } from '../../services/preview';
import { previewContainer } from '../../services/preview';
import { errorMessage } from '../../utils/error';

interface UseContainerPreviewInput {
  selectedContainerId: Readonly<Ref<string | undefined>>;
}

function buildDetailComposePreview(
  preview: ContainerPreviewPayload | null,
): ContainerComposePreview | null {
  const compose = preview?.compose;
  if (!compose || typeof compose !== 'object') {
    return null;
  }

  const files = Array.isArray(compose.files)
    ? compose.files
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];
  const service =
    typeof compose.service === 'string' && compose.service.trim().length > 0
      ? compose.service.trim()
      : undefined;
  const writableFile =
    typeof compose.writableFile === 'string' && compose.writableFile.trim().length > 0
      ? compose.writableFile.trim()
      : undefined;
  const patch =
    typeof compose.patch === 'string' && compose.patch.trim().length > 0
      ? compose.patch
      : undefined;
  const willWrite = typeof compose.willWrite === 'boolean' ? compose.willWrite : undefined;

  const hasComposePreviewContent = [
    files.length > 0,
    service !== undefined,
    writableFile !== undefined,
    patch !== undefined,
    willWrite !== undefined,
  ].some(Boolean);

  if (!hasComposePreviewContent) {
    return null;
  }

  return {
    files,
    ...(service ? { service } : {}),
    ...(writableFile ? { writableFile } : {}),
    ...(willWrite !== undefined ? { willWrite } : {}),
    ...(patch ? { patch } : {}),
  };
}

async function runContainerPreviewState(args: {
  containerId: string | undefined;
  previewLoading: Ref<boolean>;
  previewError: Ref<string | null>;
  detailPreview: Ref<ContainerPreviewPayload | null>;
}) {
  if (!args.containerId || args.previewLoading.value) {
    return;
  }
  args.previewLoading.value = true;
  args.previewError.value = null;
  try {
    args.detailPreview.value = await previewContainer(args.containerId);
  } catch (e: unknown) {
    args.detailPreview.value = null;
    args.previewError.value = errorMessage(e, 'Failed to generate update preview');
  } finally {
    args.previewLoading.value = false;
  }
}

export function useContainerPreview(input: UseContainerPreviewInput) {
  const detailPreview = ref<ContainerPreviewPayload | null>(null);
  const detailComposePreview = computed<ContainerComposePreview | null>(() =>
    buildDetailComposePreview(detailPreview.value),
  );
  const previewLoading = ref(false);
  const previewError = ref<string | null>(null);

  function resetPreview() {
    detailPreview.value = null;
    previewError.value = null;
  }

  async function runContainerPreview() {
    await runContainerPreviewState({
      containerId: input.selectedContainerId.value,
      previewLoading,
      previewError,
      detailPreview,
    });
  }

  return {
    detailComposePreview,
    detailPreview,
    previewError,
    previewLoading,
    resetPreview,
    runContainerPreview,
  };
}
