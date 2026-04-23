<script setup lang="ts">
import { computed } from 'vue';
import type { UpdateBlocker, UpdateBlockerReason, UpdateEligibility } from '../../types/container';

const props = withDefaults(
  defineProps<{
    eligibility?: UpdateEligibility;
    variant?: 'compact' | 'full';
    hasActiveOperationBadge?: boolean;
  }>(),
  { variant: 'compact', hasActiveOperationBadge: false },
);

const activeBlockers = computed<UpdateBlocker[]>(() => {
  if (!props.eligibility) return [];
  if (props.eligibility.eligible) return [];

  const blockers = props.eligibility.blockers.filter((b) => b.reason !== 'no-update-available');

  if (props.hasActiveOperationBadge) {
    return blockers.filter((b) => b.reason !== 'active-operation');
  }
  return blockers;
});

const shouldRender = computed(() => activeBlockers.value.length > 0);

function reasonIcon(reason: UpdateBlockerReason): string {
  switch (reason) {
    case 'security-scan-blocked':
      return 'mdi:shield-alert';
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
      return 'Security blocked';
    case 'snoozed':
      return 'Snoozed';
    case 'skip-tag':
      return 'Tag skipped';
    case 'skip-digest':
      return 'Digest skipped';
    case 'maturity-not-reached':
      return 'Maturing';
    case 'threshold-not-reached':
      return 'Below threshold';
    case 'rollback-container':
      return 'Rollback';
    case 'active-operation':
      return 'In progress';
    case 'trigger-excluded':
      return 'Trigger excluded';
    case 'trigger-not-included':
      return 'Trigger filtered';
    case 'agent-mismatch':
      return 'Agent mismatch';
    case 'no-update-trigger-configured':
      return 'No trigger';
    default:
      return reason;
  }
}

type BlockerColor = { bg: string; text: string };

function reasonColor(reason: UpdateBlockerReason): BlockerColor {
  switch (reason) {
    case 'security-scan-blocked':
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

function blockerTooltip(blocker: UpdateBlocker): string {
  const parts: string[] = [blocker.message];
  if (blocker.actionHint) {
    parts.push(blocker.actionHint);
  }
  if (blocker.liftableAt) {
    parts.push(`Lifts: ${formatLiftableAt(blocker.liftableAt)}`);
  }
  return parts.join(' — ');
}

const primaryBlocker = computed<UpdateBlocker | null>(() => activeBlockers.value[0] ?? null);

const extraCount = computed<number>(() => Math.max(0, activeBlockers.value.length - 1));
</script>

<template>
  <template v-if="shouldRender">
    <!-- Compact: single primary badge + +N indicator -->
    <template v-if="variant === 'compact'">
      <span class="inline-flex items-center gap-1">
        <span
          class="badge text-3xs font-bold uppercase inline-flex items-center gap-1"
          :style="{ backgroundColor: reasonColor(primaryBlocker!.reason).bg, color: reasonColor(primaryBlocker!.reason).text }"
          v-tooltip.top="blockerTooltip(primaryBlocker!)"
          data-test="eligibility-badge-primary"
        >
          <iconify-icon
            :icon="reasonIcon(primaryBlocker!.reason)"
            width="10"
            height="10"
            :style="{ display: 'inline-block', flex: 'none' }"
          />
          <span class="tracking-wide leading-none">{{ reasonLabel(primaryBlocker!.reason) }}</span>
        </span>
        <span
          v-if="extraCount > 0"
          class="text-3xs font-bold dd-text-muted"
          :style="{ lineHeight: 1 }"
          v-tooltip.top="`${extraCount} more blocker${extraCount !== 1 ? 's' : ''}`"
          data-test="eligibility-badge-extra"
        >+{{ extraCount }}</span>
      </span>
    </template>

    <!-- Full: stack of all blockers -->
    <template v-else>
      <div class="flex flex-col gap-1.5" data-test="eligibility-badge-full">
        <div
          v-for="blocker in activeBlockers"
          :key="blocker.reason"
          class="flex items-start gap-2 px-3 py-2 dd-rounded text-xs"
          :style="{ backgroundColor: reasonColor(blocker.reason).bg }"
          :data-reason="blocker.reason"
        >
          <iconify-icon
            :icon="reasonIcon(blocker.reason)"
            width="12"
            height="12"
            class="shrink-0 mt-0.5"
            :style="{ display: 'inline-block', flex: 'none', color: reasonColor(blocker.reason).text }"
          />
          <div class="flex-1 min-w-0" :style="{ color: reasonColor(blocker.reason).text }">
            <span class="font-semibold block">{{ reasonLabel(blocker.reason) }}</span>
            <span class="block whitespace-normal break-words">{{ blocker.message }}</span>
            <span v-if="blocker.actionHint" class="block mt-0.5 opacity-80">{{ blocker.actionHint }}</span>
            <span v-if="blocker.liftableAt" class="block mt-0.5 opacity-80">
              Lifts: {{ formatLiftableAt(blocker.liftableAt) }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </template>
</template>
