<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFocusTrap } from '../composables/useFocusTrap';
import { useShortcutsOverlay } from '../composables/useShortcutsOverlay';

const { t } = useI18n();

const { visible, close } = useShortcutsOverlay();
const dialogTitleId = 'keyboard-shortcuts-title';
const dialogRef = ref<HTMLElement | null>(null);

useFocusTrap(dialogRef, visible);

const shortcuts = computed(() => [
  { keys: ['/'], description: t('appShell.layout.shortcuts.focusSearch') },
  { keys: ['Esc'], description: t('appShell.layout.shortcuts.closeSearch') },
  { keys: ['?'], description: t('appShell.layout.shortcuts.showHelp') },
  { keys: ['⌘', 'K'], description: t('appShell.layout.shortcuts.toggleSearch') },
]);
</script>

<template>
  <Teleport to="body">
    <Transition name="shortcuts-fade">
      <div v-if="visible"
           class="fixed inset-0 z-overlay bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[20vh]"
           @pointerdown.self="close">
        <div ref="dialogRef"
             class="relative w-full max-w-[var(--dd-layout-dialog-max-width)] min-w-[var(--dd-layout-dialog-min-width)] mx-4 dd-rounded-lg overflow-hidden"
             data-test="keyboard-shortcuts-overlay"
             role="dialog"
             tabindex="-1"
             aria-modal="true"
             :aria-labelledby="dialogTitleId"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
               boxShadow: 'var(--dd-shadow-modal)',
             }">
          <!-- Header -->
          <div class="px-5 pt-4 pb-3"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span :id="dialogTitleId" class="text-xs-plus font-semibold dd-text">{{ t('appShell.layout.shortcuts.title') }}</span>
          </div>

          <!-- Body -->
          <div class="px-5 py-4.5 flex flex-col gap-2.5">
            <div v-for="shortcut in shortcuts" :key="shortcut.description"
                 class="flex items-center justify-between gap-4 text-xs dd-text-secondary">
              <span>{{ shortcut.description }}</span>
              <span class="flex items-center gap-1 shrink-0">
                <kbd v-for="key in shortcut.keys" :key="key"
                     class="px-1.5 py-0.5 dd-rounded-sm text-2xs font-medium dd-text-secondary" style="background: var(--dd-border);">
                  {{ key }}
                </kbd>
              </span>
            </div>
          </div>

          <!-- Footer -->
          <div class="px-5 pt-3 pb-4.5 flex items-center justify-end"
               :style="{ borderTop: '1px solid var(--dd-border)' }">
            <AppButton size="none" variant="plain" weight="none"
              class="px-4 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors cursor-pointer"
              data-test="keyboard-shortcuts-close"
              :aria-label="t('appShell.layout.shortcuts.close')"
              :style="{
                backgroundColor: 'var(--dd-bg-inset)',
                border: '1px solid var(--dd-border-strong)',
                color: 'var(--dd-text)',
              }"
              @click="close">
              {{ t('appShell.layout.shortcuts.close') }}
            </AppButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.shortcuts-fade-enter-active,
.shortcuts-fade-leave-active {
  transition: opacity var(--dd-duration-fast) ease;
}
.shortcuts-fade-enter-from,
.shortcuts-fade-leave-to {
  opacity: 0;
}
</style>
