<script setup lang="ts">
import AppButton from './AppButton.vue';
import AppIconButton from './AppIconButton.vue';

withDefaults(
  defineProps<{
    variant?: 'muted' | 'warning' | 'success';
    primaryDisabled?: boolean;
    menuDisabled?: boolean;
    menuOpen?: boolean;
    menuLabel: string;
    primaryClass?: string;
  }>(),
  { variant: 'success', primaryDisabled: false, menuDisabled: false, menuOpen: false },
);

defineEmits<{
  primary: [event: MouseEvent];
  menu: [event: MouseEvent];
}>();

const styles = {
  muted: { border: 'dd-border-strong', button: 'muted-subtle', open: 'dd-bg-elevated dd-text' },
  warning: { border: 'dd-border-warning', button: 'warning-subtle', open: 'brightness-125' },
  success: { border: 'dd-border-success', button: 'success-subtle', open: 'brightness-125' },
} as const;
</script>

<template>
  <div class="inline-flex dd-rounded overflow-hidden border" :class="styles[variant].border">
    <AppButton
      size="md"
      :variant="styles[variant].button"
      weight="bold"
      class="inline-flex items-center justify-center whitespace-nowrap transition-colors"
      :class="[primaryClass, primaryDisabled ? 'cursor-not-allowed' : '']"
      :disabled="primaryDisabled"
      @click.stop="$emit('primary', $event)"
      @keydown.enter.stop
      @keydown.space.stop
    >
      <slot />
    </AppButton>
    <AppIconButton
      icon="chevron-down"
      size="toolbar"
      :variant="styles[variant].button"
      class="transition-colors border-l"
      :class="[styles[variant].border, menuDisabled ? 'cursor-not-allowed' : menuOpen ? styles[variant].open : '']"
      :disabled="menuDisabled"
      :aria-label="menuLabel"
      @click.stop="$emit('menu', $event)"
      @keydown.enter.stop
      @keydown.space.stop
    />
  </div>
</template>
