<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';

const { t } = useI18n();
const { selectedContainer } = useContainersViewTemplateContext();
</script>

<template>
  <div>
    <div class="dd-rounded overflow-hidden"
          :style="{ backgroundColor: 'var(--dd-bg-card)' }">
      <div class="px-4 py-3 flex items-center gap-2">
        <AppIcon name="containers" :size="12" class="dd-text-muted" />
        <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">{{ t('containerComponents.fullPageLabels.labels') }}</span>
        <span class="badge text-3xs ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.labels.length }}</span>
      </div>
      <div class="p-4">
        <div v-if="selectedContainer.details.labels.length > 0" class="flex flex-wrap gap-2">
          <span v-for="label in selectedContainer.details.labels" :key="label"
                class="badge text-2xs-plus font-semibold px-3 py-1.5"
                :style="{
                  backgroundColor: 'var(--dd-neutral-muted)',
                  color: 'var(--dd-text-secondary)',
                }">
            {{ label }}
          </span>
        </div>
        <p v-else class="text-xs dd-text-muted italic">{{ t('containerComponents.fullPageLabels.noLabels') }}</p>
      </div>
    </div>
  </div>
</template>
