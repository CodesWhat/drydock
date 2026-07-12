import { type ComputedRef, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { UpdateMode } from '../services/settings';
import type {
  UpdateBlocker,
  UpdateBlockerReason,
  UpdateBlockerSeverity,
  UpdateEligibility,
} from '../types/container';
import { severityOf } from '../utils/update-eligibility';

type Translate = (key: string, params?: Record<string, unknown>) => string;

export interface UpdateStatusContainer {
  id: string;
  name: string;
  newTag?: string | null;
  newDigest?: string | null;
  updateEligibility?: UpdateEligibility;
}

export type UpdateStatusAction =
  | { kind: 'tab'; label: string; tab: string; section?: string }
  | {
      kind: 'route';
      label: string;
      to: { path: string; query?: Record<string, string> };
    };

export interface UpdateStatusCondition {
  reason: UpdateBlockerReason;
  severity: UpdateBlockerSeverity;
  tone: 'danger' | 'warning' | 'info';
  icon: string;
  heading: string;
  body: string;
  liftableAt?: string;
  action?: UpdateStatusAction;
}

export type UpdateStatusState =
  | 'up-to-date'
  | 'ready'
  | 'soft-blocked'
  | 'hard-blocked'
  | 'in-progress'
  | 'notify';

export interface UpdateStatusViewModel {
  state: UpdateStatusState;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  icon: string;
  summary: string;
  conditions: UpdateStatusCondition[];
  detailsCollapsed: boolean;
  hasUpdate: boolean;
  manualUpdateDisabled: boolean;
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

const LABEL_REASONS = new Set<UpdateBlockerReason>(['trigger-excluded', 'trigger-not-included']);

const TRIGGER_REASONS = new Set<UpdateBlockerReason>([
  'agent-mismatch',
  'no-update-trigger-configured',
  'threshold-not-reached',
]);

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
  if (LABEL_REASONS.has(blocker.reason)) {
    return {
      kind: 'tab',
      label: t('containerComponents.updateStatus.actions.reviewLabels'),
      tab: 'labels',
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
  if (TRIGGER_REASONS.has(blocker.reason)) {
    const triggerId = blocker.details?.triggerId;
    return {
      kind: 'route',
      label: t('containerComponents.updateStatus.actions.reviewTriggers'),
      to: {
        path: '/triggers',
        ...(typeof triggerId === 'string' && triggerId ? { query: { q: triggerId } } : {}),
      },
    };
  }
  if (blocker.reason === 'maintenance-window-closed') {
    return {
      kind: 'route',
      label: t('containerComponents.updateStatus.actions.reviewWatchers'),
      to: { path: '/watchers' },
    };
  }
  if (blocker.reason === 'self-update-unavailable') {
    return {
      kind: 'route',
      label: t('containerComponents.updateStatus.actions.reviewWatchers'),
      to: { path: '/watchers' },
    };
  }
  return undefined;
}

function conditionIcon(reason: UpdateBlockerReason): string {
  switch (reason) {
    case 'security-scan-blocked':
      return 'security';
    case 'last-update-rolled-back':
    case 'rollback-container':
      return 'restart';
    case 'snoozed':
      return 'clock';
    case 'skip-tag':
    case 'skip-digest':
      return 'skip-forward';
    case 'maturity-not-reached':
    case 'maintenance-window-closed':
      return 'uptime';
    case 'active-operation':
      return 'spinner';
    case 'agent-mismatch':
    case 'no-update-trigger-configured':
    case 'threshold-not-reached':
    case 'trigger-excluded':
    case 'trigger-not-included':
      return 'triggers';
    case 'self-update-unavailable':
      return 'containers';
    default:
      return 'warning';
  }
}

function conditionHeading(reason: UpdateBlockerReason, t: Translate): string {
  return t(`containerComponents.updateStatus.conditions.${reason}`);
}

function sortConditions(left: UpdateBlocker, right: UpdateBlocker): number {
  const leftSeverity = severityOf(left) === 'hard' ? 0 : 1;
  const rightSeverity = severityOf(right) === 'hard' ? 0 : 1;
  return leftSeverity - rightSeverity;
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
    icon: conditionIcon(blocker.reason),
    heading: conditionHeading(blocker.reason, t),
    body: blocker.message,
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

export function deriveUpdateStatus(input: UpdateStatusInput): UpdateStatusViewModel {
  const { container, mode, t } = input;
  const hasUpdate = Boolean(container.newTag || container.newDigest);
  const allBlockers = container.updateEligibility?.blockers ?? [];
  const activeOperation = allBlockers.some((blocker) => blocker.reason === 'active-operation');
  const visibleBlockers = allBlockers
    .filter((blocker) => blocker.reason !== 'no-update-available')
    .filter((blocker) => !(input.hasActiveOperationBadge && blocker.reason === 'active-operation'))
    .sort(sortConditions);
  const conditions = visibleBlockers.map((blocker) => toCondition(blocker, container, t));
  const hardBlocked = allBlockers.some(
    (blocker) => blocker.reason !== 'active-operation' && severityOf(blocker) === 'hard',
  );
  const softBlocked = allBlockers.some((blocker) => severityOf(blocker) === 'soft');

  let state: UpdateStatusState;
  let tone: UpdateStatusViewModel['tone'];
  let icon: string;
  let summary: string;

  if (!hasUpdate) {
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

  return {
    state,
    tone,
    icon,
    summary,
    conditions,
    detailsCollapsed: mode === 'notify',
    hasUpdate,
    manualUpdateDisabled: !hasUpdate || mode === 'notify' || hardBlocked || activeOperation,
  };
}

export function useUpdateStatus(
  input: () => Omit<UpdateStatusInput, 't'>,
): ComputedRef<UpdateStatusViewModel> {
  const { t } = useI18n();
  return computed(() => deriveUpdateStatus({ ...input(), t }));
}
