<script setup lang="ts">
import { computed } from 'vue';
import { useIcons } from '../composables/useIcons';

const props = withDefaults(defineProps<{
  name: string;
  size?: number;
}>(), { size: 16 });

const { icon, iconScale } = useIcons();
const resolved = computed(() => icon(props.name));
const scaled = computed(() => Math.round(props.size * iconScale.value));
</script>

<template>
  <iconify-icon :icon="resolved" :width="scaled" :height="scaled" />
</template>
