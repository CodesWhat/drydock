import { computed, type Ref, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from '../../composables/useToast';
import type {
  ContainerComposePreview,
  ContainerPreviewPayload,
  PreviewErrorAction,
} from '../../services/preview';
import { previewContainer } from '../../services/preview';
import { errorMessage } from '../../utils/error';

interface UseContainerPreviewInput {
  selectedContainerId: Readonly<Ref<string | undefined>>;
}

type PreviewErrorActionPresentation = PreviewErrorAction & { label: string };

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
  containerId: string;
  previewLoading: Ref<boolean>;
  previewError: Ref<string | null>;
  previewErrorAction: Ref<PreviewErrorActionPresentation | null>;
  detailPreview: Ref<ContainerPreviewPayload | null>;
  t: (key: string) => string;
  isCurrentRequest: () => boolean;
}) {
  args.previewLoading.value = true;
  args.previewError.value = null;
  args.previewErrorAction.value = null;
  try {
    const preview = await previewContainer(args.containerId);
    if (!args.isCurrentRequest()) {
      return;
    }
    args.detailPreview.value = preview;
  } catch (e: unknown) {
    if (!args.isCurrentRequest()) {
      return;
    }
    args.detailPreview.value = null;
    const msg = errorMessage(e, args.t('containerComponents.preview.toasts.failedDetail'));
    args.previewError.value = msg;
    if (e && typeof e === 'object' && 'action' in e) {
      const action = (e as { action?: unknown }).action;
      if (
        action &&
        typeof action === 'object' &&
        'code' in action &&
        'href' in action &&
        ((action.code === 'open-registry-settings' && action.href === '/registries') ||
          (action.code === 'open-trigger-settings' && action.href === '/triggers'))
      ) {
        const labelKey =
          action.code === 'open-registry-settings'
            ? 'containerComponents.preview.actions.openRegistrySettings'
            : 'containerComponents.preview.actions.openTriggerSettings';
        args.previewErrorAction.value = {
          code: action.code,
          label: args.t(labelKey),
          href: action.href,
        };
      }
    }
    const toast = useToast();
    toast.error(args.t('containerComponents.preview.toasts.failedTitle'), msg);
  } finally {
    if (args.isCurrentRequest()) {
      args.previewLoading.value = false;
    }
  }
}

export function useContainerPreview(input: UseContainerPreviewInput) {
  const { t } = useI18n();
  const detailPreview = ref<ContainerPreviewPayload | null>(null);
  const detailComposePreview = computed<ContainerComposePreview | null>(() =>
    buildDetailComposePreview(detailPreview.value),
  );
  const previewLoading = ref(false);
  const previewError = ref<string | null>(null);
  const previewErrorAction = ref<PreviewErrorActionPresentation | null>(null);
  let previewRequestGeneration = 0;
  let previewRequestContainerId: string | undefined;

  function resetPreview() {
    previewRequestGeneration += 1;
    previewRequestContainerId = undefined;
    previewLoading.value = false;
    detailPreview.value = null;
    previewError.value = null;
    previewErrorAction.value = null;
  }

  async function runContainerPreview() {
    const containerId = input.selectedContainerId.value;
    if (
      !containerId ||
      (previewLoading.value &&
        (previewRequestContainerId === undefined || previewRequestContainerId === containerId))
    ) {
      return;
    }
    const requestGeneration = ++previewRequestGeneration;
    previewRequestContainerId = containerId;
    await runContainerPreviewState({
      containerId,
      previewLoading,
      previewError,
      previewErrorAction,
      detailPreview,
      t,
      isCurrentRequest: () =>
        requestGeneration === previewRequestGeneration &&
        input.selectedContainerId.value === containerId,
    });
    if (requestGeneration === previewRequestGeneration) {
      previewRequestContainerId = undefined;
    }
  }

  return {
    detailComposePreview,
    detailPreview,
    previewError,
    previewErrorAction,
    previewLoading,
    resetPreview,
    runContainerPreview,
  };
}
