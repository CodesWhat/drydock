<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useClipboard } from '../composables/useClipboard';

const props = defineProps<{
  tag: string;
}>();

const { t } = useI18n();
const { copyToClipboard, isCopied, isFailed } = useClipboard();
</script>

<template>
  <span
    class="cursor-pointer hover:underline"
    v-tooltip.top="isFailed(props.tag) ? t('sharedComponents.copyableTag.failed') : isCopied(props.tag) ? t('sharedComponents.copyableTag.copied') : t('sharedComponents.copyableTag.clickToCopy')"
    @click.stop="copyToClipboard(props.tag)"
  ><span :style="isFailed(props.tag) ? { color: 'var(--dd-danger)' } : undefined"><slot>{{ props.tag }}</slot></span></span>
</template>
