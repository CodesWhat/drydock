<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { UpdateBlocker, UpdateBlockerReason, UpdateEligibility } from '../../types/container';
import { severityOf } from '../../utils/update-eligibility';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    eligibility?: UpdateEligibility;
    hasActiveOperationBadge?: boolean;
  }>(),
  { hasActiveOperationBadge: false },
);

const activeBlockers = computed<UpdateBlocker[]>(() => {
  if (!props.eligibility) return [];
  if (props.eligibility.eligible) return [];

  let blockers = props.eligibility.blockers.filter((b) => b.reason !== 'no-update-available');

  if (props.hasActiveOperationBadge) {
    blockers = blockers.filter((b) => b.reason !== 'active-operation');
  }

  return [...blockers].sort((a, b) => {
    const sa = severityOf(a) === 'hard' ? 0 : 1;
    const sb = severityOf(b) === 'hard' ? 0 : 1;
    return sa - sb;
  });
});

const shouldRender = computed(() => activeBlockers.value.length > 0);

function reasonIcon(reason: UpdateBlockerReason): string {
  switch (reason) {
    case 'security-scan-blocked':
      return 'mdi:shield-alert';
    case 'last-update-rolled-back':
      return 'mdi:alert-circle';
    case 'snoozed':
      return 'mdi:alarm-snooze';
    case 'skip-tag':
    case 'skip-digest':
      return 'mdi:tag-off';
    case 'maturity-not-reached':
      return 'mdi:timer-sand';
    case 'threshold-not-reached':
      return 'mdi:filter-variant';
    case 'rollback-container':
      return 'mdi:backup-restore';
    case 'active-operation':
      return 'mdi:sync';
    case 'trigger-excluded':
    case 'trigger-not-included':
    case 'agent-mismatch':
    case 'no-update-trigger-configured':
      return 'mdi:cog-off';
    default:
      return 'mdi:alert-circle';
  }
}

function reasonLabel(reason: UpdateBlockerReason): string {
  switch (reason) {
    case 'security-scan-blocked':
      return t('containerComponents.eligibilityBadges.securityBlocked');
    case 'last-update-rolled-back':
      return t('containerComponents.eligibilityBadges.rolledBack');
    case 'snoozed':
      return t('containerComponents.eligibilityBadges.snoozed');
    case 'skip-tag':
      return t('containerComponents.eligibilityBadges.tagSkipped');
    case 'skip-digest':
      return t('containerComponents.eligibilityBadges.digestSkipped');
    case 'maturity-not-reached':
      return t('containerComponents.eligibilityBadges.maturing');
    case 'threshold-not-reached':
      return t('containerComponents.eligibilityBadges.belowThreshold');
    case 'rollback-container':
      return t('containerComponents.eligibilityBadges.rollback');
    case 'active-operation':
      return t('containerComponents.eligibilityBadges.inProgress');
    case 'trigger-excluded':
      return t('containerComponents.eligibilityBadges.triggerExcluded');
    case 'trigger-not-included':
      return t('containerComponents.eligibilityBadges.triggerFiltered');
    case 'agent-mismatch':
      return t('containerComponents.eligibilityBadges.agentMismatch');
    case 'no-update-trigger-configured':
      return t('containerComponents.eligibilityBadges.noTrigger');
    default:
      return reason;
  }
}

type BlockerStyle = { bg: string; text: string };

function reasonColor(reason: UpdateBlockerReason): BlockerStyle {
  switch (reason) {
    case 'security-scan-blocked':
    case 'last-update-rolled-back':
      return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)' };
    case 'snoozed':
    case 'skip-tag':
    case 'skip-digest':
    case 'maturity-not-reached':
    case 'threshold-not-reached':
    case 'trigger-excluded':
    case 'trigger-not-included':
      return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)' };
    case 'active-operation':
      return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)' };
    default:
      return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)' };
  }
}

function blockerStyle(blocker: UpdateBlocker): BlockerStyle {
  return reasonColor(blocker.reason);
}

function blockerTooltip(blocker: UpdateBlocker): string {
  let text = blocker.message ?? '';
  if (blocker.actionHint) {
    text += `\n${blocker.actionHint}`;
  }
  if (blocker.liftableAt) {
    text += `\n${t('containerComponents.eligibilityBadges.liftsLabel')} ${formatLiftableAt(blocker.liftableAt)}`;
  }
  return text.trim();
}

function formatLiftableAt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
</script>

<template>
  <div v-if="shouldRender" class="flex flex-col gap-1.5" data-test="eligibility-badge-full">
    <div
      v-for="blocker in activeBlockers"
      :key="blocker.reason"
      class="flex items-start gap-2 px-3 py-2 dd-rounded text-xs"
      :style="{ backgroundColor: blockerStyle(blocker).bg }"
      :data-reason="blocker.reason"
    >
      <iconify-icon
        :icon="reasonIcon(blocker.reason)"
        width="12"
        height="12"
        class="shrink-0 mt-0.5"
        :style="{ display: 'inline-block', flex: 'none', color: blockerStyle(blocker).text }"
      />
      <div class="flex-1 min-w-0" :style="{ color: blockerStyle(blocker).text }">
        <span class="font-semibold block">{{ reasonLabel(blocker.reason) }}</span>
        <span class="block whitespace-normal break-words">{{ blocker.message }}</span>
        <span v-if="blocker.actionHint" class="block mt-0.5 opacity-80">{{ blocker.actionHint }}</span>
        <span v-if="blocker.liftableAt" class="block mt-0.5 opacity-80">
          {{ t('containerComponents.eligibilityBadges.liftsLabel') }} {{ formatLiftableAt(blocker.liftableAt) }}
        </span>
      </div>
    </div>
  </div>
</template>
