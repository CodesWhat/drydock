<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import AppIcon from './AppIcon.vue';
import {
  iconButtonIconSizes,
  iconButtonSizeClasses,
  type IconButtonSize,
} from './appIconButtonSizes';
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
    href?: string;
    target?: string;
    rel?: string;
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

const variantClasses: Record<IconButtonVariant, string> = {
  muted: 'dd-text-muted hover:dd-text hover:dd-bg-elevated',
  secondary: 'dd-text-secondary hover:dd-text hover:dd-bg-elevated',
  danger: 'dd-text-muted hover:dd-text-danger hover:dd-bg-elevated',
  success: 'dd-text-muted hover:dd-text-success hover:dd-bg-elevated',
  plain: '',
};

const iconSize = computed(() => iconButtonIconSizes[props.size]);

const buttonClasses = computed(() => [
  'inline-flex items-center justify-center dd-rounded transition-colors min-w-8 min-h-8',
  iconButtonSizeClasses[props.size],
  variantClasses[props.variant],
  props.disabled ? 'opacity-40 cursor-not-allowed' : '',
]);

const resolvedAriaLabel = computed(
  () => props.ariaLabel || (typeof props.tooltip === 'string' ? props.tooltip : undefined),
);
</script>

<template>
  <a
    v-if="href"
    v-bind="attrs"
    v-tooltip="tooltip"
    :href="href"
    :target="target"
    :rel="rel"
    :aria-label="resolvedAriaLabel"
    :class="buttonClasses"
  >
    <AppIcon v-if="loading" name="spinner" :size="iconSize" class="dd-spin" />
    <AppIcon v-else :name="icon" :size="iconSize" />
  </a>
  <button
    v-else
    v-bind="attrs"
    v-tooltip="tooltip"
    type="button"
    :aria-label="resolvedAriaLabel"
    :disabled="disabled"
    :class="buttonClasses"
  >
    <AppIcon v-if="loading" name="spinner" :size="iconSize" class="dd-spin" />
    <AppIcon v-else :name="icon" :size="iconSize" />
  </button>
</template>
