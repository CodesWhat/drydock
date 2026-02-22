<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useConfirmDialog } from '../composables/useConfirmDialog';

const { visible, current, accept, reject, dismiss } = useConfirmDialog();

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && visible.value) {
    dismiss();
  }
}

onMounted(() => globalThis.addEventListener('keydown', handleKeydown));
onUnmounted(() => globalThis.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-fade">
      <div v-if="visible && current"
           class="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[20vh]"
           @pointerdown.self="dismiss">
        <div class="relative w-full max-w-[420px] min-w-[340px] mx-4 dd-rounded-lg overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
               boxShadow: '0 16px 48px rgba(0, 0, 0, 0.3)',
             }">
          <!-- Header -->
          <div class="px-5 pt-4 pb-3"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-[13px] font-semibold dd-text">{{ current.header }}</span>
          </div>

          <!-- Body -->
          <div class="px-5 py-4.5 text-[12px] leading-relaxed dd-text-secondary">
            {{ current.message }}
          </div>

          <!-- Footer -->
          <div class="px-5 pt-3 pb-4.5 flex items-center justify-end gap-2.5">
            <button
              class="px-4 py-1.5 dd-rounded text-[11px] font-semibold transition-colors"
              :style="{
                backgroundColor: 'var(--dd-bg-inset)',
                border: '1px solid var(--dd-border-strong)',
                color: 'var(--dd-text)',
              }"
              @click="reject">
              {{ current.rejectLabel || 'Cancel' }}
            </button>
            <button
              class="px-4 py-1.5 dd-rounded text-[11px] font-semibold transition-colors"
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
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity 0.15s ease;
}
.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}
</style>
