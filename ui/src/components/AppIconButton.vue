<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import AppIcon from './AppIcon.vue';

type IconButtonSize = 'toolbar' | 'xs' | 'sm' | 'md' | 'lg';
type IconButtonVariant = 'muted' | 'secondary' | 'danger' | 'success' | 'plain';

const props = withDefaults(
  defineProps<{
    icon: string;
    size?: IconButtonSize;
    variant?: IconButtonVariant;
    disabled?: boolean;
    loading?: boolean;
    tooltip?: string | Record<string, unknown>;
    ariaLabel?: string;
  }>(),
  {
    size: 'sm',
    variant: 'muted',
    disabled: false,
    loading: false,
  },
);

defineOptions({
  inheritAttrs: false,
});

const attrs = useAttrs();

const sizeClasses: Record<IconButtonSize, string> = {
  toolbar: 'w-8 h-8', // 32px — dense bars
  xs: 'w-10 h-10', // 40px — compact interactive
  sm: 'w-11 h-11', // 44px — WCAG 2.5.8 minimum (default)
  md: 'w-12 h-12', // 48px — Material Design
  lg: 'w-14 h-14', // 56px — prominent actions
};

const iconSizes: Record<IconButtonSize, number> = {
  toolbar: 15,
  xs: 16,
  sm: 18,
  md: 20,
  lg: 24,
};

const variantClasses: Record<IconButtonVariant, string> = {
  muted: 'dd-text-muted hover:dd-text hover:dd-bg-elevated',
  secondary: 'dd-text-secondary hover:dd-text hover:dd-bg-elevated',
  danger: 'dd-text-muted hover:dd-text-danger hover:dd-bg-elevated',
  success: 'dd-text-muted hover:dd-text-success hover:dd-bg-elevated',
  plain: '',
};

const iconSize = computed(() => iconSizes[props.size]);

const buttonClasses = computed(() => [
  'inline-flex items-center justify-center dd-rounded transition-colors',
  sizeClasses[props.size],
  variantClasses[props.variant],
  props.disabled ? 'opacity-40 cursor-not-allowed' : '',
]);
</script>

<template>
  <button
    v-bind="attrs"
    v-tooltip="tooltip"
    type="button"
    :aria-label="ariaLabel || (typeof tooltip === 'string' ? tooltip : undefined)"
    :disabled="disabled"
    :class="buttonClasses"
  >
    <AppIcon v-if="loading" name="spinner" :size="iconSize" class="dd-spin" />
    <AppIcon v-else :name="icon" :size="iconSize" />
  </button>
</template>
