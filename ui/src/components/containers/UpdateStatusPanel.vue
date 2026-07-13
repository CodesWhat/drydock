<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import AppButton from '../AppButton.vue';
import { useNow } from '../../composables/useNow';
import type { UpdateMode } from '../../services/settings';
import {
  type UpdateStatusAction,
  type UpdateStatusContainer,
  formatLiftCountdown,
  useUpdateStatus,
} from '../../composables/useUpdateStatus';

const props = withDefaults(
  defineProps<{
    container: UpdateStatusContainer;
    mode: UpdateMode;
    hasActiveOperationBadge?: boolean;
    busy?: boolean;
  }>(),
  { hasActiveOperationBadge: false, busy: false },
);

const emit = defineEmits<{
  update: [];
  'open-tab': [tab: string, section?: string];
}>();

const router = useRouter();
const status = useUpdateStatus(() => ({
  container: props.container,
  mode: props.mode,
  hasActiveOperationBadge: props.hasActiveOperationBadge,
}));
const nowMs = useNow(60_000, () =>
  status.value.conditions.some((condition) => Boolean(condition.liftableAt)),
);

const panelStyle = computed(() => {
  const tone = status.value.tone;
  return {
    backgroundColor: `var(--dd-${tone}-muted)`,
    color: `var(--dd-${tone})`,
  };
});

async function runAction(action: UpdateStatusAction): Promise<void> {
  if (action.kind === 'tab') {
    emit('open-tab', action.tab, action.section);
    return;
  }
  if (action.kind === 'external') return;
  await router.push(action.to);
}
</script>

<template>
  <section
    class="dd-rounded overflow-hidden"
    :style="panelStyle"
    data-test="update-status-panel"
    :data-state="status.state"
  >
    <div class="flex items-start gap-2.5 px-3 py-2.5">
      <AppIcon
        :name="status.icon"
        :size="14"
        class="shrink-0 mt-0.5"
        :class="status.state === 'in-progress' ? 'dd-spin' : ''"
      />
      <div class="flex-1 min-w-0">
        <div class="dd-text-label">{{ $t('containerComponents.updateStatus.title') }}</div>
        <p class="text-xs font-medium mt-0.5" data-test="update-status-summary">
          {{ status.summary }}
        </p>
      </div>
    </div>

    <details
      v-if="status.conditions.length > 0"
      class="px-3 pb-3"
      :open="!status.detailsCollapsed"
    >
      <summary class="text-2xs font-semibold cursor-pointer py-1 select-none">
        {{ $t('containerComponents.updateStatus.showDetails') }}
      </summary>
      <div class="mt-2 space-y-2" role="list">
        <div
          v-for="condition in status.conditions"
          :key="condition.reason"
          class="flex items-start gap-2 px-2.5 py-2 dd-rounded dd-bg-card"
          role="listitem"
          :data-reason="condition.reason"
          :data-severity="condition.severity"
          :data-tone="condition.tone"
          :style="{
            backgroundColor: `var(--dd-${condition.tone}-muted)`,
            color: `var(--dd-${condition.tone})`,
          }"
        >
          <AppIcon :name="condition.icon" :size="12" class="shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <div class="text-xs font-semibold">{{ condition.heading }}</div>
            <div class="text-2xs-plus mt-0.5 whitespace-normal break-words dd-text-secondary">
              {{ condition.body }}
            </div>
            <div v-if="condition.liftableAt" class="text-2xs mt-1 dd-text-muted">
              <template v-if="formatLiftCountdown(condition.liftableAt, nowMs)">
                {{ formatLiftCountdown(condition.liftableAt, nowMs) }} ·
              </template>
              {{ $t('containerComponents.updateStatus.liftsAt', { date: new Date(condition.liftableAt).toLocaleString() }) }}
            </div>
            <a
              v-if="condition.action?.kind === 'external'"
              :href="condition.action.href"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center mt-1.5 min-h-9 text-2xs font-semibold underline underline-offset-2"
              :data-test="`update-status-action-${condition.reason}`"
            >
              {{ condition.action.label }}
            </a>
            <AppButton
              v-else-if="condition.action"
              size="xs"
              variant="link-secondary"
              weight="semibold"
              class="mt-1.5 min-h-9"
              :data-test="`update-status-action-${condition.reason}`"
              @click="runAction(condition.action)"
            >
              {{ condition.action.label }}
            </AppButton>
          </div>
        </div>
      </div>
    </details>

    <div v-if="status.hasUpdate" class="px-3 pb-3">
      <AppButton
        size="sm"
        :variant="status.manualUpdateDisabled ? 'muted-subtle' : 'success-subtle'"
        class="w-full min-h-11"
        data-test="update-status-manual-cta"
        :disabled="status.manualUpdateDisabled || busy"
        @click="emit('update')"
      >
        {{
          mode === 'notify'
            ? $t('containerComponents.updateStatus.notificationsOnlyButton')
            : status.state === 'hard-blocked'
              ? $t('containerComponents.updateStatus.blockedButton')
              : $t('containerComponents.updateStatus.updateButton')
        }}
      </AppButton>
    </div>
  </section>
</template>
