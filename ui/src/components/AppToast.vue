<script setup lang="ts">
import { useToast, type ToastTone } from '@/composables/useToast';
import AppIconButton from '@/components/AppIconButton.vue';

const { toasts, dismissToast } = useToast();

function toneStyles(tone: ToastTone) {
  switch (tone) {
    case 'error':
      return {
        bg: 'color-mix(in srgb, var(--dd-danger) 25%, var(--dd-bg-card))',
        border: 'var(--dd-danger)',
        text: 'var(--dd-danger)',
        iconName: 'warning',
      };
    case 'success':
      return {
        bg: 'color-mix(in srgb, var(--dd-success) 25%, var(--dd-bg-card))',
        border: 'var(--dd-success)',
        text: 'var(--dd-success)',
        iconName: 'up-to-date',
      };
    case 'warning':
      return {
        bg: 'color-mix(in srgb, var(--dd-warning) 25%, var(--dd-bg-card))',
        border: 'var(--dd-warning)',
        text: 'var(--dd-warning)',
        iconName: 'warning',
      };
    default:
      return {
        bg: 'color-mix(in srgb, var(--dd-primary) 25%, var(--dd-bg-card))',
        border: 'var(--dd-primary)',
        text: 'var(--dd-primary)',
        iconName: 'info',
      };
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed top-16 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-lg pointer-events-none">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="dd-rounded px-3 py-2.5 flex items-start gap-2.5 pointer-events-auto"
          :style="{
            backgroundColor: toneStyles(toast.tone).bg,
            border: `1px solid ${toneStyles(toast.tone).border}`,
            boxShadow: 'var(--dd-shadow-lg)',
          }">
          <AppIcon
            :name="toneStyles(toast.tone).iconName"
            :size="14"
            class="shrink-0 mt-0.5"
            :style="{ color: toneStyles(toast.tone).text }" />
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold" :style="{ color: toneStyles(toast.tone).text }">
              {{ toast.title }}
            </p>
            <p v-if="toast.body" class="text-2xs-plus mt-0.5" :style="{ color: 'var(--dd-text)' }">
              {{ toast.body }}
            </p>
          </div>
          <AppIconButton
            icon="xmark"
            size="xs"
            variant="plain"
            class="shrink-0 mt-0.5"
            :style="{ color: toneStyles(toast.tone).text }"
            aria-label="Dismiss"
            @click="dismissToast(toast.id)"
          />
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-1rem);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-0.5rem);
}
</style>
