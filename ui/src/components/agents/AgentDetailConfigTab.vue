<script setup lang="ts">
interface AgentDetailField {
  label: string;
  value: string | number;
  muted?: boolean;
}

const props = defineProps<{
  fields: AgentDetailField[];
}>();
</script>

<template>
  <div class="p-4 space-y-3">
    <div
      v-for="field in props.fields"
      :key="field.label"
      class="flex items-center justify-between px-3 py-2 dd-rounded"
      :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
    >
      <span class="text-[0.625rem] font-semibold uppercase tracking-wider dd-text-muted">{{ field.label }}</span>
      <span class="text-xs font-mono" :class="field.muted ? 'dd-text-muted' : 'dd-text'">{{ field.value }}</span>
    </div>
  </div>
</template>
