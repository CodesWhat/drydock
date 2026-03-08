<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    disabled?: boolean;
    ariaLabel?: string;
    size?: 'sm' | 'md';
    onColor?: string;
    offColor?: string;
  }>(),
  {
    size: 'md',
    onColor: 'var(--dd-primary)',
    offColor: 'var(--dd-border-strong)',
  },
);

defineEmits<{
  'update:modelValue': [value: boolean];
}>();
</script>

<template>
  <button
    type="button"
    role="switch"
    :disabled="props.disabled"
    :aria-checked="String(props.modelValue)"
    :aria-label="props.ariaLabel"
    class="relative dd-rounded-lg transition-colors"
    :class="[
      props.size === 'sm' ? 'w-8 h-4' : 'w-10 h-5',
      props.disabled ? 'opacity-50 pointer-events-none' : '',
    ]"
    :style="{ backgroundColor: props.modelValue ? props.onColor : props.offColor }"
    @click="$emit('update:modelValue', !props.modelValue)"
  >
    <span
      class="absolute top-0.5 left-0.5 dd-rounded transition-transform"
      :class="[
        props.size === 'sm' ? 'w-3 h-3' : 'w-4 h-4',
        props.modelValue
          ? props.size === 'sm'
            ? 'translate-x-4'
            : 'translate-x-5'
          : 'translate-x-0',
      ]"
      :style="{ backgroundColor: 'var(--dd-bg)' }"
    />
  </button>
</template>
