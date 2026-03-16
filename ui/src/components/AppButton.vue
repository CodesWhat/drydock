<script setup lang="ts">
import { computed, useAttrs } from 'vue';

type ButtonSize = 'none' | 'xs' | 'compact' | 'sm' | 'md' | 'icon-xs' | 'icon-sm';
type ButtonVariant =
  | 'muted'
  | 'secondary'
  | 'elevated'
  | 'plain'
  | 'text-muted'
  | 'text-secondary'
  | 'link-secondary';
type ButtonWeight = 'none' | 'medium' | 'semibold' | 'bold';

const sizeClasses: Record<ButtonSize, string> = {
  none: '',
  xs: 'px-2 py-1 text-[0.625rem]',
  compact: 'px-2 py-1.5 text-[0.625rem]',
  sm: 'px-2.5 py-1.5 text-[0.625rem]',
  md: 'px-3 py-1.5 text-[0.6875rem]',
  'icon-xs': 'inline-flex items-center justify-center w-4 h-4',
  'icon-sm': 'inline-flex items-center justify-center w-7 h-7 text-[0.6875rem]',
};

const variantClasses: Record<ButtonVariant, string> = {
  muted: 'dd-text-muted hover:dd-text hover:dd-bg-elevated',
  secondary: 'dd-text-secondary hover:dd-text hover:dd-bg-elevated',
  elevated: 'dd-bg-elevated dd-text hover:opacity-90',
  'text-muted': 'dd-text-muted hover:dd-text',
  'text-secondary': 'dd-text-secondary hover:dd-text',
  'link-secondary': 'text-drydock-secondary hover:underline',
  plain: '',
};

const weightClasses: Record<ButtonWeight, string> = {
  none: '',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
};

const props = withDefaults(
  defineProps<{
    size?: ButtonSize;
    variant?: ButtonVariant;
    weight?: ButtonWeight;
    type?: 'button' | 'submit' | 'reset';
  }>(),
  {
    size: 'md',
    variant: 'muted',
    weight: 'semibold',
    type: 'button',
  },
);

defineOptions({
  inheritAttrs: false,
});

const attrs = useAttrs();

const buttonClasses = computed(() => [
  'dd-rounded transition-colors',
  sizeClasses[props.size],
  weightClasses[props.weight],
  variantClasses[props.variant],
]);
</script>

<template>
  <button
    v-bind="attrs"
    :type="type"
    :class="buttonClasses"
  >
    <slot />
  </button>
</template>
