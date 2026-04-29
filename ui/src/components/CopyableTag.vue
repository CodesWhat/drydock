<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useClipboard } from '../composables/useClipboard';

const props = defineProps<{
  tag: string;
}>();

const { t } = useI18n();
const { copyToClipboard, isCopied } = useClipboard();
</script>

<template>
  <span
    class="cursor-pointer hover:underline"
    v-tooltip.top="isCopied(props.tag) ? t('sharedComponents.copyableTag.copied') : t('sharedComponents.copyableTag.clickToCopy')"
    @click.stop="copyToClipboard(props.tag)"
  ><slot>{{ props.tag }}</slot></span>
</template>
