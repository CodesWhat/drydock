import type { BulkUpdatePlan, BulkUpdatePlanEntry } from './bulk-update-plan';
import type { TranslateFn } from './container-update';

export interface BulkUpdateConfirm {
  header: string;
  message: string;
  acceptLabel: string;
  disabled: boolean;
}

/** Every i18n key this module (and its plan-side reason keys) depends on, so wave 3 can add them all in one pass. */
export const BULK_UPDATE_I18N_KEYS = [
  'containerComponents.confirmDialogs.bulkUpdate.header',
  'containerComponents.confirmDialogs.bulkUpdate.accept',
  'containerComponents.confirmDialogs.bulkUpdate.acceptWithParents',
  'containerComponents.confirmDialogs.bulkUpdate.dispatchHeading',
  'containerComponents.confirmDialogs.bulkUpdate.blockedHeading',
  'containerComponents.confirmDialogs.bulkUpdate.softOverridesHeading',
  'containerComponents.confirmDialogs.bulkUpdate.skippedHeading',
  'containerComponents.confirmDialogs.bulkUpdate.staleParentsHeading',
  'containerComponents.confirmDialogs.bulkUpdate.agentCountInfo',
  'containerComponents.confirmDialogs.bulkUpdate.stackCountInfo',
  'containerComponents.selection.reasons.stale',
  'containerComponents.selection.reasons.inFlight',
  'containerComponents.selection.reasons.noUpdate',
] as const;

function bulletFor(entry: BulkUpdatePlanEntry): string {
  return entry.reason ? `${entry.name} (${entry.reason})` : entry.name;
}

function formatSection(heading: string, entries: BulkUpdatePlanEntry[]): string {
  return [heading, ...entries.map((entry) => `• ${bulletFor(entry)}`)].join('\n');
}

/**
 * Formats a `BulkUpdatePlan` into the confirm-dialog shape the bulk update
 * button hands to `useConfirmDialog` (roadmap 6.1.1). Sections are omitted
 * entirely when their entry list is empty, so a plan with nothing blocked
 * never shows a "Blocked" heading with no bullets under it.
 */
export function formatBulkUpdateConfirm(plan: BulkUpdatePlan, t: TranslateFn): BulkUpdateConfirm {
  const sections: string[] = [];

  if (plan.dispatch.length > 0) {
    sections.push(
      formatSection(
        t('containerComponents.confirmDialogs.bulkUpdate.dispatchHeading', {
          count: plan.dispatch.length,
        }),
        plan.dispatch,
      ),
    );
  }
  if (plan.blocked.length > 0) {
    sections.push(
      formatSection(
        t('containerComponents.confirmDialogs.bulkUpdate.blockedHeading', {
          count: plan.blocked.length,
        }),
        plan.blocked,
      ),
    );
  }
  if (plan.softOverrides.length > 0) {
    sections.push(
      formatSection(
        t('containerComponents.confirmDialogs.bulkUpdate.softOverridesHeading', {
          count: plan.softOverrides.length,
        }),
        plan.softOverrides,
      ),
    );
  }
  if (plan.skipped.length > 0) {
    sections.push(
      formatSection(
        t('containerComponents.confirmDialogs.bulkUpdate.skippedHeading', {
          count: plan.skipped.length,
        }),
        plan.skipped,
      ),
    );
  }
  if (plan.staleParents.length > 0) {
    sections.push(
      formatSection(
        t('containerComponents.confirmDialogs.bulkUpdate.staleParentsHeading', {
          count: plan.staleParents.length,
        }),
        plan.staleParents,
      ),
    );
  }
  if (plan.agentCount > 1) {
    sections.push(
      t('containerComponents.confirmDialogs.bulkUpdate.agentCountInfo', {
        count: plan.agentCount,
      }),
    );
  }
  if (plan.stackCount > 1) {
    sections.push(
      t('containerComponents.confirmDialogs.bulkUpdate.stackCountInfo', {
        count: plan.stackCount,
      }),
    );
  }

  const count = plan.dispatch.length;
  const acceptLabel =
    plan.staleParents.length > 0
      ? t('containerComponents.confirmDialogs.bulkUpdate.acceptWithParents', {
          count: plan.staleParents.length,
        })
      : t('containerComponents.confirmDialogs.bulkUpdate.accept', { count });

  return {
    header: t('containerComponents.confirmDialogs.bulkUpdate.header', { count }),
    message: sections.join('\n'),
    acceptLabel,
    disabled: count === 0,
  };
}
