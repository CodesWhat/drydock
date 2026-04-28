<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getContainerUpdateStartedMessage } from '../../utils/container-update';
import { updateContainer as apiUpdateContainer } from '../../services/container-actions';
import { errorMessage } from '../../utils/error';

const { t } = useI18n();

const props = defineProps<{
  containerId: string | null;
  containerName?: string;
  currentTag?: string;
  newTag?: string;
  updateKind?: 'major' | 'minor' | 'patch' | 'digest' | null;
}>();

const emit = defineEmits<{
  'update:containerId': [value: string | null];
  updated: [containerId: string];
}>();

const inProgress = ref(false);
const actionError = ref<string | null>(null);

const isOpen = computed(() => props.containerId !== null);

const confirmMessage = computed(() => {
  const name = props.containerName ?? props.containerId ?? 'this container';
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
  inProgress.value = true;
  actionError.value = null;
  try {
    await apiUpdateContainer(id);
    const name = props.containerName ?? id;
    emit('updated', id);
    emit('update:containerId', null);
    // Show a simple console diagnostic for callers that don't handle the event
    getContainerUpdateStartedMessage(name);
  } catch (caught: unknown) {
    actionError.value = errorMessage(caught, 'Update failed');
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
            v-if="actionError"
            class="px-5 pb-2 text-2xs"
            :style="{ color: 'var(--dd-danger)' }">
            {{ actionError }}
          </div>
          <div class="px-5 pt-3 pb-4.5 flex items-center justify-end gap-2.5">
            <AppButton
              size="none"
              variant="plain"
              weight="none"
              class="px-4 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors cursor-pointer"
              :style="{
                backgroundColor: 'var(--dd-bg-inset)',
                border: '1px solid var(--dd-border-strong)',
                color: 'var(--dd-text)',
              }"
              :disabled="inProgress"
              @click="close">
              {{ t('common.cancel') }}
            </AppButton>
            <AppButton
              size="none"
              variant="plain"
              weight="none"
              class="px-4 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
              :style="{
                backgroundColor: 'var(--dd-warning-muted)',
                border: '1px solid var(--dd-warning)',
                color: 'var(--dd-warning)',
              }"
              :disabled="inProgress"
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
