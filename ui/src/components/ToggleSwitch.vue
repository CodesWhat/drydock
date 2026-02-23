<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  disabled?: boolean;
}>();

defineEmits<{
  'update:modelValue': [value: boolean];
}>();
</script>

<template>
  <button
    type="button"
    class="relative w-10 h-5 dd-rounded-lg transition-colors"
    :class="disabled ? 'opacity-50 pointer-events-none' : ''"
    :style="{ backgroundColor: modelValue ? 'var(--dd-primary)' : 'var(--dd-border-strong)' }"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <span
      class="absolute top-0.5 left-0.5 w-4 h-4 bg-white dd-rounded transition-transform"
      :class="modelValue ? 'translate-x-5' : 'translate-x-0'"
    />
  </button>
</template>
