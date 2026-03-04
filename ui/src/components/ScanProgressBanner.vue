<script setup lang="ts">
defineProps<{
  progress: { done: number; total: number };
}>();
</script>

<template>
  <div class="mb-2 px-3 py-2 dd-rounded flex items-center gap-2.5"
       :style="{ backgroundColor: 'var(--dd-info-muted)', border: '1px solid var(--dd-info)' }">
    <AppIcon name="restart" :size="12" class="animate-spin shrink-0" :style="{ color: 'var(--dd-info)' }" />
    <span class="text-[11px] font-semibold" :style="{ color: 'var(--dd-info)' }">
      Scanning {{ progress.done }}/{{ progress.total }} containers...
    </span>
    <div class="flex-1 h-1 dd-rounded overflow-hidden" :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
      <div class="h-full dd-rounded transition-all duration-300"
           :style="{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%', backgroundColor: 'var(--dd-info)' }" />
    </div>
  </div>
</template>
