<script setup lang="ts">
defineProps<{
  items: any[]
  itemKey: string | ((item: any) => string)
  selectedKey?: string | null
  minWidth?: string
}>();

defineEmits<{
  'item-click': [item: any]
}>();

function getKey(item: any, itemKeyProp: string | ((item: any) => string)): string {
  return typeof itemKeyProp === 'function' ? itemKeyProp(item) : item[itemKeyProp];
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
         @click="$emit('item-click', item)">
      <slot name="card" :item="item" :selected="selectedKey != null && getKey(item, itemKey) === selectedKey" />
    </div>
  </div>
</template>
