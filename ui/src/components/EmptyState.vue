<script setup lang="ts">
withDefaults(defineProps<{
  icon?: string
  message: string
  showClear?: boolean
}>(), {
  icon: 'filter',
  showClear: false,
});

defineEmits<{
  clear: []
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center py-16 dd-rounded"
       :style="{
         backgroundColor: 'var(--dd-bg-card)',
         border: '1px solid var(--dd-border-strong)',
       }">
    <AppIcon :name="icon" :size="24" class="mb-3 dd-text-muted" />
    <p class="text-sm font-medium mb-1 dd-text-secondary">
      {{ message }}
    </p>
    <button v-if="showClear"
            class="text-xs font-medium mt-2 px-3 py-1.5 dd-rounded transition-colors text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/20"
            @click="$emit('clear')">
      Clear all filters
    </button>
  </div>
</template>
