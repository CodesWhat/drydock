<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { useFleetHealth } from '../../views/containers/useFleetHealth';
import AppButton from '../AppButton.vue';
import AppStatusIndicator from '../AppStatusIndicator.vue';

defineProps<{ health: ReturnType<typeof useFleetHealth> }>();
const { t } = useI18n();
</script>

<template>
  <section class="mb-3 min-w-0 dd-rounded dd-bg-elevated p-3" :aria-label="t('containerComponents.fleetHealth.title')" :aria-busy="health.loading.value">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-2xs-plus font-semibold">{{ t('containerComponents.fleetHealth.title') }}</h2>
      <AppButton size="sm" variant="secondary" data-test="fleet-health-reload" :disabled="health.loading.value || health.refreshing.value !== null" @click="health.load()">{{ t('containerComponents.fleetHealth.reload') }}</AppButton>
    </div>
    <p class="text-2xs-plus dd-text-muted mt-1">{{ t('containerComponents.fleetHealth.description') }}</p>
    <p v-if="health.agentError.value" role="status" class="text-2xs-plus dd-text-warning mt-2">{{ t('containerComponents.fleetHealth.agentUnavailable') }}</p>
    <p v-if="health.watcherError.value" role="status" class="text-2xs-plus dd-text-warning mt-2">{{ t('containerComponents.fleetHealth.watcherUnavailable') }}</p>
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 mt-2">
      <article v-for="row in health.rows.value" :key="row.key" :data-source="row.key" data-test="fleet-health-row" class="min-w-0 p-2 dd-rounded dd-bg" :aria-busy="health.refreshing.value === row.key">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="min-w-0 break-all text-2xs-plus font-semibold">{{ row.agent ?? t('containerComponents.fleetDimensions.local') }}</h3>
          <AppStatusIndicator :tone="row.status === 'connected' ? 'success' : row.status === 'disconnected' ? 'danger' : 'neutral'" :label="t(`containerComponents.fleetHealth.${row.status}`)" />
        </div>
        <p class="text-2xs-plus dd-text-muted mt-1">
          {{ row.total === undefined ? t('containerComponents.fleetHealth.unavailable') : t('containerComponents.fleetHealth.total', { count: row.total }) }}
          <span v-if="row.lastKnown"> · {{ t('containerComponents.fleetHealth.lastKnown') }}</span>
        </p>
        <p v-if="row.lastSeen" class="text-2xs-plus dd-text-muted break-all">{{ t('containerComponents.fleetHealth.lastSeen', { value: row.lastSeen }) }}</p>
        <ul class="text-2xs-plus dd-text-muted mt-1">
          <li v-for="watcher in row.watchers" :key="watcher.id" class="break-all">{{ watcher.type }} · {{ watcher.name }}</li>
        </ul>
        <AppButton class="mt-2" size="sm" variant="secondary" data-test="fleet-inventory-refresh" :disabled="!row.canRefresh" @click="health.refresh(row.key)">{{ t('containerComponents.fleetHealth.refresh') }}</AppButton>
        <p v-if="!row.supported" class="text-2xs-plus dd-text-muted mt-1">{{ t('containerComponents.fleetHealth.unsupported') }}</p>
        <div v-if="health.outcomes.value[row.key]" role="status" class="mt-2 text-2xs-plus break-words">
          <p :class="health.outcomes.value[row.key]!.complete ? 'dd-text-success' : 'dd-text-warning'">{{ t(`containerComponents.fleetHealth.${health.outcomes.value[row.key]!.complete ? 'complete' : 'partial'}`) }}</p>
          <p v-if="health.outcomes.value[row.key]!.reloadFailed" class="dd-text-warning">{{ t('containerComponents.fleetHealth.reloadFailed') }}</p>
          <ul>
            <li v-for="result in health.outcomes.value[row.key]!.results" :key="result.id" class="mt-1 break-all">
              {{ result.name }}: {{ t(`containerComponents.fleetHealth.${result.authoritative && result.errors.length === 0 ? 'complete' : 'partial'}`) }}
              <ul><li v-for="(error, index) in result.errors" :key="index" class="dd-text-warning">{{ error.phase }}<template v-if="error.id"> · {{ error.id }}</template>: {{ error.message }}</li></ul>
            </li>
          </ul>
        </div>
      </article>
    </div>
  </section>
</template>
