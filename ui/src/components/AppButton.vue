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
  | 'link-secondary'
  | 'text-danger'
  | 'text-success'
  | 'text-warning'
  | 'text-info'
  | 'danger'
  | 'success'
  | 'warning'
  | 'muted-subtle'
  | 'danger-subtle'
  | 'success-subtle'
  | 'warning-subtle'
  | 'info-subtle';
type ButtonWeight = 'none' | 'medium' | 'semibold' | 'bold';

const sizeClasses: Record<ButtonSize, string> = {
  none: '',
  xs: 'px-2 py-1 dd-text-button-sm',
  compact: 'px-2 py-1.5 dd-text-button-sm',
  sm: 'px-2.5 py-1.5 dd-text-button-sm',
  md: 'px-3 py-1.5 dd-text-button',
  'icon-xs': 'inline-flex items-center justify-center w-9 h-9',
  'icon-sm': 'inline-flex items-center justify-center w-10 h-10 dd-text-button',
  'icon-md': 'inline-flex items-center justify-center w-11 h-11 dd-text-button',
  'icon-lg': 'inline-flex items-center justify-center w-12 h-12 dd-text-button',
};

const variantClasses: Record<ButtonVariant, string> = {
  muted: 'dd-text-muted hover:dd-text hover:dd-bg-elevated',
  outlined: 'dd-bg-button dd-text hover:opacity-85',
  secondary: 'dd-text-secondary hover:dd-text hover:dd-bg-elevated',
  elevated: 'dd-bg-elevated dd-text hover:opacity-90',
  'text-muted': 'dd-text-muted hover:dd-text',
  'text-secondary': 'dd-text-secondary hover:dd-text',
  'link-secondary': 'text-drydock-secondary hover:underline',
  'text-danger': 'dd-text-danger hover:opacity-85',
  'text-success': 'dd-text-success hover:opacity-85',
  'text-warning': 'dd-text-warning hover:opacity-85',
  'text-info': 'dd-text-info hover:opacity-85',
  danger: 'border dd-border-danger dd-bg-danger-muted dd-text-danger hover:opacity-90',
  success: 'border dd-border-success dd-bg-success-muted dd-text-success hover:opacity-90',
  warning: 'border dd-border-warning dd-bg-warning-muted dd-text-warning hover:opacity-90',
  'muted-subtle': 'dd-bg-button dd-text-muted hover:opacity-90',
  'danger-subtle': 'dd-bg-danger-muted dd-text-danger hover:opacity-90',
  'success-subtle': 'dd-bg-success-muted dd-text-success hover:opacity-90',
  'warning-subtle': 'dd-bg-warning-muted dd-text-warning hover:opacity-90',
  'info-subtle': 'dd-bg-info-muted dd-text-info hover:opacity-90',
  plain: '',
};

const disabledVariantClasses: Record<ButtonVariant, string> = {
  muted: 'dd-text-muted',
  outlined: 'dd-bg-button dd-text',
  secondary: 'dd-text-secondary',
  elevated: 'dd-bg-elevated dd-text',
  'text-muted': 'dd-text-muted',
  'text-secondary': 'dd-text-secondary',
  'link-secondary': 'text-drydock-secondary',
  'text-danger': 'dd-text-danger',
  'text-success': 'dd-text-success',
  'text-warning': 'dd-text-warning',
  'text-info': 'dd-text-info',
  danger: 'border dd-border-danger dd-bg-danger-muted dd-text-danger',
  success: 'border dd-border-success dd-bg-success-muted dd-text-success',
  warning: 'border dd-border-warning dd-bg-warning-muted dd-text-warning',
  'muted-subtle': 'dd-bg-button dd-text-muted',
  'danger-subtle': 'dd-bg-danger-muted dd-text-danger',
  'success-subtle': 'dd-bg-success-muted dd-text-success',
  'warning-subtle': 'dd-bg-warning-muted dd-text-warning',
  'info-subtle': 'dd-bg-info-muted dd-text-info',
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

const isDisabled = computed(() => {
  const disabled = attrs.disabled;
  return disabled === '' || disabled === true || disabled === 'true' || disabled === 'disabled';
});

const buttonClasses = computed(() => [
  'dd-rounded transition-colors disabled:cursor-not-allowed disabled:opacity-60',
  sizeClasses[props.size],
  weightClasses[props.weight],
  isDisabled.value ? disabledVariantClasses[props.variant] : variantClasses[props.variant],
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
