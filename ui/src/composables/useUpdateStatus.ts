import { type ComputedRef, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { UpdateMode } from '../services/settings';
import type {
  ActionPolicyState,
  Container,
  UpdateBlocker,
  UpdateBlockerReason,
  UpdateBlockerSeverity,
  UpdateEligibility,
} from '../types/container';
import { hasRawUpdateCandidate, severityOf } from '../utils/update-eligibility';

type Translate = (key: string, params?: Record<string, unknown>) => string;

export interface UpdateStatusContainer {
  id: string;
  name: string;
  newTag?: string | null;
  newDigest?: string | null;
  updateInsight?: Container['updateInsight'];
  updateEligibility?: UpdateEligibility;
  registryError?: string;
}

export type UpdateStatusAction =
  | { kind: 'tab'; label: string; tab: string; section?: string }
  | {
      kind: 'route';
      label: string;
      to: { path: string; query?: Record<string, string> };
    }
  | { kind: 'external'; label: string; href: string };

/** Server-reported blocker reasons plus the non-blocker row for a group manual ceiling. */
type UpdateStatusConditionReason = UpdateBlockerReason | 'group-manual-only';

interface UpdateStatusCondition {
  reason: UpdateStatusConditionReason;
  severity: UpdateBlockerSeverity;
  tone: 'danger' | 'warning' | 'info';
  icon: string;
  heading: string;
  body: string;
  liftableAt?: string;
  action?: UpdateStatusAction;
}

type UpdateStatusState =
  | 'up-to-date'
  | 'insight'
  | 'unknown'
  | 'ready'
  | 'soft-blocked'
  | 'hard-blocked'
  | 'in-progress'
  | 'notify';

/**
 * Additive "Auto" badge (spec-6.0.1-action-policy.md API surface) reflecting
 * UpdateEligibility.actionPolicy. Only ever shown for `state === 'auto'` —
 * `manual`/`blocked` don't get a badge here (blocked is already covered by
 * the trigger-excluded/trigger-not-included condition; manual is the
 * unremarkable default). `tooltip` still varies by state so the same
 * mapping is reusable anywhere all three states need explaining (e.g. the
 * per-trigger resolvedState tooltip in the associated-triggers list).
 */
interface ActionPolicyBadge {
  state: ActionPolicyState;
  label: string;
  tooltip: string;
}

export interface UpdateStatusViewModel {
  state: UpdateStatusState;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  icon: string;
  summary: string;
  conditions: UpdateStatusCondition[];
  detailsCollapsed: boolean;
  hasUpdate: boolean;
  manualUpdateDisabled: boolean;
  insightNote?: string;
  actionPolicyBadge?: ActionPolicyBadge;
}

export interface UpdateStatusInput {
  container: UpdateStatusContainer;
  mode: UpdateMode;
  hasActiveOperationBadge?: boolean;
  t: Translate;
}

const POLICY_REASONS = new Set<UpdateBlockerReason>([
  'snoozed',
  'skip-tag',
  'skip-digest',
  'maturity-not-reached',
]);

export const ELIGIBILITY_DOCS =
  'https://getdrydock.com/docs/configuration/actions/update-eligibility#reasons-reference';

function groupEditorAction(group: unknown, t: Translate): UpdateStatusAction | undefined {
  if (typeof group !== 'string') return undefined;
  return {
    kind: 'route',
    label: t('containerComponents.updateStatus.actions.editGroupPolicy'),
    to: { path: '/config', query: { tab: 'groupPolicies', group } },
  };
}

function conditionAction(
  blocker: UpdateBlocker,
  container: UpdateStatusContainer,
  t: Translate,
): UpdateStatusAction | undefined {
  if (POLICY_REASONS.has(blocker.reason)) {
    return {
      kind: 'tab',
      label: t('containerComponents.updateStatus.actions.editPolicy'),
      tab: 'actions',
      section: 'update-policy',
    };
  }
  if (blocker.reason === 'group-notify-only') {
    return groupEditorAction(blocker.details?.group, t);
  }
  if (blocker.reason === 'trigger-excluded' && blocker.details?.excludedBy === 'group') {
    const action = groupEditorAction(blocker.details.group, t);
    if (action) return action;
  }
  if (blocker.reason === 'trigger-excluded' || blocker.reason === 'trigger-not-included') {
    return {
      kind: 'external',
      label: t('containerComponents.updateStatus.actions.configureLabels'),
      href: ELIGIBILITY_DOCS,
    };
  }
  if (blocker.reason === 'active-operation') {
    return {
      kind: 'tab',
      label: t('containerComponents.updateStatus.actions.viewOperation'),
      tab: 'actions',
      section: 'update-operation-history',
    };
  }
  if (blocker.reason === 'security-scan-blocked') {
    return {
      kind: 'route',
      label: t('containerComponents.updateStatus.actions.reviewSecurity'),
      to: { path: '/security' },
    };
  }
  if (blocker.reason === 'last-update-rolled-back' || blocker.reason === 'rollback-container') {
    return {
      kind: 'route',
      label: t('containerComponents.updateStatus.actions.viewRollback'),
      to: {
        path: '/audit',
        query: { actions: 'rollback,auto-rollback', container: container.name },
      },
    };
  }
  if (blocker.reason === 'agent-mismatch') {
    return {
      kind: 'external',
      label: t('containerComponents.updateStatus.actions.configureAgent'),
      href: 'https://getdrydock.com/docs/configuration/actions/update-eligibility#update-status-says-agent-mismatch',
    };
  }
  if (blocker.reason === 'no-update-trigger-configured') {
    return {
      kind: 'external',
      label: t('containerComponents.updateStatus.actions.configureTriggers'),
      href: 'https://getdrydock.com/docs/configuration/triggers',
    };
  }
  if (blocker.reason === 'threshold-not-reached') {
    return {
      kind: 'external',
      label: t('containerComponents.updateStatus.actions.configureThreshold'),
      href: ELIGIBILITY_DOCS,
    };
  }
  if (blocker.reason === 'maintenance-window-closed') {
    return {
      kind: 'external',
      label: t('containerComponents.updateStatus.actions.configureMaintenance'),
      href: ELIGIBILITY_DOCS,
    };
  }
  /* v8 ignore next -- final visible reason; no-update-available is filtered before this mapper */
  if (blocker.reason === 'self-update-unavailable') {
    return {
      kind: 'external',
      label: t('containerComponents.updateStatus.actions.configureSelfUpdate'),
      href: 'https://getdrydock.com/docs/configuration/self-update',
    };
  }
  /* v8 ignore next -- every runtime blocker reason is handled above; retained for forward safety */
  return undefined;
}

const CONDITION_ICONS: Record<UpdateStatusConditionReason, string> = {
  'group-notify-only': 'notifications',
  'group-manual-only': 'containers',
  'security-scan-blocked': 'security',
  'last-update-rolled-back': 'restart',
  'rollback-container': 'restart',
  snoozed: 'clock',
  'skip-tag': 'skip-forward',
  'skip-digest': 'skip-forward',
  'maturity-not-reached': 'uptime',
  'maintenance-window-closed': 'uptime',
  'active-operation': 'spinner',
  'agent-mismatch': 'triggers',
  'no-update-trigger-configured': 'triggers',
  'threshold-not-reached': 'triggers',
  'trigger-excluded': 'triggers',
  'trigger-not-included': 'triggers',
  'self-update-unavailable': 'containers',
  'no-update-available': 'up-to-date',
};

function conditionHeading(reason: UpdateStatusConditionReason, t: Translate): string {
  return t(`containerComponents.updateStatus.conditions.${reason}`);
}

function sortConditions(left: UpdateBlocker, right: UpdateBlocker): number {
  const leftSeverity = severityOf(left) === 'hard' ? 0 : 1;
  const rightSeverity = severityOf(right) === 'hard' ? 0 : 1;
  return leftSeverity - rightSeverity;
}

/**
 * The maturity-not-reached blocker's plain message no longer states which clock it's
 * measuring against — that's now named explicitly here from the backend-resolved
 * clockSource/clockStartAt (computeUpdateEligibility() in
 * app/model/update-eligibility.ts, resolveMaturityClock() in
 * app/model/maturity-policy.ts), so the UI shows the same clock the server enforced
 * instead of re-deriving one from updateDetectedAt alone (#display-honesty item 4).
 * Falls back to the plain backend message when the clock details aren't present
 * (e.g. older cached payloads).
 */
function maturitySentence(blocker: UpdateBlocker, t: Translate): string {
  const details = blocker.details ?? {};
  const clockStartAt = details.clockStartAt;
  const minAgeDays = details.minAgeDays;
  const remainingMs = details.remainingMs;
  if (
    typeof clockStartAt !== 'string' ||
    typeof minAgeDays !== 'number' ||
    typeof remainingMs !== 'number'
  ) {
    return blocker.message;
  }
  const date = new Date(clockStartAt).toLocaleDateString();
  const count = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  const key =
    details.clockSource === 'publishedAt'
      ? 'containerComponents.updateStatus.maturityClockPublished'
      : 'containerComponents.updateStatus.maturityClockDetected';
  return t(key, { date, count, minDays: minAgeDays });
}

function toCondition(
  blocker: UpdateBlocker,
  container: UpdateStatusContainer,
  t: Translate,
): UpdateStatusCondition {
  const severity = severityOf(blocker);
  return {
    reason: blocker.reason,
    severity,
    tone:
      blocker.reason === 'active-operation' ? 'info' : severity === 'hard' ? 'danger' : 'warning',
    icon: CONDITION_ICONS[blocker.reason],
    heading: conditionHeading(blocker.reason, t),
    body:
      blocker.reason === 'maturity-not-reached' ? maturitySentence(blocker, t) : blocker.message,
    liftableAt: blocker.liftableAt,
    action: conditionAction(blocker, container, t),
  };
}

export function formatLiftCountdown(liftableAt: string, nowMs: number): string | undefined {
  const liftableAtMs = Date.parse(liftableAt);
  if (!Number.isFinite(liftableAtMs)) return undefined;
  const totalMinutes = Math.max(0, Math.ceil((liftableAtMs - nowMs) / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * The group name when the server reports that its group caps updates at manual. Reads the
 * server-resolved `updateMode`; the ceiling is never recomputed from the policy here.
 */
function groupManualCeiling(eligibility: UpdateEligibility | undefined): string | undefined {
  const updateMode = eligibility?.updateMode;
  if (updateMode?.source !== 'group' || updateMode.value !== 'manual') return undefined;
  return updateMode.group;
}

function groupManualCondition(group: string, t: Translate): UpdateStatusCondition {
  return {
    reason: 'group-manual-only',
    severity: 'soft',
    tone: 'info',
    icon: CONDITION_ICONS['group-manual-only'],
    heading: conditionHeading('group-manual-only', t),
    body: t('containerComponents.updateStatus.groupManualOnly', { group }),
    action: groupEditorAction(group, t),
  };
}

function actionPolicyBadgeFor(
  actionPolicy: UpdateEligibility['actionPolicy'],
  t: Translate,
): ActionPolicyBadge | undefined {
  if (actionPolicy?.state !== 'auto') {
    return undefined;
  }
  return {
    state: actionPolicy.state,
    label: t('containerComponents.updateStatus.actionPolicyBadge.auto'),
    tooltip: t('containerComponents.updateStatus.actionPolicyTooltip.auto'),
  };
}

export function deriveUpdateStatus(input: UpdateStatusInput): UpdateStatusViewModel {
  const { container, t } = input;
  const groupManual = groupManualCeiling(container.updateEligibility);
  // A group manual ceiling means automatic dispatch isn't in play for this container.
  const mode: UpdateMode =
    groupManual !== undefined && input.mode === 'auto' ? 'manual' : input.mode;
  const allBlockers = container.updateEligibility?.blockers ?? [];
  const activeOperation =
    Boolean(input.hasActiveOperationBadge) ||
    allBlockers.some((blocker) => blocker.reason === 'active-operation');
  const hasUpdate = activeOperation || hasRawUpdateCandidate(container);
  const visibleBlockers = allBlockers
    .filter((blocker) => blocker.reason !== 'no-update-available')
    .filter((blocker) => !(input.hasActiveOperationBadge && blocker.reason === 'active-operation'))
    .sort(sortConditions);
  const conditions = visibleBlockers.map((blocker) => toCondition(blocker, container, t));
  if (groupManual !== undefined && hasUpdate) {
    conditions.push(groupManualCondition(groupManual, t));
  }
  const hardBlocked = allBlockers.some(
    (blocker) => blocker.reason !== 'active-operation' && severityOf(blocker) === 'hard',
  );
  const softBlocked = allBlockers.some((blocker) => severityOf(blocker) === 'soft');

  let state: UpdateStatusState;
  let tone: UpdateStatusViewModel['tone'];
  let icon: string;
  let summary: string;

  if (!hasUpdate && container.registryError) {
    // A failed check is more actionable than a routine pin-gate note, so the
    // error wins even when an updateInsight is also present (#814, #808).
    state = 'unknown';
    tone = 'warning';
    icon = 'warning';
    summary = t('containerComponents.updateStatus.summary.unknown');
  } else if (!hasUpdate && container.updateInsight) {
    state = 'insight';
    tone = 'info';
    icon = 'pin';
    summary = t('containerComponents.updateStatus.summary.insight');
  } else if (!hasUpdate) {
    state = 'up-to-date';
    tone = 'success';
    icon = 'up-to-date';
    summary = t('containerComponents.updateStatus.summary.upToDate');
  } else if (activeOperation) {
    state = 'in-progress';
    tone = 'info';
    icon = 'spinner';
    summary = t('containerComponents.updateStatus.summary.inProgress');
  } else if (mode === 'notify') {
    state = 'notify';
    tone = 'neutral';
    icon = 'notifications';
    summary = t('containerComponents.updateStatus.summary.notify');
  } else if (hardBlocked) {
    state = 'hard-blocked';
    tone = 'danger';
    icon = 'lock';
    summary = t('containerComponents.updateStatus.summary.hardBlocked');
  } else if (softBlocked) {
    state = 'soft-blocked';
    tone = 'warning';
    icon = 'warning';
    summary =
      mode === 'auto'
        ? t('containerComponents.updateStatus.summary.autoFiltered')
        : t('containerComponents.updateStatus.summary.manualFiltered');
  } else {
    state = 'ready';
    tone = 'success';
    icon = 'cloud-download';
    summary =
      mode === 'auto'
        ? t('containerComponents.updateStatus.summary.autoReady')
        : t('containerComponents.updateStatus.summary.manualReady');
  }

  const insightNote =
    !hasUpdate && container.updateInsight
      ? t('containerComponents.updateInsight.tooltip', { tag: container.updateInsight.tag })
      : undefined;

  return {
    state,
    tone,
    icon,
    summary,
    conditions,
    detailsCollapsed: mode === 'notify',
    hasUpdate,
    manualUpdateDisabled: !hasUpdate || mode === 'notify' || hardBlocked || activeOperation,
    insightNote,
    actionPolicyBadge:
      groupManual === undefined
        ? actionPolicyBadgeFor(container.updateEligibility?.actionPolicy, t)
        : undefined,
  };
}

export function useUpdateStatus(
  input: () => Omit<UpdateStatusInput, 't'>,
): ComputedRef<UpdateStatusViewModel> {
  const { t } = useI18n();
  return computed(() => deriveUpdateStatus({ ...input(), t }));
}
