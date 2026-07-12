<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from '../../composables/useToast';
import { useUpdateMode } from '../../composables/useUpdateMode';
import {
  getContainerAlreadyUpToDateMessage,
  getContainerUpdateStartedMessage,
  isStaleContainerUpdateError,
  runContainerUpdateRequest,
} from '../../utils/container-update';
import { updateContainer as apiUpdateContainer } from '../../services/container-actions';
import { errorMessage } from '../../utils/error';
import type { UpdateEligibility } from '../../types/container';
import { getPrimaryHardBlocker } from '../../utils/update-eligibility';

const { t } = useI18n();
const toast = useToast();
const { updateMode } = useUpdateMode();

const props = defineProps<{
  containerId: string | null;
  containerName?: string;
  currentTag?: string;
  newTag?: string;
  updateKind?: 'major' | 'minor' | 'patch' | 'digest' | null;
  updateEligibility?: UpdateEligibility;
}>();

const emit = defineEmits<{
  'update:containerId': [value: string | null];
  updated: [containerId: string];
}>();

const inProgress = ref(false);
const actionError = ref<string | null>(null);

const isOpen = computed(() => props.containerId !== null);
const hardBlocker = computed(() => getPrimaryHardBlocker(props.updateEligibility));
const managedUpdatesAllowed = computed(() => updateMode.value !== 'notify');
const updateBlocked = computed(
  () => !managedUpdatesAllowed.value || hardBlocker.value !== undefined,
);

const confirmMessage = computed(() => {
  const name =
    props.containerName ?? props.containerId ?? t('containerComponents.updateDialog.thisContainer');
  if (props.currentTag && props.newTag) {
    const isTagChange = props.updateKind !== 'digest';
    if (isTagChange) {
      const kind = props.updateKind ? ` (${props.updateKind})` : '';
      return t('containerComponents.updateDialog.confirmTagChange', {
        name,
        currentTag: props.currentTag,
        newTag: props.newTag,
        kind,
      });
    }
    return t('containerComponents.updateDialog.confirmDigestChange', {
      name,
      currentTag: props.currentTag,
    });
  }
  return t('containerComponents.updateDialog.confirmLatest', { name });
});

watch(
  () => props.containerId,
  () => {
    actionError.value = null;
    inProgress.value = false;
  },
);

function close() {
  emit('update:containerId', null);
}

async function confirm() {
  const id = props.containerId;
  if (!id || inProgress.value) {
    return;
  }
  if (!managedUpdatesAllowed.value) {
    actionError.value = t('containerComponents.updateStatus.summary.notify');
    toast.warning(actionError.value);
    return;
  }
  if (hardBlocker.value) {
    actionError.value = hardBlocker.value.message;
    toast.warning(hardBlocker.value.message);
    return;
  }
  inProgress.value = true;
  actionError.value = null;
  const name = props.containerName ?? id;
  try {
    const result = await runContainerUpdateRequest({
      request: async () => {
        await apiUpdateContainer(id);
      },
      isStaleError: isStaleContainerUpdateError,
    });
    if (result === 'stale') {
      toast.info(getContainerAlreadyUpToDateMessage(name, t));
      emit('update:containerId', null);
      return;
    }
    toast.success(getContainerUpdateStartedMessage(name, t));
    emit('updated', id);
    emit('update:containerId', null);
  } catch (caught: unknown) {
    actionError.value = errorMessage(caught, t('containerComponents.updateDialog.updateFailed'));
    toast.error(t('containersView.toast.updateFailed', { name }), actionError.value);
  } finally {
    inProgress.value = false;
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (!isOpen.value) {
    return;
  }
  if (e.key === 'Escape') {
    close();
    return;
  }
  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    void confirm();
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="container-update-dialog-fade">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-overlay bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[20vh]"
        @pointerdown.self="close"
        @keydown="handleKeydown">
        <div
          class="relative w-full max-w-[var(--dd-layout-dialog-max-width)] min-w-[var(--dd-layout-dialog-min-width)] mx-4 dd-rounded-lg overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="container-update-dialog-title"
          aria-describedby="container-update-dialog-desc"
          :style="{
            backgroundColor: 'var(--dd-bg-card)',
            border: '1px solid var(--dd-border-strong)',
            boxShadow: 'var(--dd-shadow-modal)',
          }">
          <div class="px-5 pt-4 pb-3" :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span id="container-update-dialog-title" class="text-xs-plus font-semibold dd-text">{{ t('containerComponents.updateDialog.title') }}</span>
          </div>
          <div id="container-update-dialog-desc" class="px-5 py-4.5 text-xs leading-relaxed dd-text-secondary">
            {{ confirmMessage }}
          </div>
          <div
            v-if="hardBlocker"
            class="px-5 pb-2 text-2xs"
            :style="{ color: 'var(--dd-danger)' }">
            {{ hardBlocker.message }}
          </div>
          <div
            v-if="actionError"
            class="px-5 pb-2 text-2xs"
            :style="{ color: 'var(--dd-danger)' }">
            {{ actionError }}
          </div>
          <div class="px-5 pt-3 pb-4.5 flex items-center justify-end gap-2.5">
            <AppButton
              size="md"
              variant="outlined"
              weight="semibold"
              class="cursor-pointer"
              :disabled="inProgress"
              @click="close">
              {{ t('common.cancel') }}
            </AppButton>
            <AppButton
              size="md"
              variant="warning"
              weight="semibold"
              class="flex items-center gap-1.5 cursor-pointer"
              :disabled="inProgress || updateBlocked"
              @click="confirm">
              <AppIcon v-if="inProgress" name="restart" :size="11" class="animate-spin" />
              {{ inProgress ? t('containerComponents.updateDialog.updating') : t('containerComponents.updateDialog.update') }}
            </AppButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.container-update-dialog-fade-enter-active,
.container-update-dialog-fade-leave-active {
  transition: opacity var(--dd-duration-fast) ease;
}
.container-update-dialog-fade-enter-from,
.container-update-dialog-fade-leave-to {
  opacity: 0;
}
</style>
