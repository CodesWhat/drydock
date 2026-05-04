import { findDockerTriggerForContainer } from '../api/docker-trigger.js';
import type Trigger from '../triggers/providers/Trigger.js';
import { isThresholdReached } from '../triggers/providers/trigger-threshold.js';
import type { Container } from './container.js';
import { isRollbackContainer } from './container.js';
import { maturityMinAgeDaysToMilliseconds, resolveMaturityMinAgeDays } from './maturity-policy.js';

export type UpdateBlockerReason =
  | 'no-update-available'
  | 'rollback-container'
  | 'active-operation'
  | 'security-scan-blocked'
  | 'last-update-rolled-back'
  | 'snoozed'
  | 'skip-tag'
  | 'skip-digest'
  | 'maturity-not-reached'
  | 'threshold-not-reached'
  | 'trigger-excluded'
  | 'trigger-not-included'
  | 'agent-mismatch'
  | 'no-update-trigger-configured';

/**
 * Severity controls how a blocker is enforced:
 * - 'hard': API rejects manual update with the blocker's message; UI disables the Update button.
 * - 'soft': API allows manual update; UI shows the pill but the button stays enabled (with a
 *   warning + confirm modal listing the soft blockers).
 *
 * `trigger-not-included` and `trigger-excluded` are 'soft' in v1.5.x with a deprecation
 * notice — they become 'hard' in v1.7.0. See DEPRECATIONS.md.
 */
export type UpdateBlockerSeverity = 'hard' | 'soft';

export const BLOCKER_SEVERITY: Record<UpdateBlockerReason, UpdateBlockerSeverity> = {
  'no-update-available': 'hard',
  'rollback-container': 'hard',
  'active-operation': 'hard',
  'security-scan-blocked': 'hard',
  'last-update-rolled-back': 'hard',
  'agent-mismatch': 'hard',
  'no-update-trigger-configured': 'hard',
  snoozed: 'soft',
  'skip-tag': 'soft',
  'skip-digest': 'soft',
  'maturity-not-reached': 'soft',
  'threshold-not-reached': 'soft',
  // Deprecation: become 'hard' in v1.7.0. See DEPRECATIONS.md.
  'trigger-excluded': 'soft',
  'trigger-not-included': 'soft',
};

export interface UpdateBlocker {
  reason: UpdateBlockerReason;
  severity: UpdateBlockerSeverity;
  message: string;
  actionable: boolean;
  actionHint?: string;
  liftableAt?: string;
  details?: Record<string, unknown>;
}

export function getHardBlockers(eligibility: UpdateEligibility | undefined): UpdateBlocker[] {
  if (!eligibility) return [];
  return eligibility.blockers.filter((blocker) => blocker.severity === 'hard');
}

export function getSoftBlockers(eligibility: UpdateEligibility | undefined): UpdateBlocker[] {
  if (!eligibility) return [];
  return eligibility.blockers.filter((blocker) => blocker.severity === 'soft');
}

export function hasHardBlocker(eligibility: UpdateEligibility | undefined): boolean {
  return getHardBlockers(eligibility).length > 0;
}

export function getPrimaryHardBlocker(
  eligibility: UpdateEligibility | undefined,
): UpdateBlocker | undefined {
  return getHardBlockers(eligibility)[0];
}

function makeBlocker(blocker: Omit<UpdateBlocker, 'severity'>): UpdateBlocker {
  return { ...blocker, severity: BLOCKER_SEVERITY[blocker.reason] };
}

export interface UpdateEligibility {
  eligible: boolean;
  blockers: UpdateBlocker[];
  evaluatedAt: string;
}

export interface UpdateEligibilityContext {
  triggers: Record<string, Trigger> | undefined;
  getActiveOperation: (
    container: Container,
  ) => { id: string; status: 'queued' | 'in-progress'; updatedAt?: string } | undefined;
  now?: number;
}

// Minimal interface for the trigger instance methods we need at runtime
interface TriggerInstanceMethods {
  agent?: string;
  configuration?: { threshold?: string };
  getId?: () => string;
  isTriggerIncluded: (container: Container, include: string | undefined) => boolean;
  isTriggerExcluded: (container: Container, exclude: string | undefined) => boolean;
}

function formatSnoozeDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

function hasRawTagOrDigestUpdate(container: Container): boolean {
  if (!container.image || !container.result) {
    return false;
  }

  // Check tag update (with transform applied by container.ts — use raw values here for
  // consistency with hasRawUpdate in container.ts)
  const localTag = container.image.tag?.value;
  const remoteTag = container.result.tag;
  if (localTag !== undefined && remoteTag !== undefined && localTag !== remoteTag) {
    return true;
  }

  // Fallback to image created date (especially for legacy v1 manifests)
  if (container.image.created !== undefined && container.result.created !== undefined) {
    const localCreatedMs = new Date(container.image.created).getTime();
    const remoteCreatedMs = new Date(container.result.created).getTime();
    if (localCreatedMs !== remoteCreatedMs) {
      return true;
    }
  }

  // Check digest update
  if (
    container.image.digest?.watch &&
    container.image.digest.value !== undefined &&
    container.result.digest !== undefined &&
    container.image.digest.value !== container.result.digest
  ) {
    return true;
  }

  return false;
}

export function computeUpdateEligibility(
  container: Container,
  context: UpdateEligibilityContext,
): UpdateEligibility {
  const now = context.now ?? Date.now();
  const evaluatedAt = new Date(now).toISOString();

  // If no raw update exists at all, short-circuit with no-update-available only
  if (!hasRawTagOrDigestUpdate(container)) {
    return {
      eligible: false,
      blockers: [
        makeBlocker({
          reason: 'no-update-available',
          message: 'No newer image detected.',
          actionable: false,
        }),
      ],
      evaluatedAt,
    };
  }

  const blockers: UpdateBlocker[] = [];

  // 1. security-scan-blocked — fires when either the candidate update scan or the
  // current container's existing scan is blocked. The candidate scan reflects the
  // image we'd pull; the current scan reflects vulnerabilities we're already running.
  // Either is grounds to halt an update until the operator triages.
  if (
    container.security?.updateScan?.status === 'blocked' ||
    container.security?.scan?.status === 'blocked'
  ) {
    blockers.push(
      makeBlocker({
        reason: 'security-scan-blocked',
        message: 'Security scan is blocking this update (critical/high vulnerabilities).',
        actionable: true,
        actionHint: 'Use force-update to override, or lower the scan severity threshold.',
      }),
    );
  }

  // 1b. last-update-rolled-back — fires when the last update attempt for this
  // container was rolled back and the candidate digest is unchanged. This prevents
  // the user from immediately re-triggering the same broken update.
  //
  // The block is digest-scoped: a different candidate digest (e.g. a newer release)
  // is never blocked. The operator can also opt out via dd.update.rollback-gate=off.
  if (container.updateRollback) {
    const candidateDigest = container.result?.digest;
    const rollbackGateLabelRaw = container.labels?.['dd.update.rollback-gate'];
    const rollbackGateOff =
      typeof rollbackGateLabelRaw === 'string' &&
      rollbackGateLabelRaw.trim().toLowerCase() === 'off';

    if (
      !rollbackGateOff &&
      candidateDigest !== undefined &&
      candidateDigest === container.updateRollback.targetDigest
    ) {
      blockers.push(
        makeBlocker({
          reason: 'last-update-rolled-back',
          message:
            'Last update attempt rolled back. The same target digest is blocked until a newer image is available.',
          actionable: true,
          actionHint:
            'Wait for a newer image to be released, or set dd.update.rollback-gate=off to override.',
          details: {
            targetDigest: container.updateRollback.targetDigest,
            rollbackReason: container.updateRollback.reason,
            lastError: container.updateRollback.lastError,
            recordedAt: container.updateRollback.recordedAt,
          },
        }),
      );
    }
  }

  // 2. snoozed
  const snoozeUntil = container.updatePolicy?.snoozeUntil;
  if (snoozeUntil) {
    const snoozeUntilMs = new Date(snoozeUntil).getTime();
    if (Number.isFinite(snoozeUntilMs) && snoozeUntilMs > now) {
      blockers.push(
        makeBlocker({
          reason: 'snoozed',
          message: `Snoozed until ${formatSnoozeDate(snoozeUntil)}.`,
          actionable: true,
          actionHint: 'Clear snooze from the container menu.',
          liftableAt: snoozeUntil,
        }),
      );
    }
  }

  // 3. skip-tag
  const remoteTag = container.result?.tag;
  const skipTags = container.updatePolicy?.skipTags;
  if (remoteTag && Array.isArray(skipTags) && skipTags.includes(remoteTag)) {
    blockers.push(
      makeBlocker({
        reason: 'skip-tag',
        message: `Tag ${remoteTag} is in the skip list.`,
        actionable: true,
        actionHint: 'Remove the skip entry from the container menu.',
        details: { skippedTag: remoteTag },
      }),
    );
  }

  // 4. skip-digest
  const remoteDigest = container.result?.digest;
  const skipDigests = container.updatePolicy?.skipDigests;
  if (remoteDigest && Array.isArray(skipDigests) && skipDigests.includes(remoteDigest)) {
    blockers.push(
      makeBlocker({
        reason: 'skip-digest',
        message: `Digest ${remoteDigest} is in the skip list.`,
        actionable: true,
        actionHint: 'Remove the skip entry from the container menu.',
        details: { skippedDigest: remoteDigest },
      }),
    );
  }

  // 5. maturity-not-reached
  if (container.updatePolicy?.maturityMode === 'mature') {
    const updateDetectedAtMs = Date.parse(container.updateDetectedAt || '');
    const maturityMinAgeDays = resolveMaturityMinAgeDays(container.updatePolicy.maturityMinAgeDays);
    const maturityMinAgeMs = maturityMinAgeDaysToMilliseconds(maturityMinAgeDays);

    if (!Number.isFinite(updateDetectedAtMs) || now - updateDetectedAtMs < maturityMinAgeMs) {
      const remainingMs = Number.isFinite(updateDetectedAtMs)
        ? Math.max(0, maturityMinAgeMs - (now - updateDetectedAtMs))
        : maturityMinAgeMs;
      const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      const liftableAt = Number.isFinite(updateDetectedAtMs)
        ? new Date(updateDetectedAtMs + maturityMinAgeMs).toISOString()
        : undefined;

      blockers.push(
        makeBlocker({
          reason: 'maturity-not-reached',
          message: `Maturity policy requires updates to be at least ${maturityMinAgeDays} days old (${remainingDays} day${remainingDays !== 1 ? 's' : ''} remaining).`,
          actionable: true,
          actionHint: "Change maturity mode to 'all' or wait for the gate to clear.",
          ...(liftableAt ? { liftableAt } : {}),
          details: {
            minAgeDays: maturityMinAgeDays,
            remainingMs,
          },
        }),
      );
    }
  }

  // Resolve a candidate docker/dockercompose trigger for trigger-level checks.
  //
  // findDockerTriggerForContainer uses full compatibility checking (including agent matching),
  // so it won't return a trigger when the agent doesn't match. To distinguish
  // "no docker trigger at all" from "trigger exists but agent is wrong", we also do a
  // type-only lookup that ignores agent constraints.
  const DOCKER_TRIGGER_TYPES = new Set(['docker', 'dockercompose']);

  function findDockerTriggerByTypeOnly(
    triggers: Record<string, TriggerInstanceMethods> | undefined,
  ): TriggerInstanceMethods | undefined {
    if (!triggers) return undefined;
    for (const trigger of Object.values(triggers)) {
      const type = (trigger as unknown as { type?: string }).type ?? '';
      if (DOCKER_TRIGGER_TYPES.has(type.toLowerCase())) {
        return trigger;
      }
    }
    return undefined;
  }

  const candidateTrigger = findDockerTriggerForContainer(context.triggers, container) as unknown as
    | TriggerInstanceMethods
    | undefined;

  const typeOnlyTrigger: TriggerInstanceMethods | undefined =
    candidateTrigger ??
    findDockerTriggerByTypeOnly(
      context.triggers as Record<string, TriggerInstanceMethods> | undefined,
    );

  if (!typeOnlyTrigger) {
    // 11. no-update-trigger-configured — no docker/dockercompose trigger exists at all
    blockers.push(
      makeBlocker({
        reason: 'no-update-trigger-configured',
        message: 'No docker or dockercompose action trigger is configured for this container.',
        actionable: true,
        actionHint: 'Configure `DD_ACTION_DOCKER_*` or `DD_ACTION_DOCKERCOMPOSE_*`.',
      }),
    );
  } else if (!candidateTrigger) {
    // A docker trigger exists but it's not compatible with this container's agent.
    // 10. agent-mismatch (detected here because full lookup failed but type-only succeeded)
    const t = typeOnlyTrigger;
    const triggerAgent = t.agent;
    blockers.push(
      makeBlocker({
        reason: 'agent-mismatch',
        message: `Update trigger runs on agent '${triggerAgent ?? '<none>'}'; container is on agent '${container.agent ?? '<none>'}'.`,
        actionable: true,
        actionHint: 'Configure an update trigger for the target agent.',
        details: {
          triggerAgent,
          containerAgent: container.agent,
          triggerId: t.getId?.(),
        },
      }),
    );
  } else {
    const t = candidateTrigger;

    // 6. threshold-not-reached
    const threshold = (t.configuration?.threshold ?? 'all').toLowerCase();
    if (!isThresholdReached(container, threshold)) {
      blockers.push(
        makeBlocker({
          reason: 'threshold-not-reached',
          message: `Trigger threshold is '${threshold}'; detected update is '${container.updateKind?.semverDiff ?? container.updateKind?.kind ?? 'unknown'}'.`,
          actionable: true,
          actionHint: "Lower the trigger threshold (e.g. from 'major' to 'all').",
          details: {
            threshold,
            updateKind: container.updateKind?.kind,
            semverDiff: container.updateKind?.semverDiff,
            triggerId: t.getId?.(),
          },
        }),
      );
    }

    // 7. rollback-container
    if (isRollbackContainer(container)) {
      blockers.push(
        makeBlocker({
          reason: 'rollback-container',
          message: 'This is a rollback container created during a previous update.',
          actionable: false,
        }),
      );
    }

    // 8. trigger-excluded / 9. trigger-not-included
    const { triggerInclude, triggerExclude } = container;
    const included = t.isTriggerIncluded(container, triggerInclude);
    const excluded = t.isTriggerExcluded(container, triggerExclude);

    if (excluded) {
      blockers.push(
        makeBlocker({
          reason: 'trigger-excluded',
          message: `Trigger excluded by container label dd.trigger.exclude='${triggerExclude}'.`,
          actionable: true,
          actionHint: 'Adjust `dd.trigger.include` / `dd.trigger.exclude` labels on the container.',
          details: {
            triggerExclude,
            triggerId: t.getId?.(),
          },
        }),
      );
    } else if (!included) {
      blockers.push(
        makeBlocker({
          reason: 'trigger-not-included',
          message: `Trigger not matched by container label dd.trigger.include='${triggerInclude}'.`,
          actionable: true,
          actionHint: 'Adjust `dd.trigger.include` / `dd.trigger.exclude` labels on the container.',
          details: {
            triggerInclude,
            triggerId: t.getId?.(),
          },
        }),
      );
    }
  }

  // 12. active-operation
  const activeOp = context.getActiveOperation(container);
  if (activeOp) {
    const isQueued = activeOp.status === 'queued';
    blockers.push(
      makeBlocker({
        reason: 'active-operation',
        message: isQueued ? 'Update already queued.' : 'Update already in progress.',
        actionable: false,
        details: {
          operationId: activeOp.id,
          status: activeOp.status,
        },
      }),
    );
  }

  // eligible = raw update exists AND no policy/trigger blockers
  const eligible = blockers.length === 0;

  return {
    eligible,
    blockers,
    evaluatedAt,
  };
}
