<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useClipboard } from '../composables/useClipboard';
import type { BindingValue } from '../directives/tooltip';

const props = defineProps<{
  tag: string;
  // Optional informative tooltip shown in place of the default "Click to copy"
  // hint while idle (not copied, not failed). Lets call sites fold their own
  // outer tooltip content into this component's own tooltip instead of
  // stacking a second v-tooltip on the same root element (#472). Accepts
  // either a plain string or the richer { value, showDelay } shape the
  // v-tooltip directive also supports.
  idleTooltip?: BindingValue;
}>();

const { t } = useI18n();
const { copyToClipboard, isCopied, isFailed } = useClipboard();
</script>

<template>
  <span
    class="cursor-pointer hover:underline"
    v-tooltip.top="isFailed(props.tag) ? t('sharedComponents.copyableTag.failed') : isCopied(props.tag) ? t('sharedComponents.copyableTag.copied') : (props.idleTooltip ?? t('sharedComponents.copyableTag.clickToCopy'))"
    @click.stop="copyToClipboard(props.tag)"
  ><span :style="isFailed(props.tag) ? { color: 'var(--dd-danger)' } : undefined"><slot>{{ props.tag }}</slot></span></span>
</template>
