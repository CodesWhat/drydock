<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  open: boolean
  isMobile: boolean
  size?: 'sm' | 'md' | 'lg'
  showSizeControls?: boolean
  showFullPage?: boolean
}>(), {
  size: 'sm',
  showSizeControls: true,
  showFullPage: false,
});

defineEmits<{
  'update:open': [val: boolean]
  'update:size': [size: 'sm' | 'md' | 'lg']
  'full-page': []
}>();

const panelFlex = computed(() =>
  props.size === 'sm' ? '0 0 30%' : props.size === 'md' ? '0 0 45%' : '0 0 70%',
);
</script>

<template>
  <!-- Mobile overlay -->
  <div v-if="open && isMobile"
       class="fixed inset-0 bg-black/50 z-40"
       @click="$emit('update:open', false)" />

  <!-- Panel -->
  <aside v-if="open"
         class="detail-panel-inline flex flex-col dd-rounded overflow-clip transition-all duration-300 ease-in-out"
         :class="isMobile ? 'fixed top-0 right-0 h-full z-50' : 'sticky top-0'"
         :style="{
           flex: isMobile ? undefined : panelFlex,
           width: isMobile ? '100%' : undefined,
           backgroundColor: 'var(--dd-bg-card)',
           border: '1px solid var(--dd-border-strong)',
           height: isMobile ? '100vh' : 'calc(100vh - 96px)',
           minHeight: '480px',
         }">

    <!-- Panel toolbar: size + full page + close -->
    <div class="shrink-0 px-4 py-2.5 flex items-center justify-between"
         :style="{ borderBottom: '1px solid var(--dd-border)' }">
      <div class="flex items-center gap-2">
        <div v-if="showSizeControls && !isMobile" class="flex items-center dd-rounded overflow-hidden"
             :style="{ border: '1px solid var(--dd-border-strong)' }">
          <button v-for="s in (['lg', 'md', 'sm'] as const)" :key="s"
                  class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors"
                  :class="size === s
                    ? 'dd-bg-elevated dd-text'
                    : 'dd-text-muted hover:dd-text hover:dd-bg-elevated'"
                  @click="$emit('update:size', s)">
            {{ s === 'sm' ? 'S' : s === 'md' ? 'M' : 'L' }}
          </button>
        </div>
        <button v-if="showFullPage"
                class="flex items-center gap-1.5 px-2 py-1 dd-rounded text-[10px] font-semibold uppercase tracking-wide transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                title="Open full page view"
                @click="$emit('full-page')">
          <AppIcon name="expand" :size="11" />
          Full Page
        </button>
        <slot name="toolbar" />
      </div>
      <button class="flex items-center justify-center w-7 h-7 dd-rounded text-xs font-medium transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
              @click="$emit('update:open', false)">
        <AppIcon name="xmark" :size="14" />
      </button>
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
    <div class="flex-1 overflow-y-auto">
      <slot />
    </div>
  </aside>
</template>
