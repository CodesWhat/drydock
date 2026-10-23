<script setup lang="ts">
import { useId, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppButton from './AppButton.vue';
import { ROUTES } from '../router/routes';
import { getTriggerSkips } from '../services/trigger';
import type { ApiTriggerSkip } from '../types/api';

const PAGE_SIZE = 20;

const props = defineProps<{
  trigger: { type: string; name: string; agent?: string };
  label?: string;
}>();
const { t } = useI18n();
const id = useId();

const skips = ref<ApiTriggerSkip[]>([]);
const total = ref(0);
const hasMore = ref(false);
const loading = ref(false);
const failed = ref(false);
let requestId = 0;

// Offset 0 replaces the list, any later offset extends the rows already shown.
async function load(offset: number) {
  const current = ++requestId;
  loading.value = true;
  failed.value = false;
  try {
    const page = await getTriggerSkips({
      type: props.trigger.type,
      name: props.trigger.name,
      agent: props.trigger.agent,
      limit: PAGE_SIZE,
      offset,
    });
    if (current !== requestId) return;
    skips.value = [...skips.value.slice(0, offset), ...page.data];
    total.value = page.total;
    hasMore.value = page.hasMore;
  } catch {
    if (current !== requestId) return;
    if (offset === 0) {
      skips.value = [];
      total.value = 0;
      hasMore.value = false;
    }
    failed.value = true;
  } finally {
    if (current === requestId) loading.value = false;
  }
}

watch(
  () => [props.trigger.type, props.trigger.name, props.trigger.agent],
  () => void load(0),
  { immediate: true },
);

function loadMore() {
  return load(skips.value.length);
}

function containerLocation(containerId: string) {
  return { path: ROUTES.CONTAINERS, query: { containerIds: containerId } };
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
</script>

<template>
  <section class="space-y-3 border-t dd-border pt-4" :aria-labelledby="`${id}-title`" data-test="trigger-skips">
    <h3 :id="`${id}-title`" class="dd-text-heading-section">{{ t('triggersView.skips.title') }}<span v-if="label" class="ml-2 text-2xs font-mono dd-text-muted" data-test="trigger-skips-label">{{ label }}</span></h3>
    <p class="dd-text-card-description">{{ t('triggersView.skips.description') }}</p>
    <p v-if="loading && skips.length === 0" role="status" class="text-2xs-plus dd-text-muted">{{ t('triggersView.skips.loading') }}</p>
    <p v-if="failed" role="alert" class="text-2xs-plus dd-text-danger" data-test="trigger-skips-error">{{ t('triggersView.skips.loadError') }}</p>
    <p v-else-if="!loading && skips.length === 0" class="text-2xs-plus dd-text-muted" data-test="trigger-skips-empty">{{ t('triggersView.skips.empty') }}</p>
    <ul v-if="skips.length > 0" class="space-y-2">
      <li v-for="skip in skips" :key="skip.containerId" class="space-y-0.5" data-test="trigger-skip">
        <div class="flex items-baseline justify-between gap-2">
          <RouterLink :to="containerLocation(skip.containerId)" class="text-xs-plus font-semibold underline hover:no-underline truncate dd-text" data-test="trigger-skip-container">
            {{ skip.containerName ?? skip.containerId }}
          </RouterLink>
          <span class="text-2xs dd-text-muted shrink-0" data-test="trigger-skip-time">{{ formatTime(skip.at) }}</span>
        </div>
        <div class="text-2xs-plus dd-text-muted" data-test="trigger-skip-reason">{{ t(`containerComponents.fullPageActions.notificationSkipReason.${skip.reason}`) }}</div>
      </li>
    </ul>
    <AppButton v-if="hasMore" variant="outlined" :disabled="loading" data-test="trigger-skips-more" @click="loadMore">{{ t('triggersView.skips.showMore') }}</AppButton>
  </section>
</template>
