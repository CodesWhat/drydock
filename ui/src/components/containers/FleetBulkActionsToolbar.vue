<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { useFleetBulkActions } from '../../views/containers/useFleetBulkActions';
import AppButton from '../AppButton.vue';

defineProps<{ actions: ReturnType<typeof useFleetBulkActions> }>();
const { t } = useI18n();
</script>

<template>
  <section class="mb-3 dd-rounded dd-bg-elevated p-2" :aria-label="t('containerComponents.fleetBulk.label')" :aria-busy="actions.busy.value">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-2xs-plus font-semibold dd-text-muted">{{ t('containerComponents.fleetBulk.label') }}</span>
      <AppButton size="sm" variant="secondary" data-test="fleet-bulk-update" :disabled="!actions.canUpdate.value" @click="actions.updateAll">
        {{ t('containerComponents.fleetBulk.updateAll', { count: actions.updateCount.value }) }}
      </AppButton>
      <select v-model="actions.duration.value" data-test="fleet-snooze-duration" :disabled="actions.busy.value" :aria-label="t('containerComponents.fleetBulk.duration')" class="min-w-0 max-w-full px-2 py-1.5 dd-rounded dd-bg dd-text text-2xs-plus">
        <option v-for="days in ['1', '7', '30']" :key="days" :value="days">{{ t('containerComponents.fleetBulk.days', { count: Number(days) }) }}</option>
        <option value="date">{{ t('containerComponents.fleetBulk.untilDate') }}</option>
      </select>
      <input v-if="actions.duration.value === 'date'" v-model="actions.date.value" type="date" data-test="fleet-snooze-date" :disabled="actions.busy.value" :aria-label="t('containerComponents.fleetBulk.date')" class="min-w-0 max-w-full px-2 py-1.5 dd-rounded dd-bg dd-text text-2xs-plus" />
      <AppButton size="sm" variant="secondary" data-test="fleet-bulk-snooze" :disabled="!actions.canSnooze.value" @click="actions.snoozeAllPatch">
        {{ t('containerComponents.fleetBulk.snoozePatch') }}
      </AppButton>
      <span class="text-2xs-plus dd-text-muted">{{ t('containerComponents.fleetBulk.patchCount', { count: actions.patchCount.value }) }}</span>
    </div>
    <p v-if="actions.summary.value" role="status" class="text-2xs-plus mt-2 whitespace-pre-line break-words" :class="actions.summaryWarning.value ? 'dd-text-warning' : 'dd-text-muted'">{{ actions.summary.value }}</p>
  </section>
</template>
