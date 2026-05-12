<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppBadge from '../../components/AppBadge.vue';
import type { ContainerChoice } from './securityViewTypes';

defineProps<{
  choices: ContainerChoice[];
}>();

const emit = defineEmits<{
  close: [];
  openChoice: [choice: ContainerChoice];
  viewAll: [];
}>();

const { t } = useI18n();
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-overlay"
      @pointerdown.self="emit('close')"
      @keydown.escape="emit('close')">
      <div
        class="fixed left-1/2 top-1/3 -translate-x-1/2 w-full max-w-xs mx-4 dd-rounded-lg overflow-hidden shadow-lg"
        :style="{
          backgroundColor: 'var(--dd-bg-card)',
          border: '1px solid var(--dd-border-strong)',
          boxShadow: 'var(--dd-shadow-modal)',
        }">
        <div class="px-4 pt-3 pb-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
          <span class="text-2xs-plus font-semibold dd-text">{{ t('securityView.chooser.title') }}</span>
        </div>
        <div class="py-1 max-h-64 overflow-y-auto">
          <AppButton
            v-for="choice in choices"
            :key="choice.id"
            size="md"
            variant="plain"
            weight="medium"
            class="w-full text-left flex items-start gap-2 hover:dd-bg-hover transition-colors"
            :class="choice.blocked ? 'opacity-60 cursor-not-allowed' : ''"
            :disabled="choice.blocked"
            data-test="security-chooser-item"
            v-tooltip.top="choice.blockerMessage"
            @click="emit('openChoice', choice)">
            <div class="min-w-0 flex-1">
              <div class="text-2xs-plus font-semibold dd-text truncate">{{ choice.name }}</div>
              <div v-if="choice.host" class="text-3xs dd-text-muted mt-0.5">{{ choice.host }}</div>
            </div>
            <AppBadge v-if="choice.blocked" tone="danger" size="xs" class="shrink-0 mt-0.5">
              {{ t('containerComponents.fullPageDetail.blockedButton') }}
            </AppBadge>
            <AppBadge v-else-if="choice.newTag" tone="info" size="xs" class="shrink-0 mt-0.5">
              {{ choice.newTag }}
            </AppBadge>
          </AppButton>
        </div>
        <div class="px-4 py-2.5 flex items-center justify-between" :style="{ borderTop: '1px solid var(--dd-border)' }">
          <AppButton
            size="xs"
            variant="text-secondary"
            weight="medium"
            class="underline hover:no-underline"
            data-test="security-chooser-view-all"
            @click="emit('viewAll')">
            {{ t('securityView.viewAllInContainers') }}
          </AppButton>
          <AppButton size="xs" variant="secondary" @click="emit('close')">{{ t('securityView.chooser.cancel') }}</AppButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>
