<script setup lang="ts">
import { useClipboard } from '../composables/useClipboard';

const props = defineProps<{
  tag: string;
}>();

const { copyToClipboard, isCopied } = useClipboard();
</script>

<template>
  <span
    class="cursor-pointer hover:underline"
    v-tooltip.top="isCopied(props.tag) ? 'Copied!' : 'Click to copy'"
    @click.stop="copyToClipboard(props.tag)"
  ><slot>{{ props.tag }}</slot></span>
</template>
