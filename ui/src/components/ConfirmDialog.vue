<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useConfirmDialog } from '../composables/useConfirmDialog';

const { visible, current, accept, reject, dismiss } = useConfirmDialog();
const dialogTitleId = 'confirm-dialog-title';
const dialogDescriptionId = 'confirm-dialog-description';

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  if (tag === 'textarea') {
    return true;
  }
  if (tag !== 'input') {
    return false;
  }
  const input = target as HTMLInputElement;
  return input.type !== 'checkbox' && input.type !== 'radio' && input.type !== 'button';
}

function handleKeydown(e: KeyboardEvent) {
  if (!visible.value || !current.value) {
    return;
  }
  if (e.key === 'Escape') {
    dismiss();
    return;
  }
  if (
    e.key === 'Enter' &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.shiftKey &&
    !isTextEntryTarget(e.target)
  ) {
    e.preventDefault();
    void accept();
  }
}

onMounted(() => globalThis.addEventListener('keydown', handleKeydown));
onUnmounted(() => globalThis.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-fade">
      <div v-if="visible && current"
           class="fixed inset-0 z-overlay bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[20vh]"
           @pointerdown.self="dismiss">
        <div class="relative w-full max-w-[var(--dd-layout-dialog-max-width)] min-w-[var(--dd-layout-dialog-min-width)] mx-4 dd-rounded-lg overflow-hidden"
             role="dialog"
             aria-modal="true"
             :aria-labelledby="dialogTitleId"
             :aria-describedby="dialogDescriptionId"
               :style="{
                 backgroundColor: 'var(--dd-bg-card)',
                 border: '1px solid var(--dd-border-strong)',
                 boxShadow: 'var(--dd-shadow-modal)',
               }">
          <!-- Header -->
          <div class="px-5 pt-4 pb-3"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span :id="dialogTitleId" class="text-xs-plus font-semibold dd-text">{{ current.header }}</span>
          </div>

          <!-- Body -->
          <div :id="dialogDescriptionId" class="px-5 py-4.5 text-xs leading-relaxed dd-text-secondary">
            {{ current.message }}
          </div>

          <!-- Footer -->
          <div class="px-5 pt-3 pb-4.5 flex items-center justify-end gap-2.5">
            <AppButton size="none" variant="plain" weight="none"
              class="px-4 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors cursor-pointer"
              :aria-label="current.rejectLabel || 'Cancel'"
              :style="{
                backgroundColor: 'var(--dd-bg-inset)',
                border: '1px solid var(--dd-border-strong)',
                color: 'var(--dd-text)',
              }"
              @click="reject">
              {{ current.rejectLabel || 'Cancel' }}
            </AppButton>
            <AppButton size="none" variant="plain" weight="none"
              class="px-4 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
              :aria-label="current.acceptLabel || 'Confirm'"
              :style="current.severity === 'danger'
                ? {
                    backgroundColor: 'var(--dd-danger-muted)',
                    border: '1px solid var(--dd-danger)',
                    color: 'var(--dd-danger)',
                  }
                : {
                    backgroundColor: 'var(--dd-warning-muted)',
                    border: '1px solid var(--dd-warning)',
                    color: 'var(--dd-warning)',
                  }"
              @click="accept">
              {{ current.acceptLabel || 'Confirm' }}
            </AppButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity var(--dd-duration-fast) ease;
}
.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}
</style>
