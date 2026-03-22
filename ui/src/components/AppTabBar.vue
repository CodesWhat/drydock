<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';

interface Tab {
  id: string;
  label: string;
  icon?: string;
  count?: number;
  disabled?: boolean;
}

interface Props {
  tabs: Tab[];
  modelValue: string;
  size?: 'compact' | 'default';
  iconOnly?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'default',
  iconOnly: false,
});

defineEmits<{
  'update:modelValue': [id: string];
}>();

const sizeClasses = computed(() =>
  props.size === 'compact'
    ? 'px-2 py-1.5 text-2xs font-semibold uppercase tracking-wide'
    : 'px-3 py-2 text-2xs-plus font-semibold uppercase tracking-wide',
);

const iconSize = computed(() => (props.size === 'compact' ? 10 : 12));

const countStyle = {
  backgroundColor: 'var(--dd-neutral-muted)',
  color: 'var(--dd-neutral)',
};
</script>

<template>
  <div class="flex items-center gap-1 border-b" :style="{ borderColor: 'var(--dd-border)' }">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      :disabled="tab.disabled"
      v-tooltip="iconOnly ? tab.label : undefined"
      class="relative transition-colors"
      :class="[
        sizeClasses,
        tab.id === modelValue ? 'dd-text' : 'dd-text-muted hover:dd-text',
        tab.disabled && 'opacity-40 cursor-not-allowed',
      ]"
      @click="!tab.disabled && $emit('update:modelValue', tab.id)"
    >
      <span class="inline-flex items-center">
        <AppIcon v-if="tab.icon" :name="tab.icon" :size="iconSize" :class="!iconOnly && 'mr-1.5'" />
        <span v-if="!iconOnly">{{ tab.label }}</span>
        <span
          v-if="tab.count != null"
          class="ml-1.5 badge text-4xs font-bold px-1.5 py-0"
          :style="countStyle"
        >
          {{ tab.count }}
        </span>
      </span>
      <div
        v-if="tab.id === modelValue"
        class="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full"
        style="background-color: var(--color-drydock-secondary)"
      />
    </button>
  </div>
</template>
