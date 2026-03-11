<script setup lang="ts">
import type { StyleValue } from 'vue';

const props = withDefaults(
  defineProps<{
    entries: unknown[];
    loading: boolean;
    error?: string;
    emptyMessage?: string;
    loadingMessage?: string;
    panelClass?: string;
    panelStyle?: StyleValue;
    containerClass?: string;
    containerStyle?: StyleValue;
    loadingClass?: string;
    errorClass?: string;
    errorStyle?: StyleValue;
    emptyClass?: string;
  }>(),
  {
    error: '',
    emptyMessage: 'No log entries found.',
    loadingMessage: 'Loading logs...',
    panelClass: '',
    panelStyle: undefined,
    containerClass: '',
    containerStyle: undefined,
    loadingClass: 'text-xs dd-text-muted text-center py-6',
    errorClass: 'text-[0.6875rem] px-3 py-2 dd-rounded',
    errorStyle: () => ({
      backgroundColor: 'var(--dd-danger-muted)',
      color: 'var(--dd-danger)',
    }),
    emptyClass: 'px-3 py-4 dd-text-muted text-center',
  },
);

const emit = defineEmits<{
  (e: 'scroll'): void;
  (e: 'container-ready', element: HTMLElement | null): void;
}>();

function setContainer(element: Element | null) {
  emit('container-ready', element as HTMLElement | null);
}
</script>

<template>
  <div class="flex flex-col min-h-0">
    <slot name="controls" />
    <slot name="meta" />

    <div class="flex-1 min-h-0 flex flex-col overflow-hidden" :class="props.panelClass" :style="props.panelStyle">
      <div v-if="props.loading" :class="props.loadingClass">
        {{ props.loadingMessage }}
      </div>

      <div v-else-if="props.error" :class="props.errorClass" :style="props.errorStyle">
        {{ props.error }}
      </div>

      <div
        v-else
        :ref="setContainer"
        class="flex-1 overflow-y-auto"
        :class="props.containerClass"
        :style="props.containerStyle"
        @scroll="emit('scroll')"
      >
        <div v-if="props.entries.length === 0" :class="props.emptyClass">
          {{ props.emptyMessage }}
        </div>

        <div v-else>
          <slot
            v-for="(entry, index) in props.entries"
            :key="index"
            name="entry"
            :entry="entry"
            :index="index"
          />
        </div>
      </div>

      <slot name="footer" />
    </div>
  </div>
</template>
