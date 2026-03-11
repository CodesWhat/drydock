<script setup lang="ts">
import { useAttrs } from 'vue';

defineProps<{
  title: string;
  icon?: string;
  dismissLabel?: string;
  permanentDismissLabel?: string;
}>();

defineEmits<{
  dismiss: [];
  'dismiss-permanent': [];
}>();

const attrs = useAttrs();
const testIdPrefix = attrs['data-testid'] as string | undefined;
</script>

<template>
  <div
    class="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-5xl dd-rounded px-3 py-2.5 flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between"
    :style="{
      backgroundColor: 'color-mix(in srgb, var(--dd-warning) 25%, var(--dd-bg-card))',
      border: '1px solid var(--dd-warning)',
      boxShadow: 'var(--dd-shadow-lg)',
    }">
    <div class="flex items-start gap-2.5 min-w-0">
      <AppIcon :name="icon ?? 'warning'" :size="14" class="shrink-0 mt-0.5" :style="{ color: 'var(--dd-warning)' }" />
      <div class="min-w-0">
        <p class="text-xs font-semibold" :style="{ color: 'var(--dd-warning)' }">
          {{ title }}
        </p>
        <p class="text-[0.6875rem] mt-0.5" :style="{ color: 'var(--dd-text)' }">
          <slot />
        </p>
      </div>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <button
        :data-testid="testIdPrefix ? `${testIdPrefix}-dismiss-session` : undefined"
        class="text-[0.6875rem] px-2.5 py-1.5 dd-rounded transition-colors"
        :style="{
          border: '1px solid var(--dd-warning)',
          color: 'var(--dd-warning)',
          backgroundColor: 'transparent',
        }"
        @click="$emit('dismiss')">
        {{ dismissLabel ?? 'Dismiss' }}
      </button>
      <button
        v-if="permanentDismissLabel !== undefined"
        :data-testid="testIdPrefix ? `${testIdPrefix}-dismiss-forever` : undefined"
        class="text-[0.6875rem] px-2.5 py-1.5 dd-rounded transition-colors"
        :style="{
          border: '1px solid var(--dd-warning)',
          color: 'var(--dd-bg)',
          backgroundColor: 'var(--dd-warning)',
        }"
        @click="$emit('dismiss-permanent')">
        {{ permanentDismissLabel }}
      </button>
    </div>
  </div>
</template>
