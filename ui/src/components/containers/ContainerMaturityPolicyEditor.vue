<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppBadge from '../AppBadge.vue';
import AppButton from '../AppButton.vue';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';

const { t } = useI18n();
const {
  maturityModeInput,
  maturityMinAgeDaysInput,
  maturitySkipReleasesInput,
  maturityReleaseFallbackDaysInput,
  policyInProgress,
  selectedHasMaturityPolicy,
  selectedMaturityMode,
  selectedMaturitySkipReleases,
  selectedMaturityReleaseFallbackDays,
  selectedPolicyGroupName,
  selectedPolicyGroupFields,
  selectedPolicyOverriddenFields,
  selectedPolicyOverrideFields,
  revertPolicySelected,
  setMaturityPolicySelected,
  clearMaturityPolicySelected,
} = useContainersViewTemplateContext();

const numericFields = [
  {
    key: 'maturityMinAgeDays',
    model: maturityMinAgeDaysInput,
    min: 1,
    max: 365,
    label: 'groupPolicyEditor.editor.minAge',
    help: '',
    testId: 'maturity-min-age',
  },
  {
    key: 'maturitySkipReleases',
    model: maturitySkipReleasesInput,
    min: 0,
    max: 100,
    label: 'containerComponents.fullPageActions.skipReleases',
    help: 'containerComponents.fullPageActions.skipReleasesHint',
    testId: 'maturity-skip-releases',
  },
  {
    key: 'maturityReleaseFallbackDays',
    model: maturityReleaseFallbackDaysInput,
    min: 0,
    max: 365,
    label: 'containerComponents.fullPageActions.releaseFallbackDays',
    help: 'containerComponents.fullPageActions.releaseFallbackHint',
    testId: 'maturity-release-fallback',
  },
] as const;
</script>

<template>
  <div class="space-y-3">
    <div class="text-3xs uppercase tracking-wider dd-text-muted">{{ t('containerComponents.fullPageActions.maturityGroup') }}</div>
    <div class="flex flex-wrap items-center gap-1.5">
      <select v-model="maturityModeInput" class="px-2.5 py-1.5 dd-rounded text-2xs-plus outline-none dd-bg dd-text" :disabled="policyInProgress !== null">
        <option value="all">{{ t('containerComponents.fullPageActions.allowNewMature') }}</option>
        <option value="mature">{{ t('containerComponents.fullPageActions.matureOnly') }}</option>
      </select>
      <AppBadge v-if="selectedPolicyGroupName && selectedPolicyGroupFields.has('maturityMode')" data-test="policy-group-maturityMode" tone="info" size="xs">{{ t('containerComponents.fullPageActions.groupSource', { group: selectedPolicyGroupName }) }}</AppBadge>
      <AppBadge v-if="selectedPolicyOverriddenFields.has('maturityMode')" data-test="policy-overridden-maturityMode" tone="warning" size="xs">{{ t('containerComponents.fullPageActions.overridden') }}</AppBadge>
      <AppButton v-if="selectedPolicyOverrideFields.has('maturityMode')" data-test="policy-revert-maturityMode" size="sm" variant="plain" :disabled="policyInProgress !== null" @click="revertPolicySelected('maturityMode')">{{ t('containerComponents.fullPageActions.revert') }}</AppButton>
    </div>
    <div class="grid gap-3 sm:grid-cols-2">
      <template v-for="field in numericFields" :key="field.key">
        <div v-if="field.key === 'maturityMinAgeDays' || maturityModeInput === 'mature'" class="space-y-1">
          <label class="block space-y-1 text-2xs-plus dd-text-muted">
            <span class="block">{{ t(field.label) }}</span>
            <input v-model.number="field.model.value" :data-testid="field.testId" type="number" :min="field.min" :max="field.max" step="1"
                   :disabled="policyInProgress !== null" class="w-full px-2.5 py-1.5 dd-rounded outline-none dd-bg dd-text" />
          </label>
          <div class="flex flex-wrap items-center gap-1">
            <AppBadge v-if="selectedPolicyGroupName && selectedPolicyGroupFields.has(field.key)" :data-test="`policy-group-${field.key}`" tone="info" size="xs">{{ t('containerComponents.fullPageActions.groupSource', { group: selectedPolicyGroupName }) }}</AppBadge>
            <AppBadge v-if="selectedPolicyOverriddenFields.has(field.key)" :data-test="`policy-overridden-${field.key}`" tone="warning" size="xs">{{ t('containerComponents.fullPageActions.overridden') }}</AppBadge>
            <AppButton v-if="selectedPolicyOverrideFields.has(field.key)" :data-test="`policy-revert-${field.key}`" size="sm" variant="plain" :disabled="policyInProgress !== null" @click="revertPolicySelected(field.key)">{{ t('containerComponents.fullPageActions.revert') }}</AppButton>
          </div>
          <p v-if="field.help" class="text-3xs dd-text-muted">{{ t(field.help) }}</p>
        </div>
      </template>
    </div>
    <div class="flex flex-wrap gap-2">
      <AppButton data-testid="apply-maturity-policy" size="md" variant="outlined" :disabled="policyInProgress !== null" @click="setMaturityPolicySelected(maturityModeInput)">{{ t('containerComponents.fullPageActions.applyMaturity') }}</AppButton>
      <AppButton size="md" variant="outlined" :disabled="!selectedHasMaturityPolicy || policyInProgress !== null" @click="clearMaturityPolicySelected">{{ t('containerComponents.fullPageActions.clearMaturity') }}</AppButton>
    </div>
    <p v-if="selectedMaturityMode === 'mature' && selectedMaturitySkipReleases > 0" class="text-3xs dd-text-muted">
      {{ t('containerComponents.fullPageActions.releasePolicySummary', { count: selectedMaturitySkipReleases }) }}
      <span v-if="selectedMaturityReleaseFallbackDays > 0">{{ t('containerComponents.fullPageActions.releaseFallbackSummary', { days: selectedMaturityReleaseFallbackDays }) }}</span>
    </p>
  </div>
</template>
