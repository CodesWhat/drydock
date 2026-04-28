<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import ScanProgressText from './ScanProgressText.vue';

const { t } = useI18n();

withDefaults(
  defineProps<{
    hasVulnerabilityData: boolean;
    scannerSetupNeeded: boolean;
    scannerMessage?: string;
    activeFilterCount: number;
    scanning: boolean;
    runtimeLoading: boolean;
    scannerReady: boolean;
    scanDisabledReason: string;
    scanProgress: { done: number; total: number };
    boxed?: boolean;
  }>(),
  {
    scannerMessage: '',
    boxed: false,
  },
);

defineEmits<{
  'clear-filters': [];
  'scan-now': [];
}>();
</script>

<template>
  <div
    data-testid="security-empty-state"
    class="flex flex-col items-center justify-center py-16"
    :class="{ 'dd-rounded': boxed }"
    :style="
      boxed
        ? {
            backgroundColor: 'var(--dd-bg-card)',
          }
        : undefined
    "
  >
    <AppIcon name="security" :size="24" class="mb-3 dd-text-muted" />
    <p class="text-sm font-medium mb-1 dd-text-secondary">
      {{ hasVulnerabilityData ? t('sharedComponents.securityEmptyState.filteredTitle') : t('sharedComponents.securityEmptyState.noDataTitle') }}
    </p>
    <p v-if="!hasVulnerabilityData && !scannerSetupNeeded" class="text-xs dd-text-muted mb-3">
      {{ t('sharedComponents.securityEmptyState.noDataBody') }}
    </p>
    <p v-if="!hasVulnerabilityData && scannerSetupNeeded" class="text-xs dd-text-muted mb-3 text-center max-w-sm">
      {{ scannerMessage }}
    </p>
    <div class="flex items-center gap-2 mt-2">
      <AppButton size="none" variant="plain" weight="none"
        v-if="activeFilterCount > 0"
        data-testid="security-empty-clear-filters"
        class="text-xs font-medium px-3 py-1.5 dd-rounded transition-colors text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/20"
        @click="$emit('clear-filters')"
      >
        {{ t('sharedComponents.securityEmptyState.clearFilters') }}
      </AppButton>

      <a
        v-if="!hasVulnerabilityData && scannerSetupNeeded"
        href="https://getdrydock.com/docs/configuration/security"
        target="_blank"
        rel="noopener noreferrer"
        class="text-xs font-medium px-3 py-1.5 dd-rounded transition-colors flex items-center gap-1.5 no-underline text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/20"
      >
        <AppIcon name="expand" :size="12" />
        {{ t('sharedComponents.securityEmptyState.setupGuide') }}
      </a>

      <span v-if="!hasVulnerabilityData && !scannerSetupNeeded" class="inline-flex" v-tooltip.top="scanDisabledReason">
        <AppButton size="none" variant="plain" weight="none"
          data-testid="security-empty-scan-now"
          class="text-xs font-medium px-3 py-1.5 dd-rounded transition-colors flex items-center gap-1.5"
          :class="
            scanning || runtimeLoading || !scannerReady
              ? 'dd-text-muted cursor-not-allowed dd-bg-elevated'
              : 'text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/20'
          "
          :disabled="scanning || runtimeLoading || !scannerReady"
          @click="$emit('scan-now')"
        >
          <AppIcon name="restart" :size="12" :class="{ 'animate-spin': scanning }" />
          <template v-if="scanning">
            <ScanProgressText :progress="scanProgress" />
          </template>
          <template v-else>
            {{ t('sharedComponents.securityEmptyState.scanNow') }}
          </template>
        </AppButton>
      </span>
    </div>
  </div>
</template>
