<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import AppIconButton from './AppIconButton.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    isMobile: boolean;
    size?: 'sm' | 'md' | 'lg';
    showSizeControls?: boolean;
    showFullPage?: boolean;
  }>(),
  {
    size: 'sm',
    showSizeControls: true,
    showFullPage: false,
  },
);

const emit = defineEmits<{
  'update:open': [val: boolean];
  'update:size': [size: 'sm' | 'md' | 'lg'];
  'full-page': [];
}>();

const panelDesktopWidth = computed(() =>
  props.size === 'sm'
    ? 'var(--dd-layout-panel-width-sm)'
    : props.size === 'md'
      ? 'var(--dd-layout-panel-width-md)'
      : 'var(--dd-layout-panel-width-lg)',
);

function closePanel() {
  emit('update:open', false);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !props.open) {
    return;
  }
  event.preventDefault();
  closePanel();
}

onMounted(() => globalThis.addEventListener('keydown', handleKeydown));
onUnmounted(() => globalThis.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <!-- Mobile overlay -->
  <div v-if="open && isMobile"
       class="fixed inset-0 bg-black/50 z-40"
       @click="closePanel" />

  <!-- Panel -->
  <aside v-if="open"
         role="dialog"
         :aria-modal="isMobile ? 'true' : undefined"
         aria-label="Detail panel"
         class="detail-panel-inline flex flex-col min-w-0 overflow-clip transition-[flex-basis,width,max-width,color,background-color,border-color,opacity,transform,box-shadow] duration-300 ease-in-out"
         :class="isMobile ? 'fixed top-0 right-0 h-full z-50 dd-rounded' : 'sticky top-0 mt-4 sm:mt-6 mr-[15px]'"
         :style="{
           flex: isMobile ? undefined : `0 0 ${panelDesktopWidth}`,
           width: isMobile ? '100%' : panelDesktopWidth,
           maxWidth: isMobile ? '100%' : 'min(calc(100vw - 32px), 920px)',
           backgroundColor: 'var(--dd-bg-card)',
           height: isMobile ? '100vh' : 'calc(100vh - var(--dd-layout-main-viewport-offset) - 1.5rem)',
           minHeight: '480px',
           borderTopLeftRadius: 'var(--dd-radius)',
           borderTopRightRadius: 'var(--dd-radius)',
           borderBottomLeftRadius: isMobile ? undefined : '0',
           borderBottomRightRadius: isMobile ? undefined : '0',
         }">

    <!-- Panel toolbar: size + full page + close -->
    <div class="shrink-0 px-4 py-2.5 flex items-center justify-between"
         :style="{ borderBottom: '1px solid var(--dd-border)' }">
      <div class="flex items-center gap-2">
        <div v-if="(showSizeControls && !isMobile) || showFullPage" class="flex items-center dd-rounded overflow-hidden">
          <AppIconButton v-if="showFullPage"
                  icon="frame-corners" size="toolbar" variant="muted"
                  tooltip="Open full page view"
                  @click="$emit('full-page')" />
          <AppButton size="none" variant="plain" weight="none" v-if="showSizeControls && !isMobile"
                  v-for="s in (['lg', 'md', 'sm'] as const)" :key="s"
                  class="px-2 py-1 text-2xs font-semibold uppercase tracking-wide transition-colors"
                  :class="size === s
                    ? 'dd-bg-elevated dd-text'
                    : 'dd-text-muted hover:dd-text hover:dd-bg-elevated'"
                  @click="$emit('update:size', s)">
            {{ s === 'sm' ? 'S' : s === 'md' ? 'M' : 'L' }}
          </AppButton>
        </div>
        <slot name="toolbar" />
      </div>
      <AppIconButton icon="xmark" size="toolbar" variant="muted"
              aria-label="Close details panel"
              @click="closePanel" />
    </div>

    <!-- Header -->
    <div class="shrink-0 px-4 pt-3 pb-2">
      <slot name="header" />
    </div>

    <!-- Subtitle -->
    <div class="shrink-0 px-4 pb-3 flex flex-wrap items-center gap-2"
         :style="{ borderBottom: '1px solid var(--dd-border)' }">
      <slot name="subtitle" />
    </div>

    <!-- Tabs (if provided) -->
    <slot name="tabs" />

    <!-- Main scrollable content -->
    <div class="flex flex-col flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-contain dd-scroll-stable dd-touch-scroll">
      <slot />
    </div>
  </aside>
</template>
