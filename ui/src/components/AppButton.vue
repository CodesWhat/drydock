<script setup lang="ts">
import { computed, useAttrs } from 'vue';

type ButtonSize =
  | 'none'
  | 'xs'
  | 'compact'
  | 'sm'
  | 'md'
  | 'icon-xs'
  | 'icon-sm'
  | 'icon-md'
  | 'icon-lg';
type ButtonVariant =
  | 'muted'
  | 'outlined'
  | 'secondary'
  | 'elevated'
  | 'plain'
  | 'text-muted'
  | 'text-secondary'
  | 'link-secondary';
type ButtonWeight = 'none' | 'medium' | 'semibold' | 'bold';

const sizeClasses: Record<ButtonSize, string> = {
  none: '',
  xs: 'px-2 py-1 text-2xs',
  compact: 'px-2 py-1.5 text-2xs',
  sm: 'px-2.5 py-1.5 text-2xs',
  md: 'px-3 py-1.5 text-2xs-plus',
  'icon-xs': 'inline-flex items-center justify-center w-9 h-9',
  'icon-sm': 'inline-flex items-center justify-center w-10 h-10 text-2xs-plus',
  'icon-md': 'inline-flex items-center justify-center w-11 h-11 text-2xs-plus',
  'icon-lg': 'inline-flex items-center justify-center w-12 h-12 text-2xs-plus',
};

const variantClasses: Record<ButtonVariant, string> = {
  muted: 'dd-text-muted hover:dd-text hover:dd-bg-elevated',
  outlined: 'dd-bg-button dd-text hover:opacity-85',
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
    tooltip?: string | Record<string, unknown>;
    ariaLabel?: string;
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

const resolvedAriaLabel = computed(() => {
  if (props.ariaLabel) {
    return props.ariaLabel;
  }
  if (typeof props.tooltip === 'string') {
    return props.tooltip;
  }
  if (typeof attrs['aria-label'] === 'string') {
    return attrs['aria-label'];
  }
  return undefined;
});

const resolvedTitle = computed(() => {
  if (typeof props.tooltip === 'string') {
    return props.tooltip;
  }
  if (typeof attrs.title === 'string') {
    return attrs.title;
  }
  return undefined;
});

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
    v-tooltip="tooltip"
    :type="type"
    :aria-label="resolvedAriaLabel"
    :title="resolvedTitle"
    :class="buttonClasses"
  >
    <slot />
  </button>
</template>
