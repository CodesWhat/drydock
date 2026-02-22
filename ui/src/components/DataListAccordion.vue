<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  items: any[];
  itemKey: string | ((item: any) => string);
  selectedKey?: string | null;
  expandable?: boolean;
}>();

defineEmits<{
  'item-click': [item: any];
}>();

const expandedItems = ref<Set<string>>(new Set());

function getKey(item: any, itemKeyProp: string | ((item: any) => string)): string {
  return typeof itemKeyProp === 'function' ? itemKeyProp(item) : item[itemKeyProp];
}

function toggleItem(key: string) {
  if (expandedItems.value.has(key)) expandedItems.value.delete(key);
  else expandedItems.value.add(key);
}
</script>

<template>
  <div class="space-y-2">
    <div v-for="item in items" :key="getKey(item, itemKey)"
         class="dd-rounded overflow-hidden transition-all cursor-pointer"
         :style="{
           backgroundColor: 'var(--dd-bg-card)',
           border: selectedKey != null && getKey(item, itemKey) === selectedKey
             ? '1.5px solid var(--color-drydock-secondary)'
             : '1px solid var(--dd-border-strong)',
         }"
         @click="expandable ? toggleItem(getKey(item, itemKey)) : $emit('item-click', item)">
      <!-- Header -->
      <div class="flex items-center gap-3 px-5 py-3 transition-colors hover:dd-bg-elevated">
        <slot name="header" :item="item" :expanded="expandable && expandedItems.has(getKey(item, itemKey))" />
        <AppIcon v-if="expandable"
                 :name="expandedItems.has(getKey(item, itemKey)) ? 'chevron-up' : 'chevron-down'"
                 :size="10" class="transition-transform shrink-0 dd-text-muted" />
      </div>
      <!-- Details (expandable mode only) -->
      <div v-if="expandable && expandedItems.has(getKey(item, itemKey))"
           class="px-5 pb-4 pt-1"
           :style="{ borderTop: '1px solid var(--dd-border-strong)' }">
        <slot name="details" :item="item" />
      </div>
    </div>
  </div>
</template>
