<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { useFleetDimensions } from '../../composables/useFleetDimensions';
import { FLEET_GROUP_DIMENSIONS, FLEET_TAG_TYPES } from '../../preferences/schema';

defineProps<{ fleet: ReturnType<typeof useFleetDimensions>; mode: 'filters' | 'grouping' }>();
const { t } = useI18n();
const controlClass =
  'px-2 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text min-w-0 max-w-48';
</script>

<template>
  <template v-if="mode === 'grouping'">
    <select v-model="fleet.groupBy.value" data-test="fleet-group-by" :aria-label="t('containerComponents.fleetDimensions.groupBy')" :class="controlClass">
      <option v-for="dimension in FLEET_GROUP_DIMENSIONS" :key="dimension" :value="dimension">{{ t(`containerComponents.fleetDimensions.${dimension}`) }}</option>
    </select>
    <input v-if="fleet.groupBy.value === 'label'" v-model="fleet.groupLabel.value" data-test="fleet-group-label" :aria-label="t('containerComponents.fleetDimensions.groupLabel')" :placeholder="t('containerComponents.fleetDimensions.groupLabel')" :class="controlClass" list="fleet-group-labels" />
    <datalist id="fleet-group-labels"><option v-for="key in fleet.labelKeys.value" :key="key" :value="key" /></datalist>
  </template>
  <template v-else>
    <select v-model="fleet.agent.value" data-test="fleet-agent" :aria-label="t('containerComponents.fleetDimensions.agent')" :class="controlClass">
      <option value="all">{{ t('containerComponents.fleetDimensions.allAgents') }}</option>
      <option v-for="option in fleet.agentOptions.value" :key="option.value" :value="option.value">{{ fleet.optionLabel(option, t) }}</option>
    </select>
    <select v-model="fleet.registry.value" data-test="fleet-registry" :aria-label="t('containerComponents.fleetDimensions.registry')" :class="controlClass">
      <option value="all">{{ t('containerComponents.fleetDimensions.allRegistries') }}</option>
      <option v-for="option in fleet.registryOptions.value" :key="option.value" :value="option.value">{{ fleet.optionLabel(option, t) }}</option>
    </select>
    <select v-model="fleet.tagType.value" data-test="fleet-tag-type" :aria-label="t('containerComponents.fleetDimensions.tagType')" :class="controlClass">
      <option v-for="type in FLEET_TAG_TYPES" :key="type" :value="type">{{ t(`containerComponents.fleetDimensions.${type}`) }}</option>
    </select>
    <input v-model="fleet.labelKey.value" data-test="fleet-label-key" :aria-label="t('containerComponents.fleetDimensions.labelKey')" :placeholder="t('containerComponents.fleetDimensions.labelKey')" :class="controlClass" list="fleet-filter-labels" />
    <datalist id="fleet-filter-labels"><option v-for="key in fleet.labelKeys.value" :key="key" :value="key" /></datalist>
    <select v-if="fleet.labelKey.value" v-model="fleet.labelMatch.value" data-test="fleet-label-match" :aria-label="t('containerComponents.fleetDimensions.labelMatch')" :class="controlClass">
      <option v-for="match in ['exists', 'equals', 'missing']" :key="match" :value="match">{{ t(`containerComponents.fleetDimensions.${match}`) }}</option>
    </select>
    <input v-if="fleet.labelKey.value && fleet.labelMatch.value === 'equals'" v-model="fleet.labelValue.value" data-test="fleet-label-value" :aria-label="t('containerComponents.fleetDimensions.labelValue')" :placeholder="t('containerComponents.fleetDimensions.labelValue')" :class="controlClass" />
  </template>
</template>
