<script setup lang="ts">
const props = defineProps<{
  items: Record<string, unknown>[];
  itemKey: string | ((item: Record<string, unknown>) => string);
  selectedKey?: string | null;
  minWidth?: string;
  /** Return a human-readable label for a card (used in aria-label). Falls back to item.name. */
  itemLabel?: (item: Record<string, unknown>) => string;
}>();

function cardLabel(item: Record<string, unknown>): string {
  if (props.itemLabel) return props.itemLabel(item);
  return item.name ?? '';
}

const emit = defineEmits<{
  'item-click': [item: Record<string, unknown>];
}>();

function getKey(item: Record<string, unknown>, itemKeyProp: string | ((item: Record<string, unknown>) => string)): string {
  return typeof itemKeyProp === 'function' ? itemKeyProp(item) : item[itemKeyProp];
}

function onCardKeydown(event: KeyboardEvent, item: Record<string, unknown>) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    emit('item-click', item);
  }
}
</script>

<template>
  <div class="grid gap-4"
       :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth ?? '280px'}, 1fr))` }">
    <div v-for="item in items" :key="getKey(item, itemKey)"
         class="container-card dd-rounded cursor-pointer overflow-hidden flex flex-col"
         :class="[
           selectedKey != null && getKey(item, itemKey) === selectedKey
             ? 'ring-2 ring-drydock-secondary ring-offset-0'
             : '',
         ]"
         :style="{
           backgroundColor: 'var(--dd-bg-card)',
           border: selectedKey != null && getKey(item, itemKey) === selectedKey
             ? '1.5px solid var(--color-drydock-secondary)'
             : '1px solid var(--dd-border-strong)',
           borderRadius: 'var(--dd-radius)',
           overflow: 'hidden',
         }"
         role="button"
         tabindex="0"
         :aria-label="`Select ${cardLabel(item)}`"
         @keydown="onCardKeydown($event, item)"
         @click="emit('item-click', item)">
      <slot name="card" :item="item" :selected="selectedKey != null && getKey(item, itemKey) === selectedKey" />
    </div>
  </div>
</template>
