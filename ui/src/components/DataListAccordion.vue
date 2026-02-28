<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  items: Record<string, unknown>[];
  itemKey: string | ((item: Record<string, unknown>) => string);
  selectedKey?: string | null;
  expandable?: boolean;
}>();

const emit = defineEmits<{
  'item-click': [item: Record<string, unknown>];
}>();

const expandedItems = ref<Set<string>>(new Set());

function getKey(item: Record<string, unknown>, itemKeyProp: string | ((item: Record<string, unknown>) => string)): string {
  return typeof itemKeyProp === 'function' ? itemKeyProp(item) : item[itemKeyProp];
}

function toggleItem(key: string) {
  if (expandedItems.value.has(key)) expandedItems.value.delete(key);
  else expandedItems.value.add(key);
}

function isExpanded(item: Record<string, unknown>): boolean {
  return expandedItems.value.has(getKey(item, props.itemKey));
}

function itemLabel(item: Record<string, unknown>): string {
  const name = typeof item?.name === 'string' ? item.name : getKey(item, props.itemKey);
  return props.expandable ? `Toggle ${name} details` : `Select ${name}`;
}

function activateItem(item: Record<string, unknown>) {
  if (props.expandable) {
    toggleItem(getKey(item, props.itemKey));
  } else {
    emit('item-click', item);
  }
}

function onItemKeydown(event: KeyboardEvent, item: Record<string, unknown>) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  event.preventDefault();
  activateItem(item);
}
</script>

<template>
  <div class="space-y-2">
    <div v-for="item in items" :key="getKey(item, itemKey)"
         class="dd-rounded overflow-hidden transition-all cursor-pointer"
         role="button"
         tabindex="0"
         :aria-expanded="expandable ? String(isExpanded(item)) : undefined"
         :aria-label="itemLabel(item)"
         :style="{
           backgroundColor: 'var(--dd-bg-card)',
           border: selectedKey != null && getKey(item, itemKey) === selectedKey
             ? '1.5px solid var(--color-drydock-secondary)'
             : '1px solid var(--dd-border-strong)',
         }"
         @keydown="onItemKeydown($event, item)"
         @click="activateItem(item)">
      <!-- Header -->
      <div class="flex items-center gap-3 px-5 py-3 transition-colors hover:dd-bg-elevated">
        <slot name="header" :item="item" :expanded="expandable && isExpanded(item)" />
        <AppIcon v-if="expandable"
                 :name="isExpanded(item) ? 'chevron-up' : 'chevron-down'"
                 :size="10" class="transition-transform shrink-0 dd-text-muted" />
      </div>
      <!-- Details (expandable mode only) -->
      <div v-if="expandable && isExpanded(item)"
           class="px-5 pb-4 pt-1"
           :style="{ borderTop: '1px solid var(--dd-border-strong)' }">
        <slot name="details" :item="item" />
      </div>
    </div>
  </div>
</template>
